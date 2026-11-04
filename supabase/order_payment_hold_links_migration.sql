-- Extending an unpaid order extends its payment link. Payment follows the same deadline as the
-- order: extended by staff, the customer can still pay; lapsed, nobody can.
-- Run after payment_hold_extensions_migration.sql and order_payment_links_expiry_migration.sql. Safe to re-run.
BEGIN;
ALTER TABLE public.order_payment_links ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE OR REPLACE FUNCTION public._order_hold_deadline(p_order uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(h.expires_at,o.created_at+interval '24 hours') FROM orders o LEFT JOIN order_payment_holds h ON h.order_id=o.id WHERE o.id=p_order;
$$;
REVOKE ALL ON FUNCTION public._order_hold_deadline(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._order_payment_quote(p_order uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o orders%ROWTYPE;doc jsonb;currency text;n integer;splits numeric[];s integer;total numeric;recorded numeric;due numeric;
 stop_with text;each numeric;
BEGIN
 SELECT * INTO o FROM orders WHERE id=p_order;
 IF o.id IS NULL THEN RETURN jsonb_build_object('payable',false,'reason','not_found'); END IF;
 doc:=to_jsonb(o);currency:=upper(coalesce(doc->>'currency','MYR'));total:=o.amount;
 IF lower(coalesce(o.status,'')) IN ('cancelled','canceled','closed','void','refunded') THEN stop_with:='closed';
 -- The same deadline auto_expire_unpaid_orders uses, so an extended order stays payable and a lapsed one stops at once.
 ELSIF o.status='pending_payment' AND o.payment_status='unpaid' AND _order_hold_deadline(o.id)<=now()
  AND NOT EXISTS(SELECT 1 FROM order_payments WHERE order_id=p_order) THEN stop_with:='expired';
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

CREATE OR REPLACE FUNCTION public.hitpay_link_prepare(p_order uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE q jsonb;l order_payment_links%ROWTYPE;recent integer;c record;expires text;
BEGIN
 PERFORM 1 FROM orders WHERE id=p_order FOR UPDATE;
 q:=_order_payment_quote(p_order);
 IF NOT (q->>'payable')::boolean THEN
  UPDATE order_payment_links SET status='superseded' WHERE order_id=p_order AND status='open';
  RETURN q;
 END IF;
 SELECT * INTO l FROM order_payment_links WHERE order_id=p_order AND status='open' AND seq=(q->>'seq')::integer AND amount=(q->>'amount')::numeric;
 -- A link whose HitPay expiry has passed cannot be paid, even if the order was extended since.
 IF l.id IS NOT NULL AND l.expires_at<=now() THEN l:=NULL; END IF;
 UPDATE order_payment_links SET status='superseded' WHERE order_id=p_order AND status='open' AND id IS DISTINCT FROM l.id;
 SELECT count(*) INTO recent FROM order_payment_links WHERE order_id=p_order AND created_at>now()-interval '1 day';
 -- HitPay reads this in Singapore time, the same clock as Malaysia.
 SELECT to_char(_order_hold_deadline(o.id) AT TIME ZONE 'Asia/Singapore','YYYY-MM-DD HH24:MI:SS') INTO expires FROM orders o
  WHERE o.id=p_order AND o.status='pending_payment' AND o.payment_status='unpaid' AND NOT EXISTS(SELECT 1 FROM order_payments p WHERE p.order_id=o.id);
 SELECT c2.name,c2.phone,o.description INTO c FROM orders o LEFT JOIN customers c2 ON c2.id=o.customer_id WHERE o.id=p_order;
 RETURN q||jsonb_build_object('link',CASE WHEN l.id IS NULL THEN NULL ELSE jsonb_build_object('payment_url',l.payment_url,'payment_request_id',l.payment_request_id) END,
  'links_today',recent,'expires_at',expires,'customer_name',c.name,'customer_phone',c.phone,'description',c.description);
END $$;

REVOKE ALL ON FUNCTION public.hitpay_link_prepare(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.hitpay_link_save(p_order uuid,p_seq integer,p_pct numeric,p_amount numeric,p_request text,p_url text,p_source text,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l order_payment_links%ROWTYPE;
BEGIN
 PERFORM 1 FROM orders WHERE id=p_order FOR UPDATE;
 SELECT * INTO l FROM order_payment_links WHERE order_id=p_order AND seq=p_seq AND status='open' AND amount=p_amount;
 IF l.id IS NULL THEN
  INSERT INTO order_payment_links(order_id,seq,pct,amount,payment_request_id,payment_url,source,created_by)
   VALUES(p_order,p_seq,p_pct,p_amount,p_request,p_url,p_source,p_actor) RETURNING * INTO l;
  UPDATE order_payment_links SET expires_at=_order_hold_deadline(p_order) WHERE id=l.id
   AND EXISTS(SELECT 1 FROM orders o WHERE o.id=p_order AND o.status='pending_payment' AND o.payment_status='unpaid' AND NOT EXISTS(SELECT 1 FROM order_payments x WHERE x.order_id=o.id));
  -- Older screens reconcile from these columns.
  UPDATE orders SET hitpay_payment_id=p_request,hitpay_payment_url=p_url,hitpay_reference=order_no,hitpay_status='pending',hitpay_amount=p_amount,hitpay_currency='MYR' WHERE id=p_order;
 END IF;
 RETURN jsonb_build_object('payment_url',l.payment_url,'payment_request_id',l.payment_request_id);
END $$;

REVOKE ALL ON FUNCTION public.hitpay_link_save(uuid,integer,numeric,numeric,text,text,text,uuid) FROM PUBLIC,anon,authenticated;

-- Links whose order deadline moved later than the expiry HitPay holds.
CREATE OR REPLACE FUNCTION public.hitpay_links_to_extend(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.payment_request_id,'amount',t.amount,'expiry_date',t.expiry)),'[]'::jsonb) FROM (
  SELECT l.payment_request_id,l.amount,to_char(_order_hold_deadline(l.order_id) AT TIME ZONE 'Asia/Singapore','YYYY-MM-DD HH24:MI:SS') AS expiry
  FROM order_payment_links l JOIN orders o ON o.id=l.order_id
  WHERE l.status='open' AND l.expires_at>now() AND o.status='pending_payment' AND _order_hold_deadline(l.order_id)>l.expires_at
  LIMIT p_limit) t;
$$;
REVOKE ALL ON FUNCTION public.hitpay_links_to_extend(integer) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.hitpay_link_extended(p_request text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 UPDATE order_payment_links SET expires_at=_order_hold_deadline(order_id) WHERE payment_request_id=p_request;
$$;
REVOKE ALL ON FUNCTION public.hitpay_link_extended(text) FROM PUBLIC,anon,authenticated;

DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.hitpay_link_prepare(uuid),public.hitpay_link_save(uuid,integer,numeric,numeric,text,text,text,uuid),public.hitpay_links_to_extend(integer),public.hitpay_link_extended(text) TO service_role;
 END IF;
END $grant$;
NOTIFY pgrst,'reload schema';
COMMIT;
