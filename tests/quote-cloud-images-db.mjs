// 报价图片云端文件夹：员工只能读写自己账号下的图片——换设备同步要能读回自己的图，但同事看不到别人客户的户型图
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
await db.exec(`
  CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth; CREATE SCHEMA storage;
  GRANT USAGE ON SCHEMA auth, storage TO authenticated, anon;
  CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES ('${A}'),('${B}');
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE TABLE public.staff_active(id uuid);
  INSERT INTO public.staff_active VALUES ('${A}'),('${B}');
  GRANT SELECT ON public.staff_active TO authenticated, anon;
  CREATE FUNCTION public._is_active_staff(integer) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM public.staff_active WHERE id=auth.uid()) $$;
  CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE storage.objects(bucket_id text, name text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  GRANT SELECT, INSERT ON storage.objects TO authenticated, anon;
`);
const sql = await readFile(new URL('../supabase/quote_cloud_images_migration.sql', import.meta.url), 'utf8');
await db.exec(sql); await db.exec(sql); // 可重复执行
const b = (await db.query(`SELECT public, allowed_mime_types FROM storage.buckets WHERE id='quote-images'`)).rows[0];
assert.equal(b.public, false, '图片文件夹必须是私有的');
const as = async (who, q) => { await db.exec(`RESET ROLE; SET ROLE ${who ? 'authenticated' : 'anon'}; SET request.jwt.claim.sub = '${who || ''}';`); return db.query(q); };
await as(A, `INSERT INTO storage.objects VALUES ('quote-images','${A}/abc.jpg')`);
await assert.rejects(as(A, `INSERT INTO storage.objects VALUES ('quote-images','${B}/x.jpg')`), /row-level security/, '不能往同事的文件夹里放图');
await as(B, `INSERT INTO storage.objects VALUES ('quote-images','${B}/b.jpg')`);
assert.deepEqual((await as(A, `SELECT name FROM storage.objects ORDER BY name`)).rows.map(r => r.name), [`${A}/abc.jpg`], '只看得到自己的图');
assert.equal((await as(null, `SELECT name FROM storage.objects`)).rows.length, 0, '没登录看不到');
await db.exec(`RESET ROLE; DELETE FROM public.staff_active WHERE id='${A}';`);
assert.equal((await as(A, `SELECT name FROM storage.objects`)).rows.length, 0, '离职账号读不到');
await assert.rejects(as(A, `INSERT INTO storage.objects VALUES ('quote-images','${A}/new.jpg')`), /row-level security/, '离职账号不能再传');
console.log('quote cloud images db: 7 checks passed');
