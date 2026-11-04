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
    const completed = ['completed', 'paid', 'succeeded', 'success'].includes(status) || event.event_type === 'payment_request.completed';
    if (completed) {
      // The database checks the amount against what is due, and ignores a repeat of the same event.
      const amount = payload.amount ?? null;
      const { error } = await admin.rpc('hitpay_record_payment', { p_request: paymentId || null, p_reference: reference || null, p_amount: amount == null ? null : Number(amount) });
      if (error) return json({ error: error.message }, 500); // HitPay retries
    } else if (paymentId && ['failed', 'expired', 'canceled', 'cancelled'].includes(status)) {
      await admin.from('order_payment_links').update({ status: 'failed' }).eq('payment_request_id', paymentId).eq('status', 'open');
    }
    return json({ ok: true });
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid payload' }, 400); }
});
