-- Fulfilment tracking, owner signature before ordering custom goods, and staff handover.
-- Staff act on a whole sub-order (or a few lines of it); every contract line keeps its own trail.
--
-- Ownership: renovation_projects.created_by now means "current owner". About 50 access checks and
-- the statement phone already read it, so a handover moves all of them at once. Sales credit moves
-- to the new, never-reassigned sales_by column, and the two performance reports read that instead.
-- Run after every other renovation migration, before renovation_rpc_permissions. Safe to re-run.
BEGIN;

ALTER TABLE public.renovation_projects ADD COLUMN IF NOT EXISTS sales_by uuid REFERENCES public.profiles(id);
UPDATE public.renovation_projects SET sales_by=created_by WHERE sales_by IS NULL;
CREATE OR REPLACE FUNCTION public._reno_default_sales_by()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN NEW.sales_by:=coalesce(NEW.sales_by,NEW.created_by);RETURN NEW;END $$;
DROP TRIGGER IF EXISTS reno_default_sales_by ON public.renovation_projects;
CREATE TRIGGER reno_default_sales_by BEFORE INSERT ON public.renovation_projects
 FOR EACH ROW EXECUTE FUNCTION public._reno_default_sales_by();
REVOKE ALL ON FUNCTION public._reno_default_sales_by() FROM PUBLIC,anon,authenticated;
ALTER TABLE public.renovation_projects ALTER COLUMN sales_by SET NOT NULL;

-- Patch only the owner token inside each report, keeping whatever production runs. A report whose
-- text no longer matches stops the migration rather than silently crediting the new owner.
DO $patch$
DECLARE item text[];def text;
BEGIN
 FOREACH item SLICE 1 IN ARRAY ARRAY[
  ['public._dash_kpi_period(date,date,integer,uuid,text)','SELECT p.id, p.created_by, p.current_total','SELECT p.id, p.sales_by AS created_by, p.current_total'],
  ['public.get_store_performance(date,date,uuid,boolean)','OR p.created_by=a.id','OR p.sales_by=a.id']
 ] LOOP
  IF to_regprocedure(item[1]) IS NULL THEN RAISE EXCEPTION '找不到业绩函数 %，请先跑业绩迁移',item[1]; END IF;
  def:=pg_get_functiondef(to_regprocedure(item[1]));
  IF position(item[3] IN def)>0 THEN CONTINUE; END IF;
  IF position(item[2] IN def)=0 THEN RAISE EXCEPTION '业绩函数 % 与预期不符，已停止',item[1]; END IF;
  EXECUTE replace(def,item[2],item[3]);
 END LOOP;
END $patch$;

-- Owner signature for custom goods. Each new version replaces the last; old versions stay on file.
CREATE TABLE IF NOT EXISTS public.renovation_custom_confirmations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.renovation_projects(id),
 work_order_id uuid NOT NULL REFERENCES public.renovation_work_orders(id),
 version integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('confirm','change')),
 line_ids jsonb NOT NULL,
 terms jsonb NOT NULL,
 document_path text NOT NULL,
 document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paper_review','signed','voided')),
 signing_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 failed_checks integer NOT NULL DEFAULT 0,
 verified_until timestamptz,
 method text CHECK(method IN ('electronic','paper')),
 signer_name text, signer_relation text, signed_at timestamptz,
 signed_terms_hash text, signature_strokes jsonb, signature_hash text,
 paper_path text, paper_sha256 text, paper_reviewed_by uuid REFERENCES public.profiles(id),
 voided_at timestamptz, voided_by uuid, void_reason text,
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(work_order_id,version),
 CONSTRAINT reno_confirmation_signed_check CHECK(status<>'signed' OR (signed_at IS NOT NULL AND signer_name IS NOT NULL AND signer_relation IS NOT NULL AND
  ((method='electronic' AND signature_strokes IS NOT NULL AND signature_hash IS NOT NULL AND signed_terms_hash IS NOT NULL) OR
   (method='paper' AND paper_path IS NOT NULL AND paper_reviewed_by IS NOT NULL))))
);
CREATE UNIQUE INDEX IF NOT EXISTS reno_confirmation_one_live ON public.renovation_custom_confirmations(work_order_id)
 WHERE status IN ('pending','paper_review');

CREATE TABLE IF NOT EXISTS public.renovation_purchase_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.renovation_projects(id),
 work_order_id uuid NOT NULL REFERENCES public.renovation_work_orders(id),
 supplier text NOT NULL, supplier_order_no text NOT NULL DEFAULT '',
 ordered_on date NOT NULL, expected_on date NOT NULL, note text NOT NULL DEFAULT '',
 legacy boolean NOT NULL DEFAULT false,
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.renovation_work_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.renovation_projects(id),
 work_order_id uuid NOT NULL REFERENCES public.renovation_work_orders(id),
 line_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('custom','stock','work','gift')),
 name text NOT NULL DEFAULT '', spec text NOT NULL DEFAULT '', qty numeric, unit text NOT NULL DEFAULT '',
 stage text NOT NULL DEFAULT 'pending' CHECK(stage IN ('pending','confirmed','ordered','arrived','scheduled','working','done','cancelled')),
 confirmation_id uuid REFERENCES public.renovation_custom_confirmations(id),
 batch_id uuid REFERENCES public.renovation_purchase_batches(id),
 scheduled_on date, arrived_on date, done_on date, proof_path text,
 change_pending boolean NOT NULL DEFAULT false,
 issue_note text, issue_follow_up_on date,
 legacy_eligible boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(work_order_id,line_id)
);
CREATE INDEX IF NOT EXISTS reno_work_items_project ON public.renovation_work_items(project_id);

CREATE TABLE IF NOT EXISTS public.renovation_handovers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 from_user uuid NOT NULL REFERENCES public.profiles(id),
 to_user uuid NOT NULL REFERENCES public.profiles(id),
 project_ids uuid[] NOT NULL,
 checklist jsonb NOT NULL,
 note text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','cancelled')),
 forced boolean NOT NULL DEFAULT false,
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz
);

