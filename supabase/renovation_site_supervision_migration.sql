-- 施工监理：监理名单（内部账号 / 外部链接+验证码）、工地记录（日志、到货点收、开工、完工、验收、问题、延误、停工）、现场照片。
-- 监理只能通过下面的函数看到自己负责的工地，看不到任何金额；员工按原有项目权限可以看全部记录。
-- 依赖 renovation_fulfillment_migration.sql、renovation_schedule_migration.sql、renovation_planning_migration.sql。可重复运行。

-- 员工账号新增「监理」角色（supervisor）：保留现有全部角色，只多加这一个
DO $role$
DECLARE c record;vals text[];
BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND contype='c' AND pg_get_constraintdef(oid) ~ '\mrole\M' LOOP
  IF c.def ~ '''supervisor''' THEN CONTINUE; END IF;
  SELECT array_agg(DISTINCT m[1]) INTO vals FROM regexp_matches(c.def,'''([a-z_]+)''','g') m;
  IF vals IS NULL OR NOT 'staff'=ANY(vals) THEN RAISE EXCEPTION '账号角色限制的格式和预期不同，未修改：%',c.def; END IF;
  EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I',c.conname);
  EXECUTE format('ALTER TABLE public.profiles ADD CONSTRAINT %I CHECK (role IN (%s))',c.conname,(SELECT string_agg(quote_literal(v),',') FROM unnest(vals||'supervisor'::text) v));
 END LOOP;
END $role$;

CREATE TABLE IF NOT EXISTS public.renovation_site_supervisors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.renovation_projects(id),
 profile_id uuid REFERENCES public.profiles(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
 phone text NOT NULL DEFAULT '' CHECK(length(phone)<=40),
 kind text NOT NULL CHECK(kind IN ('internal','external')),
 access_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 access_code text NOT NULL CHECK(access_code ~ '^[0-9]{4}$'),
 failed_checks integer NOT NULL DEFAULT 0,
 verified_until timestamptz,
 active boolean NOT NULL DEFAULT true,
 started_on date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date),
 ended_on date,
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT reno_site_sup_internal CHECK(kind='external' OR profile_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS reno_site_sup_project ON public.renovation_site_supervisors(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS reno_site_sup_one_internal ON public.renovation_site_supervisors(project_id,profile_id) WHERE active AND profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.renovation_site_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.renovation_projects(id),
 supervisor_id uuid NOT NULL REFERENCES public.renovation_site_supervisors(id),
 work_order_id uuid REFERENCES public.renovation_work_orders(id),
 kind text NOT NULL CHECK(kind IN ('log','arrival','start','finish','inspection','issue','delay','pause')),
 on_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=1000),
 photos jsonb NOT NULL DEFAULT '[]'::jsonb,
 data jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'done' CHECK(status IN ('done','open','resolved','confirmed','rejected')),
 resolved_at timestamptz, resolution jsonb,
 reviewed_by uuid REFERENCES public.profiles(id), reviewed_at timestamptz, review_note text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reno_site_entries_project ON public.renovation_site_entries(project_id,on_date DESC);

-- 员工按项目权限只读；监理不直接读表，走下面的函数
ALTER TABLE public.renovation_site_supervisors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renovation_site_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.renovation_site_supervisors,public.renovation_site_entries FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.renovation_site_supervisors,public.renovation_site_entries TO authenticated;
DROP POLICY IF EXISTS reno_site_sup_read ON public.renovation_site_supervisors;
CREATE POLICY reno_site_sup_read ON public.renovation_site_supervisors FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.renovation_projects p WHERE p.id=project_id AND public._reno_access(p.store_id,p.created_by)));
DROP POLICY IF EXISTS reno_site_entries_read ON public.renovation_site_entries;
CREATE POLICY reno_site_entries_read ON public.renovation_site_entries FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.renovation_projects p WHERE p.id=project_id AND public._reno_access(p.store_id,p.created_by)));

