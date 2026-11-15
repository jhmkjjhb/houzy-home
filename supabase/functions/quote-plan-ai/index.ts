// 报价器「AI 识别平面图」：员工上传的平面图（每层一张 JPEG）交给 Claude 看图，返回房间清单（名称、类型、楼层、长宽尺）。
// 只给已登录、在职的员工用（每次调用要花 API 费用）。结果只是建议，页面上必须员工逐项核对后才加入报价。
// 模型：设了 DEEPSEEK_API_KEY 就用 DeepSeek（deepseek-flash，能看图）；否则用 ANTHROPIC_API_KEY 走 Claude。
// 部署：supabase secrets set DEEPSEEK_API_KEY=...；supabase functions deploy quote-plan-ai --no-verify-jwt
import Anthropic from 'npm:@anthropic-ai/sdk';

const origins = new Set(['https://houzyhome.com', 'https://www.houzyhome.com', 'http://localhost:8799', 'http://127.0.0.1:8799']);
const env = (k: string) => Deno.env.get(k) || '';
const TYPES = ['living', 'dining', 'master', 'bedroom', 'study', 'kitchen', 'bath', 'laundry', 'balcony', 'family', 'store', 'corridor', 'stairs', 'yard', 'extension', 'porch'];
const MAX_IMAGES = 4, MAX_B64 = 6_000_000;

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['rooms', 'notes'],
  properties: {
    rooms: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'type', 'level', 'length_ft', 'width_ft', 'size_source', 'note', 'box'],
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: TYPES },
          level: { type: 'integer' },
          length_ft: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          width_ft: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          size_source: { type: 'string', enum: ['图上标注', '按比例估算', '读不出'] },
          note: { type: 'string' },
          box: { anyOf: [{ type: 'array', items: { type: 'number' } }, { type: 'null' }] }
        }
      }
    },
    notes: { type: 'string' }
  }
};

const SYSTEM = `你是马来西亚柔佛新山一家装修公司的报价助理，负责读住宅平面图（排屋、半独立、独立式、公寓），列出每一个室内外空间，供员工报价时核对。
规则：
- 每张图前面会注明它是第几层。按图上的墙线和文字，把这一层的每个房间都列出来，包括没写名字但明显是房间的空间（按位置和设施判断类型，并在 note 里说明是推断的）。
- type 只能用给定的英文代码：living 客厅、dining 餐厅、master 主卧、bedroom 其他卧室、study 书房、kitchen 厨房（干/湿厨房各算一间）、bath 卫生间、laundry 洗衣区、balcony 阳台、family 家庭厅、store 储物间、corridor 走廊/玄关、stairs 楼梯、yard 后院/侧院/花园、extension 加建部分、porch 车廊/前院。
- name 用图上的原文（如 "BEDROOM 2"、"WET KITCHEN"）；图上没名字就用中文类型名。
- 尺寸一律换算成英尺（ft），保留 1 位小数。本地图纸常用毫米（如 3600 x 3000 = 11.8 x 9.8 ft），也有写英尺英寸的。length_ft 填较长的一边。
- 图上标了这间的尺寸就用标注值，size_source=图上标注；没标但图上有比例尺或整体总尺寸可推算，就估算，size_source=按比例估算；推不出就填 null，size_source=读不出。绝不编造。
- 没有墙隔开的开放空间算一间（例如客厅、餐厅、干厨房连在一起时，合成一间，name 写「客厅 + 餐厅 + 干厨房」，type 用 living，长宽按整个开放空间），在 note 里说明包含哪几块。只有被墙或门隔开的才分开列。
- box 是这间在它那张图上的位置 [左, 上, 右, 下]，都用 0–1 的比例（相对整张图片的宽和高），用于在图上框出房间；看不出就填 null。
- 立面图、剖面图、屋顶图、位置图不列房间，在 notes 里说明。
- notes 用简体中文，一两句话，说明看不清或需要员工到现场复尺的地方。`;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const cors: Record<string, string> = { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Vary': 'Origin', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
  if (origin && origins.has(origin)) cors['Access-Control-Allow-Origin'] = origin;
  const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: cors });
  if (origin && !origins.has(origin)) return reply(403, { error: '不允许的访问来源' });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply(405, { error: '仅接受 POST 请求' });

  // 只有在职员工可以用（_radar_level：profiles 里 active 的员工 ≥ 1）
  const base = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY');
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!base || !anon) return reply(503, { error: '服务未配置数据库' });
  if (!token || token === anon) return reply(401, { error: '请先登录员工后台' });
  const lv = await fetch(new URL('/rest/v1/rpc/_radar_level', base), { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000) })
    .then(r => r.ok ? r.json() : 0).catch(() => 0);
  if (!(Number(lv) >= 1)) return reply(403, { error: '只有在职员工可以使用 AI 识别，请重新登录' });

  const dsKey = env('DEEPSEEK_API_KEY'), key = env('ANTHROPIC_API_KEY');
  if (!dsKey && !key) return reply(503, { error: 'AI 识别还没开通：请在 Supabase 设置 DEEPSEEK_API_KEY' });

  const body = await req.json().catch(() => null);
  const images = Array.isArray(body?.images) ? body.images : [];
  if (!images.length || images.length > MAX_IMAGES) return reply(400, { error: `请上传 1–${MAX_IMAGES} 张平面图` });
  const content: any[] = [];
  for (const im of images) {
    const level = Number(im?.level), data = String(im?.data || '');
    const m = data.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!(level >= 1 && level <= 6) || !m || m[2].length > MAX_B64) return reply(400, { error: '图片格式不对或太大' });
    content.push({ type: 'text', text: `下面这张是第 ${level} 层（${level === 1 ? '底层' : level + ' 楼'}）平面图：` });
    content.push({ type: 'image', source: { type: 'base64', media_type: m[1] as 'image/jpeg' | 'image/png' | 'image/webp', data: m[2] } });
  }
  const house = String(body?.house || '').slice(0, 40);
  content.push({ type: 'text', text: `房屋类型：${house || '未选'}。请列出所有空间。` });

  if (dsKey) return reply(...await deepseek(dsKey, content));

  try {
    const client = new Anthropic({ apiKey: key, timeout: 140_000, maxRetries: 1 });
    const res = await client.beta.messages.create({
      model: env('CLAUDE_PLAN_MODEL') || 'claude-opus-5-5', // 想省钱可设 claude-haiku-5-5
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content }]
    } as any);
    if (res.stop_reason === 'refusal') return reply(422, { error: 'AI 没有处理这张图，请换一张更清楚的平面图' });
    if (res.stop_reason === 'max_tokens') return reply(422, { error: '图太复杂，请一层一层分开识别' });
    const text = (res.content as any[]).filter(b => b.type === 'text').map(b => b.text).join('');
    const out = JSON.parse(text);
    return reply(200, { ...out, engine: 'AI 看图', usage: { input: res.usage?.input_tokens, output: res.usage?.output_tokens } });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return reply(429, { error: 'AI 服务繁忙，请一分钟后再试' });
    if (e instanceof Anthropic.AuthenticationError) return reply(503, { error: 'API Key 不对，请检查 Supabase 里的 ANTHROPIC_API_KEY' });
    if (e instanceof Anthropic.APIConnectionTimeoutError) return reply(504, { error: 'AI 识别超时，请一层一层分开识别' });
    if (e instanceof Anthropic.APIError) return reply(502, { error: 'AI 服务出错，请稍后再试' });
    return reply(500, { error: 'AI 返回的结果读不懂，请再试一次' });
  }
});

