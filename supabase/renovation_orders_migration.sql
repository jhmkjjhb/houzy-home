-- Renovation projects are separate from merchandise orders: never enter legacy
-- unpaid-order expiry/deletion, warehouse deductions, or merchandise receivables.
-- Apply in a test project first. No production migration has been run by this file.
BEGIN;
-- Later migrations redefine functions created here; re-running this file would
-- silently restore older money/permission rules, so refuse once they exist.
DO $guard$ BEGIN IF to_regclass('public.renovation_payments') IS NOT NULL THEN
 RAISE EXCEPTION '此迁移已被 renovation_payments_migration.sql 取代，重跑会恢复旧规则，已停止。请按《整装订单上线与验收》的迁移顺序执行。';
END IF; END $guard$;
CREATE TABLE IF NOT EXISTS public.renovation_projects (
 id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES public.stores(id),
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 contract_no text NOT NULL, customer_name text NOT NULL, customer_phone text NOT NULL,
 address text NOT NULL, state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','confirmed','executing','accepted')),
 revision integer NOT NULL DEFAULT 0,
 snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
 customer_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 accepted_on date, acceptance_path text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(store_id,contract_no)
);
CREATE TABLE IF NOT EXISTS public.renovation_work_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.renovation_projects(id),
 group_name text NOT NULL, line_ids jsonb NOT NULL, assignee text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','assigned','working','done')),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(project_id,group_name)
);
CREATE TABLE IF NOT EXISTS public.renovation_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES public.renovation_projects(id),
 actor uuid NOT NULL, action text NOT NULL, payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public._reno_access(p_store uuid,p_creator uuid,p_manager boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM profiles p LEFT JOIN stores s ON s.id=p_store
 WHERE p.id=auth.uid() AND p.active=true AND
 (NOT p_manager OR p.role IN ('store_manager','regional_manager','general_manager','admin','superadmin')) AND (
 p.role IN ('general_manager','admin','superadmin') OR
 (p.role='regional_manager' AND p.region=s.region) OR
 (p.role='store_manager' AND p.store_id=p_store) OR
 (p.role='staff' AND p.store_id=p_store AND p_creator=p.id)));
$$;
REVOKE ALL ON FUNCTION public._reno_access(uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._reno_access(uuid,uuid,boolean) TO authenticated;
ALTER TABLE public.renovation_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renovation_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renovation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.renovation_projects,public.renovation_work_orders,public.renovation_audit FROM anon,authenticated;
GRANT SELECT ON public.renovation_projects,public.renovation_work_orders,public.renovation_audit TO authenticated;
DROP POLICY IF EXISTS reno_projects_read ON public.renovation_projects;
CREATE POLICY reno_projects_read ON public.renovation_projects FOR SELECT TO authenticated
 USING(public._reno_access(store_id,created_by));
DROP POLICY IF EXISTS reno_work_read ON public.renovation_work_orders;
CREATE POLICY reno_work_read ON public.renovation_work_orders FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.renovation_projects p WHERE p.id=project_id AND public._reno_access(p.store_id,p.created_by)));
DROP POLICY IF EXISTS reno_audit_read ON public.renovation_audit;
CREATE POLICY reno_audit_read ON public.renovation_audit FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.renovation_projects p WHERE p.id=project_id AND public._reno_access(p.store_id,p.created_by)));

