-- 施工计划分两套：
--  预计计划（phase_baseline）：给业主看的承诺。店长点「确认预计计划」后锁定；锁定后只有店长能改，必须写原因，留记录。
--  实时计划（phase_plan）：现场在跑的计划。店里随时可调；监理报延误后，看板自动把后面的工序顺延并保存。
-- 业主链接只显示已确认的预计计划 + 每道工序的实际完成情况。
-- 依赖 renovation_phase_plan_migration.sql。可重复运行。
ALTER TABLE public.renovation_projects ADD COLUMN IF NOT EXISTS phase_baseline_locked_at timestamptz;
ALTER TABLE public.renovation_projects ADD COLUMN IF NOT EXISTS phase_baseline_locked_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.renovation_projects ADD COLUMN IF NOT EXISTS phase_lines jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.renovation_projects ADD COLUMN IF NOT EXISTS phase_delays_applied jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public._reno_phase_name(k text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE k WHEN 'prep' THEN '拆除保护' WHEN 'mep' THEN '水电' WHEN 'masonry' THEN '泥水' WHEN 'ceiling' THEN '天花木作' WHEN 'paint' THEN '油漆'
  WHEN 'cabinet' THEN '定制柜安装' WHEN 'fit' THEN '台面门窗玻璃' WHEN 'fixture' THEN '洁具灯具设备' WHEN 'clean' THEN '清洁交付' ELSE k END $$;

CREATE OR REPLACE FUNCTION public._reno_is_manager() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND coalesce(active,true) AND role IN ('store_manager','regional_manager','general_manager','admin','superadmin')) $$;
REVOKE ALL ON FUNCTION public._reno_is_manager() FROM PUBLIC,anon;

-- 校验并合并一份工序计划（两套计划共用）
CREATE OR REPLACE FUNCTION public._reno_phase_merge(old jsonb,p_plan jsonb,OUT merged jsonb,OUT changes jsonb) LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text;v jsonb;s date;e date;
 keys constant text[]:=ARRAY['prep','mep','masonry','ceiling','paint','cabinet','fit','fixture','clean'];
BEGIN
 IF p_plan IS NULL OR jsonb_typeof(p_plan)<>'object' THEN RAISE EXCEPTION '计划格式不对'; END IF;
 merged:=coalesce(old,'{}'::jsonb);changes:='[]'::jsonb;
 FOR k,v IN SELECT * FROM jsonb_each(p_plan) LOOP
  IF NOT k=ANY(keys) THEN RAISE EXCEPTION '不认识的工序：%',k; END IF;
  IF v IS NULL OR jsonb_typeof(v)='null' THEN
   IF merged ? k THEN changes:=changes||jsonb_build_array(jsonb_build_object('phase',k,'before_start',merged->k->>'start','before_end',merged->k->>'end','start',NULL,'end',NULL));END IF;
   merged:=merged-k;CONTINUE;
  END IF;
  BEGIN s:=(v->>'start')::date;e:=(v->>'end')::date; EXCEPTION WHEN others THEN RAISE EXCEPTION '工序日期格式不对'; END;
  IF s IS NULL OR e IS NULL OR e<s OR s<DATE '2020-01-01' OR e>DATE '2099-12-31' OR e-s>366 THEN RAISE EXCEPTION '工序日期不对：结束不能早于开始，单道工序最长一年'; END IF;
  IF (merged->k->>'start') IS DISTINCT FROM s::text OR (merged->k->>'end') IS DISTINCT FROM e::text THEN
   changes:=changes||jsonb_build_array(jsonb_build_object('phase',k,'before_start',merged->k->>'start','before_end',merged->k->>'end','start',s,'end',e));
  END IF;
  merged:=merged||jsonb_build_object(k,jsonb_build_object('start',s,'end',e));
 END LOOP;
END $$;

