-- One HitPay link per installment, shared by staff and customers, so whoever opens it pays the same
-- request. The server decides the amount. A payment is recorded only when it matches what is due;
-- anything else leaves the order unpaid and asks a manager to check. Safe to re-run.
BEGIN;

-- order_payments is not defined in this repo, so state what this feature needs from it and stop
-- rather than fail on a customer's real payment.
DO $check$
DECLARE c text;
BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='order_payments' AND column_name='recorded_by' AND is_nullable='NO') THEN
  ALTER TABLE public.order_payments ALTER COLUMN recorded_by DROP NOT NULL;
 END IF;
 FOR c IN SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.order_payments'::regclass AND contype='c' LOOP
  IF c ILIKE '%method%' AND c NOT ILIKE '%hitpay%' THEN RAISE EXCEPTION '付款表不允许 hitpay 方式，已停止：%',c; END IF;
 END LOOP;
END $check$;

CREATE TABLE IF NOT EXISTS public.order_payment_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
 seq integer NOT NULL, pct numeric NOT NULL, amount numeric(12,2) NOT NULL CHECK(amount>0),
 payment_request_id text NOT NULL UNIQUE, payment_url text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','paid','failed','superseded','review')),
 source text NOT NULL CHECK(source IN ('staff','customer')),
 created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
 paid_amount numeric(12,2), paid_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS order_payment_links_one_open ON public.order_payment_links(order_id,seq) WHERE status='open';
ALTER TABLE public.order_payment_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_payment_links FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.order_payment_links TO authenticated;
DROP POLICY IF EXISTS order_payment_links_staff_read ON public.order_payment_links;
CREATE POLICY order_payment_links_staff_read ON public.order_payment_links FOR SELECT TO authenticated
 USING(public.auth_user_level()>=1 AND public._order_visible(order_id));

