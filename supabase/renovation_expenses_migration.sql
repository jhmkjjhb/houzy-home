-- renovation_expenses_migration.sql
-- 2026-11-27 整装支出与公司财务：
--  监理 / 店员请款（每笔必须附发票、收据或签收单照片），挂到项目和子订单；门店开销不挂项目。
--  RM 500 以下直接进公司财务待付；超过 RM 500 先由店长批准。财务付款后上传转账凭证，标「已付」。
--  新增「财务」角色（finance）：看所有门店的支出、付款和每单利润，不能改合同和订单。
--  店员 / 监理只看自己提交的请款，看不到利润。
-- 依赖：renovation_orders_migration.sql（_reno_access）、renovation_site_supervision_migration.sql、renovation_payments_migration.sql。
-- 可重复运行。运行：Supabase SQL Editor → 粘贴全部 → Run

-- 1. 账号角色加「财务」：保留现有全部角色，只多加这一个
DO $role$
DECLARE c record;vals text[];
BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND contype='c' AND pg_get_constraintdef(oid) ~ '\mrole\M' LOOP
  IF c.def ~ '''finance''' THEN CONTINUE; END IF;
  SELECT array_agg(DISTINCT m[1]) INTO vals FROM regexp_matches(c.def,'''([a-z_]+)''','g') m;
  IF vals IS NULL OR NOT 'staff'=ANY(vals) THEN RAISE EXCEPTION '账号角色限制的格式和预期不同，未修改：%',c.def; END IF;
  EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I',c.conname);
  EXECUTE format('ALTER TABLE public.profiles ADD CONSTRAINT %I CHECK (role IN (%s))',c.conname,(SELECT string_agg(quote_literal(v),',') FROM unnest(vals||'finance'::text) v));
 END LOOP;
END $role$;

-- 2. 支出表
CREATE TABLE IF NOT EXISTS public.renovation_expenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES public.stores(id),
 project_id uuid REFERENCES public.renovation_projects(id),
 work_order_id uuid REFERENCES public.renovation_work_orders(id),
 category text NOT NULL CHECK(category IN ('material','labour','subcontract','transport','misc','commission','overhead')),
 payee text NOT NULL CHECK(length(btrim(payee)) BETWEEN 1 AND 120),
 payee_bank text NOT NULL DEFAULT '' CHECK(length(payee_bank)<=200),
 amount numeric(14,2) NOT NULL CHECK(amount>0 AND amount<=10000000),
 sst numeric(14,2) NOT NULL DEFAULT 0 CHECK(sst>=0 AND sst<=amount),
 doc_type text NOT NULL CHECK(doc_type IN ('invoice','receipt','voucher')),
 doc_no text NOT NULL DEFAULT '' CHECK(length(doc_no)<=80),
 docs jsonb NOT NULL CHECK(jsonb_typeof(docs)='array' AND jsonb_array_length(docs) BETWEEN 1 AND 8),
 spent_on date NOT NULL,
 note text NOT NULL DEFAULT '' CHECK(length(note)<=500),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','paid','rejected','void')),
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 approved_by uuid REFERENCES public.profiles(id), approved_at timestamptz,
 paid_by uuid REFERENCES public.profiles(id), paid_at timestamptz, paid_on date, paid_ref text, paid_proof text,
 closed_reason text,
 CHECK(project_id IS NOT NULL OR work_order_id IS NULL),
 CHECK(project_id IS NOT NULL OR category='overhead')
);
CREATE INDEX IF NOT EXISTS reno_expenses_project ON public.renovation_expenses(project_id,spent_on);
CREATE INDEX IF NOT EXISTS reno_expenses_store ON public.renovation_expenses(store_id,status,spent_on);
CREATE INDEX IF NOT EXISTS reno_expenses_creator ON public.renovation_expenses(created_by,created_at DESC);