-- All mutations go through an optimistic-revision checked, row-locked transaction.
CREATE OR REPLACE FUNCTION public.renovation_command(p_id uuid,p_revision integer,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE; rowdata jsonb; wr jsonb; g text;
 total numeric:=0; discount numeric; net numeric; payments numeric:=0; q numeric; rate numeric;
 ids text[]:='{}'; lineid text; file_path text; v_work renovation_work_orders%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION '请登录后重试'; END IF;
 IF p_action='create' THEN
  IF NOT _reno_access((p_data->>'store_id')::uuid,auth.uid()) THEN RAISE EXCEPTION '无门店操作权限'; END IF;
  IF length(trim(coalesce(p_data->>'contract_no','')))=0 OR length(trim(coalesce(p_data->>'customer_name','')))=0
   OR length(trim(coalesce(p_data->>'customer_phone','')))=0 OR length(trim(coalesce(p_data->>'address','')))=0 THEN RAISE EXCEPTION '请补齐合同编号、客户、电话和项目地址'; END IF;
  INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,customer_phone,address)
   VALUES(p_id,(p_data->>'store_id')::uuid,auth.uid(),trim(p_data->>'contract_no'),trim(p_data->>'customer_name'),trim(p_data->>'customer_phone'),trim(p_data->>'address'))
   ON CONFLICT(id) DO NOTHING;
  SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
  IF p.created_by<>auth.uid() OR p.store_id<>(p_data->>'store_id')::uuid THEN RAISE EXCEPTION '项目已存在'; END IF;
  INSERT INTO renovation_audit(project_id,actor,action,payload) SELECT p.id,auth.uid(),'create',p_data WHERE NOT EXISTS(SELECT 1 FROM renovation_audit WHERE project_id=p.id);
  RETURN to_jsonb(p);
 END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF p.revision<>p_revision THEN RAISE EXCEPTION '项目已被其他人修改，请刷新后重试'; END IF;
 IF p_action='save' THEN
  IF p.state<>'draft' THEN RAISE EXCEPTION '合同已锁定，不能覆盖；变更需另签协议'; END IF;
  IF p_data->>'contract_no' IS NOT NULL AND p_data->>'contract_no'<>p.contract_no THEN RAISE EXCEPTION '合同编号与项目不一致'; END IF;
  IF jsonb_typeof(p_data->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'lines')=0
    OR jsonb_array_length(p_data->'lines')>500 THEN RAISE EXCEPTION '需提供1至500项合同清单'; END IF;
  IF octet_length(p_data::text)>2000000 THEN RAISE EXCEPTION '合同数据超过2MB，请缩短原文或拆分附件'; END IF;
  FOR rowdata IN SELECT value FROM jsonb_array_elements(p_data->'lines') LOOP
   lineid:=rowdata->>'id';
   IF coalesce(lineid,'')='' OR lineid=ANY(ids) OR coalesce(trim(rowdata->>'name'),'')='' OR coalesce(trim(rowdata->>'group'),'')=''
    OR rowdata->>'kind' NOT IN ('custom','stock','work','gift') OR rowdata->>'kind' IS NULL THEN RAISE EXCEPTION '清单编号重复、内容或分组不完整'; END IF;
   ids:=array_append(ids,lineid);
   q:=(rowdata->>'qty')::numeric;rate:=(rowdata->>'rate')::numeric;
   IF q IS NULL OR rate IS NULL OR q::text IN ('NaN','Infinity','-Infinity') OR rate::text IN ('NaN','Infinity','-Infinity') OR q<=0 OR q>100000000 OR rate<0 OR rate>100000000 THEN RAISE EXCEPTION '数量或单价无效'; END IF;
   IF rowdata->>'kind'='gift' AND rate<>0 THEN RAISE EXCEPTION '赠送项目售价必须为零'; END IF;
   IF coalesce(rowdata->>'unit','')='' THEN RAISE EXCEPTION '请补充计价单位'; END IF;
   IF jsonb_typeof(rowdata->'warranties') IS DISTINCT FROM 'array' OR jsonb_array_length(rowdata->'warranties')>50 THEN RAISE EXCEPTION '缺少质保核对记录'; END IF;
   FOR wr IN SELECT value FROM jsonb_array_elements(rowdata->'warranties') LOOP
    IF coalesce(wr->>'component','')='' OR coalesce(wr->>'source','')='' THEN RAISE EXCEPTION '质保需注明部件和条款来源'; END IF;
    IF wr->>'years' IS NOT NULL AND ((wr->>'years')::numeric<=0 OR (wr->>'years')::numeric>100 OR trunc((wr->>'years')::numeric)<>(wr->>'years')::numeric) THEN RAISE EXCEPTION '质保年限须为1至100整数，待确认留空'; END IF;
   END LOOP;
   total:=total+round(q*rate,2);
  END LOOP;
  discount:=(p_data->>'discount')::numeric;net:=(p_data->>'net')::numeric;
  IF discount IS NULL OR net IS NULL OR discount<0 OR discount>total OR net<=0 OR net<>round(net,2) OR discount<>round(discount,2) OR total-discount<>net THEN RAISE EXCEPTION '工程合计、优惠和合同价未对平'; END IF;
  IF jsonb_typeof(p_data->'payments') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'payments')=0 OR jsonb_array_length(p_data->'payments')>50 THEN RAISE EXCEPTION '缺少合同付款计划'; END IF;
  FOR rowdata IN SELECT value FROM jsonb_array_elements(p_data->'payments') LOOP
   IF coalesce(rowdata->>'name','')='' OR (rowdata->>'amount') IS NULL OR (rowdata->>'amount')::numeric<=0
    OR (rowdata->>'amount')::numeric<>round((rowdata->>'amount')::numeric,2) THEN RAISE EXCEPTION '付款节点或金额无效'; END IF;
   payments:=payments+(rowdata->>'amount')::numeric;
  END LOOP;
  IF payments<>net THEN RAISE EXCEPTION '付款计划合计与合同价不一致'; END IF;
  file_path:=p_data->>'contract_path';
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='renovation-contracts' AND name=file_path AND split_part(name,'/',1)=p_id::text) THEN RAISE EXCEPTION '合同原文件尚未归档'; END IF;
  UPDATE renovation_projects SET snapshot=p_data,revision=revision+1,updated_at=now() WHERE id=p_id RETURNING * INTO p;
 ELSIF p_action='confirm' THEN
  IF NOT _reno_access(p.store_id,p.created_by,true) THEN RAISE EXCEPTION '需店长或上级确认合同'; END IF;
  IF p.state<>'draft' OR p.snapshot->'lines' IS NULL OR coalesce(p_data->>'signed','')<>'true' OR coalesce(p_data->>'reviewed','')<>'true' THEN RAISE EXCEPTION '请核对清单、质保及双方签署的合同'; END IF;
  IF coalesce(p.snapshot->>'signed_on','')='' OR (p.snapshot->>'signed_on')::date>current_date THEN RAISE EXCEPTION '请填写有效签约日期'; END IF;
  UPDATE renovation_projects SET state='confirmed',revision=revision+1,updated_at=now() WHERE id=p_id RETURNING * INTO p;
 ELSIF p_action='split' THEN
  IF p.state NOT IN ('confirmed','executing') THEN RAISE EXCEPTION '先确认合同，再生成子订单'; END IF;
  INSERT INTO renovation_work_orders(project_id,group_name,line_ids)
  SELECT p_id,x->>'group',jsonb_agg(x->>'id') FROM jsonb_array_elements(p.snapshot->'lines') x GROUP BY x->>'group'
  ON CONFLICT(project_id,group_name) DO NOTHING;
  UPDATE renovation_projects SET state='executing',revision=revision+1,updated_at=now() WHERE id=p_id RETURNING * INTO p;
 ELSIF p_action='work' THEN
  IF p.state<>'executing' THEN RAISE EXCEPTION '项目当前不可修改履约进度'; END IF;
  SELECT * INTO v_work FROM renovation_work_orders WHERE id=(p_data->>'id')::uuid AND project_id=p_id FOR UPDATE;
  IF v_work.id IS NULL OR p_data->>'status' NOT IN ('draft','assigned','working','done') OR p_data->>'status' IS NULL THEN RAISE EXCEPTION '子订单或状态无效'; END IF;
  IF p_data->>'status'<>'draft' AND coalesce(trim(p_data->>'assignee'),'')='' THEN RAISE EXCEPTION '先指定负责人'; END IF;
  UPDATE renovation_work_orders SET assignee=trim(p_data->>'assignee'),status=p_data->>'status',updated_at=now() WHERE id=v_work.id;
  UPDATE renovation_projects SET revision=revision+1,updated_at=now() WHERE id=p_id RETURNING * INTO p;
 ELSIF p_action='accept' THEN
  IF NOT _reno_access(p.store_id,p.created_by,true) THEN RAISE EXCEPTION '需店长或上级确认竣工验收'; END IF;
  IF p.state<>'executing' OR NOT EXISTS(SELECT 1 FROM renovation_work_orders WHERE project_id=p_id)
   OR EXISTS(SELECT 1 FROM renovation_work_orders WHERE project_id=p_id AND status<>'done') THEN RAISE EXCEPTION '须先完成全部子订单'; END IF;
  IF coalesce(p_data->>'accepted_on','')='' OR (p_data->>'accepted_on')::date>current_date OR
   (p_data->>'accepted_on')::date<(p.snapshot->>'signed_on')::date THEN RAISE EXCEPTION '验收日期须在签约日至今天之间'; END IF;
  file_path:=p_data->>'acceptance_path';
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='renovation-contracts' AND name=file_path AND split_part(name,'/',1)=p_id::text) THEN RAISE EXCEPTION '请上传竣工验收凭证'; END IF;
  UPDATE renovation_projects SET state='accepted',accepted_on=(p_data->>'accepted_on')::date,acceptance_path=file_path,revision=revision+1,updated_at=now() WHERE id=p_id RETURNING * INTO p;
 ELSE RAISE EXCEPTION '未知操作'; END IF;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p.id,auth.uid(),p_action,p_data);
 RETURN to_jsonb(p);
