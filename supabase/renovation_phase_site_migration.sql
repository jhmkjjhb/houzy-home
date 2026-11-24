-- 第二步：内部监理在现场页调整施工计划
--  1) 现场拖动改工序顺序（phase_setup.order）；
--  2) 被指派到工地的内部监理可以保存工序日期（实时计划；业主看的预计计划仍只有店长能改）；
--  3) 现场页拿到工序计划和现场调整（工序名称、日期，不含价格）。
-- 依赖 renovation_phase_setup_migration.sql。可重复运行。
CREATE OR REPLACE FUNCTION public.renovation_phase_setup_save(p_id uuid,p_setup jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;k text;v jsonb;c jsonb;keys text[]:='{}';who text;
 ph text:='^(window|prep|plumb|elec|mep|masonry|tile|ceiling|paint|cabinet|fit|fix_plumb|fix_elec|hardware|fixture|clean|c_[a-z0-9]{1,24})$';
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_plan_editor(p.id) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF p.state NOT IN ('confirmed','executing') THEN RAISE EXCEPTION '项目当前不可修改施工计划'; END IF;
 IF p_setup IS NULL OR jsonb_typeof(p_setup)<>'object' OR length(p_setup::text)>100000 THEN RAISE EXCEPTION '工序设置格式不对'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_setup) x WHERE x NOT IN ('assign','custom','after','order')) THEN RAISE EXCEPTION '工序设置格式不对'; END IF;
 IF jsonb_typeof(coalesce(p_setup->'custom','[]'::jsonb))<>'array' OR jsonb_array_length(coalesce(p_setup->'custom','[]'::jsonb))>30 THEN RAISE EXCEPTION '手动工序最多 30 道'; END IF;
 FOR c IN SELECT * FROM jsonb_array_elements(coalesce(p_setup->'custom','[]'::jsonb)) LOOP
  IF jsonb_typeof(c)<>'object' OR coalesce(c->>'key','') !~ '^c_[a-z0-9]{1,24}$' OR c->>'key'=ANY(keys) THEN RAISE EXCEPTION '手动工序编号不对'; END IF;
  IF length(trim(coalesce(c->>'name','')))<1 OR length(c->>'name')>30 THEN RAISE EXCEPTION '工序名称要 1 到 30 个字'; END IF;
  IF length(coalesce(c->>'trade',''))>20 THEN RAISE EXCEPTION '工种名称太长'; END IF;
  IF coalesce(c->>'days','') !~ '^[0-9]{1,3}$' OR (c->>'days')::int NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION '工序天数要在 1 到 365 之间'; END IF;
  IF c ? 'after' AND jsonb_typeof(c->'after')<>'null' AND coalesce(c->>'after','') !~ ph THEN RAISE EXCEPTION '接在哪道工序后面不对'; END IF;
  keys:=keys||(c->>'key');
 END LOOP;
 IF jsonb_typeof(coalesce(p_setup->'assign','{}'::jsonb))<>'object' THEN RAISE EXCEPTION '工序设置格式不对'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(coalesce(p_setup->'assign','{}'::jsonb)))>2000 THEN RAISE EXCEPTION '手动归类的项目太多'; END IF;
 FOR k,v IN SELECT * FROM jsonb_each(coalesce(p_setup->'assign','{}'::jsonb)) LOOP
  IF length(k)>120 OR jsonb_typeof(v)<>'string' OR v#>>'{}' !~ ph THEN RAISE EXCEPTION '项目归到的工序不对'; END IF;
 END LOOP;
 IF jsonb_typeof(coalesce(p_setup->'after','{}'::jsonb))<>'object' THEN RAISE EXCEPTION '工序设置格式不对'; END IF;
 FOR k,v IN SELECT * FROM jsonb_each(coalesce(p_setup->'after','{}'::jsonb)) LOOP
  IF k !~ ph OR jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>20 OR EXISTS(SELECT 1 FROM jsonb_array_elements(v) x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' !~ ph) THEN RAISE EXCEPTION '工序先后设置不对'; END IF;
 END LOOP;
 IF jsonb_typeof(coalesce(p_setup->'order','[]'::jsonb))<>'array' OR jsonb_array_length(coalesce(p_setup->'order','[]'::jsonb))>60
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_setup->'order','[]'::jsonb)) x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' !~ ph) THEN RAISE EXCEPTION '工序顺序不对'; END IF;
 IF coalesce(p.phase_setup,'{}'::jsonb)=p_setup THEN RETURN jsonb_build_object('ok',true,'changed',false); END IF;
 UPDATE renovation_projects SET phase_setup=p_setup,updated_at=now() WHERE id=p.id;
 SELECT name INTO who FROM profiles WHERE id=auth.uid();
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p.id,auth.uid(),'phase_setup_saved',
  jsonb_build_object('before',coalesce(p.phase_setup,'{}'::jsonb),'after',p_setup,'by',coalesce(who,'')));
 RETURN jsonb_build_object('ok',true,'changed',true);
