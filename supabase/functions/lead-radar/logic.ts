// Pure helpers for the lead radar. No network or Deno APIs, so Node tests can import them.

export type SearchHit = { url: string; title: string; description: string; query: string };
export type Classification = {
  id: string; label: 'demand' | 'ad' | 'irrelevant' | 'out_of_area'; score: number; confidence: number;
  service: 'full_house' | 'kitchen' | 'wardrobe' | 'bathroom' | 'aluminium' | 'other'; area: string; lang: string;
  keywords: string[]; reason: string; reply: string; invites_contact: boolean;
};

const TRACKING = /^(utm_|fbclid$|gclid$|igsh$|igshid$|si$|ref$|mibextid$|rdid$|share_url$|__cft__|__tn__)/;

// One post can surface under several queries, hosts and tracking parameters; collapse them.
export function urlKey(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  let host = u.hostname.toLowerCase().replace(/^(www|m|mobile|web|old)\./, '');
  if (host === 'fb.com') host = 'facebook.com';
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : '';
  const path = u.pathname.replace(/\/+$/, '') || '/';
  return host + path + query;
}

export function platformOf(raw: string): string {
  const key = urlKey(raw) || '';
  const host = key.split('/')[0];
  if (host.endsWith('facebook.com')) return key.includes('/groups/') ? 'facebook_group' : 'facebook';
  for (const p of ['instagram', 'threads', 'tiktok', 'reddit', 'xiaohongshu', 'lowyat', 'youtube']) if (host.includes(p)) return p;
  return 'web';
}

// Search snippets often start with the engine's own date ("6 days ago · ..."). Keep it as a hint only.
export function publishedHint(text: string): string | null {
  const m = String(text || '').match(/^\s*((?:\d{1,2}|an?|one)\s+(?:minute|hour|day|week|month)s?\s+ago|\d{1,2}\s*(?:天|小时|周|个月)前|(?:\d{1,2}\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?|\d{4}-\d{2}-\d{2})\s*[·\-–]/i);
  return m ? m[1].trim() : null;
}

// Malaysian mobile numbers written in a post, normalised to +60. Returns the first one only.
export function malaysianMobile(text: string): string | null {
  const s = String(text || '').replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  const m = s.match(/(?:\+?6?0)?1[0-9][\s.-]?\d{3,4}[\s.-]?\d{4}/);
  if (!m) return null;
  const digits = m[0].replace(/\D/g, '').replace(/^60/, '').replace(/^0/, '');
  return /^1\d{8,9}$/.test(digits) ? '+60' + digits : null;
}

export function waLink(phone: string, tag: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi HOUZY, I saw your reply [${tag}]`)}`;
}

export const CLASSIFY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'label', 'score', 'confidence', 'service', 'area', 'lang', 'keywords', 'reason', 'reply', 'invites_contact'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string', enum: ['demand', 'ad', 'irrelevant', 'out_of_area'] },
          score: { type: 'integer' }, confidence: { type: 'number' },
          service: { type: 'string', enum: ['full_house', 'kitchen', 'wardrobe', 'bathroom', 'aluminium', 'other'] },
          area: { type: 'string' }, lang: { type: 'string', enum: ['en', 'zh', 'ms', 'other'] },
          keywords: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' }, reply: { type: 'string' }, invites_contact: { type: 'boolean' },
        },
      },
    },
  },
};

export const SYSTEM_PROMPT = `You triage public posts for HOUZY HOME, a renovation and custom cabinet company in Johor Bahru (JB), Malaysia, with a store in Singapore.
Services: full-house renovation, kitchen cabinets, wardrobes, bathroom renovation and vanities, aluminium cabinets, tiles and fittings.
For each post decide:
- label "demand": a homeowner, buyer or tenant is looking for someone to do renovation or cabinet work in Johor (JB, Iskandar Puteri, Skudai, Tebrau, Mount Austin, Pasir Gudang, Kulai, etc.), including Singapore residents renovating a Johor property.
- label "ad": a contractor, supplier, designer or agent promoting their own service, even if it says "looking for customers" or "recommendations wanted".
- label "out_of_area": a real renovation need outside Johor.
- label "irrelevant": anything else (influencer collaborations, jobs, news, general tips).
Search snippets often mix a thread's original question with replies, and a page title may come from a contractor's reply or post. If any part of the text shows a homeowner asking for this kind of work in Johor, label "demand" and say in the reason that the request is in the thread or comments.
score 0-100 = how likely HOUZY could win this job soon (explicit need, scope, timing and budget raise it; vague or old posts lower it). Non-demand posts score below 20.
confidence 0-1 = how sure you are of the label from the text given.
area: the Johor area named, or "" if none. keywords: up to 5 short phrases in the post's own language that describe the need.
reason: one sentence in Simplified Chinese explaining the label for HOUZY staff.
invites_contact: true only if the poster explicitly asks contractors to message or call them (e.g. "WhatsApp me", "PM me your quote", "contact me at"); false whenever the request sits in a thread or comments with other people's text, because any number there may belong to someone else.
reply: for "demand" only, a short friendly public reply in the post's language from HOUZY HOME, offering a free site measurement; do not invent prices, projects or promotions; do not include any phone number or link (one is appended). For other labels, "".
Use only the given text. Never invent details.`;

export function buildUserInput(items: { id: string; title: string; snippet: string; platform: string }[]): string {
  return JSON.stringify(items.map(i => ({ id: i.id, platform: i.platform, title: i.title.slice(0, 300), text: i.snippet.slice(0, 1200) })));
}

// The model's output is untrusted: keep only known ids and clamp every field to what the table accepts.
export function parseClassifications(raw: unknown, ids: Set<string>): Classification[] {
  const list = (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)) ? (raw as { items: unknown[] }).items : [];
  const out: Classification[] = [];
  const seen = new Set<string>();
  const labels = ['demand', 'ad', 'irrelevant', 'out_of_area'], services = ['full_house', 'kitchen', 'wardrobe', 'bathroom', 'aluminium', 'other'];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const id = String(r.id ?? '');
    if (!ids.has(id) || seen.has(id) || !labels.includes(String(r.label))) continue;
    seen.add(id);
    const label = String(r.label) as Classification['label'];
    const score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)));
    out.push({
      id, label,
      score: label === 'demand' ? score : Math.min(score, 19),
      confidence: Math.max(0, Math.min(1, Math.round((Number(r.confidence) || 0) * 100) / 100)),
      service: (services.includes(String(r.service)) ? String(r.service) : 'other') as Classification['service'],
      area: String(r.area ?? '').slice(0, 80), lang: String(r.lang ?? '').slice(0, 10),
      keywords: (Array.isArray(r.keywords) ? r.keywords : []).map(k => String(k).trim().slice(0, 40)).filter(Boolean).slice(0, 5),
      reason: String(r.reason ?? '').slice(0, 300),
      reply: label === 'demand' ? String(r.reply ?? '').slice(0, 800) : '',
      invites_contact: label === 'demand' && r.invites_contact === true,
    });
  }
  return out;
}

// Responses API: the JSON text sits in output[].content[] items of type "output_text".
export function responseText(body: unknown): string {
  const b = body as { output_text?: unknown; output?: { content?: { type?: string; text?: string }[] }[] };
  if (typeof b?.output_text === 'string') return b.output_text;
  for (const o of b?.output || []) for (const c of o.content || []) if (c.type === 'output_text' && typeof c.text === 'string') return c.text;
  return '';
}
