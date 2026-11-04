// Shared by the staff and customer payment functions, so both hand out the same link.
export const COMPLETED = ['completed', 'paid', 'succeeded', 'success'];
export const MAX_LINKS_PER_DAY = 10;
const METHOD_SETS = [
  ['card', 'duitnow', 'fpx', 'grabpay', 'shopee_pay', 'wechat_pay', 'razer_maybankqr'],
  ['card', 'duitnow', 'fpx', 'grabpay'],
  ['card', 'duitnow', 'fpx'],
  ['card', 'duitnow'],
  ['card'],
];
const API = 'https://api.hit-pay.com/v1/payment-requests';
const REASONS: Record<string, string> = {
  paid: '这笔订单已付清', closed: '订单已取消或关闭，不能付款', currency: '在线付款目前只支持马币（MYR）订单',
  invalid_amount: '订单金额无效', pending_verify: '有一笔现金正等店长核对，核对后才能继续付款',
  review: '有一笔付款金额不符，正等店长核对', not_found: '找不到订单',
};
export const reasonText = (reason: string) => REASONS[reason] || '现在不能付款';

type Deps = { admin: any; key: string; fetchFn?: typeof fetch; baseUrl: string };

// Webhooks can be delayed, so check HitPay directly before handing out a link.
export async function reconcile(orderId: string, { admin, key, fetchFn = fetch }: Deps) {
  const { data: open, error } = await admin.rpc('hitpay_open_links', { p_order: orderId });
  if (error) throw new Error(error.message);
  let recorded = false, fullyPaid = false;
  for (const id of (open || [])) {
    try {
      const r = await fetchFn(`${API}/${encodeURIComponent(id)}`, { headers: { 'X-BUSINESS-API-KEY': key, 'X-Requested-With': 'XMLHttpRequest' } });
      const body = await r.json();
      const status = String(body.status || body.payment_request?.status || body.data?.status || '').toLowerCase();
      if (!r.ok || !COMPLETED.includes(status)) continue;
      const amount = body.amount ?? body.payment_request?.amount ?? body.data?.amount ?? null;
      const { data: saved, error: saveError } = await admin.rpc('hitpay_record_payment', { p_request: id, p_reference: null, p_amount: amount == null ? null : Number(amount) });
      if (saveError) throw new Error(saveError.message);
      if (saved?.result === 'recorded') { recorded = true; fullyPaid = fullyPaid || !!saved.fully_paid; }
    } catch (e) {
      if (e instanceof Error && !(e instanceof TypeError)) throw e; // our own failure, not a network blip
    }
  }
  return { recorded, fullyPaid };
}

export async function linkForOrder(orderId: string, source: 'staff' | 'customer', actor: string | null, deps: Deps) {
  const { admin, key, fetchFn = fetch, baseUrl } = deps;
  const checked = await reconcile(orderId, deps);
  const { data: q, error } = await admin.rpc('hitpay_link_prepare', { p_order: orderId });
  if (error) throw new Error(error.message);
  if (!q?.payable) return { payable: false, reason: q?.reason, message: reasonText(q?.reason), reconciled: checked.recorded, status: checked.fullyPaid || q?.reason === 'paid' ? 'completed' : undefined };
  const quote = { payable: true, seq: q.seq, installments: q.installments, amount: q.amount, customer_phone: q.customer_phone, reconciled: checked.recorded };
  if (q.link) return { ...quote, payment_url: q.link.payment_url, payment_id: q.link.payment_request_id, reused: true };
  if (q.links_today >= MAX_LINKS_PER_DAY) return { payable: false, reason: 'too_many', message: '今天生成付款链接次数太多，请联系门店' };
  let result: any = {}, ok = false;
  for (const payment_methods of METHOD_SETS) {
    const r = await fetchFn(API, {
      method: 'POST',
      headers: { 'X-BUSINESS-API-KEY': key, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({
        amount: Number(q.amount).toFixed(2), currency: 'MYR', payment_methods,
        email: (globalThis as any).Deno?.env.get('HITPAY_RECEIPT_EMAIL') || 'hello@houzyhome.com',
        reference_number: q.order_no,
        purpose: q.description || `HOUZY HOME 订单 ${q.order_no}`,
        name: q.customer_name || undefined, phone: q.customer_phone || undefined,
        // Goes to the customer page for everyone: a shared link may be opened by a customer.
        redirect_url: `${baseUrl}/portal/customer.html?hitpay=return`,
      }),
    });
    result = await r.json();
    ok = r.ok && result.url;
    if (ok) break;
  }
  if (!ok) throw new Error(`${result.message || 'HitPay 创建付款链接失败'}${result.errors ? ` ${JSON.stringify(result.errors)}` : ''}`);
  const requestId = result.id || result.payment_request_id;
  const { data: saved, error: saveError } = await admin.rpc('hitpay_link_save', { p_order: orderId, p_seq: q.seq, p_pct: q.pct, p_amount: q.amount, p_request: requestId, p_url: result.url, p_source: source, p_actor: actor });
  if (saveError) throw new Error(`付款链接已生成，但保存失败：${saveError.message}`);
  return { ...quote, payment_url: saved.payment_url, payment_id: saved.payment_request_id };
}
