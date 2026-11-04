import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { linkForOrder, reconcile } from '../_shared/hitpay-links.ts';

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
    const serviceKey = Deno.env.get('HOUZY_SUPABASE_SERVICE_KEY');
    if (!serviceKey) return reply({ error: 'HitPay 服务密钥尚未配置' }, 503);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
    const { data: profile } = await admin.from('profiles').select('id,role,store_id').eq('id', user.id).maybeSingle();
    if (!profile || !['staff','store_manager','regional_manager','general_manager','admin','superadmin'].includes(profile.role)) {
      return reply({ error: '当前账号没有员工后台权限' }, 403);
    }

    const body = await req.json();
    const orderId = String(body.order_id || '');
    if (!orderId) return reply({ error: '缺少订单 ID' }, 400);
    // Read through the caller's own session, so staff only reach orders they may see.
    const { data: visible } = await supabase.from('orders').select('id').eq('id', orderId).maybeSingle();
    if (!visible) return reply({ error: '找不到订单或无权访问' }, 404);
    const key = Deno.env.get('HITPAY_API_KEY');
    if (!key) return reply({ error: 'HitPay API 尚未配置，请先设置后台密钥' }, 503);
    const deps = { admin, key, baseUrl: Deno.env.get('HOUZY_PUBLIC_URL') || 'https://houzyhome.com' };
    // Opening an order only checks for payments; a link is made when staff ask for one.
    if (body.action !== 'link') {
      const checked = await reconcile(orderId, deps);
      return reply({ reconciled: checked.recorded, status: checked.fullyPaid ? 'completed' : undefined });
    }
    const out: Record<string, any> = await linkForOrder(orderId, 'staff', profile.id, deps);
    if (out.payable && body.seq != null && Number(body.seq) !== out.seq) {
      return reply({ error: `请先收第${out.seq}期` }, 409);
    }
    if (!out.payable) return reply({ error: out.message, reason: out.reason, reconciled: out.reconciled, status: out.status }, out.reason === 'paid' ? 200 : 409);
    return reply(out);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : '服务器错误' }, 500);
  }
});