-- 2b. 普通商品订单也能挂支出；币种跟订单走（新加坡店是 SGD）；单据照片指纹（防同一张照片报两次）
ALTER TABLE public.renovation_expenses ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id);
ALTER TABLE public.renovation_expenses ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'MYR';
ALTER TABLE public.renovation_expenses ADD COLUMN IF NOT EXISTS doc_hashes jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS reno_expenses_order ON public.renovation_expenses(order_id,spent_on);
CREATE INDEX IF NOT EXISTS reno_expenses_docno ON public.renovation_expenses(lower(payee),doc_no) WHERE doc_no<>'';
DO $c$
DECLARE c record;
BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.renovation_expenses'::regclass AND contype='c'
  AND pg_get_constraintdef(oid) ~ 'project_id IS NOT NULL\) OR \(category' LOOP
  EXECUTE format('ALTER TABLE public.renovation_expenses DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $c$;
ALTER TABLE public.renovation_expenses DROP CONSTRAINT IF EXISTS reno_expenses_target;
ALTER TABLE public.renovation_expenses ADD CONSTRAINT reno_expenses_target CHECK(num_nonnulls(project_id,order_id)<=1 AND (category='overhead')=(project_id IS NULL AND order_id IS NULL));
ALTER TABLE public.renovation_expenses DROP CONSTRAINT IF EXISTS reno_expenses_currency;
ALTER TABLE public.renovation_expenses ADD CONSTRAINT reno_expenses_currency CHECK(currency ~ '^[A-Z]{3}$');

-- 谁是财务（含总经理及以上，他们也能付款）
CREATE OR REPLACE FUNCTION public._is_finance()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM profiles p WHERE p.id=auth.uid() AND p.active
  AND (p.role IN ('finance','general_manager','admin','superadmin') OR coalesce(to_jsonb(p)->'extra_roles','[]'::jsonb) ? 'finance'));
$$;
REVOKE ALL ON FUNCTION public._is_finance() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._is_finance() TO authenticated;

-- 能批准这家门店请款的人：店长（本店）、区域经理（本区）、总经理及以上
CREATE OR REPLACE FUNCTION public._expense_manager(p_store uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public._reno_access(p_store,NULL,true);
$$;
REVOKE ALL ON FUNCTION public._expense_manager(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._expense_manager(uuid) TO authenticated;

ALTER TABLE public.renovation_expenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.renovation_expenses FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.renovation_expenses TO authenticated;
DROP POLICY IF EXISTS reno_expenses_read ON public.renovation_expenses;
CREATE POLICY reno_expenses_read ON public.renovation_expenses FOR SELECT TO authenticated
 USING(created_by=auth.uid() OR public._is_finance() OR public._expense_manager(store_id));

-- 3. 单据照片：私有存储，路径 <上传人>/<随机名>。上传人自己、财务、能批准这家门店的人可以看。
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('renovation-expenses','renovation-expenses',false,8388608,ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=8388608,allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','application/pdf'];
DROP POLICY IF EXISTS reno_expense_doc_insert ON storage.objects;
CREATE POLICY reno_expense_doc_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='renovation-expenses' AND split_part(name,'/',1)=auth.uid()::text
  AND EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND active AND role IN ('staff','store_manager','regional_manager','general_manager','admin','superadmin','supervisor','finance')));
CREATE OR REPLACE FUNCTION public._expense_doc_readable(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT split_part(p_name,'/',1)=auth.uid()::text OR public._is_finance()
  OR EXISTS(SELECT 1 FROM renovation_expenses e WHERE (e.docs ? p_name OR e.paid_proof=p_name) AND public._expense_manager(e.store_id));
$$;
REVOKE ALL ON FUNCTION public._expense_doc_readable(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._expense_doc_readable(text) TO authenticated;
DROP POLICY IF EXISTS reno_expense_doc_read ON storage.objects;
CREATE POLICY reno_expense_doc_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='renovation-expenses' AND public._expense_doc_readable(name));

-- 4. 请款入口：我的角色、能记门店开销的门店、我负责的工地 + 我最近请过款的单（订单多了靠下面的搜索）
CREATE OR REPLACE FUNCTION public._expense_project_ok(p_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM renovation_projects p WHERE p.id=p_project AND p.state IN ('confirmed','executing','accepted')
  AND (public._reno_access(p.store_id,p.created_by) OR public._is_finance()
   OR EXISTS(SELECT 1 FROM renovation_site_supervisors s WHERE s.project_id=p.id AND s.profile_id=auth.uid() AND s.active AND s.kind='internal')));
$$;
REVOKE ALL ON FUNCTION public._expense_project_ok(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._expense_project_ok(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public._expense_order_ok(p_order uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM orders o WHERE o.id=p_order AND o.status<>'cancelled'
  AND (public._is_finance() OR (EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND active AND role IN ('staff','store_manager','regional_manager','general_manager','admin','superadmin'))
   AND public._order_row_visible(o.id,o.store_id,o.staff_id,o.supplier_id,o.status))));
$$;
REVOKE ALL ON FUNCTION public._expense_order_ok(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._expense_order_ok(uuid) TO authenticated;

-- 一张可以请款的单（整装单或普通订单）给页面用的样子
CREATE OR REPLACE FUNCTION public._expense_target_json(p_kind text,p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN p_kind='project' THEN (SELECT jsonb_build_object('kind','project','id',p.id,'store_id',p.store_id,'no',p.contract_no,'contract_no',p.contract_no,'customer_name',p.customer_name,'address',p.address,'state',p.state,'currency','MYR',
   'work_orders',coalesce((SELECT jsonb_agg(jsonb_build_object('id',w.id,'name',w.group_name,'assignee',w.assignee) ORDER BY w.group_name) FROM renovation_work_orders w WHERE w.project_id=p.id AND w.cancelled_at IS NULL),'[]'::jsonb))
   FROM renovation_projects p WHERE p.id=p_id)
 ELSE (SELECT jsonb_build_object('kind','order','id',o.id,'store_id',o.store_id,'no',o.order_no,'customer_name',c.name,'address',coalesce(c.address,''),'state',o.status,
   'currency',upper(coalesce(nullif(to_jsonb(o)->>'currency',''),'MYR')),'supplier',sp.name,'description',left(coalesce(o.description,''),80),'work_orders','[]'::jsonb)
   FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN suppliers sp ON sp.id=o.supplier_id WHERE o.id=p_id) END;
$$;
REVOKE ALL ON FUNCTION public._expense_target_json(text,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.renovation_expense_targets()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
  'role',(SELECT role FROM profiles WHERE id=auth.uid()),
  'finance',public._is_finance(),
  -- 我负责的工地 + 最近 10 张我请过款的单
  'projects',coalesce((SELECT jsonb_agg(t ORDER BY ord) FROM (
    SELECT public._expense_target_json('project',s.project_id) t,0 ord FROM renovation_site_supervisors s
     WHERE s.profile_id=auth.uid() AND s.active AND s.kind='internal' AND public._expense_project_ok(s.project_id)
    UNION ALL
    SELECT public._expense_target_json(k,id),1 FROM (
     SELECT CASE WHEN project_id IS NOT NULL THEN 'project' ELSE 'order' END k,coalesce(project_id,order_id) id,max(created_at) last
     FROM renovation_expenses WHERE created_by=auth.uid() AND coalesce(project_id,order_id) IS NOT NULL GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10) r
     WHERE (k='project' AND public._expense_project_ok(id) AND NOT EXISTS(SELECT 1 FROM renovation_site_supervisors s WHERE s.project_id=r.id AND s.profile_id=auth.uid() AND s.active AND s.kind='internal'))
      OR (k='order' AND public._expense_order_ok(id))) q),'[]'::jsonb),
  'stores',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) ORDER BY s.name) FROM stores s WHERE s.active AND (public._is_finance() OR public._expense_manager(s.id))),'[]'::jsonb),
  'all_stores',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) ORDER BY s.name) FROM stores s),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.renovation_expense_targets() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_expense_targets() TO authenticated;

