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

    // Use the server key only after validating the caller's Supabase session.
    // This avoids RLS/session-header inconsistencies inside Edge Functions
    // while still limiting access to approved staff accounts.
    const serviceKey = Deno.env.get('HOUZY_SUPABASE_SERVICE_KEY');
    const admin = serviceKey
      ? createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)
      : supabase;
    const { data: profile } = await admin.from('profiles').select('id,role,store_id').eq('id', user.id).maybeSingle();
    if (!profile || !['staff','store_manager','regional_manager','general_manager','admin','superadmin'].includes(profile.role)) {
      return reply({ error: '当前账号没有员工后台权限' }, 403);
    }

    const body = await req.json();
    const orderId = String(body.order_id || '');
    if (!orderId) return reply({ error: '缺少订单 ID' }, 400);
    // Read the order first, then read the customer separately. A nested
    // customers(...) relationship can be blocked by a separate RLS policy
    // even when the staff member can read the order itself.
    const { data: order, error: orderError } = await admin.from('orders').select('id,order_no,customer_id,store_id,amount,description,status,hitpay_payment_id,hitpay_payment_url,hitpay_status').eq('id', orderId).single();
    if (orderError || !order) {
      const reason = orderError?.message ? `（${orderError.message}）` : '';
      return reply({ error: `找不到订单或无权访问${reason}` }, 404);
    }
    const key = Deno.env.get('HITPAY_API_KEY');
    if (!key) return reply({ error: 'HitPay API 尚未配置，请先设置后台密钥' }, 503);
    if (order.hitpay_payment_url && order.hitpay_status !== 'failed') {
      // Webhooks can be delayed or retried. Reconcile an existing link when a
      // staff member opens it so an already-paid order is not shown as due.
      if (['completed', 'paid', 'succeeded', 'success'].includes(String(order.hitpay_status || '').toLowerCase())) {
        // Do not rewrite the row on every page refresh: that would emit a
        // realtime UPDATE repeatedly and make the mobile page flash/jump.
        if (order.payment_status !== 'paid' || order.status !== 'paid') {
          await admin.from('orders').update({ payment_status: 'paid', hitpay_status: 'completed', hitpay_paid_at: new Date().toISOString(), status: 'paid' }).eq('id', order.id);
        }
        return reply({ payment_url: order.hitpay_payment_url, payment_id: order.hitpay_payment_id, status: 'completed', reconciled: true });
      }
      if (order.hitpay_payment_id) {
        try {
          const statusResponse = await fetch(`https://api.hit-pay.com/v1/payment-requests/${encodeURIComponent(order.hitpay_payment_id)}`, { headers: { 'X-BUSINESS-API-KEY': key } });
          const statusResult = await statusResponse.json();
          const remoteStatus = String(
            statusResult.status || statusResult.payment_request?.status || statusResult.data?.status || ''
          ).toLowerCase();
          if (statusResponse.ok && ['completed', 'paid', 'succeeded', 'success'].includes(remoteStatus)) {
            await admin.from('orders').update({ hitpay_status: 'completed', hitpay_paid_at: new Date().toISOString(), payment_status: 'paid', status: 'paid' }).eq('id', order.id);
            return reply({ payment_url: order.hitpay_payment_url, payment_id: order.hitpay_payment_id, status: 'completed', reconciled: true });
          }
        } catch (_) { /* webhook remains the primary confirmation path */ }
      }
      return reply({ payment_url: order.hitpay_payment_url, payment_id: order.hitpay_payment_id, reused: true });
    }

    const amount = Number(order.amount);
    // HOUZY OMS orders are currently priced in Malaysian Ringgit; the
    // legacy orders table has no currency column, so use MYR explicitly.
    const currency = 'MYR';
    if (!Number.isFinite(amount) || amount <= 0) return reply({ error: '订单金额无效' }, 400);
    if (currency !== 'MYR') return reply({ error: 'HitPay 后台付款链接目前只支持 MYR 订单' }, 400);
    const { data: customer } = order.customer_id
      ? await admin.from('customers').select('name,phone').eq('id', order.customer_id).maybeSingle()
      : { data: null };
    const baseUrl = Deno.env.get('HOUZY_PUBLIC_URL') || 'https://houzyhome.com';
    const methodSets = [
      ['card', 'duitnow', 'fpx', 'grabpay', 'shopee_pay', 'wechat_pay', 'razer_maybankqr'],
      ['card', 'duitnow', 'fpx', 'grabpay'],
      ['card', 'duitnow', 'fpx'],
      ['card', 'duitnow'],
      ['card'],
    ];
    let hitpay: Response | null = null;
    let result: Record<string, any> = {};
    for (const payment_methods of methodSets) {
      hitpay = await fetch('https://api.hit-pay.com/v1/payment-requests', {
        method: 'POST',
        headers: { 'X-BUSINESS-API-KEY': key, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({
          amount: amount.toFixed(2), currency, payment_methods,
          email: Deno.env.get('HITPAY_RECEIPT_EMAIL') || 'hello@houzyhome.com',
          reference_number: order.order_no,
          purpose: order.description || `HOUZY HOME 订单 ${order.order_no}`,
          name: customer?.name || undefined,
          phone: customer?.phone || undefined,
          redirect_url: `${baseUrl}/portal/staff.html?hitpay=success&order=${encodeURIComponent(order.id)}`,
        }),
      });
      result = await hitpay.json();
      if (hitpay.ok && result.url) break;
    }
    if (!hitpay.ok || !result.url) {
      const details = result.errors ? ` ${JSON.stringify(result.errors)}` : '';
      return reply({ error: `${result.message || 'HitPay 创建付款链接失败'}${details}` }, 502);
    }
    const update = { hitpay_payment_id: result.id || result.payment_request_id || null, hitpay_reference: order.order_no, hitpay_payment_url: result.url, hitpay_status: result.status || 'pending', hitpay_amount: amount, hitpay_currency: currency, hitpay_created_at: new Date().toISOString() };
    const { error: saveError } = await admin.from('orders').update(update).eq('id', order.id);
    if (saveError) return reply({ error: `付款链接已生成，但订单保存失败：${saveError.message}`, payment_url: result.url }, 500);
    return reply({ payment_url: result.url, payment_id: update.hitpay_payment_id, status: update.hitpay_status });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : '服务器错误' }, 500);
  }
});
