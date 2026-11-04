import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { closeLinks } from '../_shared/hitpay-links.ts';

const cors = { 'Access-Control-Allow-Origin': 'https://houzyhome.com', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

// Called by pg_cron, and by the staff page right after an extension. It reads no input and only brings
// HitPay in line with deadlines already set, so a stranger calling it can only make that happen early.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const serviceKey = Deno.env.get('HOUZY_SUPABASE_SERVICE_KEY'), key = Deno.env.get('HITPAY_API_KEY');
  if (!serviceKey || !key) return new Response(JSON.stringify({ error: 'not configured' }), { status: 503, headers: cors });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
    return new Response(JSON.stringify(await closeLinks({ admin, key, baseUrl: '' })), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('[hitpay-close-links]', error);
    return new Response(JSON.stringify({ error: 'failed' }), { status: 500, headers: cors });
  }
});