-- 搜单：合同号 / 单号 / 客户名 / 电话后几位 / 地址，整装单和普通订单一起找，最多 20 张。
-- 默认只找还在进行的（整装未验收、普通订单未完成，或 90 天内完工的）；p_all=true 包括更早完工的。p_id 直接取一张。
CREATE OR REPLACE FUNCTION public.renovation_expense_search(p_q text DEFAULT '',p_all boolean DEFAULT false,p_kind text DEFAULT NULL,p_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE q text:=lower(btrim(coalesce(p_q,'')));d text:=regexp_replace(coalesce(p_q,''),'\D','','g');out jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '请先登录' USING ERRCODE='42501'; END IF;
 IF p_id IS NOT NULL THEN
  IF (p_kind='project' AND public._expense_project_ok(p_id)) OR (p_kind='order' AND public._expense_order_ok(p_id)) THEN RETURN jsonb_build_array(public._expense_target_json(p_kind,p_id)); END IF;
  RETURN '[]'::jsonb;
 END IF;
 IF length(q)<2 THEN RETURN '[]'::jsonb; END IF;
 SELECT coalesce(jsonb_agg(public._expense_target_json(k,id) ORDER BY t DESC),'[]'::jsonb) INTO out FROM (
  (SELECT 'project' k,p.id,p.created_at t FROM renovation_projects p
   WHERE (position(q IN lower(p.contract_no))>0 OR position(q IN lower(p.customer_name))>0 OR position(q IN lower(p.address))>0
     OR (length(d)>=4 AND right(regexp_replace(coalesce(p.customer_phone,''),'\D','','g'),length(d))=d))
    AND (p_all OR p.state IN ('confirmed','executing') OR (p.state='accepted' AND p.updated_at>now()-interval '90 days'))
    AND public._expense_project_ok(p.id) ORDER BY p.created_at DESC LIMIT 20)
  UNION ALL
  (SELECT 'order',o.id,o.created_at FROM orders o LEFT JOIN customers c ON c.id=o.customer_id
   WHERE (position(q IN lower(o.order_no))>0 OR position(q IN lower(coalesce(c.name,'')))>0 OR position(q IN lower(coalesce(c.address,'')))>0
     OR (length(d)>=4 AND right(regexp_replace(coalesce(c.phone,''),'\D','','g'),length(d))=d))
    AND o.status<>'cancelled' AND (p_all OR o.status NOT IN ('completed','closed') OR coalesce(o.completed_at,o.updated_at)>now()-interval '90 days')
    AND public._expense_order_ok(o.id) ORDER BY o.created_at DESC LIMIT 20)) r;
 RETURN (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(out) x LIMIT 20) y);
