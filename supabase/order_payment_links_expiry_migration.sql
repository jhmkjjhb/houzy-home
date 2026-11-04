-- An order that lapses takes its payment link with it. A link for an order still awaiting its first
-- payment expires at HitPay when the order does; every other link that should no longer be paid
-- (order cancelled by staff, amount changed) is deleted at HitPay by hitpay-close-links.
-- Run after order_payment_links_migration.sql. Safe to re-run.
BEGIN;
ALTER TABLE public.order_payment_links ADD COLUMN IF NOT EXISTS closed_at timestamptz;

CREATE OR REPLACE FUNCTION public._order_payment_quote(p_order uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o orders%ROWTYPE;doc jsonb;currency text;n integer;splits numeric[];s integer;total numeric;recorded numeric;due numeric;
 stop_with text;each numeric;
BEGIN
 SELECT * INTO o FROM orders WHERE id=p_order;
 IF o.id IS NULL THEN RETURN jsonb_build_object('payable',false,'reason','not_found'); END IF;
 doc:=to_jsonb(o);currency:=upper(coalesce(doc->>'currency','MYR'));total:=o.amount;
 IF lower(coalesce(o.status,'')) IN ('cancelled','canceled','closed','void','refunded') THEN stop_with:='closed';
 -- Same 24 hours as auto_expire_unpaid_orders, which only runs hourly: an expired order is unpayable at once.
 ELSIF o.status='pending_payment' AND o.payment_status='unpaid' AND o.created_at<now()-interval '24 hours'
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
 UPDATE order_payment_links SET status='superseded' WHERE order_id=p_order AND status='open' AND id IS DISTINCT FROM l.id;
 SELECT count(*) INTO recent FROM order_payment_links WHERE order_id=p_order AND created_at>now()-interval '1 day';
 -- HitPay reads this in Singapore time, the same clock as Malaysia.
 SELECT to_char((o.created_at+interval '24 hours') AT TIME ZONE 'Asia/Singapore','YYYY-MM-DD HH24:MI:SS') INTO expires FROM orders o
  WHERE o.id=p_order AND o.status='pending_payment' AND o.payment_status='unpaid' AND NOT EXISTS(SELECT 1 FROM order_payments p WHERE p.order_id=o.id);
 SELECT c2.name,c2.phone,o.description INTO c FROM orders o LEFT JOIN customers c2 ON c2.id=o.customer_id WHERE o.id=p_order;
 RETURN q||jsonb_build_object('link',CASE WHEN l.id IS NULL THEN NULL ELSE jsonb_build_object('payment_url',l.payment_url,'payment_request_id',l.payment_request_id) END,
  'links_today',recent,'expires_at',expires,'customer_name',c.name,'customer_phone',c.phone,'description',c.description);
END $$;

REVOKE ALL ON FUNCTION public.hitpay_link_prepare(uuid) FROM PUBLIC,anon,authenticated;

-- Links HitPay should stop accepting. Includes older whole-order links kept on the order row.
CREATE OR REPLACE FUNCTION public.hitpay_links_to_close(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(t.id),'[]'::jsonb) FROM (
  SELECT l.payment_request_id AS id FROM order_payment_links l JOIN orders o ON o.id=l.order_id
   WHERE l.closed_at IS NULL AND (l.status='superseded' OR (l.status='open' AND
    (lower(coalesce(o.status,'')) IN ('cancelled','canceled','closed','void','refunded')
     OR (_order_payment_quote(o.id)->>'reason') IN ('expired','paid'))))
  UNION
  SELECT o.hitpay_payment_id FROM orders o
   WHERE o.hitpay_payment_id IS NOT NULL AND lower(coalesce(o.status,'')) IN ('cancelled','canceled','closed','void','refunded')
    AND lower(coalesce(o.hitpay_status,'')) NOT IN ('completed','paid','succeeded','success','review','closed')
    AND NOT EXISTS(SELECT 1 FROM order_payment_links x WHERE x.payment_request_id=o.hitpay_payment_id)
  LIMIT p_limit) t;
$$;
REVOKE ALL ON FUNCTION public.hitpay_links_to_close(integer) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.hitpay_link_closed(p_request text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE order_payment_links SET status=CASE WHEN status='open' THEN 'superseded' ELSE status END,closed_at=now() WHERE payment_request_id=p_request;
 UPDATE orders SET hitpay_status='closed' WHERE hitpay_payment_id=p_request AND lower(coalesce(hitpay_status,'')) NOT IN ('completed','paid','succeeded','success','review');
END $$;
REVOKE ALL ON FUNCTION public.hitpay_link_closed(text) FROM PUBLIC,anon,authenticated;

-- A closed link no longer needs checking with HitPay.
CREATE OR REPLACE FUNCTION public.hitpay_open_links(p_order uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (
  SELECT payment_request_id FROM order_payment_links WHERE order_id=p_order AND status='open'
  UNION SELECT o.hitpay_payment_id FROM orders o WHERE o.id=p_order AND o.hitpay_payment_id IS NOT NULL AND lower(coalesce(o.hitpay_status,'')) NOT IN ('completed','paid','succeeded','success','review','superseded','closed')
 ) t(x);
$$;
REVOKE ALL ON FUNCTION public.hitpay_open_links(uuid) FROM PUBLIC,anon,authenticated;

-- The old job deletes cancelled orders after 15 days. Keep an order while HitPay could still accept
-- its link, so a late payment always has an order to attach to.
CREATE OR REPLACE FUNCTION public._keep_order_with_live_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM order_payment_links WHERE order_id=OLD.id AND closed_at IS NULL AND status IN ('open','superseded')) THEN RETURN NULL; END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public._keep_order_with_live_link() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS keep_order_with_live_link ON public.orders;
CREATE TRIGGER keep_order_with_live_link BEFORE DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public._keep_order_with_live_link();

DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.hitpay_links_to_close(integer),public.hitpay_link_closed(text) TO service_role;
 END IF;
END $grant$;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Every 15 minutes. The function takes no input and only retires links that should already be dead,
-- so it needs no secret. Skipped where pg_cron is not installed (the test database).
DO $sched$
BEGIN
 IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
 CREATE EXTENSION IF NOT EXISTS pg_net;
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='hitpay-close-links') THEN PERFORM cron.unschedule('hitpay-close-links'); END IF;
 PERFORM cron.schedule('hitpay-close-links','*/15 * * * *',$job$
  SELECT net.http_post(url:='https://csabbxiijzghooppayae.supabase.co/functions/v1/hitpay-close-links',
   headers:='{"Content-Type":"application/json"}'::jsonb,body:='{}'::jsonb,timeout_milliseconds:=60000);
 $job$);
END $sched$;
