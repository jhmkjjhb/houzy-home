import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': 'https://houzyhome.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return reply({ error: '登录已失效，请重新登录后台' }, 401);
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return reply({ error: '没有后台登录权限' }, 401);

    const body = await req.json();
    const orderId = String(body.order_id || '');
    if (!orderId) return reply({ error: '缺少订单 ID' }, 400);
    // Read the order first, then read the customer separately. A nested
    // customers(...) relationship can be blocked by a separate RLS policy
    // even when the staff member can read the order itself.
    const { data: order, error: orderError } = await supabase.from('orders').select('id,order_no,customer_id,amount,currency,description,hitpay_payment_id,hitpay_payment_url,hitpay_status').eq('id', orderId).single();
    if (orderError || !order) return reply({ error: '找不到订单或无权访问' }, 404);
    if (order.hitpay_payment_url && order.hitpay_status !== 'failed') return reply({ payment_url: order.hitpay_payment_url, payment_id: order.hitpay_payment_id, reused: true });

    const amount = Number(order.amount);
    const currency = String(order.currency || 'MYR').toUpperCase();
    if (!Number.isFinite(amount) || amount <= 0) return reply({ error: '订单金额无效' }, 400);
    if (currency !== 'MYR') return reply({ error: 'HitPay 后台付款链接目前只支持 MYR 订单' }, 400);
    const key = Deno.env.get('HITPAY_API_KEY');
    if (!key) return reply({ error: 'HitPay API 尚未配置，请先设置后台密钥' }, 503);

    const { data: customer } = order.customer_id
      ? await supabase.from('customers').select('name,phone').eq('id', order.customer_id).maybeSingle()
      : { data: null };
    const baseUrl = Deno.env.get('HOUZY_PUBLIC_URL') || 'https://houzyhome.com';
    const hitpay = await fetch('https://api.hit-pay.com/v1/payment-requests', {
      method: 'POST',
      headers: { 'X-BUSINESS-API-KEY': key, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({
        amount: amount.toFixed(2), currency,
        // HitPay requires at least one enabled payment method and an email
        // field for hosted payment requests. The checkout page still shows
        // the methods enabled for this Malaysian HitPay account.
        payment_methods: ['card'],
        email: Deno.env.get('HITPAY_RECEIPT_EMAIL') || 'hello@houzyhome.com',
        reference_number: order.order_no,
        purpose: order.description || `HOUZY HOME 订单 ${order.order_no}`,
        name: customer?.name || undefined,
        phone: customer?.phone || undefined,
        redirect_url: `${baseUrl}/portal/staff.html?hitpay=success&order=${encodeURIComponent(order.id)}`,
      }),
    });
    const result = await hitpay.json();
    if (!hitpay.ok || !result.url) {
      const details = result.errors ? ` ${JSON.stringify(result.errors)}` : '';
      return reply({ error: `${result.message || 'HitPay 创建付款链接失败'}${details}` }, 502);
    }
    const update = { hitpay_payment_id: result.id || result.payment_request_id || null, hitpay_reference: order.order_no, hitpay_payment_url: result.url, hitpay_status: result.status || 'pending', hitpay_amount: amount, hitpay_currency: currency, hitpay_created_at: new Date().toISOString() };
    const { error: saveError } = await supabase.from('orders').update(update).eq('id', order.id);
    if (saveError) return reply({ error: `付款链接已生成，但订单保存失败：${saveError.message}`, payment_url: result.url }, 500);
    return reply({ payment_url: result.url, payment_id: update.hitpay_payment_id, status: update.hitpay_status });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : '服务器错误' }, 500);
  }
});
