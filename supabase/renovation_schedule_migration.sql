-- 履约进度表（甘特图）：每张子单有「计划开始 / 计划完成」，系统先按常规顺序自动排，员工再拖改。
-- 业主的查看链接里显示简版进度表（子单名称、计划日期、完成了几项），不含厂家、单号、内部备注。
-- 同时放宽一条规则：材料下单不再要求先填执行人（排期、完工仍然要求）。
-- 依赖 renovation_fulfillment_migration.sql。可重复运行。

ALTER TABLE public.renovation_work_orders ADD COLUMN IF NOT EXISTS planned_start date;
ALTER TABLE public.renovation_work_orders ADD COLUMN IF NOT EXISTS planned_end date;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='reno_work_plan_order') THEN
  ALTER TABLE public.renovation_work_orders ADD CONSTRAINT reno_work_plan_order CHECK(planned_start IS NULL OR planned_end IS NULL OR planned_end>=planned_start);
 END IF;
END $$;

-- 员工保存计划日期：p_plans = [{work_order_id, start, end}]，start/end 为 null 表示清空。
CREATE OR REPLACE FUNCTION public.renovation_schedule_save(p_id uuid,p_plans jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;x jsonb;w renovation_work_orders%ROWTYPE;s date;e date;n integer:=0;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '请登录后重试'; END IF;
 IF p_plans IS NULL OR jsonb_typeof(p_plans)<>'array' OR jsonb_array_length(p_plans)=0 THEN RAISE EXCEPTION '没有要保存的计划'; END IF;
 IF jsonb_array_length(p_plans)>200 THEN RAISE EXCEPTION '一次最多保存 200 张子单'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF p.state NOT IN ('confirmed','executing') THEN RAISE EXCEPTION '项目当前不可修改进度计划'; END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(p_plans) LOOP
  SELECT * INTO w FROM renovation_work_orders WHERE id=(x->>'work_order_id')::uuid AND project_id=p_id AND cancelled_at IS NULL FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION '子订单不存在或已作废，请刷新后重试'; END IF;
  BEGIN s:=nullif(x->>'start','')::date;e:=nullif(x->>'end','')::date;
  EXCEPTION WHEN others THEN RAISE EXCEPTION '「%」的日期格式不对',w.group_name; END;
  IF (s IS NULL)<>(e IS NULL) THEN RAISE EXCEPTION '「%」要同时填开始和完成日期',w.group_name; END IF;
  IF e<s THEN RAISE EXCEPTION '「%」的完成日期不能早于开始日期',w.group_name; END IF;
  IF s<DATE '2020-01-01' OR e>DATE '2099-12-31' OR e-s>730 THEN RAISE EXCEPTION '「%」的日期超出合理范围',w.group_name; END IF;
  UPDATE renovation_work_orders SET planned_start=s,planned_end=e,updated_at=now() WHERE id=w.id;
  n:=n+1;
 END LOOP;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p_id,auth.uid(),'schedule_saved',jsonb_build_object('count',n,'plans',p_plans));
 RETURN jsonb_build_object('ok',true,'count',n);
END $$;
REVOKE ALL ON FUNCTION public.renovation_schedule_save(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_schedule_save(uuid,jsonb) TO authenticated;

-- 业主查看链接用：只给子单名称（增项去掉内部编号）、计划日期和完成项数。
CREATE OR REPLACE FUNCTION public.renovation_customer_schedule(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'name',regexp_replace(w.group_name,'^增项-[0-9a-fA-F-]{36} · ?','增项 · '),
   'planned_start',w.planned_start,'planned_end',w.planned_end,
   'total',(SELECT count(*) FROM renovation_work_items i WHERE i.work_order_id=w.id AND i.stage<>'cancelled'),
   'done',(SELECT count(*) FROM renovation_work_items i WHERE i.work_order_id=w.id AND i.stage='done'),
   'started',EXISTS(SELECT 1 FROM renovation_work_items i WHERE i.work_order_id=w.id AND i.stage IN ('arrived','scheduled','working','done')))
  ORDER BY w.planned_start NULLS LAST,w.group_name),'[]'::jsonb)
 FROM renovation_projects p JOIN renovation_work_orders w ON w.project_id=p.id AND w.cancelled_at IS NULL
 WHERE p.customer_token=p_token AND p.state<>'draft';
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_schedule(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_schedule(uuid) TO anon,authenticated;

-- 材料下单不再要求执行人：只去掉 place_order 分支里的那一行检查，函数其余内容原样保留。
-- 找不到预期内容且也不是已经改过的状态时直接报错，避免悄悄改错函数。
DO $$
DECLARE d text;
 old_text text:=E'ELSIF p_action=''place_order'' THEN\n  IF trim(w.assignee)='''' THEN RAISE EXCEPTION ''先指定执行人''; END IF;\n';
 new_text text:=E'ELSIF p_action=''place_order'' THEN\n';
BEGIN
 d:=pg_get_functiondef('public.renovation_fulfillment_command(uuid,integer,text,jsonb)'::regprocedure);
 IF position(old_text IN d)>0 THEN
  EXECUTE replace(d,old_text,new_text);
 ELSIF position(new_text IN d)=0 THEN
  RAISE EXCEPTION '没找到下单规则的位置，履约函数可能已被其他更新改过，请联系开发核对';
 END IF;
END $$;
