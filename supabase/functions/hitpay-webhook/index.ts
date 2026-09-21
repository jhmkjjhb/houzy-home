import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const encoder = new TextEncoder();
async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const raw = await req.text();
  const salt = Deno.env.get('HITPAY_SALT');
  const signature = req.headers.get('X-Hitpay-Signature') || req.headers.get('X-HITPAY-SIGNATURE') || '';
  if (!salt || !signature || (await hmacHex(salt, raw)).toLowerCase() !== signature.toLowerCase()) return json({ error: 'Invalid signature' }, 401);
  try {
    const event = JSON.parse(raw);
    const payload = event.data || event;
    const reference = payload.reference_number || payload.reference || payload.order_no;
    const paymentId = payload.payment_request_id || payload.id || payload.payment_id;
    const status = String(payload.status || event.event_type || event.type || '').toLowerCase();
    if (!reference && !paymentId) return json({ ok: true, ignored: true });
    // Supabase reserves the SUPABASE_* secret prefix, so the service key is
    // stored under our own name in Edge Function secrets.
    const serviceKey = Deno.env.get('HOUZY_SUPABASE_SERVICE_KEY');
    if (!serviceKey) return json({ error: 'Webhook service key is not configured' }, 503);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
    let query = admin.from('orders').select('id,payment_status,status,amount,hitpay_payment_id').limit(1);
    query = reference ? query.eq('order_no', reference) : query.eq('hitpay_payment_id', paymentId);
    const { data: rows, error } = await query;
    const order = rows?.[0];
    if (error || !order) return json({ ok: true, ignored: true });
    const completed = ['completed', 'paid', 'succeeded', 'success'].includes(status) || event.event_type === 'payment_request.completed';
    const update: Record<string, unknown> = { hitpay_status: status || 'received' };
    if (paymentId) update.hitpay_payment_id = paymentId;
    if (completed) { update.hitpay_status = 'completed'; update.hitpay_paid_at = new Date().toISOString(); update.payment_status = 'paid'; update.payment_method = 'hitpay'; if (order.status === 'pending_payment') update.status = 'paid'; }
    await admin.from('orders').update(update).eq('id', order.id);
    return json({ ok: true });
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid payload' }, 400); }
});
