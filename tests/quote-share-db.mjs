// 报价「发客户看」链接：只有本人能建/停用；客户要手机后 4 位；错 5 次锁；过期/停用打不开；快照里不能有单价
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
await db.exec(`
  CREATE ROLE authenticated; CREATE ROLE anon;
  CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated, anon;
  CREATE TABLE auth.users(id uuid PRIMARY KEY);
  INSERT INTO auth.users(id) VALUES ('${userA}'), ('${userB}');
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION public._is_active_staff(integer) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT auth.uid() IS NOT NULL $$;
`);
const sql = await readFile(new URL('../supabase/quote_share_migration.sql', import.meta.url), 'utf8');
await db.exec(sql); await db.exec(sql); // 可重复执行

const payload = { plans: [{ id: 'A', name: '方案 A', total: 100000, spaces: [{ name: '主卧', price: 30000, items: ['地面', '衣柜'] }], pay: [] }] };
const as = async who => db.exec(who ? `SET ROLE authenticated; SET request.jwt.claim.sub = '${who}';` : `RESET ROLE; SET ROLE anon; SET request.jwt.claim.sub = '';`);
const create = data => db.query('SELECT public.quote_share_create($1::jsonb) AS r', [JSON.stringify(data)]).then(r => r.rows[0].r);
const open = (id, token, code) => db.query('SELECT public.quote_share_open($1,$2,$3) AS r', [id, token, code]).then(r => r.rows[0].r);

await as(null);
await assert.rejects(create({ customer_name: 'X', phone: '0179337628', payload }), /permission denied|login/i, '客户（未登录）不能建链接');

await as(userA);
await assert.rejects(create({ customer_name: 'SANMMAE', phone: '12', payload }), /手机号/);
await assert.rejects(create({ customer_name: 'SANMMAE', phone: '0179337628', payload: { plans: [] } }), /至少选一个方案/);
const s = await create({ customer_name: 'SANMMAE', phone: '017-933 7628', days: 7, payload });
assert.ok(s.id && s.token);
const row = (await db.query('SELECT customer_name, phone_mask FROM public.quote_shares')).rows[0];
assert.equal(row.phone_mask, '017***7628', '员工列表看到的是打码电话');
await assert.rejects(db.query('SELECT phone_last4 FROM public.quote_shares'), /permission denied/, '员工也读不到验证码列');

await as(userB);
assert.equal((await db.query('SELECT count(*)::int n FROM public.quote_shares')).rows[0].n, 0, '别的员工看不到');
await assert.rejects(db.query('SELECT public.quote_share_revoke($1)', [s.id]), /不是你发的/);

await as(null);
await assert.rejects(db.query('SELECT * FROM public.quote_shares'), /permission denied/, '客户不能直接读表');
assert.equal(await open(s.id, '00000000-0000-4000-8000-000000000000', '7628'), null, 'token 不对打不开');
const ok = await open(s.id, s.token, '7628');
assert.equal(ok.status, 'ok'); assert.equal(ok.customer_name, 'SANMMAE'); assert.equal(ok.payload.plans[0].spaces[0].price, 30000);
for (let i = 1; i <= 4; i++) assert.equal((await open(s.id, s.token, '0000')).status, 'bad_code');
assert.equal((await open(s.id, s.token, '0000')).status, 'locked', '错 5 次锁住');
assert.equal((await open(s.id, s.token, '7628')).status, 'locked', '锁住期间对的也不行');
await db.exec('RESET ROLE');
await db.query("UPDATE public.quote_shares SET locked_until = now() - interval '1 minute'");
await as(null);
assert.equal((await open(s.id, s.token, '7628')).status, 'ok', '解锁后能打开');

await db.exec('RESET ROLE');
await db.query("UPDATE public.quote_shares SET expires_at = now() - interval '1 second'");
await as(null);
assert.equal((await open(s.id, s.token, '7628')).status, 'expired', '过期打不开');
await db.exec('RESET ROLE');
await db.query("UPDATE public.quote_shares SET expires_at = now() + interval '1 day'");
await as(userA);
assert.equal((await db.query('SELECT public.quote_share_revoke($1) AS r', [s.id])).rows[0].r, true);
await as(null);
assert.equal((await open(s.id, s.token, '7628')).status, 'revoked', '停用后打不开');
await db.close();
console.log('quote share links: staff-only create/revoke, last-4 check, lockout, expiry, revoke, isolation passed');
