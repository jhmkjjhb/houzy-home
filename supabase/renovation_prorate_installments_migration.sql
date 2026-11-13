-- Signed additions and deductions are spread across the unpaid contract installments by the
-- contract ratio. The number of installments never changes and fully paid installments stay as
-- they are. Every installment changes by a whole ringgit; the cents go to the last unpaid one.
-- Before signing, the customer sees each installment before and after (terms.payment_plan).
-- Additions signed before this migration keep their own payment node; earlier deductions keep
-- the amounts they were signed with. Run after all renovation migrations, including
-- renovation_partial_deductions, renovation_installment_statements and renovation_statement_contact.
BEGIN;

ALTER TABLE public.renovation_additions ADD COLUMN IF NOT EXISTS merged_into_plan boolean NOT NULL DEFAULT false;

-- New plan after adding p_delta (negative for a deduction). Raises if there is no room.
CREATE OR REPLACE FUNCTION public._reno_prorate_plan(p_id uuid,p_delta numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;plan jsonb;base jsonb;n integer;i integer;amt numeric[];paid numeric[];w numeric[];
 open integer[];share numeric[];remaining numeric;sw numeric;acc numeric;last integer;clamped boolean;room numeric;got numeric;
BEGIN
 SELECT * INTO p FROM renovation_projects WHERE id=p_id;
 plan:=coalesce(p.adjusted_payments,p.snapshot->'payments','[]'::jsonb);base:=coalesce(p.snapshot->'payments','[]'::jsonb);n:=jsonb_array_length(plan);
 IF n=0 THEN RAISE EXCEPTION '合同没有付款计划，无法调整各期金额'; END IF;
 FOR i IN 1..n LOOP
  amt[i]:=(plan->(i-1)->>'amount')::numeric;
  w[i]:=greatest(coalesce((plan->(i-1)->>'contract_amount')::numeric,(base->(i-1)->>'amount')::numeric,amt[i]),0);
  SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount ELSE -amount END) FILTER(WHERE verified_at IS NOT NULL),0)
   +coalesce(sum(amount) FILTER(WHERE verified_at IS NULL),0) INTO got
  FROM _reno_payment_lines(p_id) WHERE installment=i AND voided_at IS NULL;
  paid[i]:=got;
  IF paid[i]<amt[i] THEN open:=open||i; END IF;
 END LOOP;
 remaining:=round(p_delta,2);
 WHILE remaining<>0 LOOP
  IF coalesce(array_length(open,1),0)=0 THEN RAISE EXCEPTION '原合同已没有未付清的期数可以调整，请先核对收退款'; END IF;
  sw:=0;FOREACH i IN ARRAY open LOOP sw:=sw+w[i]; END LOOP;
  last:=open[array_length(open,1)];acc:=0;clamped:=false;
  FOREACH i IN ARRAY open LOOP
   IF i=last THEN share[i]:=remaining-acc;
   ELSE share[i]:=trunc(remaining*CASE WHEN sw>0 THEN w[i]/sw ELSE 1.0/array_length(open,1) END);acc:=acc+share[i]; END IF;
  END LOOP;
  -- An installment never drops below what has already been paid on it; the rest moves to the others.
  FOREACH i IN ARRAY open LOOP
   IF amt[i]+share[i]<paid[i] THEN room:=paid[i]-amt[i];amt[i]:=paid[i];remaining:=remaining-room;open:=array_remove(open,i);clamped:=true;EXIT; END IF;
  END LOOP;
  IF NOT clamped THEN FOREACH i IN ARRAY open LOOP amt[i]:=amt[i]+share[i]; END LOOP;remaining:=0; END IF;
 END LOOP;
 FOR i IN 1..n LOOP
  plan:=jsonb_set(plan,ARRAY[(i-1)::text],(plan->(i-1))||jsonb_build_object('amount',amt[i],'contract_amount',w[i]));
 END LOOP;
 RETURN plan;
END;$$;
REVOKE ALL ON FUNCTION public._reno_prorate_plan(uuid,numeric) FROM PUBLIC;