END $$;
REVOKE ALL ON FUNCTION public.renovation_expense_search(text,boolean,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_expense_search(text,boolean,text,uuid) TO authenticated;

-- 5. 提交请款。p_data: {project_id|store_id, work_order_id, category, payee, payee_bank, amount, sst, doc_type, doc_no, docs:[path], spent_on, note}
--    一笔钱分到几个子订单：前端拆成几次提交，单据照片共用。
CREATE OR REPLACE FUNCTION public.renovation_expense_submit(p_data jsonb)
RETURNS public.renovation_expenses LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;w renovation_work_orders%ROWTYPE;e renovation_expenses%ROWTYPE;o orders%ROWTYPE;dup renovation_expenses%ROWTYPE;
 v_cur text:='MYR';v_hashes jsonb:=coalesce(p_data->'doc_hashes','[]'::jsonb);v_store uuid;v_amount numeric;v_total numeric;v_sst numeric;v_proof text;v_docs jsonb:=p_data->'docs';x jsonb;v_cat text:=p_data->>'category';v_day date;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND active) THEN RAISE EXCEPTION '请先登录' USING ERRCODE='42501'; END IF;
 IF coalesce(p_data->>'project_id','')<>'' THEN
  SELECT * INTO p FROM renovation_projects WHERE id=(p_data->>'project_id')::uuid;
  IF p.id IS NULL OR NOT (public._reno_access(p.store_id,p.created_by) OR public._is_finance()
   OR EXISTS(SELECT 1 FROM renovation_site_supervisors s WHERE s.project_id=p.id AND s.profile_id=auth.uid() AND s.active AND s.kind='internal')) THEN RAISE EXCEPTION '你没有这个项目的权限'; END IF;
  IF NOT public._expense_project_ok(p.id) THEN RAISE EXCEPTION '合同确认后才能记这一单的支出'; END IF;
  v_store:=p.store_id;
  IF v_cat='overhead' THEN RAISE EXCEPTION '门店开销不要挂在项目上'; END IF;
  IF coalesce(p_data->>'work_order_id','')<>'' THEN
   SELECT * INTO w FROM renovation_work_orders WHERE id=(p_data->>'work_order_id')::uuid AND project_id=p.id AND cancelled_at IS NULL;
   IF w.id IS NULL THEN RAISE EXCEPTION '子订单不存在或已作废'; END IF;
  END IF;
 ELSIF coalesce(p_data->>'order_id','')<>'' THEN
  SELECT * INTO o FROM orders WHERE id=(p_data->>'order_id')::uuid;
  IF o.id IS NULL OR NOT public._expense_order_ok(o.id) THEN RAISE EXCEPTION '你没有这张订单的权限，或订单已取消'; END IF;
  IF v_cat='overhead' THEN RAISE EXCEPTION '门店开销不要挂在订单上'; END IF;
  v_store:=o.store_id;v_cur:=upper(coalesce(nullif(to_jsonb(o)->>'currency',''),'MYR'));
 ELSE
  v_store:=nullif(p_data->>'store_id','')::uuid;
  IF v_store IS NULL OR NOT (public._is_finance() OR public._expense_manager(v_store)) THEN RAISE EXCEPTION '门店开销只有店长或财务能记'; END IF;
  v_cat:='overhead';
  v_cur:=CASE WHEN upper(coalesce(p_data->>'currency',''))='SGD' THEN 'SGD' ELSE 'MYR' END;
 END IF;
 IF v_cat IS NULL OR v_cat NOT IN ('material','labour','subcontract','transport','misc','commission','overhead') THEN RAISE EXCEPTION '请选类别'; END IF;
 v_amount:=round(nullif(p_data->>'amount','')::numeric,2);v_sst:=round(coalesce(nullif(p_data->>'sst','')::numeric,0),2);
 IF v_amount IS NULL OR v_amount<=0 THEN RAISE EXCEPTION '请填写金额'; END IF;
 IF v_sst<0 OR v_sst>v_amount THEN RAISE EXCEPTION 'SST 金额不对'; END IF;
 IF jsonb_typeof(v_docs) IS DISTINCT FROM 'array' OR jsonb_array_length(v_docs)=0 THEN RAISE EXCEPTION '必须上传发票、收据或签收单'; END IF;
 IF jsonb_array_length(v_docs)>8 THEN RAISE EXCEPTION '一笔最多 8 张单据'; END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(v_docs) LOOP
  IF jsonb_typeof(x)<>'string' OR split_part(x#>>'{}','/',1)<>auth.uid()::text
   OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='renovation-expenses' AND name=x#>>'{}') THEN RAISE EXCEPTION '单据照片还没上传好，请重新拍'; END IF;
 END LOOP;
 IF jsonb_typeof(v_hashes)<>'array' OR jsonb_array_length(v_hashes)>8 THEN v_hashes:='[]'::jsonb; END IF;
 -- 防重复报销：同一收款人 + 同一单据号，或同一张照片（指纹相同），已经报过就拦住（同一次拆单共用照片不算）
 SELECT * INTO dup FROM renovation_expenses x WHERE x.status IN ('pending','approved','paid')
  AND NOT (x.created_by=auth.uid() AND x.docs ?| ARRAY(SELECT jsonb_array_elements_text(v_docs)))
  AND ((btrim(coalesce(p_data->>'doc_no',''))<>'' AND lower(x.payee)=lower(btrim(coalesce(p_data->>'payee',''))) AND x.doc_no=btrim(p_data->>'doc_no'))
   OR (jsonb_array_length(v_hashes)>0 AND x.doc_hashes ?| ARRAY(SELECT h FROM jsonb_array_elements_text(v_hashes) h WHERE length(h)=64)))
  ORDER BY x.created_at LIMIT 1;
 IF dup.id IS NOT NULL THEN RAISE EXCEPTION '这张单据已经报过了（% 提交，% %，状态：%），不能重复请款',to_char(dup.created_at AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD'),dup.currency,dup.amount,
  CASE dup.status WHEN 'pending' THEN '待批准' WHEN 'approved' THEN '待付款' ELSE '已付' END; END IF;
 v_day:=coalesce(nullif(p_data->>'spent_on','')::date,(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date);
 IF v_day>(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date+30 OR v_day<'2020-01-01' THEN RAISE EXCEPTION '日期不对'; END IF;
 -- 同一张单据拆成几笔：按合计算，超过 RM 500 就都要店长批（拆小单绕不过去）
 SELECT v_amount+coalesce(sum(x.amount),0) INTO v_total FROM renovation_expenses x
  WHERE x.created_by=auth.uid() AND x.status IN ('pending','approved','paid') AND x.docs ?| ARRAY(SELECT jsonb_array_elements_text(v_docs));
 IF v_total>500 THEN
  UPDATE renovation_expenses x SET status='pending',approved_by=NULL,approved_at=NULL
   WHERE x.created_by=auth.uid() AND x.status='approved' AND x.approved_by=auth.uid() AND x.docs ?| ARRAY(SELECT jsonb_array_elements_text(v_docs))
    AND NOT public._expense_manager(x.store_id);
 END IF;
 -- 财务直接登记已经付掉的款（例如公司直接付的材料款）：不用店长批，记成已付，要有转账参考号或截图
 IF coalesce(p_data->>'paid','')='true' THEN
  IF NOT public._is_finance() THEN RAISE EXCEPTION '只有财务能直接登记已付款'; END IF;
  v_proof:=nullif(btrim(coalesce(p_data->>'paid_proof','')),'');
  IF v_proof IS NULL AND btrim(coalesce(p_data->>'paid_ref',''))='' THEN RAISE EXCEPTION '请上传转账截图或填写转账参考号'; END IF;
  IF v_proof IS NOT NULL AND (split_part(v_proof,'/',1)<>auth.uid()::text OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='renovation-expenses' AND name=v_proof)) THEN RAISE EXCEPTION '转账截图还没上传好'; END IF;
  INSERT INTO renovation_expenses(order_id,currency,doc_hashes,store_id,project_id,work_order_id,category,payee,payee_bank,amount,sst,doc_type,doc_no,docs,spent_on,note,status,created_by,approved_by,approved_at,paid_by,paid_at,paid_on,paid_ref,paid_proof)
  VALUES(o.id,v_cur,v_hashes,v_store,p.id,w.id,v_cat,btrim(coalesce(p_data->>'payee','')),btrim(coalesce(p_data->>'payee_bank','')),v_amount,v_sst,p_data->>'doc_type',btrim(coalesce(p_data->>'doc_no','')),v_docs,v_day,btrim(coalesce(p_data->>'note','')),
   'paid',auth.uid(),auth.uid(),now(),auth.uid(),now(),coalesce(nullif(p_data->>'paid_on','')::date,v_day),left(btrim(coalesce(p_data->>'paid_ref','')),120),v_proof)
  RETURNING * INTO e;
  RETURN e;
 END IF;
 INSERT INTO renovation_expenses(order_id,currency,doc_hashes,store_id,project_id,work_order_id,category,payee,payee_bank,amount,sst,doc_type,doc_no,docs,spent_on,note,status,created_by,approved_by,approved_at)
 VALUES(o.id,v_cur,v_hashes,v_store,p.id,w.id,v_cat,btrim(coalesce(p_data->>'payee','')),btrim(coalesce(p_data->>'payee_bank','')),v_amount,v_sst,p_data->>'doc_type',btrim(coalesce(p_data->>'doc_no','')),v_docs,v_day,btrim(coalesce(p_data->>'note','')),
  CASE WHEN v_total<=500 THEN 'approved' ELSE 'pending' END,auth.uid(),
  CASE WHEN v_total<=500 THEN auth.uid() END,CASE WHEN v_total<=500 THEN now() END)
 RETURNING * INTO e;
 RETURN e;
END $$;
REVOKE ALL ON FUNCTION public.renovation_expense_submit(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_expense_submit(jsonb) TO authenticated;

-- 6. 店长批准 / 退回；财务付款；提交人撤回（还没付的）
--    p_action: approve | reject | pay | void。pay 要 {paid_on, paid_ref 或 paid_proof}
CREATE OR REPLACE FUNCTION public.renovation_expense_act(p_id uuid,p_action text,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS public.renovation_expenses LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e renovation_expenses%ROWTYPE;v_reason text:=btrim(coalesce(p_data->>'reason',''));v_proof text:=nullif(btrim(coalesce(p_data->>'paid_proof','')),'');
BEGIN
 SELECT * INTO e FROM renovation_expenses WHERE id=p_id FOR UPDATE;
 IF e.id IS NULL THEN RAISE EXCEPTION '找不到这笔请款'; END IF;
 IF p_action='approve' THEN
  IF NOT public._expense_manager(e.store_id) THEN RAISE EXCEPTION '只有店长或上级能批准'; END IF;
  IF e.status<>'pending' THEN RAISE EXCEPTION '这笔请款已经处理过了'; END IF;
  UPDATE renovation_expenses SET status='approved',approved_by=auth.uid(),approved_at=now() WHERE id=e.id RETURNING * INTO e;
 ELSIF p_action='reject' THEN
  IF NOT (public._expense_manager(e.store_id) OR public._is_finance()) THEN RAISE EXCEPTION '只有店长、上级或财务能退回'; END IF;
  IF e.status NOT IN ('pending','approved') THEN RAISE EXCEPTION '已付款或已关闭的不能退回'; END IF;
  IF v_reason='' THEN RAISE EXCEPTION '请写退回原因'; END IF;
  UPDATE renovation_expenses SET status='rejected',closed_reason=left(v_reason,300) WHERE id=e.id RETURNING * INTO e;
 ELSIF p_action='pay' THEN
  IF NOT public._is_finance() THEN RAISE EXCEPTION '只有财务能标记付款'; END IF;
  IF e.status<>'approved' THEN RAISE EXCEPTION '要先批准才能付款'; END IF;
  IF v_proof IS NULL AND btrim(coalesce(p_data->>'paid_ref',''))='' THEN RAISE EXCEPTION '请上传转账截图或填写转账参考号'; END IF;
  IF v_proof IS NOT NULL AND (split_part(v_proof,'/',1)<>auth.uid()::text OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='renovation-expenses' AND name=v_proof)) THEN RAISE EXCEPTION '转账截图还没上传好'; END IF;
  UPDATE renovation_expenses SET status='paid',paid_by=auth.uid(),paid_at=now(),
   paid_on=coalesce(nullif(p_data->>'paid_on','')::date,(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date),
   paid_ref=left(btrim(coalesce(p_data->>'paid_ref','')),120),paid_proof=v_proof WHERE id=e.id RETURNING * INTO e;
 ELSIF p_action='void' THEN
  IF NOT (e.created_by=auth.uid() OR public._expense_manager(e.store_id) OR public._is_finance()) THEN RAISE EXCEPTION '没有权限'; END IF;
  IF e.status NOT IN ('pending','approved') THEN RAISE EXCEPTION '已付款或已关闭的不能撤回'; END IF;
  UPDATE renovation_expenses SET status='void',closed_reason=left(coalesce(nullif(v_reason,''),'提交人撤回'),300) WHERE id=e.id RETURNING * INTO e;
 ELSE RAISE EXCEPTION '未知操作';
 END IF;
 RETURN e;
END $$;
REVOKE ALL ON FUNCTION public.renovation_expense_act(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_expense_act(uuid,text,jsonb) TO authenticated;

-- 7. 利润与门店月账（店长：本店；区域经理：本区；财务 / 总经理：全部）
--    合同额 = 当前合同总价（含增减项）；已收 = 未作废的收款 − 退款；支出 = 已批准 + 已付（待批准的单列）
--    子订单合同额 = 这张子单里各项 数量 × 单价（优惠前）
CREATE OR REPLACE FUNCTION public.renovation_finance_overview(p_from date DEFAULT NULL,p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH vis AS (
  SELECT s.id FROM stores s WHERE public._is_finance() OR public._expense_manager(s.id)
 ), ex AS (
  SELECT e.* FROM renovation_expenses e WHERE e.store_id IN (SELECT id FROM vis) AND e.status IN ('pending','approved','paid')
 ), proj AS (
  SELECT p.* FROM renovation_projects p WHERE p.store_id IN (SELECT id FROM vis) AND p.state<>'draft'
 ), ord AS (
  -- 普通订单：有支出的，或最近 120 天建的（取消的不算）
  SELECT o.*,upper(coalesce(nullif(to_jsonb(o)->>'currency',''),'MYR')) cur FROM orders o
  WHERE o.store_id IN (SELECT id FROM vis) AND o.status<>'cancelled'
   AND (EXISTS(SELECT 1 FROM ex WHERE ex.order_id=o.id) OR o.created_at>now()-interval '120 days')
 ), allord AS (
  SELECT o.id,o.store_id,o.amount,o.payment_status,o.created_at,upper(coalesce(nullif(to_jsonb(o)->>'currency',''),'MYR')) cur FROM orders o
  WHERE o.store_id IN (SELECT id FROM vis) AND o.status<>'cancelled'
 ), opay AS (
  -- 普通订单收款：有分期收款记录按记录（现金未核实也算，作废的不算）；老订单只有「已付」标记的按订单金额
  SELECT o.id order_id,o.store_id,o.cur,(pp.paid_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS d_on,pp.amount::numeric amount
   FROM allord o JOIN order_payments pp ON pp.order_id=o.id WHERE nullif(to_jsonb(pp)->>'voided_at','') IS NULL
  UNION ALL
  SELECT o.id,o.store_id,o.cur,(o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date,o.amount FROM allord o
   WHERE o.payment_status='paid' AND NOT EXISTS(SELECT 1 FROM order_payments pp WHERE pp.order_id=o.id)
 )
 SELECT jsonb_build_object(
  'projects',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',p.id,'store_id',p.store_id,'contract_no',p.contract_no,'customer_name',p.customer_name,'state',p.state,'currency','MYR',
    'contract',coalesce(p.current_total,0),
    'received',coalesce((SELECT sum(CASE WHEN r.kind='receipt' THEN r.amount ELSE -r.amount END) FROM renovation_payments r WHERE r.project_id=p.id AND r.voided_at IS NULL),0),
    'committed',coalesce((SELECT sum(amount) FROM ex WHERE ex.project_id=p.id AND ex.status IN ('approved','paid')),0),
    'paid',coalesce((SELECT sum(amount) FROM ex WHERE ex.project_id=p.id AND ex.status='paid'),0),
    'pending',coalesce((SELECT sum(amount) FROM ex WHERE ex.project_id=p.id AND ex.status='pending'),0),
    'work_orders',coalesce((SELECT jsonb_agg(jsonb_build_object('id',w.id,'name',w.group_name,
       'contract',coalesce((SELECT sum(round((l->>'qty')::numeric*(l->>'rate')::numeric,2)) FROM jsonb_array_elements(p.snapshot->'lines') l WHERE w.line_ids ? (l->>'id')),0),
       'committed',coalesce((SELECT sum(amount) FROM ex WHERE ex.work_order_id=w.id AND ex.status IN ('approved','paid')),0),
       'paid',coalesce((SELECT sum(amount) FROM ex WHERE ex.work_order_id=w.id AND ex.status='paid'),0)) ORDER BY w.group_name)
      FROM renovation_work_orders w WHERE w.project_id=p.id AND w.cancelled_at IS NULL),'[]'::jsonb),
    'shared',coalesce((SELECT sum(amount) FROM ex WHERE ex.project_id=p.id AND ex.work_order_id IS NULL AND ex.status IN ('approved','paid')),0)
   ) ORDER BY p.created_at DESC) FROM proj p),'[]'::jsonb),
  'orders',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',o.id,'store_id',o.store_id,'order_no',o.order_no,'customer_name',c.name,'status',o.status,'currency',o.cur,'supplier',sp.name,
    'contract',o.amount,
    'received',coalesce((SELECT sum(amount) FROM opay WHERE opay.order_id=o.id),0),
    'committed',coalesce((SELECT sum(amount) FROM ex WHERE ex.order_id=o.id AND ex.status IN ('approved','paid')),0),
    'paid',coalesce((SELECT sum(amount) FROM ex WHERE ex.order_id=o.id AND ex.status='paid'),0),
    'pending',coalesce((SELECT sum(amount) FROM ex WHERE ex.order_id=o.id AND ex.status='pending'),0),
    'by_category',coalesce((SELECT jsonb_object_agg(category,amt) FROM (SELECT category,sum(amount) amt FROM ex WHERE ex.order_id=o.id AND ex.status IN ('approved','paid') GROUP BY category) z),'{}'::jsonb)
   ) ORDER BY o.created_at DESC) FROM ord o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN suppliers sp ON sp.id=o.supplier_id),'[]'::jsonb),
  'months',coalesce((SELECT jsonb_agg(m ORDER BY m->>'month' DESC,m->>'store_id',m->>'currency') FROM (
    SELECT jsonb_build_object('store_id',store_id,'month',mon,'currency',cur,'income',sum(income),'reno_income',sum(reno_income),'goods_income',sum(goods_income),
      'project_cost',sum(project_cost),'order_cost',sum(order_cost),'overhead',sum(overhead)) m FROM (
     SELECT p.store_id,to_char(r.paid_on,'YYYY-MM') AS mon,'MYR' AS cur,CASE WHEN r.kind='receipt' THEN r.amount ELSE -r.amount END income,
       CASE WHEN r.kind='receipt' THEN r.amount ELSE -r.amount END reno_income,0 goods_income,0 project_cost,0 order_cost,0 overhead
      FROM renovation_payments r JOIN renovation_projects p ON p.id=r.project_id
      WHERE r.voided_at IS NULL AND p.store_id IN (SELECT id FROM vis) AND (p_from IS NULL OR r.paid_on>=p_from) AND (p_to IS NULL OR r.paid_on<=p_to)
     UNION ALL
     SELECT store_id,to_char(d_on,'YYYY-MM'),cur,amount,0,amount,0,0,0 FROM opay WHERE (p_from IS NULL OR d_on>=p_from) AND (p_to IS NULL OR d_on<=p_to)
     UNION ALL
     SELECT store_id,to_char(spent_on,'YYYY-MM'),currency,0,0,0,
       CASE WHEN project_id IS NOT NULL THEN amount ELSE 0 END,CASE WHEN order_id IS NOT NULL THEN amount ELSE 0 END,CASE WHEN project_id IS NULL AND order_id IS NULL THEN amount ELSE 0 END
      FROM ex WHERE status IN ('approved','paid') AND (p_from IS NULL OR spent_on>=p_from) AND (p_to IS NULL OR spent_on<=p_to)
    ) t GROUP BY store_id,mon,cur) q),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.renovation_finance_overview(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_finance_overview(date,date) TO authenticated;

-- 8. 请款列表（带项目、子订单、门店、提交人名字）。看得到的范围和表权限一样：自己提交的 + 店长本店 + 财务全部
--    p_scope: mine | approve（我能批准的待批）| pay（财务待付）| all（最近 1000 笔）
CREATE OR REPLACE FUNCTION public.renovation_expense_list(p_scope text DEFAULT 'mine')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('store_name',s.name,'contract_no',p.contract_no,'customer_name',p.customer_name,
   'work_order',w.group_name,'order_no',o.order_no,'order_customer',oc.name,'creator',coalesce(nullif(c.name,''),'(未填名字)'),'approver',a.name,'payer',f.name) ORDER BY e.created_at DESC),'[]'::jsonb)
 FROM (SELECT * FROM renovation_expenses x WHERE
   CASE p_scope
    WHEN 'mine' THEN x.created_by=auth.uid()
    WHEN 'approve' THEN x.status='pending' AND public._expense_manager(x.store_id)
    WHEN 'pay' THEN x.status='approved' AND public._is_finance()
    ELSE x.created_by=auth.uid() OR public._is_finance() OR public._expense_manager(x.store_id)
   END ORDER BY x.created_at DESC LIMIT 1000) e
 JOIN stores s ON s.id=e.store_id
 LEFT JOIN renovation_projects p ON p.id=e.project_id
 LEFT JOIN renovation_work_orders w ON w.id=e.work_order_id
 LEFT JOIN orders o ON o.id=e.order_id LEFT JOIN customers oc ON oc.id=o.customer_id
 LEFT JOIN profiles c ON c.id=e.created_by LEFT JOIN profiles a ON a.id=e.approved_by LEFT JOIN profiles f ON f.id=e.paid_by;
$$;
REVOKE ALL ON FUNCTION public.renovation_expense_list(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_expense_list(text) TO authenticated;
