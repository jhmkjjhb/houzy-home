-- 施工计划按「工序 → 工种 → 流程」排：每个项目存一份工序计划（每道工序一个开始 / 结束日期，一个工种一次进场做完）。
-- 第一次保存的工序计划自动成为「原计划」，之后再改也不变，用来对比晚了几天。
-- 保存时同时把各子单的计划日期更新为它所含工序的起止（监理「今天要做」、业主进度、师傅撞期都照旧用子单日期）。
-- 依赖 renovation_schedule_migration.sql。可重复运行。
ALTER TABLE public.renovation_projects ADD COLUMN IF NOT EXISTS phase_plan jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.renovation_projects ADD COLUMN IF NOT EXISTS phase_baseline jsonb;

CREATE OR REPLACE FUNCTION public.renovation_phase_plan_save(p_id uuid,p_plan jsonb,p_work jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;k text;v jsonb;s date;e date;merged jsonb;changes jsonb:='[]'::jsonb;base jsonb;x jsonb;w renovation_work_orders%ROWTYPE;n integer:=0;who text;
 keys constant text[]:=ARRAY['prep','mep','masonry','ceiling','paint','cabinet','fit','fixture','clean'];
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF p.state NOT IN ('confirmed','executing') THEN RAISE EXCEPTION '项目当前不可修改施工计划'; END IF;
 IF p_plan IS NULL OR jsonb_typeof(p_plan)<>'object' THEN RAISE EXCEPTION '计划格式不对'; END IF;
 merged:=coalesce(p.phase_plan,'{}'::jsonb);
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
 -- 原计划：第一次保存时定下；之后第一次出现的工序也补进原计划，已有的不再改
 base:=coalesce(p.phase_baseline,'{}'::jsonb);
 FOR k,v IN SELECT * FROM jsonb_each(merged) LOOP IF NOT base ? k THEN base:=base||jsonb_build_object(k,v); END IF; END LOOP;
 UPDATE renovation_projects SET phase_plan=merged,phase_baseline=base,updated_at=now() WHERE id=p.id;
 -- 子单日期 = 它所含工序的起止
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
 IF jsonb_array_length(changes)>0 THEN
  INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p.id,auth.uid(),'phase_plan_saved',jsonb_build_object('changes',changes,'by',coalesce(who,''),'work_orders',n));
 END IF;
 RETURN jsonb_build_object('ok',true,'changes',jsonb_array_length(changes));
END $$;
REVOKE ALL ON FUNCTION public.renovation_phase_plan_save(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_phase_plan_save(uuid,jsonb,jsonb) TO authenticated;