-- Before/after table for the signing page; NULL when the change cannot be spread.
CREATE OR REPLACE FUNCTION public._reno_prorate_preview(p_id uuid,p_delta numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE before jsonb;after jsonb;
BEGIN
 SELECT coalesce(adjusted_payments,snapshot->'payments','[]'::jsonb) INTO before FROM renovation_projects WHERE id=p_id;
 BEGIN after:=_reno_prorate_plan(p_id,p_delta); EXCEPTION WHEN others THEN RETURN NULL; END;
 RETURN (SELECT jsonb_agg(jsonb_build_object('number',x.n::integer,'name',x.b->>'name','before',(x.b->>'amount')::numeric,
  'after',(after->(x.n::integer-1)->>'amount')::numeric,
  'paid_off',coalesce((SELECT sum(CASE WHEN l.kind='receipt' THEN l.amount ELSE -l.amount END) FILTER(WHERE l.verified_at IS NOT NULL)
   +coalesce(sum(l.amount) FILTER(WHERE l.verified_at IS NULL),0) FROM _reno_payment_lines(p_id) l WHERE l.installment=x.n AND l.voided_at IS NULL),0)>=(x.b->>'amount')::numeric)
  ORDER BY x.n) FROM jsonb_array_elements(before) WITH ORDINALITY x(b,n));
END;$$;
REVOKE ALL ON FUNCTION public._reno_prorate_preview(uuid,numeric) FROM PUBLIC;


-- Merged additions stay in the list (installment numbers must not shift) with amount 0.
CREATE OR REPLACE FUNCTION public._reno_billing_plan(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(p.adjusted_payments,p.snapshot->'payments','[]'::jsonb)||coalesce((SELECT jsonb_agg(jsonb_build_object(
 'name','增项：'||a.name||' · '||a.payment_node,'amount',CASE WHEN a.voided_at IS NULL AND a.signature_status='signed' AND NOT a.merged_into_plan THEN a.amount ELSE 0 END,
 'original_amount',a.amount,'is_addition',true,'pending_signature',a.signature_status='pending' AND a.voided_at IS NULL,'addition_id',a.id,'cancelled',a.voided_at IS NOT NULL,'merged',a.merged_into_plan) ORDER BY a.installment)
 FROM renovation_additions a WHERE a.project_id=p.id),'[]'::jsonb)
 FROM renovation_projects p WHERE p.id=p_id;
$$;
REVOKE ALL ON FUNCTION public._reno_billing_plan(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._reno_installment_view(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH stages AS (SELECT x.value,x.ordinality::integer AS n,(p.snapshot->>'net')::numeric-p.deductions_total original_total,(p.snapshot->>'net')::numeric net
 FROM renovation_projects p CROSS JOIN LATERAL jsonb_array_elements(_reno_billing_plan(p.id)) WITH ORDINALITY x WHERE p.id=p_id),
 ledger AS (SELECT installment,coalesce(sum(amount) FILTER(WHERE kind='receipt' AND verified_at IS NOT NULL),0) received,
 coalesce(sum(amount) FILTER(WHERE kind='refund' AND verified_at IS NOT NULL),0) refunded,
 coalesce(sum(amount) FILTER(WHERE verified_at IS NULL),0) pending
 FROM _reno_payment_lines(p_id) WHERE voided_at IS NULL GROUP BY installment)
 SELECT coalesce(jsonb_agg(jsonb_build_object('number',s.n,'name',s.value->>'name','amount',(s.value->>'amount')::numeric,
 'is_addition',coalesce((s.value->>'is_addition')::boolean,false),'pending_signature',coalesce((s.value->>'pending_signature')::boolean,false),'cancelled',coalesce((s.value->>'cancelled')::boolean,false),'merged',coalesce((s.value->>'merged')::boolean,false),'contract_amount',(s.value->>'contract_amount')::numeric,
 'percentage',CASE WHEN coalesce((s.value->>'is_addition')::boolean,false) THEN NULL WHEN s.value ? 'contract_amount' THEN round((s.value->>'contract_amount')::numeric*100/nullif(s.net,0),2) ELSE round((s.value->>'amount')::numeric*100/nullif(s.original_total,0),2) END,
 'received',coalesce(l.received,0),'refunded',coalesce(l.refunded,0),'paid',coalesce(l.received,0)-coalesce(l.refunded,0),'pending',coalesce(l.pending,0),
 'balance',(s.value->>'amount')::numeric-coalesce(l.received,0)+coalesce(l.refunded,0)) ORDER BY s.n),'[]'::jsonb)
 FROM stages s LEFT JOIN ledger l ON l.installment=s.n;
$$;
REVOKE ALL ON FUNCTION public._reno_installment_view(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._reno_addition_terms(p_addition uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('addition_id',a.id,'contract_no',p.contract_no,'address',p.address,'category',a.category,'name',a.name,
 'spec',a.spec,'qty',a.qty,'unit',a.unit,'rate',a.rate,'amount',a.amount,'payment_node',CASE WHEN a.signature_status='pending' AND a.voided_at IS NULL AND _reno_prorate_preview(p.id,a.amount) IS NOT NULL THEN '按合同比例并入未付清的各期' ELSE a.payment_node END,
 'payment_plan',CASE WHEN a.signature_status='pending' AND a.voided_at IS NULL THEN _reno_prorate_preview(p.id,a.amount) END,
 'original_total',coalesce((p.snapshot->>'net')::numeric,0),'current_total',p.current_total,'after_sign_total',p.current_total+a.amount,
 'warranty_note','新增项目质保范围及期限待双方补充确认，不自动沿用其他产品质保')
 FROM renovation_additions a JOIN renovation_projects p ON p.id=a.project_id WHERE a.id=p_addition;
$$;
REVOKE ALL ON FUNCTION public._reno_addition_terms(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.renovation_signing_link_view(p_addition uuid,p_sign_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',a.id,'status',CASE WHEN a.voided_at IS NOT NULL THEN 'voided' ELSE a.signature_status END,
 'terms',(CASE WHEN a.signature_status='signed' THEN a.signed_snapshot->'terms' ELSE _reno_addition_terms(a.id) END)-'current_total'-'after_sign_total'-'payment_plan',
 'terms_hash',CASE WHEN a.signature_status='signed' THEN a.signed_terms_hash ELSE encode(sha256(convert_to(_reno_addition_terms(a.id)::text,'UTF8')),'hex') END,
 'signed_at',a.signed_at,'signer_name',a.signer_name,'signature_hash',a.signature_hash,'signature_strokes',a.signature_strokes)
 FROM renovation_additions a JOIN renovation_projects p ON p.id=a.project_id WHERE a.id=p_addition AND a.signing_token=p_sign_token AND p.state<>'draft';
$$;

CREATE OR REPLACE FUNCTION public.renovation_customer_sign_addition(p_token uuid,p_addition uuid,p_sign_token uuid,p_terms_hash text,p_name text,p_strokes jsonb,p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;a renovation_additions%ROWTYPE;terms jsonb;digest text;stroke jsonb;point jsonb;x numeric;y numeric;
 minx numeric:=1;miny numeric:=1;maxx numeric:=0;maxy numeric:=0;points integer:=0;at_time timestamptz:=now();record jsonb;workid uuid;plan jsonb;merged boolean:=false;
BEGIN
 SELECT * INTO p FROM renovation_projects WHERE customer_token=p_token FOR UPDATE;
 IF p.id IS NULL OR p.state='draft' THEN RAISE EXCEPTION '签署链接无效或已撤销'; END IF;
 SELECT * INTO a FROM renovation_additions WHERE id=p_addition AND project_id=p.id AND signing_token=p_sign_token FOR UPDATE;
 IF a.id IS NULL OR a.voided_at IS NOT NULL THEN RAISE EXCEPTION '签署链接无效或新增单已撤销'; END IF;
 IF a.signature_status='signed' THEN
  IF a.signed_terms_hash=p_terms_hash AND a.signer_name=trim(p_name) AND a.signature_strokes=p_strokes THEN RETURN jsonb_build_object('ok',true,'signed_at',a.signed_at,'signature_hash',a.signature_hash); END IF;
  RAISE EXCEPTION '新增单已签署，签署内容不可覆盖';
 END IF;
 IF p.state NOT IN ('confirmed','executing') THEN RAISE EXCEPTION '项目当前不可签署新增单'; END IF;
 IF p_accept IS DISTINCT FROM true OR coalesce(length(trim(p_name)),0) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION '请填写签署姓名并勾选确认增项内容'; END IF;
 terms:=_reno_addition_terms(a.id);digest:=encode(sha256(convert_to(terms::text,'UTF8')),'hex');
 IF p_terms_hash IS DISTINCT FROM digest THEN RAISE EXCEPTION '新增单或项目金额已更新，请刷新核对后重新签名'; END IF;
 IF p_strokes IS NULL OR jsonb_typeof(p_strokes)<>'array' OR octet_length(p_strokes::text)>65536 OR jsonb_array_length(p_strokes) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION '请在签名框内手写签名'; END IF;
 FOR stroke IN SELECT value FROM jsonb_array_elements(p_strokes) LOOP
  IF jsonb_typeof(stroke)<>'array' OR jsonb_array_length(stroke)<2 THEN RAISE EXCEPTION '签名笔迹无效'; END IF;
  FOR point IN SELECT value FROM jsonb_array_elements(stroke) LOOP
   IF jsonb_typeof(point)<>'array' OR jsonb_array_length(point)<>2 OR jsonb_typeof(point->0)<>'number' OR jsonb_typeof(point->1)<>'number' THEN RAISE EXCEPTION '签名笔迹无效'; END IF;
   x:=(point->>0)::numeric;y:=(point->>1)::numeric;
   IF x NOT BETWEEN 0 AND 1 OR y NOT BETWEEN 0 AND 1 THEN RAISE EXCEPTION '签名笔迹坐标无效'; END IF;
   points:=points+1;IF points>2048 THEN RAISE EXCEPTION '签名笔迹过长，请清除后重签'; END IF;
   minx:=least(minx,x);maxx:=greatest(maxx,x);miny:=least(miny,y);maxy:=greatest(maxy,y);
  END LOOP;
 END LOOP;
 IF points<8 OR (maxx-minx)+(maxy-miny)<0.05 THEN RAISE EXCEPTION '签名为空或笔迹太少，请完整手写签名'; END IF;
 BEGIN plan:=_reno_prorate_plan(p.id,a.amount);merged:=true; EXCEPTION WHEN others THEN plan:=NULL;merged:=false; END;
 record:=jsonb_build_object('terms',terms,'signer_name',trim(p_name),'signed_at',at_time,'signature',p_strokes,'consent',true)||CASE WHEN merged THEN jsonb_build_object('adjusted_payments',plan) ELSE '{}'::jsonb END;
 workid:=gen_random_uuid();
 INSERT INTO renovation_work_orders(id,project_id,group_name,line_ids) VALUES(workid,p.id,'增项-'||a.id::text||' · '||a.group_name,jsonb_build_array('ADD-'||a.id));
 UPDATE renovation_additions SET signature_status='signed',signed_at=at_time,signer_name=trim(p_name),signed_terms_hash=digest,
 signature_strokes=p_strokes,signed_snapshot=record,signature_hash=encode(sha256(convert_to(record::text,'UTF8')),'hex'),work_order_id=workid,merged_into_plan=merged WHERE id=a.id RETURNING * INTO a;
 UPDATE renovation_projects SET adjusted_payments=CASE WHEN merged THEN plan ELSE adjusted_payments END,additions_total=coalesce((SELECT sum(amount) FROM renovation_additions WHERE project_id=p.id AND voided_at IS NULL AND signature_status='signed'),0),scope_revision=scope_revision+1,revision=revision+1,updated_at=at_time WHERE id=p.id;
 PERFORM _reno_check_installment_totals(p.id);
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p.id,NULL,'addition_customer_signed',jsonb_build_object('addition_id',a.id,'signed_at',a.signed_at,'signer_name',a.signer_name,'signature_hash',a.signature_hash,'source','customer_signing_link'));
 RETURN jsonb_build_object('ok',true,'signed_at',a.signed_at,'signature_hash',a.signature_hash);
END;$$;
REVOKE ALL ON FUNCTION public.renovation_customer_sign_addition(uuid,uuid,uuid,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_sign_addition(uuid,uuid,uuid,text,text,jsonb,boolean) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.renovation_addition_command(p_id uuid,p_revision integer,p_action text,p_entry uuid,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;a renovation_additions%ROWTYPE;q numeric;r numeric;amt numeric;node integer;workid uuid;groupid text;paid numeric;pending numeric;plan jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_entry IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF p.state NOT IN ('confirmed','executing') THEN RAISE EXCEPTION '仅已确认且未竣工验收的项目可登记增项；草稿请编辑原清单'; END IF;
 SELECT * INTO a FROM renovation_additions WHERE id=p_entry;
 IF p_action='add' AND a.id IS NOT NULL THEN
  IF a.project_id=p_id AND a.created_by=auth.uid() AND a.category=p_data->>'category' AND a.name=trim(p_data->>'name') AND a.spec=coalesce(p_data->>'spec','')
  AND a.qty=(p_data->>'qty')::numeric AND a.rate=(p_data->>'rate')::numeric AND a.unit=trim(p_data->>'unit') AND a.group_name=trim(p_data->>'group_name') AND a.payment_node=trim(p_data->>'payment_node') THEN RETURN to_jsonb(a); END IF;
  RAISE EXCEPTION '增项编号已使用，请刷新后核对';
 END IF;
 IF p_revision IS NULL OR p.revision<>p_revision THEN RAISE EXCEPTION '项目已被其他人修改，请刷新后重试'; END IF;
 IF p_action='add' THEN
  q:=(p_data->>'qty')::numeric;r:=(p_data->>'rate')::numeric;
  IF q IS NULL OR r IS NULL OR q::text IN ('NaN','Infinity','-Infinity') OR r::text IN ('NaN','Infinity','-Infinity') OR q<=0 OR q>100000000 OR r<=0 OR r>100000000 OR q<>round(q,3) OR r<>round(r,2) THEN RAISE EXCEPTION '数量须大于0且最多3位小数，单价须大于0且最多2位小数'; END IF;
  amt:=round(q*r,2);
  IF amt<0.01 OR p.current_total+amt>999999999999.99 THEN RAISE EXCEPTION '新增金额无效或项目总额超限'; END IF;
  IF p_data->>'category' IS NULL OR p_data->>'category' NOT IN ('work','material') OR coalesce(length(trim(p_data->>'name')),0) NOT BETWEEN 1 AND 200
   OR length(coalesce(p_data->>'spec',''))>2000 OR coalesce(length(trim(p_data->>'unit')),0) NOT BETWEEN 1 AND 50
   OR coalesce(length(trim(p_data->>'group_name')),0) NOT BETWEEN 1 AND 80 OR coalesce(length(trim(p_data->>'payment_node')),0) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '请补齐增项类别、名称、单位、执行分组和付款节点'; END IF;
  SELECT greatest(jsonb_array_length(coalesce(p.snapshot->'payments','[]'::jsonb)),coalesce(max(installment),0))+1 INTO node FROM renovation_additions WHERE project_id=p_id;
  workid:=NULL;
  INSERT INTO renovation_additions(id,project_id,category,name,spec,qty,unit,rate,group_name,payment_node,installment,work_order_id,created_by)
  VALUES(p_entry,p_id,p_data->>'category',trim(p_data->>'name'),coalesce(p_data->>'spec',''),q,trim(p_data->>'unit'),r,trim(p_data->>'group_name'),trim(p_data->>'payment_node'),node,workid,auth.uid()) RETURNING * INTO a;
 ELSIF p_action='void' THEN
  IF NOT _reno_access(p.store_id,p.created_by,true) AND NOT (a.signature_status='pending' AND a.created_by=auth.uid()) THEN RAISE EXCEPTION '已签增项作废须由店长操作；待签增项由原登记员工或店长撤销'; END IF;
  IF a.id IS NULL OR a.project_id<>p_id OR a.voided_at IS NOT NULL THEN RAISE EXCEPTION '无此有效增项'; END IF;
  IF coalesce(length(trim(p_data->>'reason')),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '请填写作废原因'; END IF;
  SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount ELSE -amount END) FILTER(WHERE verified_at IS NOT NULL),0),coalesce(sum(amount) FILTER(WHERE verified_at IS NULL),0)
  INTO paid,pending FROM renovation_payments WHERE project_id=p_id AND installment=a.installment AND voided_at IS NULL;
  IF paid<>0 OR pending<>0 THEN RAISE EXCEPTION '该增项有已收或待核对款，请先核对退款或归期'; END IF;
  IF a.merged_into_plan THEN plan:=_reno_prorate_plan(p_id,-a.amount); END IF;
  SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount ELSE -amount END) FILTER(WHERE verified_at IS NOT NULL),0),coalesce(sum(amount) FILTER(WHERE verified_at IS NULL),0)
  INTO paid,pending FROM renovation_payments WHERE project_id=p_id AND voided_at IS NULL;
  IF paid+pending>p.current_total-a.amount THEN RAISE EXCEPTION '已收及待核对款超过作废后的项目应收，请先核对收款'; END IF;
  IF EXISTS(SELECT 1 FROM renovation_work_orders WHERE id=a.work_order_id AND status<>'draft') THEN RAISE EXCEPTION '增项已安排执行，请先与负责人核对，不能直接作废'; END IF;
  UPDATE renovation_additions SET voided_at=now(),voided_by=auth.uid(),void_reason=trim(p_data->>'reason') WHERE id=p_entry RETURNING * INTO a;
  IF a.merged_into_plan THEN UPDATE renovation_projects SET adjusted_payments=plan WHERE id=p_id; END IF;
  UPDATE renovation_work_orders SET cancelled_at=now(),status='done',assignee='增项已作废',updated_at=now() WHERE id=a.work_order_id;
 ELSE RAISE EXCEPTION '不支持的增项操作'; END IF;
 UPDATE renovation_projects SET additions_total=coalesce((SELECT sum(amount) FROM renovation_additions WHERE project_id=p_id AND voided_at IS NULL AND signature_status='signed'),0),scope_revision=scope_revision+1,revision=revision+1,updated_at=now() WHERE id=p_id;
 PERFORM _reno_check_installment_totals(p_id);
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p_id,auth.uid(),'addition_'||p_action,to_jsonb(a));
 RETURN to_jsonb(a);
END;$$;
REVOKE ALL ON FUNCTION public.renovation_addition_command(uuid,integer,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_addition_command(uuid,integer,text,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public._reno_deduction_terms(p_entry uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('deduction_id',d.id,'contract_no',p.contract_no,'line_id',d.line_id,'line_name',d.line_name,
 'original_amount',d.original_amount,'discount_credit',d.discount_credit,'reason',d.reason,'line_amount',d.line_amount,'partial',d.partial,
 'discount_ratio',round((p.snapshot->>'net')::numeric / nullif((p.snapshot->>'net')::numeric+(p.snapshot->>'discount')::numeric,0),8),
 'note',CASE WHEN d.partial THEN '本项照常保留施工，仅按实际减少的数量或范围调整金额；' ELSE '' END||'本减项经客户签署后，按合同比例从未付清的各期扣除，已付清的期数不变；各期按整数调整，零头计入最后一期。原合同与历史收款记录保留。',
 'payment_plan',CASE WHEN d.status='pending' THEN _reno_prorate_preview(p.id,-d.discount_credit) END)
 FROM renovation_deductions d JOIN renovation_projects p ON p.id=d.project_id WHERE d.id=p_entry;
$$;
REVOKE ALL ON FUNCTION public._reno_deduction_terms(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.renovation_deduction_sign(p_entry uuid,p_sign_token uuid,p_terms_hash text,p_name text,p_strokes jsonb,p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;d renovation_deductions%ROWTYPE;terms jsonb;digest text;stroke jsonb;point jsonb;x numeric;y numeric;
 minx numeric:=1;miny numeric:=1;maxx numeric:=0;maxy numeric:=0;points integer:=0;at_time timestamptz:=now();record jsonb;
 plan jsonb;stage_count integer;i integer;stage_amount numeric;stage_paid numeric;stage_pending numeric;available numeric;take numeric;remaining numeric;total_paid numeric;total_pending numeric;
BEGIN
 SELECT * INTO d FROM renovation_deductions WHERE id=p_entry AND signing_token=p_sign_token;
 IF d.id IS NULL THEN RAISE EXCEPTION '签署链接无效或已撤销'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=d.project_id FOR UPDATE;
 SELECT * INTO d FROM renovation_deductions WHERE id=p_entry AND signing_token=p_sign_token FOR UPDATE;
 IF d.status='voided' THEN RAISE EXCEPTION '减项确认单已撤销'; END IF;
 IF d.status='signed' THEN
  IF d.signed_terms_hash=p_terms_hash AND d.signer_name=trim(p_name) AND d.signature_strokes=p_strokes THEN RETURN jsonb_build_object('ok',true,'signed_at',d.signed_at,'signature_hash',d.signature_hash); END IF;
  RAISE EXCEPTION '减项确认单已签署，内容不可覆盖';
 END IF;
 IF p.state NOT IN ('confirmed','executing') THEN RAISE EXCEPTION '项目当前不可签署减项'; END IF;
 IF NOT d.partial AND EXISTS(SELECT 1 FROM renovation_work_orders w WHERE w.project_id=p.id AND w.status<>'draft' AND w.cancelled_at IS NULL
  AND w.line_ids ? d.line_id) THEN RAISE EXCEPTION '该项目已安排或开始施工，请先由门店核对现场及变更方案'; END IF;
 IF p_accept IS DISTINCT FROM true OR length(trim(coalesce(p_name,''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION '请填写签署姓名并勾选减项确认'; END IF;
 terms:=_reno_deduction_terms(d.id);digest:=encode(sha256(convert_to(terms::text,'UTF8')),'hex');
 IF p_terms_hash IS DISTINCT FROM digest THEN RAISE EXCEPTION '项目金额已更新，请刷新核对后重新签名'; END IF;
 IF p_strokes IS NULL OR jsonb_typeof(p_strokes)<>'array' OR octet_length(p_strokes::text)>65536 OR jsonb_array_length(p_strokes) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION '请在签名框内手写签名'; END IF;
 FOR stroke IN SELECT value FROM jsonb_array_elements(p_strokes) LOOP
  IF jsonb_typeof(stroke)<>'array' OR jsonb_array_length(stroke)<2 THEN RAISE EXCEPTION '签名笔迹无效'; END IF;
  FOR point IN SELECT value FROM jsonb_array_elements(stroke) LOOP
   IF jsonb_typeof(point)<>'array' OR jsonb_array_length(point)<>2 OR jsonb_typeof(point->0)<>'number' OR jsonb_typeof(point->1)<>'number' THEN RAISE EXCEPTION '签名笔迹无效'; END IF;
   x:=(point->>0)::numeric;y:=(point->>1)::numeric;
   IF x NOT BETWEEN 0 AND 1 OR y NOT BETWEEN 0 AND 1 THEN RAISE EXCEPTION '签名笔迹坐标无效'; END IF;
   points:=points+1;IF points>2048 THEN RAISE EXCEPTION '签名笔迹过长，请清除后重签'; END IF;
   minx:=least(minx,x);maxx:=greatest(maxx,x);miny:=least(miny,y);maxy:=greatest(maxy,y);
  END LOOP;
 END LOOP;
 IF points<8 OR (maxx-minx)+(maxy-miny)<0.05 THEN RAISE EXCEPTION '签名为空或笔迹太少，请完整手写签名'; END IF;
 SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount ELSE -amount END) FILTER(WHERE verified_at IS NOT NULL),0),
  coalesce(sum(amount) FILTER(WHERE verified_at IS NULL),0) INTO total_paid,total_pending
 FROM renovation_payments WHERE project_id=p.id AND voided_at IS NULL;
 IF total_paid+total_pending>p.current_total-d.discount_credit THEN RAISE EXCEPTION '减项后已收及待核对款将超过项目总额，请先处理收退款'; END IF;
 plan:=_reno_prorate_plan(p.id,-d.discount_credit);
 record:=jsonb_build_object('terms',terms,'signer_name',trim(p_name),'signed_at',at_time,'signature',p_strokes,'consent',true,'adjusted_payments',plan);
 UPDATE renovation_deductions SET status='signed',signed_at=at_time,signer_name=trim(p_name),signed_terms_hash=digest,
  signature_strokes=p_strokes,signed_snapshot=record,signature_hash=encode(sha256(convert_to(record::text,'UTF8')),'hex') WHERE id=d.id RETURNING * INTO d;
 UPDATE renovation_projects SET deductions_total=deductions_total+d.discount_credit,adjusted_payments=plan,
  scope_revision=scope_revision+1,revision=revision+1,updated_at=at_time WHERE id=p.id;
 -- A draft execution group containing only signed removals has no work left to do.
 UPDATE renovation_work_orders w SET status='done',assignee='已签减项，无需执行',updated_at=at_time
 WHERE w.project_id=p.id AND w.status='draft' AND w.cancelled_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(w.line_ids) lid
   WHERE NOT EXISTS(SELECT 1 FROM renovation_deductions x WHERE x.project_id=p.id AND x.line_id=lid AND x.status='signed' AND NOT x.partial));
 PERFORM _reno_check_installment_totals(p.id);
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p.id,NULL,'deduction_customer_signed',
  jsonb_build_object('deduction_id',d.id,'signed_at',d.signed_at,'signer_name',d.signer_name,'signature_hash',d.signature_hash,'credit',d.discount_credit));
 RETURN jsonb_build_object('ok',true,'signed_at',d.signed_at,'signature_hash',d.signature_hash);
END $$;
REVOKE ALL ON FUNCTION public.renovation_deduction_sign(uuid,uuid,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_deduction_sign(uuid,uuid,text,text,jsonb,boolean) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.renovation_customer_installment_statement(p_token uuid,p_installment integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;stage jsonb;plan jsonb;stage_amount numeric;received numeric;refunded numeric;pending numeric;unassigned numeric;paid numeric;entries jsonb;
BEGIN
 IF p_token IS NULL OR p_installment IS NULL OR p_installment<1 OR p_installment>100 THEN RAISE EXCEPTION '付款单链接或期数无效'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE customer_token=p_token AND state<>'draft';
 IF p.id IS NULL THEN RAISE EXCEPTION '客户链接无效或已失效'; END IF;
 plan:=_reno_billing_plan(p.id);
 IF p_installment>jsonb_array_length(plan) THEN RAISE EXCEPTION '付款期数不在当前项目计划内'; END IF;
 stage:=plan->(p_installment-1);
 IF coalesce((stage->>'pending_signature')::boolean,false) OR coalesce((stage->>'cancelled')::boolean,false) THEN
  RAISE EXCEPTION '待签或已撤销的付款节点不可生成付款单';
 END IF;
 stage_amount:=(stage->>'amount')::numeric;
 IF stage_amount IS NULL OR stage_amount<=0 THEN RAISE EXCEPTION '该付款节点金额无效'; END IF;
 SELECT coalesce(sum(l.amount) FILTER(WHERE l.kind='receipt' AND l.verified_at IS NOT NULL),0),
        coalesce(sum(l.amount) FILTER(WHERE l.kind='refund' AND l.verified_at IS NOT NULL),0),
        coalesce(sum(l.amount) FILTER(WHERE l.verified_at IS NULL),0)
 INTO received,refunded,pending
 FROM _reno_payment_lines(p.id) l WHERE l.installment=p_installment AND l.voided_at IS NULL;
 paid:=received-refunded;
 SELECT coalesce(sum(CASE WHEN l.kind='receipt' THEN l.amount ELSE -l.amount END) FILTER(WHERE l.verified_at IS NOT NULL),0)
 INTO unassigned FROM _reno_payment_lines(p.id) l WHERE l.installment IS NULL AND l.voided_at IS NULL;
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'amount',l.amount,'method',e.method,
  'paid_on',e.paid_on,'verified',l.verified_at IS NOT NULL) ORDER BY e.paid_on,e.created_at,e.id),'[]'::jsonb)
 INTO entries FROM _reno_payment_lines(p.id) l JOIN renovation_payments e ON e.id=l.entry_id
 WHERE l.installment=p_installment AND l.voided_at IS NULL;
 RETURN jsonb_build_object(
  'reference',p.contract_no||'-'||upper(substr(p.id::text,1,8))||'-P'||lpad(p_installment::text,2,'0'),
  'contract_no',p.contract_no,'customer_name',p.customer_name,'address',p.address,
  'project_total',p.current_total,'original_total',(p.snapshot->>'net')::numeric,
  'additions_total',p.additions_total,'deductions_total',p.deductions_total,
  'installment',p_installment,'stage_name',stage->>'name','is_addition',coalesce((stage->>'is_addition')::boolean,false),
  'amount',stage_amount,'contract_amount',(stage->>'contract_amount')::numeric,'received',received,'refunded',refunded,'paid',paid,'pending',pending,
  'unassigned_paid',unassigned,'balance',greatest(stage_amount-paid,0),
  'status',CASE WHEN paid>=stage_amount THEN 'paid' WHEN pending>0 OR unassigned>0 THEN 'review'
    WHEN paid>0 THEN 'partial' ELSE 'unpaid' END,
  'entries',entries,'generated_at',now(),'contact_phone',_reno_contact_phone(p.id));
END $$;
REVOKE ALL ON FUNCTION public.renovation_customer_installment_statement(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.renovation_customer_installment_statement(uuid,integer) TO anon,authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