END; $$;
REVOKE ALL ON FUNCTION public.renovation_command(uuid,integer,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_command(uuid,integer,text,jsonb) TO authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('renovation-contracts','renovation-contracts',false,20971520,ARRAY['application/pdf']) ON CONFLICT(id) DO NOTHING;
UPDATE storage.buckets SET public=false,file_size_limit=20971520,allowed_mime_types=ARRAY['application/pdf'] WHERE id='renovation-contracts';
DROP POLICY IF EXISTS reno_files_select ON storage.objects;
CREATE POLICY reno_files_select ON storage.objects FOR SELECT TO authenticated USING(bucket_id='renovation-contracts' AND EXISTS(
 SELECT 1 FROM renovation_projects p WHERE p.id::text=split_part(name,'/',1) AND _reno_access(p.store_id,p.created_by)));
DROP POLICY IF EXISTS reno_files_insert ON storage.objects;
CREATE POLICY reno_files_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='renovation-contracts' AND EXISTS(
 SELECT 1 FROM renovation_projects p WHERE p.id::text=split_part(name,'/',1) AND p.state IN ('draft','executing') AND _reno_access(p.store_id,p.created_by)));
-- No overwrite/delete policies: archived versions remain immutable.

-- Customer receives a high-entropy, revocable project link. No name/phone search,
-- banking, costs, staff notes, storage paths, or signed documents in this response.
CREATE OR REPLACE FUNCTION public.renovation_customer_view(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('contract_no',p.contract_no,'address',p.address,'state',p.state,'accepted_on',p.accepted_on,
 'net',p.snapshot->'net','lines',coalesce((SELECT jsonb_agg(jsonb_build_object(
 'id',x->>'id','name',x->>'name','spec',x->>'spec','qty',x->'qty','unit',x->>'unit','gift',x->>'kind'='gift','warranties',x->'warranties'))
 FROM jsonb_array_elements(p.snapshot->'lines') x),'[]'::jsonb))
 FROM renovation_projects p WHERE p.customer_token=p_token AND p.state<>'draft';
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_view(uuid) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.renovation_rotate_link(p_id uuid,p_revision integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE; token uuid;
BEGIN
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by,true) THEN RAISE EXCEPTION '无操作权限'; END IF;
 IF p.revision<>p_revision THEN RAISE EXCEPTION '请刷新后重试'; END IF;
 UPDATE renovation_projects SET customer_token=gen_random_uuid(),revision=revision+1,updated_at=now() WHERE id=p_id RETURNING customer_token INTO token;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p_id,auth.uid(),'rotate_link','{}');
 RETURN token;
END; $$;
REVOKE ALL ON FUNCTION public.renovation_rotate_link(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_rotate_link(uuid,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