ALTER TABLE public.renovation_custom_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renovation_purchase_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renovation_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renovation_handovers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.renovation_custom_confirmations,public.renovation_purchase_batches,public.renovation_work_items,public.renovation_handovers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.renovation_custom_confirmations,public.renovation_purchase_batches,public.renovation_work_items,public.renovation_handovers TO authenticated;
DROP POLICY IF EXISTS reno_confirmations_read ON public.renovation_custom_confirmations;
CREATE POLICY reno_confirmations_read ON public.renovation_custom_confirmations FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.renovation_projects p WHERE p.id=project_id AND public._reno_access(p.store_id,p.created_by)));
DROP POLICY IF EXISTS reno_batches_read ON public.renovation_purchase_batches;
CREATE POLICY reno_batches_read ON public.renovation_purchase_batches FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.renovation_projects p WHERE p.id=project_id AND public._reno_access(p.store_id,p.created_by)));
DROP POLICY IF EXISTS reno_items_read ON public.renovation_work_items;
CREATE POLICY reno_items_read ON public.renovation_work_items FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.renovation_projects p WHERE p.id=project_id AND public._reno_access(p.store_id,p.created_by)));
DROP POLICY IF EXISTS reno_handovers_read ON public.renovation_handovers;
CREATE POLICY reno_handovers_read ON public.renovation_handovers FOR SELECT TO authenticated
 USING(from_user=auth.uid() OR to_user=auth.uid() OR created_by=auth.uid() OR EXISTS(SELECT 1 FROM public.renovation_projects p WHERE p.id=ANY(project_ids) AND public._reno_access(p.store_id,p.created_by,true)));

-- Drawings, paper scans and completion photos. The contract bucket accepts PDF only.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('renovation-fulfillment','renovation-fulfillment',false,20971520,ARRAY['application/pdf','image/jpeg','image/png','image/webp']) ON CONFLICT(id) DO NOTHING;
DROP POLICY IF EXISTS reno_fulfillment_files_select ON storage.objects;
CREATE POLICY reno_fulfillment_files_select ON storage.objects FOR SELECT TO authenticated USING(bucket_id='renovation-fulfillment' AND EXISTS(
 SELECT 1 FROM renovation_projects p WHERE p.id::text=split_part(name,'/',1) AND _reno_access(p.store_id,p.created_by)));
DROP POLICY IF EXISTS reno_fulfillment_files_insert ON storage.objects;
CREATE POLICY reno_fulfillment_files_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='renovation-fulfillment' AND EXISTS(
 SELECT 1 FROM renovation_projects p WHERE p.id::text=split_part(name,'/',1) AND p.state='executing' AND _reno_access(p.store_id,p.created_by)));
CREATE OR REPLACE FUNCTION public._reno_custom_doc_readable(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM renovation_custom_confirmations WHERE document_path=p_name AND status='pending' AND verified_until>now());
$$;
REVOKE ALL ON FUNCTION public._reno_custom_doc_readable(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._reno_custom_doc_readable(text) TO anon;
DROP POLICY IF EXISTS reno_custom_doc_read ON storage.objects;
CREATE POLICY reno_custom_doc_read ON storage.objects FOR SELECT TO anon
 USING(bucket_id='renovation-fulfillment' AND public._reno_custom_doc_readable(name));

-- Keep one tracking row per contract line, following additions and signed deductions.
CREATE OR REPLACE FUNCTION public._reno_sync_work_items(p_project uuid,p_backfill boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE lines jsonb:=_reno_effective_lines(p_project);
BEGIN
 INSERT INTO renovation_work_items(project_id,work_order_id,line_id,kind,name,spec,qty,unit,stage,legacy_eligible)
 SELECT w.project_id,w.id,lid,CASE WHEN l->>'kind' IN ('custom','stock','work','gift') THEN l->>'kind' ELSE 'custom' END,
  coalesce(l->>'name',''),coalesce(l->>'spec',''),(l->>'qty')::numeric,coalesce(l->>'unit',''),
  CASE WHEN w.status='done' AND w.cancelled_at IS NULL THEN 'done' ELSE 'pending' END,p_backfill
 FROM renovation_work_orders w CROSS JOIN LATERAL jsonb_array_elements_text(w.line_ids) lid
 JOIN LATERAL jsonb_array_elements(lines) l ON l->>'id'=lid
 WHERE w.project_id=p_project
 ON CONFLICT(work_order_id,line_id) DO NOTHING;
 UPDATE renovation_work_items i SET stage='cancelled',updated_at=now() FROM renovation_work_orders w
  WHERE w.id=i.work_order_id AND i.project_id=p_project AND i.stage<>'cancelled'
   AND (w.cancelled_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(lines) l WHERE l->>'id'=i.line_id));
 UPDATE renovation_work_items i SET stage='pending',updated_at=now() FROM renovation_work_orders w
  WHERE w.id=i.work_order_id AND i.project_id=p_project AND i.stage='cancelled' AND w.cancelled_at IS NULL
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(lines) l WHERE l->>'id'=i.line_id);
END $$;
REVOKE ALL ON FUNCTION public._reno_sync_work_items(uuid,boolean) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public._reno_sync_work_items_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM _reno_sync_work_items(NEW.project_id);RETURN NULL;END $$;
REVOKE ALL ON FUNCTION public._reno_sync_work_items_trigger() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS reno_sync_items_work ON public.renovation_work_orders;
CREATE TRIGGER reno_sync_items_work AFTER INSERT OR UPDATE OF line_ids,cancelled_at ON public.renovation_work_orders
 FOR EACH ROW EXECUTE FUNCTION public._reno_sync_work_items_trigger();
DROP TRIGGER IF EXISTS reno_sync_items_addition ON public.renovation_additions;
CREATE TRIGGER reno_sync_items_addition AFTER UPDATE OF work_order_id,signature_status,voided_at ON public.renovation_additions
 FOR EACH ROW EXECUTE FUNCTION public._reno_sync_work_items_trigger();
DROP TRIGGER IF EXISTS reno_sync_items_deduction ON public.renovation_deductions;
CREATE TRIGGER reno_sync_items_deduction AFTER UPDATE OF status ON public.renovation_deductions
 FOR EACH ROW EXECUTE FUNCTION public._reno_sync_work_items_trigger();

-- Sub-order status is the sum of its lines, so the customer page and acceptance checks keep working.
-- Lines already in progress before this migration never move backwards.
CREATE OR REPLACE FUNCTION public._reno_work_status_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE total integer;finished integer;moved integer;derived text;
BEGIN
 IF NEW.cancelled_at IS NOT NULL OR NEW.assignee IN ('已签减项，无需执行','增项已作废') THEN RETURN NEW; END IF;
 SELECT count(*) FILTER(WHERE stage<>'cancelled'),count(*) FILTER(WHERE stage='done'),count(*) FILTER(WHERE stage NOT IN ('pending','cancelled'))
  INTO total,finished,moved FROM renovation_work_items WHERE work_order_id=NEW.id;
 IF total=0 THEN RETURN NEW; END IF;
 IF OLD.status='done' OR finished=total THEN derived:='done';
 ELSIF NEW.status='done' THEN RAISE EXCEPTION '还有清单项未完成，子单不能标为已完成';
 ELSIF trim(NEW.assignee)='' THEN derived:='draft';
 ELSIF moved>0 OR OLD.status='working' THEN derived:='working';
 ELSE derived:=CASE WHEN NEW.status='draft' THEN 'draft' ELSE 'assigned' END; -- never relabel untouched old rows
 END IF;
 IF derived IS DISTINCT FROM OLD.status THEN NEW.updated_at:=now(); END IF;
 NEW.status:=derived;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._reno_work_status_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS reno_work_status_guard ON public.renovation_work_orders;
