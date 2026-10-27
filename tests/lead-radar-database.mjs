import assert from 'node:assert/strict';import fs from 'node:fs';
const {PGlite}=await import(process.env.RENO_PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();let checks=0;
const ok=(v,m)=>{assert(v,m);checks++;};const reject=async(fn,re)=>{await assert.rejects(fn,re);checks++;};
const staff='20000000-0000-4000-8000-000000000001',gm='20000000-0000-4000-8000-000000000002',former='20000000-0000-4000-8000-000000000003';
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;GRANT USAGE ON SCHEMA public TO authenticated,anon;
CREATE TABLE profiles(id uuid PRIMARY KEY,active boolean,role text,name text);
INSERT INTO profiles VALUES('${staff}',true,'staff','Ali'),('${gm}',true,'general_manager','Boss'),('${former}',false,'store_manager','Former');`);
const migration=fs.readFileSync('supabase/lead_radar_migration.sql','utf8');await db.exec(migration);await db.exec(migration);
ok((await db.query('select count(*)::int n from lead_radar_queries')).rows[0].n===20,'re-running the migration keeps exactly one copy of each seed query');
async function actor(id,role='authenticated'){await db.exec(`RESET ROLE;SET request.jwt.claim.sub='${id}';SET ROLE ${role}`);}
const item=async(fields={})=>{await db.exec('RESET ROLE');const f={url:'https://example.test/p/'+crypto.randomUUID(),label:'demand',score:80,...fields};f.url_key=f.url_key||f.url;
 const cols=Object.keys(f);return (await db.query(`insert into lead_radar_items(${cols.join(',')}) values(${cols.map((_,i)=>'$'+(i+1)).join(',')}) returning id`,Object.values(f))).rows[0].id;};
const plain=await item(),invited=await item({invites_contact:true,posted_contact:'+60123456821'});
const mark=(id,status,note=null)=>db.query('select lead_radar_mark($1,$2,$3) v',[id,status,note]).then(r=>r.rows[0].v);

// Posts are public, but the triage list is internal: nothing for anonymous visitors.
await actor('','anon');await reject(()=>db.query('select * from lead_radar_items'),/permission denied/);
await reject(()=>mark(plain,'replied'),/permission denied/);
// A deactivated employee loses access even with a valid session.
await actor(former);ok((await db.query('select * from lead_radar_items')).rows.length===0,'inactive staff see no posts');
await reject(()=>mark(plain,'replied'),/员工账号/);
await actor(staff);ok((await db.query('select * from lead_radar_items')).rows.length===2,'active staff see the shared list');
// Staff cannot fabricate or edit AI results; only the service writes posts.
await reject(()=>db.query("insert into lead_radar_items(url,url_key) values('x','x')"),/permission denied/);
await reject(()=>db.query("update lead_radar_items set score=100"),/permission denied/);
// Search terms cost money per run, so only managers above store level change them.
await reject(()=>db.query("insert into lead_radar_queries(query,lang) values('staff added','en')"),/row-level security/);
ok((await db.query('select lead_radar_can_run() v')).rows[0].v===false,'staff cannot start paid manual runs');

// Marking shows colleagues who already replied, so two people do not answer the same post.
let r=await mark(plain,'replied','replied in group');ok(r.status==='replied'&&r.handled_by===staff&&r.handled_by_name==='Ali'&&r.note==='replied in group','reply recorded with handler and note');
await reject(()=>mark(plain,'spam'),/状态无效/);
// A number may be used only when the poster invited contractors to call, and only once.
await reject(()=>mark(plain,'contacted'),/没有邀请/);
r=await mark(invited,'contacted');ok(r.status==='contacted','invited number contacted once');
await reject(()=>mark(invited,'contacted'),/请勿重复联系/);
r=await mark(plain,'new');ok(r.status==='new'&&r.handled_by===null&&r.handled_by_name===null,'reset to new clears the handler');

await actor(gm);await db.query("insert into lead_radar_queries(query,lang) values('Tebrau renovation contractor','en')");
ok((await db.query('select lead_radar_can_run() v')).rows[0].v===true,'general manager can add queries and start runs');
// Data minimisation: a number from a post without an invitation must never be stored.
await reject(()=>item({posted_contact:'+60120000000'}),/lead_radar_contact_needs_invite/);
// Old untouched posts are purged after 90 days; converted customers are kept.
const old=await item({found_at:new Date(Date.now()-91*864e5).toISOString()}),oldWon=await item({found_at:new Date(Date.now()-91*864e5).toISOString(),status:'won'});
await db.exec('RESET ROLE');ok((await db.query('select lead_radar_purge() n')).rows[0].n===1,'one stale post purged');
ok((await db.query('select count(*)::int n from lead_radar_items where id=any($1)',[[old,oldWon]])).rows[0].n===1,'converted post kept, stale post removed');
await actor('','anon');await reject(()=>db.query('select lead_radar_purge()'),/permission denied/);
console.log('PASS',checks,'lead radar database checks: rerun, RLS, inactive staff, service-only writes, query management, contact-once rule, minimisation, purge');await db.close();