-- 现场照片：存在 <项目>/site/<监理>/ 下。内部监理登录后上传；外部监理验证码通过后 12 小时内可上传。
CREATE OR REPLACE FUNCTION public._reno_site_upload_ok(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM renovation_site_supervisors s JOIN renovation_projects p ON p.id=s.project_id
  WHERE split_part(p_name,'/',1)=s.project_id::text AND split_part(p_name,'/',2)='site' AND split_part(p_name,'/',3)=s.id::text
   AND s.active AND p.state='executing'
   AND ((s.kind='internal' AND s.profile_id=auth.uid()) OR (s.kind='external' AND s.verified_until>now())));
$$;
REVOKE ALL ON FUNCTION public._reno_site_upload_ok(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._reno_site_upload_ok(text) TO anon,authenticated;
DROP POLICY IF EXISTS reno_site_photo_insert ON storage.objects;
CREATE POLICY reno_site_photo_insert ON storage.objects FOR INSERT TO anon,authenticated
 WITH CHECK(bucket_id='renovation-fulfillment' AND public._reno_site_upload_ok(name));

-- 4 位验证码
CREATE OR REPLACE FUNCTION public._reno_site_code() RETURNS text LANGUAGE sql VOLATILE AS $$
 SELECT lpad(((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint)%10000)::text,4,'0');
$$;
REVOKE ALL ON FUNCTION public._reno_site_code() FROM PUBLIC,anon,authenticated;

-- 员工：指定 / 结束监理。内部监理选员工账号；外部监理填名字电话，生成链接和验证码。
CREATE OR REPLACE FUNCTION public.renovation_supervisor_save(p_project uuid,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;s renovation_site_supervisors%ROWTYPE;who profiles%ROWTYPE;v_name text;v_phone text;
BEGIN
 IF auth.uid() IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_project FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF coalesce(p_data->>'end_id','')<>'' THEN
  UPDATE renovation_site_supervisors SET active=false,ended_on=(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date,verified_until=NULL
   WHERE id=(p_data->>'end_id')::uuid AND project_id=p_project AND active RETURNING * INTO s;
  IF s.id IS NULL THEN RAISE EXCEPTION '找不到这位监理，或已结束'; END IF;
  INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p_project,auth.uid(),'supervisor_ended',jsonb_build_object('supervisor_id',s.id,'name',s.name));
  RETURN jsonb_build_object('ok',true);
 END IF;
 IF p.state NOT IN ('confirmed','executing') THEN RAISE EXCEPTION '项目还没确认，不能指定监理'; END IF;
 IF coalesce(p_data->>'profile_id','')<>'' THEN
  SELECT * INTO who FROM profiles WHERE id=(p_data->>'profile_id')::uuid AND coalesce(active,true);
  IF who.id IS NULL THEN RAISE EXCEPTION '找不到这个员工账号'; END IF;
  IF EXISTS(SELECT 1 FROM renovation_site_supervisors WHERE project_id=p_project AND profile_id=who.id AND active) THEN RAISE EXCEPTION '这位已经是本工地的监理'; END IF;
  INSERT INTO renovation_site_supervisors(project_id,profile_id,name,phone,kind,access_code,created_by)
   VALUES(p_project,who.id,coalesce(nullif(trim(who.name),''),'监理'),coalesce(who.phone,''),'internal',_reno_site_code(),auth.uid()) RETURNING * INTO s;
 ELSE
  v_name:=trim(coalesce(p_data->>'name',''));v_phone:=trim(coalesce(p_data->>'phone',''));
  IF v_name='' OR length(v_name)>80 THEN RAISE EXCEPTION '请填写外部监理的名字'; END IF;
  IF length(v_phone)>40 THEN RAISE EXCEPTION '电话太长'; END IF;
  INSERT INTO renovation_site_supervisors(project_id,name,phone,kind,access_code,created_by)
   VALUES(p_project,v_name,v_phone,'external',_reno_site_code(),auth.uid()) RETURNING * INTO s;
 END IF;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p_project,auth.uid(),'supervisor_added',jsonb_build_object('supervisor_id',s.id,'name',s.name,'kind',s.kind));
 RETURN jsonb_build_object('id',s.id,'kind',s.kind,'token',CASE WHEN s.kind='external' THEN s.access_token END,'code',CASE WHEN s.kind='external' THEN s.access_code END);
END $$;
REVOKE ALL ON FUNCTION public.renovation_supervisor_save(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_supervisor_save(uuid,jsonb) TO authenticated;

-- 谁在操作：外部监理凭 {sid,token,code}（验证码通过后 12 小时内），内部监理凭登录账号
CREATE OR REPLACE FUNCTION public._reno_site_who(p_project uuid,p_auth jsonb)
RETURNS public.renovation_site_supervisors LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s renovation_site_supervisors%ROWTYPE;
BEGIN
 IF p_auth IS NOT NULL AND jsonb_typeof(p_auth)='object' AND coalesce(p_auth->>'sid','')<>'' THEN
  SELECT * INTO s FROM renovation_site_supervisors WHERE id=(p_auth->>'sid')::uuid AND access_token=(p_auth->>'token')::uuid AND kind='external';
  IF s.id IS NULL OR NOT s.active THEN RAISE EXCEPTION '链接无效或已停用，请联系门店'; END IF;
  IF s.failed_checks>=8 OR p_auth->>'code' IS DISTINCT FROM s.access_code OR s.verified_until IS NULL OR s.verified_until<now() THEN RAISE EXCEPTION '验证已过期，请重新输入验证码'; END IF;
 ELSE
  SELECT * INTO s FROM renovation_site_supervisors WHERE project_id=p_project AND profile_id=auth.uid() AND active AND kind='internal' LIMIT 1;
  IF s.id IS NULL THEN RAISE EXCEPTION '你不是这个工地的监理'; END IF;
 END IF;
 IF p_project IS NOT NULL AND s.project_id<>p_project THEN RAISE EXCEPTION '你不是这个工地的监理'; END IF;
 RETURN s;
END $$;
REVOKE ALL ON FUNCTION public._reno_site_who(uuid,jsonb) FROM PUBLIC,anon,authenticated;

-- 监理看到的工地内容：没有任何金额，没有业主电话
CREATE OR REPLACE FUNCTION public._reno_site_payload(p_project uuid,p_sup uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
  'project',jsonb_build_object('id',p.id,'contract_no',p.contract_no,'address',p.address,'handover_on',p.handover_on,'state',p.state),
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

-- 外部监理：凭链接 + 验证码打开（错 8 次锁定），通过后 12 小时内免再输入
CREATE OR REPLACE FUNCTION public.renovation_site_open(p_sid uuid,p_token uuid,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s renovation_site_supervisors%ROWTYPE;
BEGIN
 SELECT * INTO s FROM renovation_site_supervisors WHERE id=p_sid AND access_token=p_token AND kind='external' FOR UPDATE;
 IF s.id IS NULL THEN RETURN NULL; END IF;
 IF NOT s.active THEN RETURN jsonb_build_object('status','ended'); END IF;
 IF s.failed_checks>=8 THEN RETURN jsonb_build_object('status','locked'); END IF;
 IF p_code IS DISTINCT FROM s.access_code THEN
  UPDATE renovation_site_supervisors SET failed_checks=failed_checks+1 WHERE id=s.id RETURNING * INTO s;
  RETURN jsonb_build_object('status',CASE WHEN s.failed_checks>=8 THEN 'locked' ELSE 'wrong_code' END,'remaining',greatest(0,8-s.failed_checks));
 END IF;
 UPDATE renovation_site_supervisors SET failed_checks=0,verified_until=now()+interval '12 hours' WHERE id=s.id;
 RETURN jsonb_build_object('status','ok','site',_reno_site_payload(s.project_id,s.id));
END $$;
REVOKE ALL ON FUNCTION public.renovation_site_open(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_site_open(uuid,uuid,text) TO anon,authenticated;

-- 内部监理：我负责的工地列表，和单个工地内容
CREATE OR REPLACE FUNCTION public.renovation_site_my()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('project_id',p.id,'contract_no',p.contract_no,'address',p.address,'handover_on',p.handover_on,'state',p.state,
   'open_issues',(SELECT count(*) FROM renovation_site_entries e WHERE e.project_id=p.id AND e.kind='issue' AND e.status='open'),
   'logged_today',EXISTS(SELECT 1 FROM renovation_site_entries e WHERE e.project_id=p.id AND e.kind='log' AND e.on_date=(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date),
   'arriving',(SELECT count(*) FROM renovation_work_items i JOIN renovation_purchase_batches b ON b.id=i.batch_id WHERE i.project_id=p.id AND i.stage='ordered' AND b.expected_on<=(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date))
  ORDER BY p.handover_on NULLS LAST),'[]'::jsonb)
 FROM renovation_site_supervisors s JOIN renovation_projects p ON p.id=s.project_id
 WHERE s.profile_id=auth.uid() AND s.active AND s.kind='internal' AND p.state IN ('confirmed','executing');
$$;
REVOKE ALL ON FUNCTION public.renovation_site_my() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_site_my() TO authenticated;

CREATE OR REPLACE FUNCTION public.renovation_site_view(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s renovation_site_supervisors%ROWTYPE;
BEGIN
 s:=_reno_site_who(p_project,NULL);
 RETURN _reno_site_payload(p_project,s.id);
END $$;
REVOKE ALL ON FUNCTION public.renovation_site_view(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_site_view(uuid) TO authenticated;

-- 照片参数：只能是这位监理自己上传到 <项目>/site/<监理>/ 下、确实存在的文件
CREATE OR REPLACE FUNCTION public._reno_site_photos(p_project uuid,p_sup uuid,p_photos jsonb,p_min integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE x jsonb;out jsonb:='[]'::jsonb;n integer:=0;
BEGIN
 IF p_photos IS NOT NULL AND jsonb_typeof(p_photos)<>'array' THEN RAISE EXCEPTION '照片格式不对'; END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_photos,'[]'::jsonb)) LOOP
  n:=n+1;IF n>12 THEN RAISE EXCEPTION '一次最多 12 张照片'; END IF;
  IF jsonb_typeof(x)<>'object' OR coalesce(x->>'path','') NOT LIKE p_project::text||'/site/'||p_sup::text||'/%'
   OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='renovation-fulfillment' AND name=x->>'path') THEN RAISE EXCEPTION '照片还没上传好，请重新拍'; END IF;
  out:=out||jsonb_build_array(jsonb_build_object('path',x->>'path','sha256',left(coalesce(x->>'sha256',''),64),'taken_at',x->>'taken_at',
   'lat',CASE WHEN (x->>'lat') ~ '^-?[0-9.]+$' THEN (x->>'lat')::numeric END,'lng',CASE WHEN (x->>'lng') ~ '^-?[0-9.]+$' THEN (x->>'lng')::numeric END,
   'source',CASE WHEN x->>'source'='album' THEN 'album' ELSE 'camera' END,
   'reused',EXISTS(SELECT 1 FROM renovation_site_entries e,jsonb_array_elements(e.photos) q WHERE e.project_id=p_project AND coalesce(x->>'sha256','')<>'' AND q->>'sha256'=x->>'sha256')));
 END LOOP;
 IF n<p_min THEN RAISE EXCEPTION '请至少拍 % 张照片',p_min; END IF;
 RETURN out;
END $$;
REVOKE ALL ON FUNCTION public._reno_site_photos(uuid,uuid,jsonb,integer) FROM PUBLIC,anon,authenticated;

-- 监理提交一条工地记录。到货、开工、完工会直接更新子单进度；延误原因和停工要店长确认。
CREATE OR REPLACE FUNCTION public.renovation_site_post(p_project uuid,p_auth jsonb,p_kind text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s renovation_site_supervisors%ROWTYPE;p renovation_projects%ROWTYPE;w renovation_work_orders%ROWTYPE;e renovation_site_entries%ROWTYPE;
 v_note text;v_photos jsonb;v_data jsonb:='{}'::jsonb;v_status text:='done';today date:=(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
 v_lines jsonb;picked uuid[];n integer;x jsonb;checks jsonb:='[]'::jsonb;all_ok boolean:=true;d1 date;d2 date;
BEGIN
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION '资料格式不对'; END IF;
 s:=_reno_site_who(p_project,p_auth);
 SELECT * INTO p FROM renovation_projects WHERE id=s.project_id FOR UPDATE;
 IF p.state<>'executing' THEN RAISE EXCEPTION '工地还没开始施工，暂时不能记录'; END IF;
 v_note:=trim(coalesce(p_data->>'note',''));IF length(v_note)>1000 THEN RAISE EXCEPTION '文字太长，请控制在 1000 字以内'; END IF;
 IF coalesce(p_data->>'work_order_id','')<>'' THEN
  SELECT * INTO w FROM renovation_work_orders WHERE id=(p_data->>'work_order_id')::uuid AND project_id=p.id AND cancelled_at IS NULL;
  IF w.id IS NULL THEN RAISE EXCEPTION '子单不存在或已作废'; END IF;
 END IF;
 v_lines:=p_data->'line_ids';IF v_lines IS NOT NULL AND jsonb_typeof(v_lines)<>'array' THEN RAISE EXCEPTION '清单项格式不对'; END IF;

 IF p_kind='log' THEN
  v_photos:=_reno_site_photos(p.id,s.id,p_data->'photos',1);
 ELSIF p_kind IN ('arrival','start','finish') THEN
  IF w.id IS NULL THEN RAISE EXCEPTION '请选择子单'; END IF;
  v_photos:=_reno_site_photos(p.id,s.id,p_data->'photos',1);
  SELECT array_agg(i.id) INTO picked FROM renovation_work_items i
   WHERE i.work_order_id=w.id AND i.issue_note IS NULL AND (coalesce(jsonb_array_length(v_lines),0)=0 OR v_lines ? i.line_id)
    AND CASE p_kind WHEN 'arrival' THEN i.kind IN ('custom','stock') AND i.stage='ordered'
     WHEN 'start' THEN i.kind='work' AND i.stage IN ('pending','scheduled')
     ELSE ((i.kind IN ('custom','stock') AND i.stage='arrived') OR (i.kind='work' AND i.stage='working') OR (i.kind='gift' AND i.stage='pending')) AND NOT i.change_pending END;
  IF picked IS NULL THEN RAISE EXCEPTION '%',CASE p_kind WHEN 'arrival' THEN '这张子单没有等到货的项' WHEN 'start' THEN '这张子单没有可开工的施工项' ELSE '这张子单没有可完工的项' END; END IF;
  IF p_kind='arrival' AND coalesce((p_data->>'ok')::boolean,true)=false THEN
   IF v_note='' THEN RAISE EXCEPTION '请写明缺件或破损情况'; END IF;
   -- 有缺件 / 破损：记到货，同时开一条问题让门店跟进
   v_data:=jsonb_build_object('ok',false);
  END IF;
  IF p_kind='arrival' THEN UPDATE renovation_work_items SET stage='arrived',arrived_on=today,updated_at=now() WHERE id=ANY(picked);
  ELSIF p_kind='start' THEN UPDATE renovation_work_items SET stage='working',scheduled_on=coalesce(scheduled_on,today),updated_at=now() WHERE id=ANY(picked);
  ELSE UPDATE renovation_work_items SET stage='done',done_on=today,proof_path=coalesce(proof_path,v_photos->0->>'path'),updated_at=now() WHERE id=ANY(picked);
  END IF;
  v_data:=v_data||jsonb_build_object('line_ids',(SELECT jsonb_agg(line_id ORDER BY line_id) FROM renovation_work_items WHERE id=ANY(picked)),'count',cardinality(picked));
 ELSIF p_kind='inspection' THEN
  IF trim(coalesce(p_data->>'milestone',''))='' OR length(p_data->>'milestone')>60 THEN RAISE EXCEPTION '请选择验收节点'; END IF;
  IF jsonb_typeof(p_data->'checks')<>'array' OR jsonb_array_length(p_data->'checks') NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION '验收项格式不对'; END IF;
  v_photos:=_reno_site_photos(p.id,s.id,p_data->'photos',1);
  FOR x IN SELECT * FROM jsonb_array_elements(p_data->'checks') LOOP
   IF trim(coalesce(x->>'item',''))='' OR length(x->>'item')>120 THEN RAISE EXCEPTION '验收项名称不对'; END IF;
   checks:=checks||jsonb_build_array(jsonb_build_object('item',trim(x->>'item'),'ok',coalesce((x->>'ok')::boolean,false),'note',left(trim(coalesce(x->>'note','')),300)));
   IF NOT coalesce((x->>'ok')::boolean,false) THEN all_ok:=false; END IF;
  END LOOP;
  v_data:=jsonb_build_object('milestone',trim(p_data->>'milestone'),'checks',checks,'pass',all_ok,
   'first_try',NOT EXISTS(SELECT 1 FROM renovation_site_entries WHERE project_id=p.id AND kind='inspection' AND data->>'milestone'=trim(p_data->>'milestone')));
  IF NOT all_ok AND v_note='' THEN RAISE EXCEPTION '有不合格项，请写明要返工什么'; END IF;
 ELSIF p_kind='issue' THEN
  IF v_note='' THEN RAISE EXCEPTION '请写明问题'; END IF;
  v_photos:=_reno_site_photos(p.id,s.id,p_data->'photos',0);
  BEGIN d1:=nullif(p_data->>'due_on','')::date; EXCEPTION WHEN others THEN RAISE EXCEPTION '处理期限格式不对'; END;
  v_data:=jsonb_build_object('responsible',left(trim(coalesce(p_data->>'responsible','')),80),'due_on',d1,'found_by','supervisor');v_status:='open';
 ELSIF p_kind='delay' THEN
  IF coalesce(p_data->>'reason','') NOT IN ('factory','owner','weather','crew','other') THEN RAISE EXCEPTION '请选择延误原因'; END IF;
  IF coalesce(p_data->>'days','') !~ '^[0-9]{1,2}$' OR (p_data->>'days')::int NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION '延误天数要在 1 到 60 天之间'; END IF;
  IF p_data->>'reason' IN ('owner','other') AND v_note='' THEN RAISE EXCEPTION '请写明原因'; END IF;
  v_photos:=_reno_site_photos(p.id,s.id,p_data->'photos',0);
  v_data:=jsonb_build_object('reason',p_data->>'reason','days',(p_data->>'days')::int);v_status:='open';
 ELSIF p_kind='pause' THEN
  BEGIN d1:=(p_data->>'from')::date;d2:=(p_data->>'to')::date; EXCEPTION WHEN others THEN RAISE EXCEPTION '请填写停工的起止日期'; END;
  IF d1 IS NULL OR d2 IS NULL OR d2<d1 OR d2-d1>90 THEN RAISE EXCEPTION '停工日期不对（最多 90 天）'; END IF;
  IF v_note='' THEN RAISE EXCEPTION '请写明停工原因'; END IF;
  v_photos:='[]'::jsonb;v_data:=jsonb_build_object('from',d1,'to',d2);v_status:='open';
 ELSE RAISE EXCEPTION '不支持的记录类型';
 END IF;

 INSERT INTO renovation_site_entries(project_id,supervisor_id,work_order_id,kind,note,photos,data,status)
  VALUES(p.id,s.id,w.id,p_kind,v_note,coalesce(v_photos,'[]'::jsonb),v_data,v_status) RETURNING * INTO e;
 -- 到货有缺件 / 验收不合格：自动开一条问题
 IF (p_kind='arrival' AND v_data->>'ok'='false') OR (p_kind='inspection' AND NOT all_ok) THEN
  INSERT INTO renovation_site_entries(project_id,supervisor_id,work_order_id,kind,note,photos,data,status)
   VALUES(p.id,s.id,w.id,'issue',v_note,e.photos,jsonb_build_object('from_entry',e.id,'found_by','supervisor'),'open');
 END IF;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p.id,auth.uid(),'site_'||p_kind,jsonb_build_object('entry_id',e.id,'supervisor_id',s.id,'supervisor',s.name,'data',v_data));
 RETURN jsonb_build_object('ok',true,'id',e.id,'site',_reno_site_payload(p.id,s.id));
END $$;
REVOKE ALL ON FUNCTION public.renovation_site_post(uuid,jsonb,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_site_post(uuid,jsonb,text,jsonb) TO anon,authenticated;

-- 监理把问题标为已解决（附照片）
CREATE OR REPLACE FUNCTION public.renovation_site_resolve(p_entry uuid,p_auth jsonb,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e renovation_site_entries%ROWTYPE;s renovation_site_supervisors%ROWTYPE;v_photos jsonb;
BEGIN
 SELECT * INTO e FROM renovation_site_entries WHERE id=p_entry FOR UPDATE;
 IF e.id IS NULL OR e.kind<>'issue' THEN RAISE EXCEPTION '找不到这个问题'; END IF;
 s:=_reno_site_who(e.project_id,p_auth);
 IF e.status<>'open' THEN RAISE EXCEPTION '这个问题已经处理过了'; END IF;
 v_photos:=_reno_site_photos(e.project_id,s.id,p_data->'photos',1);
 UPDATE renovation_site_entries SET status='resolved',resolved_at=now(),resolution=jsonb_build_object('by',s.id,'note',left(trim(coalesce(p_data->>'note','')),1000),'photos',v_photos) WHERE id=e.id;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(e.project_id,auth.uid(),'site_issue_resolved',jsonb_build_object('entry_id',e.id,'supervisor_id',s.id));
 RETURN jsonb_build_object('ok',true,'site',_reno_site_payload(e.project_id,s.id));
END $$;
REVOKE ALL ON FUNCTION public.renovation_site_resolve(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_site_resolve(uuid,jsonb,jsonb) TO anon,authenticated;

-- 店长：确认 / 驳回延误原因和停工申报；抽查验收（驳回 = 验收不算通过）；也可以由门店记一条问题
CREATE OR REPLACE FUNCTION public.renovation_site_review(p_entry uuid,p_action text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e renovation_site_entries%ROWTYPE;p renovation_projects%ROWTYPE;
BEGIN
 SELECT * INTO e FROM renovation_site_entries WHERE id=p_entry FOR UPDATE;
 IF e.id IS NULL THEN RAISE EXCEPTION '找不到这条记录'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=e.project_id;
 IF NOT _reno_access(p.store_id,p.created_by,true) THEN RAISE EXCEPTION '只有店长或上级可以确认'; END IF;
 IF p_action NOT IN ('confirm','reject') THEN RAISE EXCEPTION '不支持的操作'; END IF;
 IF e.kind NOT IN ('delay','pause','inspection') THEN RAISE EXCEPTION '这类记录不需要确认'; END IF;
 IF p_action='reject' AND trim(coalesce(p_note,''))='' THEN RAISE EXCEPTION '请写明驳回原因'; END IF;
 UPDATE renovation_site_entries SET status=CASE WHEN p_action='confirm' THEN 'confirmed' ELSE 'rejected' END,reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(trim(coalesce(p_note,'')),'') WHERE id=e.id;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(e.project_id,auth.uid(),'site_review_'||p_action,jsonb_build_object('entry_id',e.id,'kind',e.kind,'note',p_note));
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.renovation_site_review(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_site_review(uuid,text,text) TO authenticated;

-- 员工指定内部监理时可选的账号：角色是「施工监理」的在职账号（员工不能直接读账号表）
CREATE OR REPLACE FUNCTION public.renovation_supervisor_candidates()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND coalesce(active,true) AND role IN ('staff','store_manager','regional_manager','general_manager','admin','superadmin')) THEN RAISE EXCEPTION '请登录后重试'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'phone',coalesce(phone,'')) ORDER BY name) FROM profiles WHERE role='supervisor' AND coalesce(active,true)),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.renovation_supervisor_candidates() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_supervisor_candidates() TO authenticated;