CREATE TRIGGER reno_work_status_guard BEFORE UPDATE OF status,assignee ON public.renovation_work_orders
 FOR EACH ROW EXECUTE FUNCTION public._reno_work_status_guard();
CREATE OR REPLACE FUNCTION public._reno_item_rollup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN UPDATE renovation_work_orders SET assignee=assignee WHERE id=NEW.work_order_id;RETURN NULL;END $$;
REVOKE ALL ON FUNCTION public._reno_item_rollup() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS reno_item_rollup ON public.renovation_work_items;
CREATE TRIGGER reno_item_rollup AFTER INSERT OR UPDATE OF stage ON public.renovation_work_items
 FOR EACH ROW EXECUTE FUNCTION public._reno_item_rollup();

-- Existing projects: lines become trackable, and only these may record an order placed before this feature.
DO $backfill$
DECLARE pid uuid;
BEGIN
 FOR pid IN SELECT DISTINCT project_id FROM renovation_work_orders LOOP PERFORM _reno_sync_work_items(pid,true); END LOOP;
END $backfill$;

CREATE OR REPLACE FUNCTION public._reno_apply_confirmation(p_confirmation uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 UPDATE renovation_work_items i SET confirmation_id=c.id,change_pending=false,updated_at=now(),
  stage=CASE WHEN i.stage='pending' THEN 'confirmed' ELSE i.stage END
 FROM renovation_custom_confirmations c
 WHERE c.id=p_confirmation AND i.work_order_id=c.work_order_id AND c.line_ids ? i.line_id AND i.stage<>'cancelled';
$$;
REVOKE ALL ON FUNCTION public._reno_apply_confirmation(uuid) FROM PUBLIC,anon,authenticated;

-- Resolve which lines an action touches. No list means the whole sub-order: every line that can
-- take this step and has no open problem. A line named explicitly must qualify, or the action stops.
CREATE OR REPLACE FUNCTION public._reno_pick_items(p_work uuid,p_lines jsonb,p_kinds text[],p_stages text[],p_error text)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE picked uuid[];wanted integer;
BEGIN
 IF p_lines IS NOT NULL AND jsonb_typeof(p_lines)<>'array' THEN RAISE EXCEPTION '清单项格式无效'; END IF;
 IF coalesce(jsonb_array_length(p_lines),0)=0 THEN
  SELECT array_agg(id) INTO picked FROM renovation_work_items
   WHERE work_order_id=p_work AND kind=ANY(p_kinds) AND stage=ANY(p_stages) AND issue_note IS NULL;
  IF picked IS NULL THEN RAISE EXCEPTION '%',p_error; END IF;
  RETURN picked;
 END IF;
 wanted:=jsonb_array_length(p_lines);
 SELECT array_agg(id) INTO picked FROM renovation_work_items
  WHERE work_order_id=p_work AND p_lines ? line_id AND kind=ANY(p_kinds) AND stage=ANY(p_stages) AND issue_note IS NULL;
 IF coalesce(array_length(picked,1),0)<>wanted THEN RAISE EXCEPTION '%',p_error; END IF;
 RETURN picked;
END $$;
REVOKE ALL ON FUNCTION public._reno_pick_items(uuid,jsonb,text[],text[],text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._reno_date_arg(p_value text,p_label text,p_not_future boolean DEFAULT true)
RETURNS date LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE d date;
BEGIN
 IF coalesce(p_value,'') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION '请填写有效的%',p_label; END IF;
 BEGIN d:=p_value::date; EXCEPTION WHEN others THEN RAISE EXCEPTION '请填写有效的%',p_label; END;
 IF p_not_future AND d>(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date THEN RAISE EXCEPTION '%不能晚于今天',p_label; END IF;
 RETURN d;
END $$;
REVOKE ALL ON FUNCTION public._reno_date_arg(text,text,boolean) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._reno_file_arg(p_project uuid,p_path text,p_label text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF coalesce(p_path,'')='' OR split_part(p_path,'/',1)<>p_project::text
  OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='renovation-fulfillment' AND name=p_path) THEN RAISE EXCEPTION '请先上传%',p_label; END IF;
 RETURN p_path;
END $$;
REVOKE ALL ON FUNCTION public._reno_file_arg(uuid,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.renovation_fulfillment_command(p_id uuid,p_revision integer,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;w renovation_work_orders%ROWTYPE;c renovation_custom_confirmations%ROWTYPE;b renovation_purchase_batches%ROWTYPE;
 picked uuid[];manager boolean;today date:=(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;ordered date;expected date;when_on date;lines jsonb;v_note text;v_supplier text;order_no text;reason text;path text;doc_hash text;v_version integer;log jsonb:=coalesce(p_data,'{}'::jsonb);
BEGIN
 IF auth.uid() IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF p_revision IS NULL OR p.revision<>p_revision THEN RAISE EXCEPTION '项目已被其他人修改，请刷新后重试'; END IF;
 IF p.state<>'executing' THEN RAISE EXCEPTION '项目当前不可修改履约进度'; END IF;
 manager:=_reno_access(p.store_id,p.created_by,true);
 lines:=p_data->'line_ids';v_note:=trim(coalesce(p_data->>'note',''));
 IF p_action NOT IN ('void_signature','submit_paper','review_paper','correct_batch') THEN
  SELECT * INTO w FROM renovation_work_orders WHERE id=(p_data->>'work_order_id')::uuid AND project_id=p_id AND cancelled_at IS NULL FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION '子订单不存在或已作废'; END IF;
 END IF;

 IF p_action='request_signature' THEN
  picked:=_reno_pick_items(w.id,lines,ARRAY['custom'],CASE WHEN coalesce(jsonb_array_length(lines),0)=0 THEN ARRAY['pending','confirmed'] ELSE ARRAY['pending','confirmed','ordered','arrived'] END,'这张子单没有需要业主签名的定制项');
  IF EXISTS(SELECT 1 FROM renovation_custom_confirmations WHERE work_order_id=w.id AND status IN ('pending','paper_review')) THEN RAISE EXCEPTION '这张子单已有一份等待签名的确认单，请先撤销'; END IF;
  path:=_reno_file_arg(p_id,p_data->>'document_path','定稿图纸或确认文件');
  doc_hash:=lower(coalesce(p_data->>'document_sha256',''));
  IF doc_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION '确认文件校验信息无效，请重新上传'; END IF;
  reason:=trim(coalesce(p_data->>'change_note',''));
  IF EXISTS(SELECT 1 FROM renovation_work_items WHERE id=ANY(picked) AND stage IN ('ordered','arrived')) AND reason='' THEN RAISE EXCEPTION '已下单的项目有修改，请写明改单内容'; END IF;
  SELECT coalesce(max(k.version),0)+1 INTO v_version FROM renovation_custom_confirmations k WHERE k.work_order_id=w.id;
  INSERT INTO renovation_custom_confirmations(project_id,work_order_id,version,kind,line_ids,terms,document_path,document_sha256,created_by)
  SELECT p_id,w.id,v_version,CASE WHEN reason='' THEN 'confirm' ELSE 'change' END,jsonb_agg(i.line_id ORDER BY i.line_id),
   jsonb_build_object('contract_no',p.contract_no,'address',p.address,'customer_name',p.customer_name,'group_name',w.group_name,'version',v_version,
    'change_note',reason,'note',v_note,'document_sha256',doc_hash,
    'lines',jsonb_agg(jsonb_build_object('id',i.line_id,'name',i.name,'spec',i.spec,'qty',i.qty,'unit',i.unit) ORDER BY i.line_id)),
   path,doc_hash,auth.uid()
  FROM renovation_work_items i WHERE i.id=ANY(picked) RETURNING * INTO c;
  -- A newer version cancels the earlier signature for lines not yet ordered.
  UPDATE renovation_work_items SET stage='pending',confirmation_id=NULL,updated_at=now() WHERE id=ANY(picked) AND stage='confirmed';
  UPDATE renovation_work_items SET change_pending=true,updated_at=now() WHERE id=ANY(picked) AND stage IN ('ordered','arrived');
  log:=jsonb_build_object('confirmation_id',c.id,'version',c.version,'kind',c.kind,'line_ids',c.line_ids,'document_sha256',doc_hash);

 ELSIF p_action IN ('void_signature','submit_paper','review_paper') THEN
  SELECT * INTO c FROM renovation_custom_confirmations WHERE id=(p_data->>'confirmation_id')::uuid AND project_id=p_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION '确认单不存在'; END IF;
  IF p_action='void_signature' THEN
   IF c.status NOT IN ('pending','paper_review') THEN RAISE EXCEPTION '只能撤销尚未签名的确认单'; END IF;
   reason:=trim(coalesce(p_data->>'reason',''));IF reason='' THEN RAISE EXCEPTION '请写明撤销原因'; END IF;
   UPDATE renovation_custom_confirmations SET status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=reason,verified_until=NULL WHERE id=c.id;
   UPDATE renovation_work_items SET change_pending=false,updated_at=now() WHERE work_order_id=c.work_order_id AND c.line_ids ? line_id;
  ELSIF p_action='submit_paper' THEN
   IF c.status<>'pending' THEN RAISE EXCEPTION '这份确认单不在等待签名状态'; END IF;
   path:=_reno_file_arg(p_id,p_data->>'paper_path','纸质确认单扫描件');
   IF trim(coalesce(p_data->>'signer_name',''))='' OR trim(coalesce(p_data->>'signer_relation',''))='' THEN RAISE EXCEPTION '请填写签名人姓名及与业主的关系'; END IF;
   IF lower(coalesce(p_data->>'paper_sha256','')) !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION '扫描件校验信息无效，请重新上传'; END IF;
   UPDATE renovation_custom_confirmations SET status='paper_review',paper_path=path,paper_sha256=lower(p_data->>'paper_sha256'),
    signer_name=trim(p_data->>'signer_name'),signer_relation=trim(p_data->>'signer_relation'),verified_until=NULL WHERE id=c.id;
  ELSE
   IF NOT manager THEN RAISE EXCEPTION '纸质确认单须由店长或上级审核'; END IF;
   IF c.status<>'paper_review' THEN RAISE EXCEPTION '这份确认单不在待审核状态'; END IF;
   IF (p_data->>'approve')::boolean IS TRUE THEN
    UPDATE renovation_custom_confirmations SET status='signed',method='paper',signed_at=now(),paper_reviewed_by=auth.uid() WHERE id=c.id;
    PERFORM _reno_apply_confirmation(c.id);
   ELSE
    UPDATE renovation_custom_confirmations SET status='pending',paper_path=NULL,paper_sha256=NULL,signer_name=NULL,signer_relation=NULL WHERE id=c.id;
   END IF;
  END IF;

 ELSIF p_action='place_order' THEN
  IF trim(w.assignee)='' THEN RAISE EXCEPTION '先指定执行人'; END IF;
  IF coalesce(jsonb_array_length(lines),0)>0 AND EXISTS(SELECT 1 FROM renovation_work_items WHERE work_order_id=w.id AND lines ? line_id AND kind='custom' AND stage='pending') THEN
   RAISE EXCEPTION '定制项没有业主签名，不能下单';
  END IF;
  picked:=_reno_pick_items(w.id,lines,ARRAY['custom','stock'],ARRAY['pending','confirmed'],'没有可下单的项目：定制项须先由业主签名');
  -- The whole-sub-order form also reaches here, so unsigned custom lines are dropped from it, never ordered.
  SELECT array_agg(i.id) INTO picked FROM renovation_work_items i LEFT JOIN renovation_custom_confirmations k ON k.id=i.confirmation_id
   WHERE i.id=ANY(picked) AND (i.kind='stock' OR (i.stage='confirmed' AND k.status='signed'));
  IF picked IS NULL THEN RAISE EXCEPTION '定制项没有业主签名，不能下单'; END IF;
  IF EXISTS(SELECT 1 FROM renovation_work_items WHERE id=ANY(picked) AND kind='stock') AND (p_data->>'stock_confirmed')::boolean IS NOT TRUE THEN RAISE EXCEPTION '请先勾选已与业主确认现货的规格和数量'; END IF;
  v_supplier:=trim(coalesce(p_data->>'supplier',''));order_no:=trim(coalesce(p_data->>'order_no',''));
  IF v_supplier='' THEN RAISE EXCEPTION '请填写厂家'; END IF;
  IF order_no='' AND EXISTS(SELECT 1 FROM renovation_work_items WHERE id=ANY(picked) AND kind='custom') THEN RAISE EXCEPTION '定制单请填写厂家单号'; END IF;
  ordered:=_reno_date_arg(p_data->>'ordered_on','下单日期');
  expected:=_reno_date_arg(p_data->>'expected_on','预计到货日',false);
  IF expected<ordered THEN RAISE EXCEPTION '预计到货日不能早于下单日期'; END IF;
  INSERT INTO renovation_purchase_batches(project_id,work_order_id,supplier,supplier_order_no,ordered_on,expected_on,note,created_by)
   VALUES(p_id,w.id,v_supplier,order_no,ordered,expected,v_note,auth.uid()) RETURNING * INTO b;
  UPDATE renovation_work_items SET stage='ordered',batch_id=b.id,updated_at=now() WHERE id=ANY(picked);
  log:=p_data||jsonb_build_object('batch_id',b.id,'item_ids',to_jsonb(picked));

 ELSIF p_action='legacy_order' THEN
  IF NOT manager THEN RAISE EXCEPTION '历史订单须由店长或上级登记'; END IF;
  reason:=trim(coalesce(p_data->>'reason',''));IF reason='' THEN RAISE EXCEPTION '请写明历史下单情况'; END IF;
  picked:=_reno_pick_items(w.id,lines,ARRAY['custom','stock'],ARRAY['pending','confirmed'],'没有可登记的项目');
  IF EXISTS(SELECT 1 FROM renovation_work_items WHERE id=ANY(picked) AND NOT legacy_eligible) THEN RAISE EXCEPTION '只有上线前已存在的清单项才能登记历史订单'; END IF;
  v_supplier:=trim(coalesce(p_data->>'supplier',''));IF v_supplier='' THEN RAISE EXCEPTION '请填写厂家'; END IF;
  ordered:=_reno_date_arg(p_data->>'ordered_on','下单日期');
  expected:=_reno_date_arg(p_data->>'expected_on','预计到货日',false);
  IF expected<ordered THEN RAISE EXCEPTION '预计到货日不能早于下单日期'; END IF;
  INSERT INTO renovation_purchase_batches(project_id,work_order_id,supplier,supplier_order_no,ordered_on,expected_on,note,legacy,created_by)
   VALUES(p_id,w.id,v_supplier,trim(coalesce(p_data->>'order_no','')),ordered,expected,reason,true,auth.uid()) RETURNING * INTO b;
  UPDATE renovation_work_items SET stage='ordered',batch_id=b.id,updated_at=now() WHERE id=ANY(picked);
  log:=p_data||jsonb_build_object('batch_id',b.id,'item_ids',to_jsonb(picked));

 ELSIF p_action='correct_batch' THEN
  SELECT * INTO b FROM renovation_purchase_batches WHERE id=(p_data->>'batch_id')::uuid AND project_id=p_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION '下单记录不存在'; END IF;
  reason:=trim(coalesce(p_data->>'reason',''));IF reason='' THEN RAISE EXCEPTION '请写明更正原因'; END IF;
  log:=jsonb_build_object('reason',reason,'before',to_jsonb(b));
  v_supplier:=coalesce(nullif(trim(coalesce(p_data->>'supplier','')),''),b.supplier);
  ordered:=CASE WHEN p_data ? 'ordered_on' THEN _reno_date_arg(p_data->>'ordered_on','下单日期') ELSE b.ordered_on END;
  expected:=CASE WHEN p_data ? 'expected_on' THEN _reno_date_arg(p_data->>'expected_on','预计到货日',false) ELSE b.expected_on END;
  IF expected<ordered THEN RAISE EXCEPTION '预计到货日不能早于下单日期'; END IF;
  UPDATE renovation_purchase_batches t SET supplier=v_supplier,supplier_order_no=CASE WHEN p_data ? 'order_no' THEN trim(p_data->>'order_no') ELSE b.supplier_order_no END,ordered_on=ordered,expected_on=expected WHERE t.id=b.id RETURNING * INTO b;
  log:=log||jsonb_build_object('after',to_jsonb(b));

 ELSIF p_action='arrive' THEN
  when_on:=_reno_date_arg(p_data->>'on','到货日期');
  picked:=_reno_pick_items(w.id,lines,ARRAY['custom','stock'],ARRAY['ordered'],'没有可标记到货的项目；有问题的项目请先处理');
  UPDATE renovation_work_items SET stage='arrived',arrived_on=when_on,updated_at=now() WHERE id=ANY(picked);
  log:=p_data||jsonb_build_object('item_ids',to_jsonb(picked));

 ELSIF p_action='schedule' THEN
  IF trim(w.assignee)='' THEN RAISE EXCEPTION '先指定执行人'; END IF;
  when_on:=_reno_date_arg(p_data->>'on','排期日期',false);
  picked:=_reno_pick_items(w.id,lines,ARRAY['work'],ARRAY['pending','scheduled'],'没有可排期的施工项');
  UPDATE renovation_work_items SET stage='scheduled',scheduled_on=when_on,updated_at=now() WHERE id=ANY(picked);
  log:=p_data||jsonb_build_object('item_ids',to_jsonb(picked));

 ELSIF p_action='start_work' THEN
  picked:=_reno_pick_items(w.id,lines,ARRAY['work'],ARRAY['scheduled'],'没有已排期的施工项');
  UPDATE renovation_work_items SET stage='working',updated_at=now() WHERE id=ANY(picked);
  log:=p_data||jsonb_build_object('item_ids',to_jsonb(picked));

 ELSIF p_action='finish' THEN
  IF trim(w.assignee)='' THEN RAISE EXCEPTION '先指定执行人'; END IF;
  when_on:=_reno_date_arg(p_data->>'on','完成日期');
  IF coalesce(jsonb_array_length(lines),0)>0 AND EXISTS(SELECT 1 FROM renovation_work_items WHERE work_order_id=w.id AND lines ? line_id AND change_pending) THEN RAISE EXCEPTION '改单确认尚未签名，不能完成'; END IF;
  SELECT array_agg(id) INTO picked FROM renovation_work_items WHERE work_order_id=w.id AND issue_note IS NULL AND NOT change_pending
   AND (coalesce(jsonb_array_length(lines),0)=0 OR lines ? line_id)
   AND ((kind IN ('custom','stock') AND stage='arrived') OR (kind='work' AND stage='working') OR (kind='gift' AND stage='pending'));
  IF picked IS NULL OR (coalesce(jsonb_array_length(lines),0)>0 AND array_length(picked,1)<>jsonb_array_length(lines)) THEN RAISE EXCEPTION '没有可标记完成的项目：材料须先到货，施工须先开工'; END IF;
  IF EXISTS(SELECT 1 FROM renovation_work_items WHERE id=ANY(picked) AND kind<>'gift') THEN path:=_reno_file_arg(p_id,p_data->>'proof_path','完工照片或文件'); END IF;
  UPDATE renovation_work_items SET stage='done',done_on=when_on,proof_path=path,updated_at=now() WHERE id=ANY(picked);
  log:=p_data||jsonb_build_object('item_ids',to_jsonb(picked));

 ELSIF p_action='flag_issue' THEN
  IF coalesce(jsonb_array_length(lines),0)=0 THEN RAISE EXCEPTION '请选择有问题的清单项'; END IF;
  IF v_note='' THEN RAISE EXCEPTION '请写明问题'; END IF;
  when_on:=_reno_date_arg(p_data->>'follow_up_on','跟进日期',false);
  UPDATE renovation_work_items SET issue_note=v_note,issue_follow_up_on=when_on,updated_at=now() WHERE work_order_id=w.id AND lines ? line_id AND stage NOT IN ('done','cancelled');
  IF NOT FOUND THEN RAISE EXCEPTION '所选清单项无法标记问题'; END IF;

 ELSIF p_action='resolve_issue' THEN
  IF coalesce(jsonb_array_length(lines),0)=0 THEN RAISE EXCEPTION '请选择清单项'; END IF;
  UPDATE renovation_work_items SET issue_note=NULL,issue_follow_up_on=NULL,updated_at=now() WHERE work_order_id=w.id AND lines ? line_id AND issue_note IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '所选清单项没有未解决的问题'; END IF;

 ELSE RAISE EXCEPTION '不支持的操作';
 END IF;

 UPDATE renovation_projects SET revision=revision+1,updated_at=now() WHERE id=p_id RETURNING * INTO p;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p_id,auth.uid(),'fulfillment_'||p_action,log);
 RETURN to_jsonb(p);
END $$;
REVOKE ALL ON FUNCTION public.renovation_fulfillment_command(uuid,integer,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_fulfillment_command(uuid,integer,text,jsonb) TO authenticated;

-- Owner signing. Family may sign on the owner's behalf: the link still needs the owner's phone
-- last four digits, and the signer's name and relationship are kept with the signature.
CREATE OR REPLACE FUNCTION public.renovation_custom_sign_open(p_id uuid,p_sign_token uuid,p_last4 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c renovation_custom_confirmations%ROWTYPE;p renovation_projects%ROWTYPE;
BEGIN
 SELECT * INTO c FROM renovation_custom_confirmations WHERE id=p_id AND signing_token=p_sign_token FOR UPDATE;
 IF c.id IS NULL THEN RETURN NULL; END IF;
 IF c.status='voided' THEN RETURN jsonb_build_object('status','voided'); END IF;
 IF c.failed_checks>=8 THEN RETURN jsonb_build_object('status','locked'); END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=c.project_id;
 IF NOT _reno_esign_check_phone(p.customer_phone,p_last4) THEN
  UPDATE renovation_custom_confirmations SET failed_checks=failed_checks+1 WHERE id=c.id RETURNING * INTO c;
  RETURN jsonb_build_object('status',CASE WHEN c.failed_checks>=8 THEN 'locked' ELSE 'wrong_phone' END,'remaining',greatest(0,8-c.failed_checks));
 END IF;
 UPDATE renovation_custom_confirmations SET failed_checks=0,verified_until=CASE WHEN status='pending' THEN now()+interval '30 minutes' ELSE verified_until END WHERE id=c.id RETURNING * INTO c;
 RETURN jsonb_build_object('status',c.status,'terms',c.terms,'terms_hash',encode(sha256(convert_to(c.terms::text,'UTF8')),'hex'),
  'document_path',CASE WHEN c.status='pending' THEN c.document_path END,'signed_at',c.signed_at,'signer_name',c.signer_name,'signer_relation',c.signer_relation,'signature_hash',c.signature_hash);
END $$;
REVOKE ALL ON FUNCTION public.renovation_custom_sign_open(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_custom_sign_open(uuid,uuid,text) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.renovation_custom_sign(p_id uuid,p_sign_token uuid,p_last4 text,p_terms_hash text,p_name text,p_relation text,p_strokes jsonb,p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c renovation_custom_confirmations%ROWTYPE;p renovation_projects%ROWTYPE;at_time timestamptz:=now();record jsonb;signer text:=trim(coalesce(p_name,''));relation text:=trim(coalesce(p_relation,''));
BEGIN
 SELECT * INTO c FROM renovation_custom_confirmations WHERE id=p_id AND signing_token=p_sign_token;
 IF c.id IS NULL THEN RAISE EXCEPTION '签署链接无效或已撤销'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=c.project_id FOR UPDATE;
 SELECT * INTO c FROM renovation_custom_confirmations WHERE id=p_id FOR UPDATE;
 IF c.status='voided' THEN RAISE EXCEPTION '此签署链接已作废，请联系门店'; END IF;
 IF c.status<>'pending' THEN RAISE EXCEPTION '此确认单已处理，不能重复签署'; END IF;
 IF c.failed_checks>=8 OR NOT _reno_esign_check_phone(p.customer_phone,p_last4) OR c.verified_until IS NULL OR c.verified_until<at_time THEN
  RAISE EXCEPTION '身份验证已过期，请重新输入手机号后四位';
 END IF;
 IF p.state<>'executing' THEN RAISE EXCEPTION '项目当前不可签署'; END IF;
 IF p_terms_hash IS DISTINCT FROM encode(sha256(convert_to(c.terms::text,'UTF8')),'hex') THEN RAISE EXCEPTION '确认单内容已更新，请刷新核对后重新签名'; END IF;
 IF p_accept IS DISTINCT FROM true THEN RAISE EXCEPTION '请勾选确认已核对全部内容'; END IF;
 IF signer='' OR relation='' OR length(signer)>100 OR length(relation)>50 THEN RAISE EXCEPTION '请填写签名人姓名及与业主的关系'; END IF;
 PERFORM _reno_check_strokes(p_strokes);
 record:=jsonb_build_object('terms',c.terms,'signer_name',signer,'signer_relation',relation,'signed_at',at_time,'signature',p_strokes,'consent',true,'phone_verified',true);
 UPDATE renovation_custom_confirmations SET status='signed',method='electronic',signed_at=at_time,signer_name=signer,signer_relation=relation,signed_terms_hash=p_terms_hash,
  signature_strokes=p_strokes,signature_hash=encode(sha256(convert_to(record::text,'UTF8')),'hex'),verified_until=NULL WHERE id=c.id RETURNING * INTO c;
 PERFORM _reno_apply_confirmation(c.id);
 UPDATE renovation_projects SET revision=revision+1,updated_at=at_time WHERE id=p.id;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p.id,NULL,'fulfillment_customer_signed',
  jsonb_build_object('confirmation_id',c.id,'version',c.version,'signed_at',c.signed_at,'signer_name',c.signer_name,'signer_relation',c.signer_relation,'signature_hash',c.signature_hash));
 RETURN jsonb_build_object('ok',true,'signed_at',c.signed_at,'signature_hash',c.signature_hash);
END $$;
REVOKE ALL ON FUNCTION public.renovation_custom_sign(uuid,uuid,text,text,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_custom_sign(uuid,uuid,text,text,text,text,jsonb,boolean) TO anon,authenticated;

-- What needs attention on one project. Shared by the to-do list and the handover checklist.
CREATE OR REPLACE FUNCTION public._reno_project_todos(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date d),
 rows AS (
  SELECT w.id work_order_id,w.group_name,
   CASE WHEN i.issue_note IS NOT NULL THEN 'issue'
        WHEN i.change_pending OR (i.kind='custom' AND i.stage='pending' AND live.status='pending') THEN 'awaiting_signature'
        WHEN i.kind='custom' AND i.stage='pending' AND live.status='paper_review' THEN 'paper_review'
        WHEN i.kind='custom' AND i.stage='pending' THEN 'need_signature'
        WHEN (i.kind='custom' AND i.stage='confirmed') OR (i.kind='stock' AND i.stage IN ('pending','confirmed')) THEN 'to_order'
        WHEN i.stage='ordered' AND b.expected_on<(SELECT d FROM today) THEN 'overdue_arrival'
        WHEN i.stage='ordered' AND b.expected_on<=(SELECT d FROM today)+3 THEN 'arriving_soon' END AS type,
   CASE WHEN i.issue_note IS NOT NULL THEN i.issue_follow_up_on WHEN i.stage='ordered' THEN b.expected_on END AS due,
   i.issue_note
  FROM renovation_work_items i JOIN renovation_work_orders w ON w.id=i.work_order_id
  LEFT JOIN renovation_purchase_batches b ON b.id=i.batch_id
  LEFT JOIN LATERAL (SELECT c.status FROM renovation_custom_confirmations c WHERE c.work_order_id=w.id AND c.status IN ('pending','paper_review') AND c.line_ids ? i.line_id LIMIT 1) live ON true
  WHERE i.project_id=p_id AND i.stage NOT IN ('done','cancelled') AND w.cancelled_at IS NULL)
 SELECT coalesce(jsonb_agg(t ORDER BY t.due NULLS LAST,t.group_name),'[]'::jsonb) FROM (
  SELECT work_order_id,group_name,type,count(*) AS count,min(due) AS due,max(issue_note) AS note FROM rows WHERE type IS NOT NULL GROUP BY 1,2,3) t;
$$;
REVOKE ALL ON FUNCTION public._reno_project_todos(uuid) FROM PUBLIC,anon,authenticated;

-- Row-level access keeps this to the caller's own projects, or their store or region for managers.
CREATE OR REPLACE FUNCTION public.renovation_my_todos()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
  'items',coalesce((SELECT jsonb_agg(x.t||jsonb_build_object('project_id',p.id,'contract_no',p.contract_no,'customer_name',p.customer_name,'mine',p.created_by=auth.uid()) ORDER BY p.created_at DESC)
    FROM renovation_projects p CROSS JOIN LATERAL jsonb_array_elements(_reno_project_todos(p.id)) x(t)
    WHERE p.state='executing' AND _reno_access(p.store_id,p.created_by)),'[]'::jsonb),
  'handovers',coalesce((SELECT jsonb_agg(jsonb_build_object('id',h.id,'from_name',f.name,'note',h.note,'checklist',h.checklist,'created_at',h.created_at) ORDER BY h.created_at)
    FROM renovation_handovers h JOIN profiles f ON f.id=h.from_user WHERE h.to_user=auth.uid() AND h.status='pending'),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.renovation_my_todos() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_my_todos() TO authenticated;

CREATE OR REPLACE FUNCTION public._reno_handover_checklist(p_projects uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('project_id',p.id,'contract_no',p.contract_no,'customer_name',p.customer_name,'customer_phone',p.customer_phone,'address',p.address,'state',p.state,'todos',_reno_project_todos(p.id)) ORDER BY p.contract_no),'[]'::jsonb)
 FROM renovation_projects p WHERE p.id=ANY(p_projects);
$$;
REVOKE ALL ON FUNCTION public._reno_handover_checklist(uuid[]) FROM PUBLIC,anon,authenticated;

-- A receiver must actually be able to open the project afterwards.
CREATE OR REPLACE FUNCTION public._reno_can_own(p_user uuid,p_store uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM profiles u LEFT JOIN stores s ON s.id=p_store WHERE u.id=p_user AND u.active=true AND (
  u.role IN ('general_manager','admin','superadmin') OR (u.role='regional_manager' AND u.region=s.region) OR (u.role IN ('staff','store_manager') AND u.store_id=p_store)));
$$;
REVOKE ALL ON FUNCTION public._reno_can_own(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._reno_apply_handover(p_handover uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h renovation_handovers%ROWTYPE;
BEGIN
 SELECT * INTO h FROM renovation_handovers WHERE id=p_handover;
 INSERT INTO renovation_audit(project_id,actor,action,payload)
  SELECT p.id,auth.uid(),'handover',jsonb_build_object('handover_id',h.id,'from_user',h.from_user,'to_user',h.to_user,'forced',h.forced,'note',h.note)
  FROM renovation_projects p WHERE p.id=ANY(h.project_ids);
 UPDATE renovation_projects SET created_by=h.to_user,revision=revision+1,updated_at=now() WHERE id=ANY(h.project_ids);
 UPDATE renovation_handovers SET status='accepted',resolved_at=now() WHERE id=h.id;
END $$;
REVOKE ALL ON FUNCTION public._reno_apply_handover(uuid) FROM PUBLIC,anon,authenticated;

-- People a manager may hand work between, with how many unfinished projects each still holds.
CREATE OR REPLACE FUNCTION public.renovation_handover_people()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'role',u.role,'store_id',u.store_id,'active',u.active,
  'projects',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'contract_no',p.contract_no,'customer_name',p.customer_name,'state',p.state,'store_id',p.store_id) ORDER BY p.created_at DESC),'[]'::jsonb) FROM renovation_projects p WHERE p.created_by=u.id)) ORDER BY u.active DESC,u.name),'[]'::jsonb)
 FROM profiles u WHERE u.role IN ('staff','store_manager','regional_manager','general_manager','admin','superadmin') AND _reno_access(u.store_id,NULL,true);
$$;
REVOKE ALL ON FUNCTION public.renovation_handover_people() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_handover_people() TO authenticated;

CREATE OR REPLACE FUNCTION public.renovation_handover_command(p_action text,p_handover uuid,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h renovation_handovers%ROWTYPE;from_id uuid;to_id uuid;ids uuid[];r renovation_projects%ROWTYPE;found_count integer:=0;
BEGIN
 IF auth.uid() IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION '请登录后重试'; END IF;
 IF p_action='create' THEN
  from_id:=(p_data->>'from_user')::uuid;to_id:=(p_data->>'to_user')::uuid;
  IF from_id IS NULL OR to_id IS NULL OR from_id=to_id THEN RAISE EXCEPTION '请选择不同的交出人和接手人'; END IF;
  IF jsonb_typeof(p_data->'project_ids')<>'array' OR jsonb_array_length(p_data->'project_ids')=0 THEN RAISE EXCEPTION '请选择要交接的项目'; END IF;
  SELECT array_agg(value::uuid) INTO ids FROM jsonb_array_elements_text(p_data->'project_ids');
  FOR r IN SELECT * FROM renovation_projects WHERE id=ANY(ids) FOR UPDATE LOOP
   found_count:=found_count+1;
   IF NOT _reno_access(r.store_id,r.created_by,true) THEN RAISE EXCEPTION '须由店长或上级办理交接'; END IF;
   IF r.created_by<>from_id THEN RAISE EXCEPTION '项目 % 已不属于交出人',r.contract_no; END IF;
   IF NOT _reno_can_own(to_id,r.store_id) THEN RAISE EXCEPTION '接手人已停用或不属于项目 % 的门店',r.contract_no; END IF;
  END LOOP;
  IF found_count<>array_length(ids,1) THEN RAISE EXCEPTION '所选项目不存在'; END IF;
  IF EXISTS(SELECT 1 FROM renovation_handovers WHERE status='pending' AND project_ids && ids) THEN RAISE EXCEPTION '有项目正在等待接手，请先处理'; END IF;
  INSERT INTO renovation_handovers(from_user,to_user,project_ids,checklist,note,created_by)
   VALUES(from_id,to_id,ids,_reno_handover_checklist(ids),trim(coalesce(p_data->>'note','')),auth.uid()) RETURNING * INTO h;
  RETURN to_jsonb(h);
 END IF;
 SELECT * INTO h FROM renovation_handovers WHERE id=p_handover FOR UPDATE;
 IF h.id IS NULL OR h.status<>'pending' THEN RAISE EXCEPTION '这份交接单已处理'; END IF;
 IF p_action='accept' THEN
  IF h.to_user<>auth.uid() THEN RAISE EXCEPTION '只有接手人本人可以确认'; END IF;
  PERFORM 1 FROM renovation_projects WHERE id=ANY(h.project_ids) FOR UPDATE;
  IF EXISTS(SELECT 1 FROM renovation_projects WHERE id=ANY(h.project_ids) AND created_by<>h.from_user) THEN RAISE EXCEPTION '部分项目负责人已变更，请店长重新发起'; END IF;
  IF EXISTS(SELECT 1 FROM renovation_projects WHERE id=ANY(h.project_ids) AND NOT _reno_can_own(h.to_user,store_id)) THEN RAISE EXCEPTION '接手人已不属于项目门店'; END IF;
  PERFORM _reno_apply_handover(h.id);
 ELSIF p_action='cancel' THEN
  IF h.created_by<>auth.uid() AND NOT EXISTS(SELECT 1 FROM renovation_projects p WHERE p.id=ANY(h.project_ids) AND _reno_access(p.store_id,p.created_by,true)) THEN RAISE EXCEPTION '无权撤销这份交接单'; END IF;
  UPDATE renovation_handovers SET status='cancelled',resolved_at=now() WHERE id=h.id;
 ELSE RAISE EXCEPTION '不支持的操作';
 END IF;
 SELECT * INTO h FROM renovation_handovers WHERE id=h.id;
 RETURN to_jsonb(h);
END $$;
REVOKE ALL ON FUNCTION public.renovation_handover_command(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_handover_command(text,uuid,jsonb) TO authenticated;

-- An account holding unfinished projects cannot be switched off; the work would be left unowned.
CREATE OR REPLACE FUNCTION public._reno_guard_deactivate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE open_count integer;
BEGIN
 IF OLD.active IS TRUE AND NEW.active IS NOT TRUE THEN
  SELECT count(*) INTO open_count FROM renovation_projects WHERE created_by=NEW.id AND state<>'accepted';
  IF open_count>0 THEN RAISE EXCEPTION '该员工还有 % 个未验收的整装项目，请先到整装订单办理交接',open_count; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._reno_guard_deactivate() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS reno_guard_deactivate ON public.profiles;
CREATE TRIGGER reno_guard_deactivate BEFORE UPDATE OF active ON public.profiles
 FOR EACH ROW EXECUTE FUNCTION public._reno_guard_deactivate();

-- Urgent departure: a manager moves everything the person holds to a named colleague, then
-- switches the account off. Store managers may do this for their own staff only.
CREATE OR REPLACE FUNCTION public.renovation_offboard_user(p_user uuid,p_to uuid,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u profiles%ROWTYPE;me profiles%ROWTYPE;ids uuid[];h renovation_handovers%ROWTYPE;v_note text:=trim(coalesce(p_note,''));
BEGIN
 SELECT * INTO me FROM profiles WHERE id=auth.uid();
 SELECT * INTO u FROM profiles WHERE id=p_user FOR UPDATE;
 IF u.id IS NULL OR me.id IS NULL OR NOT _reno_access(u.store_id,NULL,true) THEN RAISE EXCEPTION '无权办理此员工离职'; END IF;
 IF u.id=me.id THEN RAISE EXCEPTION '不能停用自己的账号'; END IF;
 IF u.role<>'staff' AND me.role='store_manager' THEN RAISE EXCEPTION '店长只能办理店员离职'; END IF;
 IF v_note='' THEN RAISE EXCEPTION '请写明紧急离职情况'; END IF;
 IF p_to IS NULL OR p_to=p_user THEN RAISE EXCEPTION '请选择接手人'; END IF;
 SELECT array_agg(id) INTO ids FROM (SELECT id FROM renovation_projects WHERE created_by=p_user FOR UPDATE) t;
 IF EXISTS(SELECT 1 FROM renovation_projects WHERE id=ANY(ids) AND NOT _reno_can_own(p_to,store_id)) THEN RAISE EXCEPTION '接手人已停用或不属于项目门店'; END IF;
 UPDATE renovation_handovers SET status='cancelled',resolved_at=now() WHERE status='pending' AND (from_user=p_user OR to_user=p_user);
 IF ids IS NOT NULL THEN
  INSERT INTO renovation_handovers(from_user,to_user,project_ids,checklist,note,forced,created_by)
   VALUES(p_user,p_to,ids,_reno_handover_checklist(ids),v_note,true,auth.uid()) RETURNING * INTO h;
  PERFORM _reno_apply_handover(h.id);
 END IF;
 UPDATE profiles SET active=false WHERE id=p_user;
 RETURN jsonb_build_object('ok',true,'projects',coalesce(array_length(ids,1),0));
END $$;
REVOKE ALL ON FUNCTION public.renovation_offboard_user(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_offboard_user(uuid,uuid,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
