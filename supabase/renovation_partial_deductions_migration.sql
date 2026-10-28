-- Partial deductions: a contract line that was done, but less than contracted.
-- The store enters the reduced list-price amount; the line stays in scope and keeps
-- its work order. A full-amount deduction still removes the line as before.
BEGIN;

ALTER TABLE public.renovation_deductions ADD COLUMN IF NOT EXISTS line_amount numeric;
ALTER TABLE public.renovation_deductions ADD COLUMN IF NOT EXISTS partial boolean NOT NULL DEFAULT false;
UPDATE public.renovation_deductions SET line_amount=original_amount WHERE line_amount IS NULL;
ALTER TABLE public.renovation_deductions DROP CONSTRAINT IF EXISTS renovation_deduction_partial_check;
ALTER TABLE public.renovation_deductions ADD CONSTRAINT renovation_deduction_partial_check
 CHECK(line_amount IS NOT NULL AND original_amount<=line_amount AND partial=(original_amount<line_amount));

CREATE OR REPLACE FUNCTION public._reno_effective_lines(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT jsonb_agg(line.value ORDER BY line.ordinality)
  FROM jsonb_array_elements(coalesce(p.snapshot->'lines','[]'::jsonb)) WITH ORDINALITY AS line(value,ordinality)
  WHERE NOT EXISTS(SELECT 1 FROM renovation_deductions d WHERE d.project_id=p.id AND d.line_id=line.value->>'id' AND d.status='signed' AND NOT d.partial)),'[]'::jsonb)
 || coalesce((SELECT jsonb_agg(jsonb_build_object(
 'id','ADD-'||a.id,'name',CASE a.category WHEN 'work' THEN '【增项工项】' ELSE '【增项材料】' END||a.name,
 'spec',a.spec,'qty',a.qty,'unit',a.unit,'rate',a.rate,'kind',CASE a.category WHEN 'work' THEN 'work' ELSE 'stock' END,
 'group',w.group_name,'is_addition',true,'warranties',jsonb_build_array(jsonb_build_object('component','新增项目：质保范围及期限待核对','years',NULL,'source','增项登记，按双方确认凭证补充'))
 ) ORDER BY a.installment) FROM renovation_additions a JOIN renovation_work_orders w ON w.id=a.work_order_id
 WHERE a.project_id=p.id AND a.voided_at IS NULL AND a.signature_status='signed'),'[]'::jsonb)
 FROM renovation_projects p WHERE p.id=p_id;