END $$;
REVOKE ALL ON FUNCTION public.renovation_phase_setup_save(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_phase_setup_save(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.renovation_phase_plan_save(p_id uuid,p_plan jsonb,p_work jsonb,p_lines jsonb DEFAULT NULL,p_delays jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;m record;x jsonb;w renovation_work_orders%ROWTYPE;s date;e date;n integer:=0;who text;applied jsonb;newd jsonb:='[]'::jsonb;d text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_plan_editor(p.id) THEN RAISE EXCEPTION '无此项目权限'; END IF;
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

CREATE OR REPLACE FUNCTION public._reno_site_payload(p_project uuid,p_sup uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
  'project',jsonb_build_object('id',p.id,'contract_no',p.contract_no,'address',p.address,'handover_on',p.handover_on,'state',p.state,
   'phase_plan',coalesce(p.phase_plan,'{}'::jsonb),'phase_setup',coalesce(p.phase_setup,'{}'::jsonb),'phase_locked',p.phase_baseline_locked_at IS NOT NULL),
  'supervisor',(SELECT jsonb_build_object('id',s.id,'name',s.name,'kind',s.kind) FROM renovation_site_supervisors s WHERE s.id=p_sup),
  'today',(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date,
  'work_orders',coalesce((SELECT jsonb_agg(jsonb_build_object('id',w.id,'group_name',regexp_replace(w.group_name,'^增项-[0-9a-fA-F-]{36} · ?','增项 · '),'assignee',w.assignee,
    'planned_start',w.planned_start,'planned_end',w.planned_end,
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object('line_id',i.line_id,'name',i.name,'spec',i.spec,'qty',i.qty,'unit',i.unit,'kind',i.kind,'stage',i.stage,'issue',i.issue_note,
       'expected_on',(SELECT b.expected_on FROM renovation_purchase_batches b WHERE b.id=i.batch_id),'arrived_on',i.arrived_on,'done_on',i.done_on) ORDER BY i.line_id)
      FROM renovation_work_items i WHERE i.work_order_id=w.id AND i.stage<>'cancelled'),'[]'::jsonb)) ORDER BY w.planned_start NULLS LAST,w.group_name)
   FROM renovation_work_orders w WHERE w.project_id=p.id AND w.cancelled_at IS NULL),'[]'::jsonb),
  'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'on_date',e.on_date,'note',e.note,'work_order_id',e.work_order_id,'photo_count',jsonb_array_length(e.photos),
    'data',e.data,'status',e.status,'mine',e.supervisor_id=p_sup,'created_at',e.created_at) ORDER BY e.created_at DESC)
   FROM (SELECT * FROM renovation_site_entries WHERE project_id=p.id AND (on_date>=(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date-45 OR status='open') ORDER BY created_at DESC LIMIT 200) e),'[]'::jsonb))
 FROM renovation_projects p WHERE p.id=p_project;
$$;
REVOKE ALL ON FUNCTION public._reno_site_payload(uuid,uuid) FROM PUBLIC,anon,authenticated;
