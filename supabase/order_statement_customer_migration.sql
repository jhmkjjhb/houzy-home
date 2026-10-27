-- Phone-scoped order statement snapshot for customers. Return only fields printed
-- in the PDF; cost, commission, staff notes and payment audit identities stay private.
BEGIN;
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
      'customers', jsonb_build_object('name', c.name, 'phone', c.phone, 'address', c.address)
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
  WHERE o.id = p_order_id AND c.phone = p_phone
    AND p_phone IS NOT NULL AND length(p_phone) <= 50;
$$;
REVOKE ALL ON FUNCTION public.get_order_statement_by_phone(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_statement_by_phone(uuid,text) TO anon,authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