// DeepSeek：OpenAI 兼容的 chat/completions，图片用 image_url（data URL），要求只回 JSON
const JSON_SHAPE = `只输出一个 JSON 对象，不要任何其他文字，格式：{"rooms":[{"name":"","type":"","level":1,"length_ft":null,"width_ft":null,"size_source":"图上标注|按比例估算|读不出","note":"","box":[0.1,0.2,0.4,0.5]}],"notes":""}。type 只能是：${TYPES.join('、')}。`;
async function deepseek(apiKey: string, content: any[]): Promise<[number, unknown]> {
  const parts = content.map(c => c.type === 'image'
    ? { type: 'image_url', image_url: { url: `data:${c.source.media_type};base64,${c.source.data}` } }
    : { type: 'text', text: c.text });
  let r: Response;
  try {
    r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(140_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-flash', stream: false, max_tokens: 16000,
        thinking: { type: 'enabled' }, reasoning_effort: 'high',
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYSTEM + '\n' + JSON_SHAPE }, { role: 'user', content: parts }]
      })
    });
  } catch (_) { return [504, { error: 'AI 识别超时，请一层一层分开识别' }]; }
  if (r.status === 401) return [503, { error: 'DeepSeek API Key 不对，请检查 Supabase 里的 DEEPSEEK_API_KEY' }];
  if (r.status === 402) return [503, { error: 'DeepSeek 账户余额不足，请充值' }];
  if (r.status === 429) return [429, { error: 'AI 服务繁忙，请一分钟后再试' }];
  if (!r.ok) return [502, { error: 'AI 服务出错，请稍后再试' }];
  const j = await r.json().catch(() => null), ch = j?.choices?.[0];
  if (ch?.finish_reason === 'length') return [422, { error: '图太复杂，请一层一层分开识别' }];
  let out: any;
  try { out = JSON.parse(String(ch?.message?.content || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (_) { return [500, { error: 'AI 返回的结果读不懂，请再试一次' }]; }
  // 按约定整理字段，类型不认识的丢掉，尺寸不是正数的当作读不出
  const num = (v: unknown) => (typeof v === 'number' && v > 0 && v < 500) ? Math.round(v * 10) / 10 : null;
  const rooms = (Array.isArray(out?.rooms) ? out.rooms : []).filter((x: any) => TYPES.includes(x?.type)).map((x: any) => ({
    name: String(x.name || '').slice(0, 60), type: x.type, level: Math.max(1, Math.min(6, Math.round(Number(x.level) || 1))),
    length_ft: num(x.length_ft), width_ft: num(x.width_ft),
    size_source: ['图上标注', '按比例估算', '读不出'].includes(x.size_source) ? x.size_source : (num(x.length_ft) ? '按比例估算' : '读不出'),
    note: String(x.note || '').slice(0, 200),
    box: Array.isArray(x.box) && x.box.length === 4 && x.box.every((v: unknown) => typeof v === 'number' && v >= 0 && v <= 1) && x.box[2] > x.box[0] && x.box[3] > x.box[1] ? x.box : null
  }));
  return [200, { rooms, notes: String(out?.notes || '').slice(0, 400), engine: 'AI 看图（DeepSeek）', usage: { input: j?.usage?.prompt_tokens, output: j?.usage?.completion_tokens } }];
}
