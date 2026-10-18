-- Ready for test deployment; NOT applied to production. User confirmed total hold cap: 60 days from creation.
-- Preserve cancelled orders/logs; replaces the legacy 15-day physical deletion job.
BEGIN;
CREATE TABLE IF NOT EXISTS public.payment_hold_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  max_hold_days integer NOT NULL DEFAULT 60 CHECK(max_hold_days=60),
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.payment_hold_policy(singleton,enabled) VALUES(true,true) ON CONFLICT DO NOTHING;
ALTER TABLE public.payment_hold_policy ADD COLUMN IF NOT EXISTS max_hold_days integer NOT NULL DEFAULT 60 CHECK(max_hold_days=60);
UPDATE public.payment_hold_policy SET max_hold_days=60,enabled=true WHERE singleton;
ALTER TABLE public.payment_hold_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_hold_policy FROM anon, authenticated;
CREATE TABLE IF NOT EXISTS public.order_payment_holds (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  extend_count integer NOT NULL DEFAULT 0 CHECK(extend_count BETWEEN 0 AND 2),
  expired_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.order_payment_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_payment_holds FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public._payment_hold_access(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM orders o JOIN profiles p ON p.id=auth.uid()
 LEFT JOIN stores s ON s.id=o.store_id
 WHERE o.id=p_order_id AND p.active=true AND (
 p.role IN ('general_manager','admin','superadmin') OR
 (p.role IN ('staff','store_manager') AND p.store_id=o.store_id) OR
 (p.role='regional_manager' AND p.region=s.region)));
$$;
REVOKE ALL ON FUNCTION public._payment_hold_access(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._init_payment_hold()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='pending_payment' THEN
  INSERT INTO order_payment_holds(order_id,expires_at)
  VALUES(NEW.id,COALESCE(NEW.created_at,now())+interval '24 hours') ON CONFLICT DO NOTHING;
  UPDATE orders SET deadline_at=(SELECT expires_at FROM order_payment_holds WHERE order_id=NEW.id)
  WHERE id=NEW.id;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_init_payment_hold ON public.orders;
CREATE TRIGGER trg_init_payment_hold AFTER INSERT OR UPDATE OF status ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public._init_payment_hold();
INSERT INTO order_payment_holds(order_id,expires_at)
 SELECT id,created_at+interval '24 hours' FROM orders WHERE status='pending_payment'
 ON CONFLICT DO NOTHING;
UPDATE orders o SET deadline_at=h.expires_at FROM order_payment_holds h
 WHERE h.order_id=o.id AND o.status='pending_payment';

CREATE OR REPLACE FUNCTION public.get_payment_hold(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h order_payment_holds%ROWTYPE; p payment_hold_policy%ROWTYPE;
BEGIN
 IF NOT _payment_hold_access(p_order_id) THEN RAISE EXCEPTION '无此门店订单操作权限'; END IF;
 SELECT * INTO h FROM order_payment_holds WHERE order_id=p_order_id;
 SELECT * INTO p FROM payment_hold_policy WHERE singleton=true;
 IF h.order_id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('expires_at',h.expires_at,'extend_count',h.extend_count,
 'expired_at',h.expired_at,'max_hold_days',p.max_hold_days,'max_expires_at',(SELECT created_at+make_interval(days=>p.max_hold_days) FROM orders WHERE id=p_order_id),'enabled',p.enabled);
END; $$;
REVOKE ALL ON FUNCTION public.get_payment_hold(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payment_hold(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.extend_payment_hold(p_order_id uuid,p_days integer,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o orders%ROWTYPE; h order_payment_holds%ROWTYPE; p payment_hold_policy%ROWTYPE; actor profiles%ROWTYPE;
BEGIN
 IF NOT _payment_hold_access(p_order_id) THEN RAISE EXCEPTION '无此门店订单操作权限'; END IF;
 IF length(trim(COALESCE(p_reason,'')))=0 OR length(p_reason)>500 THEN RAISE EXCEPTION '请填写500字以内延期原因'; END IF;
 SELECT * INTO p FROM payment_hold_policy WHERE singleton=true;
 IF NOT p.enabled THEN RAISE EXCEPTION '挂单延期规则尚未启用'; END IF;
 IF p_days IS NULL OR p_days<1 OR p_days>60 THEN RAISE EXCEPTION '延长天数须为1至60的整数'; END IF;
 SELECT * INTO o FROM orders WHERE id=p_order_id FOR UPDATE;
 SELECT * INTO h FROM order_payment_holds WHERE order_id=p_order_id FOR UPDATE;
 IF h.order_id IS NULL OR o.status<>'pending_payment' OR o.payment_status<>'unpaid' THEN RAISE EXCEPTION '仅未付款的待付款订单可延期'; END IF;
 IF o.hitpay_paid_at IS NOT NULL OR lower(COALESCE(o.hitpay_status,'')) IN ('completed','paid','succeeded','success')
 OR EXISTS(SELECT 1 FROM order_payments WHERE order_id=o.id AND pct>0) THEN RAISE EXCEPTION '已有付款或收款记录，请先核对付款状态'; END IF;
 IF h.expired_at IS NOT NULL OR h.expires_at<=now() THEN RAISE EXCEPTION '挂单已过期，不能通过延期恢复'; END IF;
 IF h.extend_count>=2 THEN RAISE EXCEPTION '延期次数已用完（2/2）'; END IF;
 IF h.expires_at+make_interval(days=>p_days)>o.created_at+make_interval(days=>p.max_hold_days) THEN RAISE EXCEPTION '超过挂单上限：从建单起最长60天，请减少延长天数'; END IF;
 UPDATE order_payment_holds SET expires_at=expires_at+make_interval(days=>p_days),
 extend_count=extend_count+1,updated_at=now() WHERE order_id=p_order_id RETURNING * INTO h;
 UPDATE orders SET deadline_at=h.expires_at,updated_at=now() WHERE id=p_order_id;
 SELECT * INTO actor FROM profiles WHERE id=auth.uid();
 INSERT INTO order_logs(order_id,status,operator_id,operator_role,operator_name,notes)
 VALUES(o.id,o.status,actor.id,actor.role,actor.name,'待付款挂单延期第'||h.extend_count||'/2次，延长'||p_days||'天；原因：'||trim(p_reason));
 RETURN jsonb_build_object('expires_at',h.expires_at,'extend_count',h.extend_count);
END; $$;
REVOKE ALL ON FUNCTION public.extend_payment_hold(uuid,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.extend_payment_hold(uuid,integer,text) TO authenticated;

-- Serialize payment recording and expiry using the same order-row lock.
CREATE OR REPLACE FUNCTION public._lock_payment_order_for_hold()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM 1 FROM orders WHERE id=NEW.order_id FOR UPDATE; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_lock_payment_order_for_hold ON public.order_payments;
CREATE TRIGGER trg_lock_payment_order_for_hold BEFORE INSERT ON public.order_payments
 FOR EACH ROW EXECUTE FUNCTION public._lock_payment_order_for_hold();

CREATE OR REPLACE FUNCTION public.auto_expire_unpaid_orders()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item record; o orders%ROWTYPE; h order_payment_holds%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM payment_hold_policy WHERE singleton AND enabled) THEN RETURN; END IF;
 FOR item IN SELECT ord.id FROM orders ord JOIN order_payment_holds hold ON hold.order_id=ord.id
 WHERE ord.status='pending_payment' AND ord.payment_status='unpaid' AND hold.expires_at<=now()
 ORDER BY ord.id LIMIT 500 FOR UPDATE OF ord SKIP LOCKED LOOP
  SELECT * INTO o FROM orders WHERE id=item.id;
  SELECT * INTO h FROM order_payment_holds WHERE order_id=item.id FOR UPDATE;
  IF o.status<>'pending_payment' OR o.payment_status<>'unpaid' OR h.expires_at>now()
   OR o.hitpay_paid_at IS NOT NULL OR lower(COALESCE(o.hitpay_status,'')) IN ('completed','paid','succeeded','success')
   OR EXISTS(SELECT 1 FROM order_payments WHERE order_id=o.id AND pct>0) THEN CONTINUE; END IF;
  UPDATE orders SET status='cancelled',updated_at=now() WHERE id=o.id;
  UPDATE order_payment_holds SET expired_at=now(),updated_at=now() WHERE order_id=o.id;
  INSERT INTO order_logs(order_id,status,operator_role,operator_name,notes)
  VALUES(o.id,'cancelled','system','系统自动','待付款挂单到期作废；已延期'||h.extend_count||'/2次。保留订单及日志。');
 END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.auto_expire_unpaid_orders() FROM PUBLIC,anon,authenticated;
-- Existing hourly job already invokes this function. Reschedule explicitly to five-minute cadence.
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN PERFORM cron.unschedule('auto-expire-unpaid-orders'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('auto-expire-unpaid-orders','*/5 * * * *','select public.auto_expire_unpaid_orders();');
NOTIFY pgrst,'reload schema';
COMMIT;
-- Policy: initial24h, max2 extensions, chosen whole days, total cap60d from created_at.
-- Pause via UPDATE public.payment_hold_policy SET enabled=false WHERE singleton;
