-- Bill an ordinary sales order to a company. Each order keeps its own copy, so a customer can bill
-- different companies and later edits never rewrite an order already issued.
-- A separate table, not an orders column: suppliers and logistics can read order rows they handle,
-- and they must not read the customer's company details. Safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS public.order_billing (
 order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
 company_name text NOT NULL CHECK(length(trim(company_name)) BETWEEN 1 AND 200),
 registration_no text NOT NULL CHECK(length(trim(registration_no)) BETWEEN 1 AND 100),
 address text NOT NULL CHECK(length(trim(address)) BETWEEN 1 AND 500),
 phone text NOT NULL DEFAULT '' CHECK(length(phone)<=50),
 tax_id text NOT NULL DEFAULT '' CHECK(length(tax_id)<=50),
 updated_by uuid REFERENCES public.profiles(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.order_billing ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_billing FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.order_billing TO authenticated;
DROP POLICY IF EXISTS order_billing_staff_read ON public.order_billing;
CREATE POLICY order_billing_staff_read ON public.order_billing FOR SELECT TO authenticated
 USING(public.auth_user_level()>=1 AND public._order_visible(order_id));

-- The only write path. Empty data means back to billing the individual. Every change is logged.
CREATE OR REPLACE FUNCTION public.set_order_billing(p_order uuid,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o orders%ROWTYPE;me profiles%ROWTYPE;old order_billing%ROWTYPE;row_now order_billing%ROWTYPE;
 v_name text:=trim(coalesce(p_data->>'company_name',''));v_reg text:=trim(coalesce(p_data->>'registration_no',''));v_addr text:=trim(coalesce(p_data->>'address',''));
 v_phone text:=trim(coalesce(p_data->>'phone',''));v_tax text:=trim(coalesce(p_data->>'tax_id',''));
BEGIN
 SELECT * INTO me FROM profiles WHERE id=auth.uid();
 IF me.id IS NULL OR auth_user_level()<1 OR NOT _order_visible(p_order) THEN RAISE EXCEPTION '无此订单权限'; END IF;
 SELECT * INTO o FROM orders WHERE id=p_order FOR UPDATE;
 SELECT * INTO old FROM order_billing WHERE order_id=p_order;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR p_data='{}'::jsonb THEN
  IF old.order_id IS NULL THEN RETURN NULL; END IF;
  DELETE FROM order_billing WHERE order_id=p_order;
  INSERT INTO order_logs(order_id,status,operator_id,operator_role,operator_name,notes)
   VALUES(p_order,o.status,me.id,me.role,me.name,'开单资料：由公司 '||old.company_name||' 改回开单给个人');
  RETURN NULL;
 END IF;
 IF v_name='' OR v_reg='' OR v_addr='' THEN RAISE EXCEPTION '请填写公司名称、注册号和地址'; END IF;
 IF length(v_name)>200 OR length(v_reg)>100 OR length(v_addr)>500 OR length(v_phone)>50 OR length(v_tax)>50 THEN RAISE EXCEPTION '公司资料过长，请核对'; END IF;
 IF old.order_id IS NOT NULL AND (old.company_name,old.registration_no,old.address,old.phone,old.tax_id)=(v_name,v_reg,v_addr,v_phone,v_tax) THEN RETURN to_jsonb(old); END IF;
 INSERT INTO order_billing(order_id,company_name,registration_no,address,phone,tax_id,updated_by,updated_at)
  VALUES(p_order,v_name,v_reg,v_addr,v_phone,v_tax,me.id,now())
  ON CONFLICT(order_id) DO UPDATE SET company_name=v_name,registration_no=v_reg,address=v_addr,phone=v_phone,tax_id=v_tax,updated_by=me.id,updated_at=now()
  RETURNING * INTO row_now;
 INSERT INTO order_logs(order_id,status,operator_id,operator_role,operator_name,notes)
  VALUES(p_order,o.status,me.id,me.role,me.name,
   CASE WHEN old.order_id IS NULL THEN '开单资料：开单给公司 '||v_name||'（'||v_reg||'）'
    ELSE '开单资料修改：'||old.company_name||'（'||old.registration_no||'）'||old.address||' → '||v_name||'（'||v_reg||'）'||v_addr END);
 RETURN to_jsonb(row_now);
END $$;
REVOKE ALL ON FUNCTION public.set_order_billing(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_order_billing(uuid,jsonb) TO authenticated;

-- Returning customers: bring back the company on their latest order. Like find_customer_by_phone,
-- this works across staff because the customer may have been served by a colleague before.
CREATE OR REPLACE FUNCTION public.find_customer_billing(p_phone text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN b.order_id IS NULL THEN NULL ELSE jsonb_build_object('company_name',b.company_name,'registration_no',b.registration_no,'address',b.address,'phone',b.phone,'tax_id',b.tax_id) END
 FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN order_billing b ON b.order_id=o.id
 WHERE nullif(p_phone,'') IS NOT NULL AND c.phone=p_phone
  AND EXISTS(SELECT 1 FROM profiles p WHERE p.id=auth.uid() AND p.active=true AND auth_user_level()>=1)
 ORDER BY o.created_at DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.find_customer_billing(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.find_customer_billing(text) TO authenticated;

-- Customer PDF. Same function as order_statement_customer_migration.sql, plus the company details.
CREATE OR REPLACE FUNCTION public.get_order_statement_by_phone(p_order_id uuid, p_phone text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id, 'order_no', o.order_no, 'amount', o.amount,
      'currency', coalesce(to_jsonb(o)->>'currency', 'MYR'),
      'payment_method', to_jsonb(o)->>'payment_method',
      'payment_status', o.payment_status, 'status', o.status,
      'description', o.description, 'created_at', o.created_at,
      'hitpay_status', o.hitpay_status, 'hitpay_amount', o.hitpay_amount,
      'hitpay_paid_at', o.hitpay_paid_at,
      'stores', jsonb_build_object('name', s.name),
      'customers', jsonb_build_object('name', c.name, 'phone', c.phone, 'address', c.address),
      'order_billing', CASE WHEN b.order_id IS NULL THEN NULL ELSE jsonb_build_object('company_name', b.company_name, 'registration_no', b.registration_no, 'address', b.address, 'phone', b.phone, 'tax_id', b.tax_id) END
    ),
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'product_name', i.product_name, 'model_spec', i.model_spec,
        'quantity', i.quantity, 'uom', coalesce(i.uom, i.unit),
        'unit_price', i.unit_price, 'total_price', i.total_price
      ) ORDER BY i.sort_order NULLS LAST, i.created_at, i.id)
      FROM public.order_items i WHERE i.order_id = o.id
    ), '[]'::jsonb),
    'payments', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'amount', p.amount, 'method', p.method,
        'paid_at', p.paid_at, 'verified_at', p.verified_at
      ) ORDER BY p.seq, p.paid_at, p.id)
      FROM public.order_payments p WHERE p.order_id = o.id
    ), '[]'::jsonb)
  )
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  JOIN public.stores s ON s.id = o.store_id
  LEFT JOIN public.order_billing b ON b.order_id = o.id
  WHERE o.id = p_order_id AND c.phone = p_phone
    AND p_phone IS NOT NULL AND length(p_phone) <= 50;
$$;

NOTIFY pgrst,'reload schema';
COMMIT;
