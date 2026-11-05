import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { linkForOrder, reconcile } from '../_shared/hitpay-links.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// No login: the same order id + registered phone check as the customer PDF. Neither the caller's
// amount nor any field but those two is read, so the most anyone can do is pay what is due.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json();
    const orderId = String(body.order_id || ''), phone = String(body.phone || '');
    if (!/^[0-9a-f-]{36}$/i.test(orderId) || !phone || phone.length > 50) return reply({ error: '请重新查询订单' }, 400);
    const serviceKey = Deno.env.get('HOUZY_SUPABASE_SERVICE_KEY'), key = Deno.env.get('HITPAY_API_KEY');
    if (!serviceKey || !key) return reply({ error: '在线付款暂未开通，请联系门店' }, 503);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
    const { data: allowed, error } = await admin.rpc('order_customer_payment_quote', { p_order: orderId, p_phone: phone });
    if (error) throw new Error(error.message);
    if (!allowed) return reply({ error: '请重新查询订单' }, 404);
    const deps = { admin, key, baseUrl: Deno.env.get('HOUZY_PUBLIC_URL') || 'https://houzyhome.com' };
    // Opening an order only looks for a payment already made; it never creates a link.
    if (body.action === 'check') {
      const checked = await reconcile(orderId, deps);
      return reply({ reconciled: checked.recorded, status: checked.fullyPaid ? 'completed' : undefined });
    }
    const out = await linkForOrder(orderId, 'customer', null, deps);
    const { customer_phone: _hidden, ...safe } = out as Record<string, unknown>;
    return reply(safe);
  } catch (error) {
    console.error('[hitpay-customer-payment]', error);
    return reply({ error: '暂时无法生成付款页面，请稍后重试或联系门店' }, 500);
  }
});