$$;
REVOKE ALL ON FUNCTION public._reno_effective_lines(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._reno_deduction_terms(p_entry uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('deduction_id',d.id,'contract_no',p.contract_no,'line_id',d.line_id,'line_name',d.line_name,
 'original_amount',d.original_amount,'discount_credit',d.discount_credit,'reason',d.reason,'line_amount',d.line_amount,'partial',d.partial,
 'discount_ratio',round((p.snapshot->>'net')::numeric / nullif((p.snapshot->>'net')::numeric+(p.snapshot->>'discount')::numeric,0),8),
 'note',CASE WHEN d.partial THEN '本项照常保留施工，仅按实际减少的数量或范围调整金额；' ELSE '' END||'本减项经客户签署后从未收的原合同付款节点扣除；原合同与历史收款记录保留。')
 FROM renovation_deductions d JOIN renovation_projects p ON p.id=d.project_id WHERE d.id=p_entry;
$$;
REVOKE ALL ON FUNCTION public._reno_deduction_terms(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.renovation_deduction_command(p_id uuid,p_revision integer,p_action text,p_entry uuid,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;d renovation_deductions%ROWTYPE;line jsonb;gross numeric;original_net numeric;credit numeric;line_amount numeric;reason text;paid numeric;pending numeric;cut_amount numeric;
BEGIN
 IF auth.uid() IS NULL OR p_entry IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF p.state NOT IN ('confirmed','executing') THEN RAISE EXCEPTION '仅已确认且未竣工验收的项目可登记减项'; END IF;
 IF p_action='add' AND p_data ? 'amount' THEN
  IF jsonb_typeof(p_data->'amount')<>'number' THEN RAISE EXCEPTION '减少金额须为数字'; END IF;
  cut_amount:=(p_data->>'amount')::numeric;
 END IF;
 SELECT * INTO d FROM renovation_deductions WHERE id=p_entry FOR UPDATE;
 IF p_action='add' AND d.id IS NOT NULL THEN
  IF d.project_id=p_id AND d.created_by=auth.uid() AND d.line_id=p_data->>'line_id' AND d.reason=trim(p_data->>'reason') AND d.original_amount=coalesce(cut_amount,d.line_amount) THEN RETURN to_jsonb(d); END IF;
  RAISE EXCEPTION '减项编号已使用，请刷新后核对';
 END IF;
 IF p_revision IS NULL OR p.revision<>p_revision THEN RAISE EXCEPTION '项目已被其他人修改，请刷新后重试'; END IF;
 IF p_action='add' THEN
  reason:=trim(coalesce(p_data->>'reason',''));
  IF length(reason) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '请填写减项原因（最多500字）'; END IF;
  SELECT value INTO line FROM jsonb_array_elements(coalesce(p.snapshot->'lines','[]'::jsonb)) WHERE value->>'id'=p_data->>'line_id';
  IF line IS NULL OR line->>'kind'='gift' THEN RAISE EXCEPTION '请选择原合同中有金额的有效项目'; END IF;
  line_amount:=round((line->>'qty')::numeric*(line->>'rate')::numeric,2);cut_amount:=coalesce(cut_amount,line_amount);
  IF cut_amount<=0 OR cut_amount>line_amount OR cut_amount<>round(cut_amount,2) THEN RAISE EXCEPTION '减少金额须大于 0、最多两位小数，且不超过该项原清单金额 RM %',line_amount; END IF;
  -- Work already scheduled may still be reduced in part; only a full removal needs the site check first.
  IF cut_amount=line_amount
   AND EXISTS(SELECT 1 FROM renovation_work_orders w WHERE w.project_id=p.id AND w.status<>'draft' AND w.cancelled_at IS NULL
   AND w.line_ids ? (line->>'id')) THEN RAISE EXCEPTION '该项目已安排或开始施工，请先由门店核对现场及变更方案'; END IF;
  line_amount:=round((line->>'qty')::numeric*(line->>'rate')::numeric,2);
  gross:=(p.snapshot->>'net')::numeric+(p.snapshot->>'discount')::numeric;original_net:=(p.snapshot->>'net')::numeric;
  IF line_amount<=0 OR gross<=0 OR original_net<=0 THEN RAISE EXCEPTION '原合同金额异常，请先核对合同'; END IF;
  credit:=round(cut_amount*original_net/gross,2);
  IF credit<=0 OR credit>=original_net-p.deductions_total THEN RAISE EXCEPTION '减项后原合同金额须大于零；整单取消请另行处理'; END IF;
  SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount ELSE -amount END) FILTER(WHERE verified_at IS NOT NULL),0),
   coalesce(sum(amount) FILTER(WHERE verified_at IS NULL),0) INTO paid,pending
  FROM renovation_payments WHERE project_id=p.id AND voided_at IS NULL;
  IF paid+pending>p.current_total-credit THEN RAISE EXCEPTION '减项后已收及待核对款将超过项目总额，请先处理收退款'; END IF;
  IF EXISTS(SELECT 1 FROM renovation_deductions WHERE project_id=p.id AND line_id=p_data->>'line_id' AND status<>'voided') THEN RAISE EXCEPTION '此原合同项目已有待签或已签减项'; END IF;
  INSERT INTO renovation_deductions(id,project_id,line_id,line_name,original_amount,discount_credit,reason,created_by,line_amount,partial)
  VALUES(p_entry,p_id,line->>'id',line->>'name',cut_amount,credit,reason,auth.uid(),line_amount,cut_amount<line_amount) RETURNING * INTO d;
 ELSIF p_action='void' THEN
  IF d.id IS NULL OR d.project_id<>p.id OR d.status<>'pending' THEN RAISE EXCEPTION '仅待签减项可撤销；已签减项须另行协商变更'; END IF;
  IF d.created_by<>auth.uid() AND NOT _reno_access(p.store_id,p.created_by,true) THEN RAISE EXCEPTION '请由原登记员工或店长撤销'; END IF;
  reason:=trim(coalesce(p_data->>'reason',''));
  IF length(reason) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '请填写撤销原因'; END IF;
  UPDATE renovation_deductions SET status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=reason WHERE id=d.id RETURNING * INTO d;
 ELSE RAISE EXCEPTION '不支持的减项操作'; END IF;
 UPDATE renovation_projects SET revision=revision+1,updated_at=now() WHERE id=p.id;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p.id,auth.uid(),'deduction_'||p_action,to_jsonb(d));
 RETURN to_jsonb(d);
END $$;
REVOKE ALL ON FUNCTION public.renovation_deduction_command(uuid,integer,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_deduction_command(uuid,integer,text,uuid,jsonb) TO authenticated;

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
 plan:=coalesce(p.adjusted_payments,p.snapshot->'payments','[]'::jsonb);remaining:=d.discount_credit;stage_count:=jsonb_array_length(plan);
 FOR i IN REVERSE stage_count..1 LOOP
  stage_amount:=(plan->(i-1)->>'amount')::numeric;
  SELECT coalesce(sum(CASE WHEN kind='receipt' THEN amount ELSE -amount END) FILTER(WHERE verified_at IS NOT NULL),0),
   coalesce(sum(amount) FILTER(WHERE verified_at IS NULL),0) INTO stage_paid,stage_pending
  FROM _reno_payment_lines(p.id) WHERE installment=i AND voided_at IS NULL;
  available:=greatest(0,stage_amount-stage_paid-stage_pending);take:=least(remaining,available);
  IF take>0 THEN plan:=jsonb_set(plan,ARRAY[(i-1)::text,'amount'],to_jsonb(stage_amount-take));remaining:=remaining-take; END IF;
  EXIT WHEN remaining=0;
 END LOOP;
 IF remaining>0 THEN RAISE EXCEPTION '原合同未收款付款节点不足以扣除减项，请先核对已收款和退款'; END IF;
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

CREATE OR REPLACE FUNCTION public.renovation_customer_view(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('contract_no',p.contract_no,'address',p.address,'state',p.state,'accepted_on',p.accepted_on,
 'scope_revision',p.scope_revision,'net',p.current_total,'original_net',p.snapshot->'net','additions_total',p.additions_total,
 'deductions_total',p.deductions_total,'lines',coalesce((SELECT jsonb_agg(jsonb_build_object(
 'id',x->>'id','name',x->>'name','spec',x->>'spec','qty',x->'qty','unit',x->>'unit','gift',x->>'kind'='gift','warranties',x->'warranties'))
 FROM jsonb_array_elements(_reno_effective_lines(p.id)) x),'[]'::jsonb),
 'deductions',coalesce((SELECT jsonb_agg(jsonb_build_object('line_id',d.line_id,'line_name',d.line_name,
  'original_amount',d.original_amount,'line_amount',d.line_amount,'partial',d.partial,'discount_credit',d.discount_credit,'reason',d.reason,'signed_at',d.signed_at,'signer_name',d.signer_name,'signature_hash',d.signature_hash)
  ORDER BY d.signed_at) FROM renovation_deductions d WHERE d.project_id=p.id AND d.status='signed'),'[]'::jsonb))
 FROM renovation_projects p WHERE p.customer_token=p_token AND p.state<>'draft';
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_view(uuid) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.renovation_customer_progress_view(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('state',p.state,'accepted_on',p.accepted_on,'revision',p.revision,
  'work_orders',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'group_name',CASE WHEN a.id IS NOT NULL THEN a.group_name ELSE w.group_name END,
   'status',w.status,'updated_at',w.updated_at) ORDER BY w.group_name,w.id)
   FROM public.renovation_work_orders w LEFT JOIN public.renovation_additions a ON a.work_order_id=w.id
   WHERE w.project_id=p.id AND w.cancelled_at IS NULL
    AND (a.id IS NULL OR (a.voided_at IS NULL AND a.signature_status='signed'))
    AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(w.line_ids) lid
      WHERE NOT EXISTS(SELECT 1 FROM renovation_deductions d WHERE d.project_id=p.id AND d.line_id=lid AND d.status='signed' AND NOT d.partial))),'[]'::jsonb))
 FROM public.renovation_projects p WHERE p.customer_token=p_token AND p.state<>'draft';
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_progress_view(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.renovation_customer_progress_view(uuid) TO anon,authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