-- What can be paid right now. Same split rules as the staff payment panel.
CREATE OR REPLACE FUNCTION public._order_payment_quote(p_order uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o orders%ROWTYPE;doc jsonb;currency text;n integer;splits numeric[];s integer;total numeric;recorded numeric;due numeric;
 stop_with text;each numeric;
BEGIN
 SELECT * INTO o FROM orders WHERE id=p_order;
 IF o.id IS NULL THEN RETURN jsonb_build_object('payable',false,'reason','not_found'); END IF;
 doc:=to_jsonb(o);currency:=upper(coalesce(doc->>'currency','MYR'));total:=o.amount;
 IF lower(coalesce(o.status,'')) IN ('cancelled','canceled','closed','void','refunded') THEN stop_with:='closed';
 ELSIF currency<>'MYR' THEN stop_with:='currency';
 ELSIF coalesce(total,0)<=0 THEN stop_with:='invalid_amount';
 ELSIF o.payment_status='paid' OR lower(coalesce(doc->>'hitpay_status','')) IN ('completed','paid','succeeded','success') THEN stop_with:='paid';
 ELSIF lower(coalesce(doc->>'hitpay_status',''))='review' THEN stop_with:='review';
 ELSIF EXISTS(SELECT 1 FROM order_payments WHERE order_id=p_order AND method='cash' AND verified_at IS NULL) THEN stop_with:='pending_verify';
 END IF;
 IF stop_with IS NOT NULL THEN RETURN jsonb_build_object('payable',false,'reason',stop_with); END IF;
 IF jsonb_typeof(doc->'pay_splits')='array' AND jsonb_array_length(doc->'pay_splits')>0 THEN
  SELECT array_agg((v)::numeric ORDER BY i) INTO splits FROM jsonb_array_elements_text(doc->'pay_splits') WITH ORDINALITY t(v,i);
  n:=array_length(splits,1);
 ELSE
  n:=greatest(coalesce((doc->>'installments')::integer,1),1);each:=floor(100.0/n);
  splits:=array_fill(each,ARRAY[n]);splits[n]:=100-each*(n-1);
 END IF;
 SELECT min(g) INTO s FROM generate_series(1,n) g WHERE NOT EXISTS(SELECT 1 FROM order_payments p WHERE p.order_id=p_order AND p.seq=g);
 IF s IS NULL THEN RETURN jsonb_build_object('payable',false,'reason','paid'); END IF;
 SELECT coalesce(sum(p.amount),0) INTO recorded FROM order_payments p WHERE p.order_id=p_order;
 -- The last installment takes whatever remains, so rounding can never leave a few sen unpaid.
 due:=CASE WHEN s=n THEN total-recorded ELSE round(total*splits[s]/100,2) END;
 IF due<=0 THEN RETURN jsonb_build_object('payable',false,'reason','paid'); END IF;
 RETURN jsonb_build_object('payable',true,'seq',s,'installments',n,'pct',splits[s],'amount',due,'currency',currency,'order_no',o.order_no);
END $$;
REVOKE ALL ON FUNCTION public._order_payment_quote(uuid) FROM PUBLIC,anon,authenticated;

-- Customer page: same phone check as the customer PDF, and only what the pay button needs.
CREATE OR REPLACE FUNCTION public.order_customer_payment_quote(p_order uuid,p_phone text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT (q-'order_no') FROM orders o JOIN customers c ON c.id=o.customer_id
  CROSS JOIN LATERAL _order_payment_quote(o.id) q
 WHERE o.id=p_order AND c.phone=p_phone AND p_phone IS NOT NULL AND length(p_phone)<=50;
$$;
REVOKE ALL ON FUNCTION public.order_customer_payment_quote(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_customer_payment_quote(uuid,text) TO anon,authenticated;

-- Server only. Returns the quote plus the link to reuse. A link for an old amount is retired.
CREATE OR REPLACE FUNCTION public.hitpay_link_prepare(p_order uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE q jsonb;l order_payment_links%ROWTYPE;recent integer;c record;
BEGIN
 PERFORM 1 FROM orders WHERE id=p_order FOR UPDATE;
 q:=_order_payment_quote(p_order);
 IF NOT (q->>'payable')::boolean THEN
  UPDATE order_payment_links SET status='superseded' WHERE order_id=p_order AND status='open';
  RETURN q;
 END IF;
 SELECT * INTO l FROM order_payment_links WHERE order_id=p_order AND status='open' AND seq=(q->>'seq')::integer AND amount=(q->>'amount')::numeric;
 UPDATE order_payment_links SET status='superseded' WHERE order_id=p_order AND status='open' AND id IS DISTINCT FROM l.id;
 SELECT count(*) INTO recent FROM order_payment_links WHERE order_id=p_order AND created_at>now()-interval '1 day';
 SELECT c2.name,c2.phone,o.description INTO c FROM orders o LEFT JOIN customers c2 ON c2.id=o.customer_id WHERE o.id=p_order;
 RETURN q||jsonb_build_object('link',CASE WHEN l.id IS NULL THEN NULL ELSE jsonb_build_object('payment_url',l.payment_url,'payment_request_id',l.payment_request_id) END,
  'links_today',recent,'customer_name',c.name,'customer_phone',c.phone,'description',c.description);
END $$;
REVOKE ALL ON FUNCTION public.hitpay_link_prepare(uuid) FROM PUBLIC,anon,authenticated;

-- Two people may create a link at once; the first one saved wins and the other reuses it.
CREATE OR REPLACE FUNCTION public.hitpay_link_save(p_order uuid,p_seq integer,p_pct numeric,p_amount numeric,p_request text,p_url text,p_source text,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l order_payment_links%ROWTYPE;
BEGIN
 PERFORM 1 FROM orders WHERE id=p_order FOR UPDATE;
 SELECT * INTO l FROM order_payment_links WHERE order_id=p_order AND seq=p_seq AND status='open' AND amount=p_amount;
 IF l.id IS NULL THEN
  INSERT INTO order_payment_links(order_id,seq,pct,amount,payment_request_id,payment_url,source,created_by)
   VALUES(p_order,p_seq,p_pct,p_amount,p_request,p_url,p_source,p_actor) RETURNING * INTO l;
  -- Older screens reconcile from these columns.
  UPDATE orders SET hitpay_payment_id=p_request,hitpay_payment_url=p_url,hitpay_reference=order_no,hitpay_status='pending',hitpay_amount=p_amount,hitpay_currency='MYR' WHERE id=p_order;
 END IF;
 RETURN jsonb_build_object('payment_url',l.payment_url,'payment_request_id',l.payment_request_id);
END $$;
REVOKE ALL ON FUNCTION public.hitpay_link_save(uuid,integer,numeric,numeric,text,text,text,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.hitpay_open_links(p_order uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (
  SELECT payment_request_id FROM order_payment_links WHERE order_id=p_order AND status='open'
  UNION SELECT o.hitpay_payment_id FROM orders o WHERE o.id=p_order AND o.hitpay_payment_id IS NOT NULL AND lower(coalesce(o.hitpay_status,'')) NOT IN ('completed','paid','succeeded','success','review','superseded')
 ) t(x);
$$;
REVOKE ALL ON FUNCTION public.hitpay_open_links(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._hitpay_log(p_order uuid,p_status text,p_notes text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 INSERT INTO order_logs(order_id,status,operator_role,operator_name,notes) VALUES(p_order,coalesce(p_status,''),'system','HitPay',p_notes);
$$;
REVOKE ALL ON FUNCTION public._hitpay_log(uuid,text,text) FROM PUBLIC,anon,authenticated;

-- Called for a completed payment by the signed webhook and by status checks, possibly many times.
CREATE OR REPLACE FUNCTION public.hitpay_record_payment(p_request text,p_reference text,p_amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l order_payment_links%ROWTYPE;o orders%ROWTYPE;q jsonb;paid numeric;expected numeric;doc jsonb;first_pct numeric;counted numeric;s integer;n integer;splits numeric[];each numeric;remaining numeric;fully boolean:=false;
BEGIN
 SELECT * INTO l FROM order_payment_links WHERE payment_request_id=p_request;
 IF l.id IS NOT NULL THEN SELECT * INTO o FROM orders WHERE id=l.order_id FOR UPDATE;
 ELSE
  SELECT * INTO o FROM orders WHERE hitpay_payment_id=p_request AND p_request IS NOT NULL FOR UPDATE;
  IF o.id IS NULL THEN SELECT * INTO o FROM orders WHERE order_no=p_reference AND p_reference IS NOT NULL FOR UPDATE; END IF;
 END IF;
 IF o.id IS NULL THEN RETURN jsonb_build_object('result','ignored'); END IF;
 SELECT * INTO l FROM order_payment_links WHERE id=l.id;
 IF l.status='paid' OR (l.id IS NULL AND o.hitpay_paid_at IS NOT NULL AND o.hitpay_payment_id=p_request) THEN RETURN jsonb_build_object('result','duplicate','order_id',o.id); END IF;
 IF l.status='review' OR (l.id IS NULL AND o.hitpay_status='review' AND o.hitpay_payment_id=p_request) THEN RETURN jsonb_build_object('result','review','order_id',o.id); END IF;
 paid:=coalesce(p_amount,l.amount);
 q:=_order_payment_quote(o.id);expected:=(q->>'amount')::numeric;
 s:=(q->>'seq')::integer;
 IF paid IS NULL OR NOT coalesce((q->>'payable')::boolean,false) OR (l.id IS NOT NULL AND (l.seq<>s OR paid<>expected)) OR (l.id IS NULL AND paid<>expected AND paid<>o.amount-(SELECT coalesce(sum(amount),0) FROM order_payments WHERE order_id=o.id)) THEN
  -- Money arrived that does not match. Never mark it paid; a person decides.
  UPDATE order_payment_links SET status='review',paid_amount=paid,paid_at=now() WHERE id=l.id;
  UPDATE orders SET hitpay_status='review' WHERE id=o.id;
  PERFORM _hitpay_log(o.id,o.status,'HitPay 收到 '||coalesce(paid::text,'未知金额')||'，与当前应收 '||coalesce(expected::text,'无')||' 不符，未计入，请店长核对');
  RETURN jsonb_build_object('result','review','order_id',o.id);
 END IF;
 doc:=to_jsonb(o);
 n:=(q->>'installments')::integer;
 IF l.id IS NULL AND paid<>expected THEN
  -- An older whole-order link settled everything still unpaid: credit each remaining installment.
  IF jsonb_typeof(doc->'pay_splits')='array' AND jsonb_array_length(doc->'pay_splits')>0 THEN
   SELECT array_agg((v)::numeric ORDER BY i) INTO splits FROM jsonb_array_elements_text(doc->'pay_splits') WITH ORDINALITY t(v,i);
  ELSE each:=floor(100.0/n);splits:=array_fill(each,ARRAY[n]);splits[n]:=100-each*(n-1); END IF;
  remaining:=paid;
  FOR s IN SELECT g FROM generate_series(1,n) g WHERE NOT EXISTS(SELECT 1 FROM order_payments p WHERE p.order_id=o.id AND p.seq=g) ORDER BY g LOOP
   each:=CASE WHEN s=n THEN remaining ELSE round(o.amount*splits[s]/100,2) END;remaining:=remaining-each;
   INSERT INTO order_payments(order_id,seq,pct,amount,method,paid_at,verified_at) VALUES(o.id,s,splits[s],each,'hitpay',now(),now());
  END LOOP;
 ELSE
  INSERT INTO order_payments(order_id,seq,pct,amount,method,paid_at,verified_at) VALUES(o.id,s,(q->>'pct')::numeric,paid,'hitpay',now(),now());
 END IF;
 UPDATE order_payment_links SET status='paid',paid_amount=paid,paid_at=now() WHERE id=l.id;
 UPDATE order_payment_links SET status='superseded' WHERE order_id=o.id AND status='open' AND seq=l.seq AND id<>l.id;
 SELECT coalesce(sum(pct) FILTER(WHERE method<>'cash' OR verified_at IS NOT NULL),0) INTO counted FROM order_payments WHERE order_id=o.id;
 IF jsonb_typeof(doc->'pay_splits')='array' AND jsonb_array_length(doc->'pay_splits')>0 THEN first_pct:=(doc->'pay_splits'->>0)::numeric;
 ELSE first_pct:=CASE WHEN n=1 THEN 100 ELSE floor(100.0/n) END; END IF;
 fully:=NOT coalesce((_order_payment_quote(o.id)->>'payable')::boolean,false) OR counted>=100;
 -- Progress only moves forward: only an order still awaiting payment becomes paid.
 UPDATE orders SET payment_status=CASE WHEN fully THEN 'paid' ELSE 'partial' END,
  status=CASE WHEN status='pending_payment' AND counted>=first_pct THEN 'paid' ELSE status END,
  hitpay_status=CASE WHEN fully THEN 'completed' ELSE 'partial' END,
  hitpay_paid_at=CASE WHEN fully THEN now() ELSE hitpay_paid_at END,
  hitpay_amount=CASE WHEN fully THEN amount ELSE hitpay_amount END
 WHERE id=o.id;
 PERFORM _hitpay_log(o.id,o.status,'HitPay 收款 '||paid::text||(CASE WHEN n>1 THEN '（第'||coalesce(l.seq::text,'余下各')||'期）' ELSE '' END));
 RETURN jsonb_build_object('result','recorded','order_id',o.id,'fully_paid',fully);
END $$;
REVOKE ALL ON FUNCTION public.hitpay_record_payment(text,text,numeric) FROM PUBLIC,anon,authenticated;

DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.hitpay_link_prepare(uuid),public.hitpay_link_save(uuid,integer,numeric,numeric,text,text,text,uuid),public.hitpay_open_links(uuid),public.hitpay_record_payment(text,text,numeric) TO service_role;
 END IF;
END $grant$;

NOTIFY pgrst,'reload schema';
COMMIT;
