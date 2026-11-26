import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const document = (name, phone) => ({ format: 'houzy-quote-v2', version: 1,
  project: { rooms: [], plans: [], info: { name, phone, address: 'Johor Bahru' } },
  images: { drawings: [], rooms: {} } });

await db.exec(`
  CREATE ROLE authenticated;
  CREATE ROLE anon;
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO authenticated;
  CREATE TABLE auth.users(id uuid PRIMARY KEY);
  INSERT INTO auth.users(id) VALUES ('${userA}'), ('${userB}');
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION public._is_active_staff(integer) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT auth.uid() IS NOT NULL $$;
`);
await db.exec(await readFile(new URL('../supabase/quote_cloud_slots_migration.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../supabase/quote_cloud_slots_migration.sql', import.meta.url), 'utf8'));
for (let i = 0; i < 2; i++) await db.exec(await readFile(new URL('../supabase/quote_cloud_slot_delete_migration.sql', import.meta.url), 'utf8'));
await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${userA}';`);
const save = (slot, revision, name, phone) => db.query(
  'SELECT * FROM public.save_quote_cloud_slot($1,$2,$3::jsonb)',
  [slot, revision, JSON.stringify(document(name, phone))]);

for (let slot = 1; slot <= 3; slot++) {
  const result = await save(slot, 0, `Client ${slot}`, `6012345678${slot}`);
  assert.equal(result.rows[0].revision, 1);
}
assert.equal((await db.query('SELECT count(*)::int AS n FROM public.quote_cloud_slots')).rows[0].n, 3);
await assert.rejects(save(4, 0, 'Fourth', '60123456784'), /slot must be 1, 2 or 3/);
await assert.rejects(save(1, 0, 'Fourth', '60123456784'), /slot changed/i);
const replaced = await save(1, 1, 'Fourth', '60123456784');
assert.equal(replaced.rows[0].revision, 2);
await assert.rejects(save(1, 1, 'Stale', '60123456785'), /slot changed/i);
await assert.rejects(db.query(`INSERT INTO public.quote_cloud_slots(owner_id,slot,document,customer_name,customer_phone)
  VALUES ('${userA}',1,'{}','bad','bad')`), /permission denied/);

await db.exec(`SET request.jwt.claim.sub = '${userB}';`);
assert.equal((await db.query('SELECT count(*)::int AS n FROM public.quote_cloud_slots')).rows[0].n, 0);
assert.equal((await save(1, 0, 'Other staff', '60123456786')).rows[0].revision, 1);
// 删除：只能删自己的、版本要对（别的窗口刚改过就不删）；删了空出位置可以再存
const del = (slot, rev) => db.query('SELECT public.delete_quote_cloud_slot($1,$2) AS ok', [slot, rev]);
await db.exec(`SET request.jwt.claim.sub = '${userA}';`);
await assert.rejects(del(1, 1), /slot changed/i, '旧版本不能删');
assert.equal((await del(1, 2)).rows[0].ok, true);
assert.equal((await db.query('SELECT count(*)::int AS n FROM public.quote_cloud_slots')).rows[0].n, 2, 'A 只剩 2 份');
assert.equal((await save(1, 0, 'Again', '60123456787')).rows[0].revision, 1, '删掉的位置可以再存');
await db.exec(`SET request.jwt.claim.sub = '${userB}';`);
await assert.rejects(del(2, 1), /slot changed/i, 'B 不能删 A 的第 2 份');
await db.exec(`SET request.jwt.claim.sub = '${userA}';`);
assert.equal((await db.query('SELECT count(*)::int AS n FROM public.quote_cloud_slots')).rows[0].n, 3, 'A 的报价没被 B 删掉');
await db.close();
console.log('quote cloud slots: repeat migration, 3-slot limit, confirmed overwrite, isolation, write protection and delete passed');