-- 实时计划保存。预计计划没确认前，预计 = 实时（跟着变）；确认后不再跟着变。
DROP FUNCTION IF EXISTS public.renovation_phase_plan_save(uuid,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.renovation_phase_plan_save(uuid,jsonb,jsonb,jsonb,uuid[]);
CREATE OR REPLACE FUNCTION public.renovation_phase_plan_save(p_id uuid,p_plan jsonb,p_work jsonb,p_lines jsonb DEFAULT NULL,p_delays jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;m record;x jsonb;w renovation_work_orders%ROWTYPE;s date;e date;n integer:=0;who text;applied jsonb;newd jsonb:='[]'::jsonb;d text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF p.state NOT IN ('confirmed','executing') THEN RAISE EXCEPTION '项目当前不可修改施工计划'; END IF;
 SELECT * INTO m FROM _reno_phase_merge(p.phase_plan,p_plan);
 applied:=coalesce(p.phase_delays_applied,'[]'::jsonb);
 IF p_delays IS NOT NULL AND (jsonb_typeof(p_delays)<>'array' OR jsonb_array_length(p_delays)>200) THEN RAISE EXCEPTION '延误记录格式不对'; END IF;
 FOR d IN SELECT jsonb_array_elements_text(coalesce(p_delays,'[]'::jsonb)) LOOP
  IF NOT applied ? d AND EXISTS(SELECT 1 FROM renovation_site_entries WHERE id::text=d AND project_id=p.id AND kind='delay') THEN applied:=applied||to_jsonb(d);newd:=newd||to_jsonb(d); END IF;
 END LOOP;
 IF p_delays IS NOT NULL AND jsonb_array_length(newd)=0 THEN RETURN jsonb_build_object('ok',true,'changes',0,'skipped',true); END IF; -- 别的页面已经顺延过
 IF p_lines IS NOT NULL AND (jsonb_typeof(p_lines)<>'object' OR length(p_lines::text)>200000) THEN RAISE EXCEPTION '工序明细格式不对'; END IF;
 UPDATE renovation_projects SET phase_plan=m.merged,
  phase_baseline=CASE WHEN phase_baseline_locked_at IS NULL THEN m.merged ELSE phase_baseline END,
  phase_lines=coalesce(p_lines,phase_lines),phase_delays_applied=applied,updated_at=now() WHERE id=p.id;
 IF p_work IS NOT NULL AND jsonb_typeof(p_work)='array' THEN
  IF jsonb_array_length(p_work)>200 THEN RAISE EXCEPTION '子单太多'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(p_work) LOOP
   SELECT * INTO w FROM renovation_work_orders WHERE id=(x->>'work_order_id')::uuid AND project_id=p.id AND cancelled_at IS NULL FOR UPDATE;
   IF w.id IS NULL THEN CONTINUE; END IF;
   BEGIN s:=nullif(x->>'start','')::date;e:=nullif(x->>'end','')::date; EXCEPTION WHEN others THEN RAISE EXCEPTION '子单日期格式不对'; END;
   IF s IS NOT NULL AND e IS NOT NULL AND e<s THEN RAISE EXCEPTION '子单日期不对'; END IF;
   UPDATE renovation_work_orders SET planned_start=s,planned_end=e WHERE id=w.id;n:=n+1;
  END LOOP;
 END IF;
 SELECT name INTO who FROM profiles WHERE id=auth.uid();
 IF jsonb_array_length(m.changes)>0 THEN
  INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p.id,auth.uid(),'phase_plan_saved',
   jsonb_build_object('changes',m.changes,'by',coalesce(who,''),'work_orders',n)||CASE WHEN jsonb_array_length(newd)>0 THEN jsonb_build_object('auto_delay',newd) ELSE '{}'::jsonb END);
 END IF;
 RETURN jsonb_build_object('ok',true,'changes',jsonb_array_length(m.changes));
END $$;
REVOKE ALL ON FUNCTION public.renovation_phase_plan_save(uuid,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_phase_plan_save(uuid,jsonb,jsonb,jsonb,jsonb) TO authenticated;

-- 店长确认预计计划：把现在的实时计划定为预计计划并锁定
CREATE OR REPLACE FUNCTION public.renovation_phase_baseline_confirm(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;who text;
BEGIN
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF NOT _reno_is_manager() THEN RAISE EXCEPTION '只有店长可以确认预计计划'; END IF;
 IF p.phase_baseline_locked_at IS NOT NULL THEN RAISE EXCEPTION '预计计划已经确认过了'; END IF;
 IF coalesce(p.phase_plan,'{}'::jsonb)='{}'::jsonb THEN RAISE EXCEPTION '先排好并保存施工计划'; END IF;
 UPDATE renovation_projects SET phase_baseline=phase_plan,phase_baseline_locked_at=now(),phase_baseline_locked_by=auth.uid(),updated_at=now() WHERE id=p.id;
 SELECT name INTO who FROM profiles WHERE id=auth.uid();
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p.id,auth.uid(),'phase_baseline_confirmed',jsonb_build_object('plan',p.phase_plan,'by',coalesce(who,'')));
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.renovation_phase_baseline_confirm(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_phase_baseline_confirm(uuid) TO authenticated;

-- 店长改预计计划：必须写原因（业主加项、业主要求延期等），留记录
CREATE OR REPLACE FUNCTION public.renovation_phase_baseline_change(p_id uuid,p_plan jsonb,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;m record;who text;
BEGIN
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF NOT _reno_is_manager() THEN RAISE EXCEPTION '只有店长可以改预计计划'; END IF;
 IF p.phase_baseline_locked_at IS NULL THEN RAISE EXCEPTION '预计计划还没确认，直接改施工计划就行'; END IF;
 IF length(trim(coalesce(p_reason,'')))<2 OR length(p_reason)>300 THEN RAISE EXCEPTION '请写改预计计划的原因'; END IF;
 SELECT * INTO m FROM _reno_phase_merge(p.phase_baseline,p_plan);
 IF jsonb_array_length(m.changes)=0 THEN RETURN jsonb_build_object('ok',true,'changes',0); END IF;
 UPDATE renovation_projects SET phase_baseline=m.merged,updated_at=now() WHERE id=p.id;
 SELECT name INTO who FROM profiles WHERE id=auth.uid();
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p.id,auth.uid(),'phase_baseline_changed',jsonb_build_object('changes',m.changes,'reason',trim(p_reason),'by',coalesce(who,'')));
 RETURN jsonb_build_object('ok',true,'changes',jsonb_array_length(m.changes));
END $$;
REVOKE ALL ON FUNCTION public.renovation_phase_baseline_change(uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_phase_baseline_change(uuid,jsonb,text) TO authenticated;

-- 业主进度表：只给已确认的预计计划；每道工序的完成情况按这道工序包含的合同项目算
CREATE OR REPLACE FUNCTION public.renovation_customer_schedule(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('name',_reno_phase_name(b.key),'planned_start',b.value->>'start','planned_end',b.value->>'end',
   'total',st.total,'done',st.done,'started',st.started) ORDER BY b.value->>'start',b.key),'[]'::jsonb)
 FROM renovation_projects p
 CROSS JOIN LATERAL jsonb_each(p.phase_baseline) b
 CROSS JOIN LATERAL (SELECT count(*) total,count(*) FILTER (WHERE i.stage='done') done,bool_or(i.stage IN ('arrived','scheduled','working','done')) IS TRUE started
   FROM jsonb_array_elements(coalesce(p.phase_lines->b.key,'[]'::jsonb)) r
   JOIN renovation_work_items i ON i.project_id=p.id AND i.work_order_id::text=r->>0 AND i.line_id=r->>1 AND i.stage<>'cancelled') st
 WHERE p.customer_token=p_token AND p.state<>'draft' AND p.phase_baseline_locked_at IS NOT NULL AND jsonb_typeof(p.phase_baseline)='object';
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_schedule(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_schedule(uuid) TO anon,authenticated;
