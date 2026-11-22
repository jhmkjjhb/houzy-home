// Supplier-specific cost quote links and staff-side comparison.
// Deploy with --no-verify-jwt: supplier links are authenticated by one-time
// random tokens; staff actions still require an active manager session.
const env = (name: string) => Deno.env.get(name) || '';
const origins = new Set(['https://houzyhome.com', 'https://www.houzyhome.com', 'http://localhost:8799', 'http://127.0.0.1:8799']);
const encoder = new TextEncoder();
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
const safe = (v: unknown, max = 160) => String(v ?? '').trim().slice(0, max);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const headers: Record<string, string> = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'Vary': 'Origin' };
  if (origin && origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers });
  if (origin && !origins.has(origin)) return reply(403, { error: '不允许的访问来源' });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const base = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY'), service = env('HOUZY_SUPABASE_SERVICE_KEY');
  if (!base || !anon || !service) return reply(503, { error: '报价服务尚未配置' });
  const db = async (path: string, init: RequestInit = {}) => fetch(`${base}/rest/v1/${path}`, { ...init, headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const token = safe(req.method === 'GET' ? new URL(req.url).searchParams.get('token') : body.token, 300);

  // Supplier endpoint: expose only the assigned item list, never any competing bid.
  if (token && (req.method === 'GET' || body.action === 'submit')) {
    const tokenHash = await hash(token);
    const r = await db(`supplier_price_invites?token_hash=eq.${tokenHash}&select=id,supplier_name,status,round_id,quote,note,validity`);
    const invites = r.ok ? await r.json() : [];
    const invite = invites[0];
    if (!invite || invite.status === 'withdrawn') return reply(404, { error: '链接无效或已撤回，请联系 HOUZY HOME。' });
    const rr = await db(`supplier_price_rounds?id=eq.${invite.round_id}&select=id,title,trade,status,items,closes_at`);
    const round = rr.ok ? (await rr.json())[0] : null;
    if (!round) return reply(404, { error: '询价单不存在或已关闭。' });
    if (req.method === 'GET') return reply(200, { supplier: invite.supplier_name, status: invite.status, round: { title: round.title, trade: round.trade, status: round.status, items: round.items, closes_at: round.closes_at }, quote: invite.quote, note: invite.note, validity: invite.validity });
    if (round.status !== 'open' || (round.closes_at && Date.now() > Date.parse(round.closes_at))) return reply(409, { error: '此询价单已截止，无法修改报价。' });
    const incoming = Array.isArray(body.quote) ? body.quote : [];
    const allowed = new Set((round.items || []).map((x: any) => x.id));
    if (incoming.length > allowed.size || incoming.some((x: any) => !allowed.has(x.id)) || new Set(incoming.map((x: any) => x.id)).size !== incoming.length) return reply(400, { error: '报价项目与询价单不一致，请重新打开链接。' });
    let quote: any[];
    try {
      quote = incoming.map((x: any) => {
        const vals = ['material', 'auxiliary', 'labour', 'waste'].map(k => x[k] === '' || x[k] == null ? null : Number(x[k]));
        if (vals.some(v => v !== null && (!Number.isFinite(v) || v < 0))) throw new Error('报价必须为非负数字');
        return { id: x.id, material: vals[0], auxiliary: vals[1], labour: vals[2], waste: vals[3] };
      });
    } catch { return reply(400, { error: '报价必须为有效的非负数字。' }); }
    if (!quote.some((x: any) => x.material != null || x.auxiliary != null || x.labour != null)) return reply(400, { error: '请至少填写一个项目的成本价。' });
    const validity = safe(body.validity, 80), note = safe(body.note, 1200);
    const up = await db(`supplier_price_invites?id=eq.${invite.id}`, { method: 'PATCH', body: JSON.stringify({ quote, note, validity, status: 'submitted', submitted_at: new Date().toISOString() }) });
    return up.ok ? reply(200, { ok: true, message: '成本报价已提交。' }) : reply(500, { error: '提交失败，请稍后重试。' });
  }

  if (req.method !== 'POST') return reply(405, { error: '方法不支持' });
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!bearer || bearer === anon) return reply(401, { error: '请先登录员工账号。' });
  const who = await fetch(`${base}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${bearer}` } }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!who?.id) return reply(401, { error: '登录已过期，请重新登录。' });
  const level = await fetch(`${base}/rest/v1/rpc/auth_user_level`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.ok ? r.json() : 0).catch(() => 0);
  if (Number(level) < 4) return reply(403, { error: '供应商成本比价仅限管理人员访问。' });
  const action = safe(body.action, 30);

  if (action === 'create') {
    const title = safe(body.title, 100), trade = safe(body.trade, 80);
    const items = Array.isArray(body.items) ? body.items.slice(0, 600) : [];
    const suppliers = Array.isArray(body.suppliers) ? body.suppliers.slice(0, 30) : [];
    if (!title || !trade || !items.length || !suppliers.length) return reply(400, { error: '请填写询价名称、工种、项目和供应商。' });
    if (items.some((x: any) => !safe(x.id, 240) || !safe(x.name, 240) || !safe(x.unit, 60))) return reply(400, { error: '询价项目缺少编号、名称或单位。' });
    if (suppliers.some((x: any) => !safe(x, 100))) return reply(400, { error: '供应商名称不能为空。' });
    const created = await db('supplier_price_rounds?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ title, trade, items, created_by: who.id, closes_at: body.closes_at || null }) });
    if (!created.ok) return reply(500, { error: '创建询价单失败。' });
    const round = (await created.json())[0], issued = [];
    for (const supplier of [...new Set(suppliers.map((x: string) => safe(x, 100)))]) {
      const raw = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
      const ins = await db('supplier_price_invites', { method: 'POST', body: JSON.stringify({ round_id: round.id, supplier_name: supplier, token_hash: await hash(raw) }) });
      if (!ins.ok) return reply(500, { error: `已建询价单，但创建 ${supplier} 的链接失败。` });
      const appOrigin = origin && origins.has(origin) ? origin : 'https://houzyhome.com';
      issued.push({ supplier, url: `${appOrigin}/portal/supplier-price-quote.html?token=${raw}` });
    }
    return reply(200, { id: round.id, links: issued });
  }
  if (action === 'list') {
    const r = await db('supplier_price_rounds?select=*&order=created_at.desc&limit=100');
    if (!r.ok) return reply(500, { error: '读取询价单失败。' });
    const rounds = await r.json();
    for (const round of rounds) {
      const x = await db(`supplier_price_invites?round_id=eq.${round.id}&select=id,supplier_name,status,quote,note,validity,submitted_at,created_at&order=created_at.asc`);
      round.invites = x.ok ? await x.json() : [];
    }
    return reply(200, { rounds });
  }
  if (action === 'award') {
    const roundId = safe(body.round_id, 50), inviteId = safe(body.invite_id, 50);
    const ir = await db(`supplier_price_invites?id=eq.${inviteId}&round_id=eq.${roundId}&select=id,supplier_name,status,quote`);
    const invite = ir.ok ? (await ir.json())[0] : null;
    const rr = await db(`supplier_price_rounds?id=eq.${roundId}&select=id,status,items`);
    const round = rr.ok ? (await rr.json())[0] : null;
    if (!invite || invite.status !== 'submitted' || !round || round.status !== 'open') return reply(409, { error: '只能从开放询价单的已提交报价中选择供应商。' });
    const info = new Map((round.items || []).map((x: any) => [x.id, x]));
    const rows = (invite.quote || []).filter((q: any) => {
      const item: any = info.get(q.id);
      return item && (item.type === '瓷砖片价' ? q.material != null : q.material != null && q.auxiliary != null && q.labour != null);
    }).map((q: any) => {
      const item: any = info.get(q.id); if (!item) return null;
      return { item_id: q.id, item_type: item.type, item_name: item.name, unit: item.unit, material: q.material ?? 0, auxiliary: q.auxiliary ?? 0, labour: q.labour ?? 0, waste_pct: q.waste ?? 0, supplier_name: invite.supplier_name, source_round_id: roundId, updated_by: who.id, updated_at: new Date().toISOString() };
    }).filter(Boolean);
    if (!rows.length) return reply(400, { error: '该供应商没有可同步的成本项目。' });
    const up = await db('quote_company_costbook?on_conflict=item_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
    if (!up.ok) return reply(500, { error: '同步成本价失败，请稍后重试。' });
    await db(`supplier_price_rounds?id=eq.${roundId}`, { method: 'PATCH', body: JSON.stringify({ status: 'awarded', awarded_invite_id: inviteId }) });
    return reply(200, { ok: true, count: rows.length, skipped: Math.max(0, (round.items || []).length - rows.length), supplier: invite.supplier_name });
  }
  if (action === 'costbook') {
    const r = await db('quote_company_costbook?select=item_id,item_type,item_name,unit,material,auxiliary,labour,waste_pct,supplier_name,updated_at');
    return r.ok ? reply(200, { rows: await r.json() }) : reply(500, { error: '读取成本价目表失败。' });
  }
  return reply(400, { error: '未知操作。' });
});
