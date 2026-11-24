-- 现场手动调整施工计划（phase_setup）：
--  assign：清单项手动归到某道工序（"子单id:清单项id" → 工序），自动规则不再改回去；
--  custom：手动加的工序（名称、工种、天数、接在哪道工序后面）；
--  after：手动改的先后顺序（第二步「拖动改顺序」用，先留好位置）。
-- 店里有项目权限的员工、被指派到这个工地的内部监理可以改；每次改动记入调整记录。
-- 依赖 renovation_phase_window_migration.sql、renovation_site_supervision_migration.sql。可重复运行。
ALTER TABLE public.renovation_projects ADD COLUMN IF NOT EXISTS phase_setup jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 谁能调整施工计划：有项目权限的员工，或被指派到这个工地、仍在岗的内部监理
CREATE OR REPLACE FUNCTION public._reno_plan_editor(p_project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM renovation_projects p WHERE p.id=p_project AND _reno_access(p.store_id,p.created_by))
  OR EXISTS(SELECT 1 FROM renovation_site_supervisors s JOIN profiles f ON f.id=s.profile_id
   WHERE s.project_id=p_project AND s.active AND s.kind='internal' AND s.profile_id=auth.uid() AND f.active=true AND f.role='supervisor') $$;
REVOKE ALL ON FUNCTION public._reno_plan_editor(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._reno_plan_editor(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._reno_phase_merge(old jsonb,p_plan jsonb,OUT merged jsonb,OUT changes jsonb) LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text;v jsonb;s date;e date;
 keys constant text[]:=ARRAY['window','prep','plumb','elec','mep','masonry','tile','ceiling','paint','cabinet','fit','fix_plumb','fix_elec','hardware','fixture','clean'];
BEGIN
 IF p_plan IS NULL OR jsonb_typeof(p_plan)<>'object' THEN RAISE EXCEPTION '计划格式不对'; END IF;
 merged:=coalesce(old,'{}'::jsonb);changes:='[]'::jsonb;
 FOR k,v IN SELECT * FROM jsonb_each(p_plan) LOOP
  IF NOT (k=ANY(keys) OR k ~ '^c_[a-z0-9]{1,24}$') THEN RAISE EXCEPTION '不认识的工序：%',k; END IF;
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

CREATE OR REPLACE FUNCTION public.renovation_phase_setup_save(p_id uuid,p_setup jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;k text;v jsonb;c jsonb;keys text[]:='{}';who text;
 ph text:='^(window|prep|plumb|elec|mep|masonry|tile|ceiling|paint|cabinet|fit|fix_plumb|fix_elec|hardware|fixture|clean|c_[a-z0-9]{1,24})$';
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_plan_editor(p.id) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF p.state NOT IN ('confirmed','executing') THEN RAISE EXCEPTION '项目当前不可修改施工计划'; END IF;
 IF p_setup IS NULL OR jsonb_typeof(p_setup)<>'object' OR length(p_setup::text)>100000 THEN RAISE EXCEPTION '工序设置格式不对'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_setup) x WHERE x NOT IN ('assign','custom','after')) THEN RAISE EXCEPTION '工序设置格式不对'; END IF;
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
 IF coalesce(p.phase_setup,'{}'::jsonb)=p_setup THEN RETURN jsonb_build_object('ok',true,'changed',false); END IF;
 UPDATE renovation_projects SET phase_setup=p_setup,updated_at=now() WHERE id=p.id;
 SELECT name INTO who FROM profiles WHERE id=auth.uid();
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p.id,auth.uid(),'phase_setup_saved',
  jsonb_build_object('before',coalesce(p.phase_setup,'{}'::jsonb),'after',p_setup,'by',coalesce(who,'')));
 RETURN jsonb_build_object('ok',true,'changed',true);
END $$;
REVOKE ALL ON FUNCTION public.renovation_phase_setup_save(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_phase_setup_save(uuid,jsonb) TO authenticated;

-- 业主进度表：手动加的工序显示它自己的名称
CREATE OR REPLACE FUNCTION public.renovation_customer_schedule(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('name',coalesce((SELECT c->>'name' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.phase_setup->'custom')='array' THEN p.phase_setup->'custom' ELSE '[]'::jsonb END) c WHERE c->>'key'=b.key LIMIT 1),_reno_phase_name(b.key)),'planned_start',b.value->>'start','planned_end',b.value->>'end',
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
