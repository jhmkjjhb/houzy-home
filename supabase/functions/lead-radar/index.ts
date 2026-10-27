// Lead radar run: search public posts, keep new ones, classify them, store results.
// Triggered daily by pg_cron (x-radar-secret) or manually by a general manager (user JWT).
// Deploy with verify_jwt disabled: this function authenticates both callers itself.
import { CLASSIFY_SCHEMA, SYSTEM_PROMPT, buildUserInput, malaysianMobile, parseClassifications, platformOf, publishedHint, responseText, urlKey, waLink, type SearchHit } from './logic.ts';

const origins = new Set(['https://houzyhome.com', 'https://www.houzyhome.com']);
const env = (k: string) => Deno.env.get(k) || '';
// Tests set RADAR_RETRY_SCALE=0 so rate-limit waits do not slow them down.
const retryScale = env('RADAR_RETRY_SCALE') === '0' ? 0 : 1;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const cors: Record<string, string> = { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Vary': 'Origin', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
  if (origin && origins.has(origin)) cors['Access-Control-Allow-Origin'] = origin;
  const started = Date.now();
  const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: cors });
  if (origin && !origins.has(origin)) return reply(403, { error: '不允许的访问来源' });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply(405, { error: '仅接受POST请求' });

  const base = env('SUPABASE_URL'), service = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !service) return reply(503, { error: '雷达服务未配置数据库' });
  const rest = (path: string, init: RequestInit = {}, key = service, bearer = service) =>
    fetch(new URL('/rest/v1/' + path, base), { ...init, headers: { apikey: key, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(15000) });

  // Who is calling: the scheduler with its secret, or a signed-in manager.
  let trigger: 'schedule' | 'manual', triggeredBy: string | null = null;
  const secret = env('RADAR_CRON_SECRET');
  if (secret && req.headers.get('x-radar-secret') === secret) trigger = 'schedule';
  else {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const anon = env('SUPABASE_ANON_KEY');
    if (!token || !anon) return reply(401, { error: '请登录后再运行' });
    const can = await rest('rpc/lead_radar_can_run', { method: 'POST', body: '{}' }, anon, token).catch(() => null);
    if (!can?.ok || (await can.json()) !== true) return reply(403, { error: '只有总经理或管理员可以手动运行雷达' });
    const user = await fetch(new URL('/auth/v1/user', base), { headers: { apikey: anon, Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null).catch(() => null);
    trigger = 'manual'; triggeredBy = typeof user?.id === 'string' ? user.id : null;
  }
  const firecrawl = env('FIRECRAWL_API_KEY'), openai = env('OPENAI_API_KEY');
  if (!firecrawl || !openai) return reply(503, { error: '雷达尚未配置 Firecrawl 或 OpenAI 密钥' });

  // One run at a time: a second trigger within 15 minutes is refused, not doubled (each run costs credits).
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const busy = await rest(`lead_radar_runs?select=id&status=eq.running&started_at=gte.${encodeURIComponent(since)}&limit=1`).then(r => r.ok ? r.json() : []);
  if (Array.isArray(busy) && busy.length) return reply(409, { error: '雷达正在运行，请稍后再试' });
  // {"mode":"classify"} skips searching and only analyses posts left pending (the scheduler sends it after the main run).
  const classifyOnly = (await req.json().catch(() => ({})))?.mode === 'classify';
  const created = await rest('lead_radar_runs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ trigger, triggered_by: triggeredBy }) });
  if (!created.ok) return reply(503, { error: '无法创建运行记录' });
  const run = (await created.json())[0];
  const errors: { step: string; detail: string }[] = [];
  const stats = { queries_run: 0, results_seen: 0, new_items: 0, demand_items: 0, search_credits: 0, ai_input_tokens: 0, ai_output_tokens: 0 };

  // Edge Functions are stopped at 150 s on the free plan: stop starting new work before that and leave the rest for the next run.
  const deadline = started + (Number(env('RADAR_TIME_BUDGET')) || 120) * 1000, left = () => deadline - Date.now();
  try {
    const maxQueries = Math.max(1, Math.min(50, Number(env('RADAR_MAX_QUERIES')) || 25));
    const queries: { query: string }[] = await rest(`lead_radar_queries?select=query&active=is.true&order=created_at&limit=${maxQueries}`).then(r => r.ok ? r.json() : []);
    // Shuffled so that, when time runs short, a different set of keywords is skipped each day.
    for (let i = queries.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [queries[i], queries[j]] = [queries[j], queries[i]]; }
    const hits = new Map<string, SearchHit>();
    // Edge Functions have a wall-clock limit, so searches run five at a time.
    const search = async (q: { query: string }) => {
      try {
        let res: Response;
        // Rate limited (HTTP 429, e.g. on the free plan): wait as told, up to 30 s, and try again twice.
        for (let attempt = 0; ; attempt++) {
          res = await fetch('https://api.firecrawl.dev/v2/search', {
            method: 'POST', headers: { Authorization: `Bearer ${firecrawl}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: q.query, limit: 10, tbs: 'qdr:w', country: 'MY', sources: ['web'] }), signal: AbortSignal.timeout(60000),
          });
          if (res.status !== 429 || attempt >= 2) break;
          const wait = Math.min(30, Math.max(1, Number(res.headers.get('retry-after')) || 10 * (attempt + 1)));
          if (wait * 1000 * retryScale > left() - 20000) break;
          await new Promise(r => setTimeout(r, wait * 1000 * retryScale));
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        stats.queries_run++; stats.search_credits += Number(body?.creditsUsed) || 0;
        for (const w of body?.data?.web || []) {
          const key = urlKey(String(w?.url || ''));
          if (!key) continue;
          stats.results_seen++;
          if (!hits.has(key)) hits.set(key, { url: String(w.url), title: String(w.title || ''), description: String(w.description || ''), query: q.query });
        }
      } catch (e) { errors.push({ step: 'search', detail: `${q.query}: ${(e as Error).message}`.slice(0, 300) }); }
    };
    for (let i = 0; i < (classifyOnly ? 0 : queries.length); i += 5) {
      if (left() < 20000) { errors.push({ step: 'time', detail: `时间不够，${queries.length - i} 个关键词今天未搜索` }); break; }
      await Promise.all(queries.slice(i, i + 5).map(search));
    }

    // Skip posts already stored by earlier runs.
    const keys = [...hits.keys()], known = new Set<string>();
    for (let i = 0; i < keys.length; i += 50) {
      const list = keys.slice(i, i + 50).map(k => `"${k.replace(/"/g, '\\"')}"`).join(',');
      const rows = await rest(`lead_radar_items?select=url_key&url_key=in.(${encodeURIComponent(list)})`).then(r => r.ok ? r.json() : []);
      for (const r of rows) known.add(r.url_key);
    }
    const fresh = keys.filter(k => !known.has(k)).map(k => {
      const h = hits.get(k)!;
      return { url: h.url, url_key: k, title: h.title.slice(0, 500), snippet: h.description.slice(0, 2000), platform: platformOf(h.url), query: h.query, run_id: run.id, published_hint: publishedHint(h.description), date_verified: !!publishedHint(h.description) };
    });
    if (fresh.length) {
      const ins = await rest('lead_radar_items?on_conflict=url_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(fresh) });
      if (!ins.ok) throw new Error('保存新帖子失败 HTTP ' + ins.status);
      stats.new_items = fresh.length;
    }

    // Classify everything still pending (this run's posts plus any an earlier AI failure left behind).
    const pending: { id: string; title: string; snippet: string; platform: string }[] = await rest('lead_radar_items?select=id,title,snippet,platform&label=eq.pending&order=found_at.desc&limit=120').then(r => r.ok ? r.json() : []);
    const model = env('OPENAI_MODEL') || 'gpt-6-luna', phone = env('HOUZY_WHATSAPP') || '60105898786';
    const classify = async (batch: typeof pending) => {
      try {
        const res = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST', headers: { Authorization: `Bearer ${openai}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(Math.max(5000, Math.min(90000, left() + 20000))),
          body: JSON.stringify({ model, input: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildUserInput(batch) }], text: { format: { type: 'json_schema', name: 'lead_triage', schema: CLASSIFY_SCHEMA, strict: true } } }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
        const body = await res.json();
        stats.ai_input_tokens += Number(body?.usage?.input_tokens) || 0; stats.ai_output_tokens += Number(body?.usage?.output_tokens) || 0;
        const results = parseClassifications(JSON.parse(responseText(body) || '{}'), new Set(batch.map(b => b.id)));
        for (const c of results) {
          const post = batch.find(b => b.id === c.id)!;
          // The number is taken from the post text itself, never from the model, and kept only when the poster invited contact.
          const posted = c.invites_contact ? malaysianMobile(post.title + ' ' + post.snippet) : null;
          const patch = { label: c.label, score: c.score, confidence: c.confidence, service: c.label === 'demand' ? c.service : null, area: c.area || null, lang: c.lang || null, keywords: c.keywords, reason: c.reason,
            suggested_reply: c.label === 'demand' && c.reply ? `${c.reply} ${waLink(phone, 'Radar-' + c.id.slice(0, 6))}` : null,
            invites_contact: !!posted, posted_contact: posted, analyzed_at: new Date().toISOString(), model };
          const up = await rest(`lead_radar_items?id=eq.${c.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
          if (!up.ok) errors.push({ step: 'save', detail: `${c.id}: HTTP ${up.status}` });
          else if (c.label === 'demand') stats.demand_items++;
        }
        if (results.length < batch.length) errors.push({ step: 'classify', detail: `${batch.length - results.length} 条未返回有效结果，下次运行重试` });
      } catch (e) { errors.push({ step: 'classify', detail: (e as Error).message.slice(0, 300) }); }
    };
    const batches: (typeof pending)[] = [];
    for (let i = 0; i < pending.length; i += 15) batches.push(pending.slice(i, i + 15));
    for (let i = 0; i < batches.length; i += 3) {
      if (left() < 30000) { errors.push({ step: 'time', detail: '时间不够，其余帖子留待下次分析' }); break; }
      await Promise.all(batches.slice(i, i + 3).map(classify));
    }
    await rest('rpc/lead_radar_purge', { method: 'POST', body: '{}' }).catch(() => null);
  } catch (e) { errors.push({ step: 'run', detail: (e as Error).message.slice(0, 300) }); }

  const status = !errors.length ? 'ok' : stats.queries_run || (classifyOnly && stats.ai_output_tokens) ? 'partial' : 'failed';
  await rest(`lead_radar_runs?id=eq.${run.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...stats, status, errors, finished_at: new Date().toISOString() }) }).catch(() => null);
  return reply(status === 'failed' ? 502 : 200, { run_id: run.id, status, ...stats, errors });
});
