-- 施工计划：交房日、师傅名单、师傅跨工地撞期检查。
-- 依赖 renovation_schedule_migration.sql（子单的计划开始 / 完成）。可重复运行。

ALTER TABLE public.renovation_projects ADD COLUMN IF NOT EXISTS handover_on date;

-- 交房日：有项目权限的员工可以改；记入历史
CREATE OR REPLACE FUNCTION public.renovation_handover_date_save(p_id uuid,p_on date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF p.state NOT IN ('confirmed','executing') THEN RAISE EXCEPTION '项目当前不可修改交房日'; END IF;
 IF p_on IS NOT NULL AND (p_on<DATE '2020-01-01' OR p_on>DATE '2099-12-31') THEN RAISE EXCEPTION '交房日超出合理范围'; END IF;
 UPDATE renovation_projects SET handover_on=p_on,updated_at=now() WHERE id=p_id;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p_id,auth.uid(),'handover_date_saved',jsonb_build_object('on',p_on,'before',p.handover_on));
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.renovation_handover_date_save(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_handover_date_save(uuid,date) TO authenticated;

-- 师傅名单：每个门店一份；员工都能看，店长及以上能增改
CREATE TABLE IF NOT EXISTS public.renovation_crews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid REFERENCES public.stores(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60),
 trade text NOT NULL CHECK(trade IN ('杂工','水电工','泥水工','木工','油漆工','柜体安装队','厂家安装','清洁','其他')),
 phone text NOT NULL DEFAULT '' CHECK(length(phone)<=40),
 headcount integer NOT NULL DEFAULT 1 CHECK(headcount BETWEEN 1 AND 50),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=300),
 active boolean NOT NULL DEFAULT true,
 created_by uuid REFERENCES public.profiles(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS reno_crews_name ON public.renovation_crews(coalesce(store_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(trim(name)));
ALTER TABLE public.renovation_crews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.renovation_crews FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.renovation_crews TO authenticated;
-- 员工能看哪个门店的名单（在函数里查员工资料，员工本身不能直接读员工表）
CREATE OR REPLACE FUNCTION public._reno_crew_visible(p_store uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM profiles me WHERE me.id=auth.uid() AND coalesce(me.active,true)
  AND me.role IN ('staff','store_manager','regional_manager','general_manager','admin','superadmin')
  AND (p_store IS NULL OR me.store_id IS NULL OR me.store_id=p_store OR me.role IN ('regional_manager','general_manager','admin','superadmin')));
$$;
REVOKE ALL ON FUNCTION public._reno_crew_visible(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._reno_crew_visible(uuid) TO authenticated;
DROP POLICY IF EXISTS reno_crews_read ON public.renovation_crews;
CREATE POLICY reno_crews_read ON public.renovation_crews FOR SELECT TO authenticated USING(public._reno_crew_visible(store_id));

CREATE OR REPLACE FUNCTION public.renovation_crew_save(p_id uuid,p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me profiles%ROWTYPE;v_id uuid;v_store uuid;
BEGIN
 SELECT * INTO me FROM profiles WHERE id=auth.uid();
 IF me.id IS NULL OR me.role NOT IN ('store_manager','regional_manager','general_manager','admin','superadmin') THEN RAISE EXCEPTION '师傅名单只能由店长或上级修改'; END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION '资料格式不对'; END IF;
 v_store:=coalesce(nullif(p_data->>'store_id','')::uuid,me.store_id);
 IF me.role='store_manager' AND v_store IS DISTINCT FROM me.store_id THEN RAISE EXCEPTION '只能修改本店的师傅名单'; END IF;
 IF trim(coalesce(p_data->>'name',''))='' THEN RAISE EXCEPTION '请填写师傅 / 队伍名称'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO renovation_crews(store_id,name,trade,phone,headcount,note,created_by)
  VALUES(v_store,trim(p_data->>'name'),coalesce(p_data->>'trade','其他'),trim(coalesce(p_data->>'phone','')),coalesce((p_data->>'headcount')::int,1),trim(coalesce(p_data->>'note','')),me.id)
  RETURNING id INTO v_id;
 ELSE
  UPDATE renovation_crews SET name=trim(p_data->>'name'),trade=coalesce(p_data->>'trade',trade),phone=trim(coalesce(p_data->>'phone',phone)),
   headcount=coalesce((p_data->>'headcount')::int,headcount),note=trim(coalesce(p_data->>'note',note)),active=coalesce((p_data->>'active')::boolean,active),updated_at=now()
  WHERE id=p_id AND (me.role<>'store_manager' OR store_id IS NOT DISTINCT FROM me.store_id) RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION '找不到这位师傅，或不是本店的'; END IF;
 END IF;
 RETURN v_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION '名单里已经有同名的师傅 / 队伍';
END $$;
REVOKE ALL ON FUNCTION public.renovation_crew_save(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_crew_save(uuid,jsonb) TO authenticated;

-- 撞期检查：这些师傅在其它项目上、和给定日期重叠的计划（所有门店都查，只返回合同号、子单名和日期）
DROP FUNCTION IF EXISTS public.renovation_crew_busy(text[],uuid);
CREATE OR REPLACE FUNCTION public.renovation_crew_busy(p_names jsonb,p_exclude uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me profiles%ROWTYPE;
BEGIN
 SELECT * INTO me FROM profiles WHERE id=auth.uid();
 IF me.id IS NULL OR me.role NOT IN ('staff','store_manager','regional_manager','general_manager','admin','superadmin') THEN RAISE EXCEPTION '请登录后重试'; END IF;
 IF p_names IS NULL OR jsonb_typeof(p_names)<>'array' OR jsonb_array_length(p_names)=0 THEN RETURN '[]'::jsonb; END IF;
 IF jsonb_array_length(p_names)>100 THEN RAISE EXCEPTION '一次最多查 100 位'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('crew',w.assignee,'contract_no',p.contract_no,'group_name',regexp_replace(w.group_name,'^增项-[0-9a-fA-F-]{36} · ?','增项 · '),'start',w.planned_start,'end',w.planned_end) ORDER BY w.planned_start)
  FROM renovation_work_orders w JOIN renovation_projects p ON p.id=w.project_id
  WHERE p.id<>coalesce(p_exclude,'00000000-0000-0000-0000-000000000000'::uuid) AND p.state IN ('confirmed','executing') AND w.cancelled_at IS NULL
   AND w.planned_start IS NOT NULL AND lower(trim(w.assignee)) IN (SELECT lower(trim(x)) FROM jsonb_array_elements_text(p_names) x)
   AND NOT EXISTS(SELECT 1 FROM renovation_work_items i WHERE i.work_order_id=w.id AND i.stage<>'cancelled' HAVING bool_and(i.stage='done'))),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.renovation_crew_busy(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_crew_busy(jsonb,uuid) TO authenticated;
