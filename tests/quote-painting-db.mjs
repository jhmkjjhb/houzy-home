import fs from 'node:fs';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.RENO_PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();let n=0;const ok=(v,m)=>{assert(v,m);n++;};const denied=async(f)=>{await assert.rejects(f,/permission|权限|管理层|核价/);n++;};
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;CREATE TABLE profiles(id uuid PRIMARY KEY,name text,role text,active boolean);`);
 const ids={admin:crypto.randomUUID(),manager:crypto.randomUUID(),staff:crypto.randomUUID(),customer:crypto.randomUUID(),inactive:crypto.randomUUID()};
 for(const [role,id] of Object.entries(ids))await db.query('INSERT INTO profiles VALUES($1,$2,$3,$4)',[id,role,role==='manager'?'store_manager':role==='inactive'?'staff':role,role!=='inactive']);
 const sql=fs.readFileSync('supabase/quote_painting_prices_migration.sql','utf8');await db.exec(sql);await db.exec(sql);n++;
 await db.exec(`INSERT INTO quote_painting_prices(code,name,name_en,category,unit,cost_low,cost_high,markup_percent) VALUES('test_wall','Synthetic wall','Synthetic wall','wall','sf',10.1,20.4,40),('test_door','Synthetic door','Synthetic door','metal','set',100,200,40);`);
 const actor=async(role,id='')=>db.exec(`RESET ROLE;SET request.jwt.claim.sub='${id}';SET ROLE ${role}`);
 const rpc=async(name,args=[])=>{const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');return (await db.query(`SELECT ${name}(${placeholders}) value`,args)).rows[0].value;};
 await actor('anon');let rows=await rpc('quote_painting_catalog');ok(rows.length===2,'anonymous can read sales rates only');const wall=rows.find(r=>r.code==='test_wall');ok(wall.low===14.14&&wall.mid===21.35&&wall.high===28.56,'decimal ranges marked up exactly before cent rounding');ok(!JSON.stringify(rows).includes('cost_')&&!JSON.stringify(rows).includes('markup'),'cost and markup fields absent from public response');
 await denied(()=>rpc('quote_painting_costs'));await denied(()=>db.query('SELECT * FROM quote_painting_prices'));await denied(()=>db.query('SELECT * FROM quote_painting_cost_access'));await denied(()=>rpc('_quote_painting_can_cost'));
 await actor('authenticated',ids.staff);await denied(()=>rpc('quote_painting_costs'));await denied(()=>rpc('quote_painting_site_rate',['test_wall',12]));await denied(()=>rpc('quote_painting_set_access',[ids.staff,true]));
 await actor('authenticated',ids.manager);let costs=await rpc('quote_painting_costs');ok(costs.rows.length===2&&!costs.can_manage,'manager sees real cost but cannot manage grants');ok(costs.rows.find(r=>r.code==='test_wall').cost_low===10.1,'authorized exact cost returned');await denied(()=>rpc('quote_painting_set_access',[ids.staff,true]));await denied(()=>rpc('quote_painting_access_list'));
 await actor('authenticated',ids.admin);await rpc('quote_painting_set_access',[ids.staff,true]);ok((await rpc('quote_painting_access_list')).find(r=>r.id===ids.staff).allowed,'admin explicitly grants staff access');
 await actor('authenticated',ids.staff);ok((await rpc('quote_painting_costs')).rows.length===2,'explicit staff grant works');ok(Number(await rpc('quote_painting_site_rate',['test_wall',11]))===15.4,'site cost converted on server');
 for(const value of [0,-1,'NaN','Infinity',1000001]){await assert.rejects(()=>rpc('quote_painting_site_rate',['test_wall',value]),/有效/);n++;}
 await actor('authenticated',ids.admin);await rpc('quote_painting_set_access',[ids.staff,false]);await actor('authenticated',ids.staff);await denied(()=>rpc('quote_painting_costs'));
 await actor('authenticated',ids.customer);await denied(()=>rpc('quote_painting_costs'));
 await actor('authenticated',ids.inactive);await denied(()=>rpc('quote_painting_costs'));
 await actor('authenticated',ids.admin);await assert.rejects(()=>rpc('quote_painting_set_access',[ids.customer,true]),/在职员工/);n++;
 await actor('authenticated',ids.manager);await denied(()=>db.query("UPDATE quote_painting_prices SET cost_low=1"));await denied(()=>db.query('INSERT INTO quote_painting_cost_access VALUES($1,$2,now())',[ids.staff,ids.manager]));
 console.log(`PASS ${n} painting pricing and real-cost permission checks`);
}finally{await db.close();}
