import assert from 'node:assert/strict';
// Every external service is a fixture: no Firecrawl credits or OpenAI tokens are spent by this test.
let handler,checks=0;const ok=(v,m)=>{assert(v,m);checks++;};
const ENV={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-fixture',SUPABASE_ANON_KEY:'anon-fixture',FIRECRAWL_API_KEY:'fc-fixture',OPENAI_API_KEY:'oa-fixture',RADAR_CRON_SECRET:'cron-fixture'};
globalThis.Deno={serve:fn=>handler=fn,env:{get:k=>ENV[k]}};
let calls=[],busy=false,inserted=[],patches=[],runPatch=null,aiBodies=[];
const KNOWN='facebook.com/groups/1/posts/known';
const postId=key=>'id-'+key.split('/').pop();
globalThis.fetch=async(url,opt={})=>{
 const u=String(url),method=opt.method||'GET',body=opt.body?JSON.parse(opt.body):null;calls.push({u,method,body,headers:opt.headers});
 if(u.endsWith('/rpc/lead_radar_can_run'))return Response.json(opt.headers.Authorization==='Bearer gm-token');
 if(u.endsWith('/auth/v1/user'))return Response.json({id:'gm-user'});
 if(u.includes('/lead_radar_runs?select=id&status=eq.running'))return Response.json(busy?[{id:'r0'}]:[]);
 if(u.endsWith('/rest/v1/lead_radar_runs')&&method==='POST')return Response.json([{id:'run-1'}]);
 if(u.includes('/lead_radar_runs?id=eq.')){runPatch=body;return new Response(null,{status:204});}
 if(u.includes('/lead_radar_queries'))return Response.json([{query:'kitchen cabinet JB'},{query:'新山 装修 推荐'}]);
 if(u==='https://api.firecrawl.dev/v2/search'){
  if(body.query==='新山 装修 推荐')return new Response('down',{status:500});
  ok(body.tbs==='qdr:w'&&body.country==='MY','searches are limited to the last week in Malaysia');
  return Response.json({creditsUsed:2,data:{web:[
   {url:'https://www.facebook.com/groups/1/posts/111/?mibextid=x',title:'Need kitchen cabinet',description:'2 days ago · Need full kitchen cabinet in Skudai, contractors pls WhatsApp me 012-345 6821'},
   {url:'https://m.facebook.com/groups/1/posts/111',title:'dup',description:'same post again'},
   {url:'https://facebook.com/groups/1/posts/known',title:'old',description:'already stored'},
   {url:'https://www.instagram.com/p/ad1/',title:'JB RENOVATION',description:'We do renovation, WhatsApp 011-6966 7922'},
  ]}});}
 if(u.includes('/lead_radar_items?select=url_key'))return Response.json([{url_key:KNOWN}]);
 if(u.includes('/lead_radar_items?on_conflict=url_key')){inserted=body;return new Response(null,{status:201});}
 if(u.includes('/lead_radar_items?select=id,title,snippet,platform'))return Response.json(inserted.map(i=>({id:postId(i.url_key),title:i.title,snippet:i.snippet,platform:i.platform})));
 if(u==='https://api.openai.com/v1/responses'){aiBodies.push(body);return Response.json({usage:{input_tokens:900,output_tokens:300},output:[{content:[{type:'output_text',text:JSON.stringify({items:[
  {id:'id-111',label:'demand',score:91,confidence:.9,service:'kitchen',area:'Skudai',lang:'en',keywords:['kitchen cabinet'],reason:'业主要做整套橱柜',reply:'Hi! HOUZY HOME can help with a free measurement.',invites_contact:true},
  {id:'id-ad1',label:'ad',score:70,confidence:.95,service:'full_house',area:'JB',lang:'en',keywords:[],reason:'同行广告',reply:'',invites_contact:true},
 ]})}]}]});}
 if(u.includes('/lead_radar_items?id=eq.')){patches.push({id:u.split('id=eq.')[1],...body});return new Response(null,{status:204});}
 if(u.endsWith('/rpc/lead_radar_purge'))return Response.json(0);
 throw new Error('unexpected request '+method+' '+u);
};
await import('../supabase/functions/lead-radar/index.ts');
const call=(headers={},origin='https://houzyhome.com')=>handler(new Request('https://fixture/functions/v1/lead-radar',{method:'POST',headers:{origin,...headers}}));

// Paid runs: anonymous callers and ordinary staff are refused before any search is made.
let r=await call();ok(r.status===401,'no session refused');
r=await call({authorization:'Bearer staff-token'});ok(r.status===403,'staff cannot start a paid run');
r=await call({},'https://evil.example');ok(r.status===403,'other websites cannot trigger runs');
ok(!calls.some(c=>c.u.includes('firecrawl')||c.u.includes('openai')),'refused callers spent nothing');
// A second trigger while one is running is refused instead of paying twice.
busy=true;r=await call({'x-radar-secret':'cron-fixture'});ok(r.status===409,'concurrent run refused');busy=false;

calls=[];r=await call({'x-radar-secret':'cron-fixture'});const out=await r.json();
ok(r.status===200&&out.status==='partial','one failed query makes the run partial, not failed');
ok(runPatch.errors.some(e=>e.step==='search'&&e.detail.includes('新山 装修 推荐')),'failed query recorded for the admin');
ok(inserted.length===2&&inserted.every(i=>i.url_key!==KNOWN),'duplicates and already-stored posts are not saved again');
const fb=inserted.find(i=>i.url_key==='facebook.com/groups/1/posts/111');
ok(fb.platform==='facebook_group'&&fb.published_hint==='2 days ago'&&fb.date_verified===true,'platform and search-engine date saved');
ok(inserted.find(i=>i.platform==='instagram').date_verified===false,'post without a date marked unverified');
ok(aiBodies[0].model==='gpt-6-luna'&&aiBodies[0].text.format.strict===true,'default model and strict schema used');
const demand=patches.find(p=>p.id==='id-111'),ad=patches.find(p=>p.id==='id-ad1');
ok(demand.posted_contact==='+60123456821'&&demand.invites_contact===true,'invited number taken from the post text');
ok(demand.suggested_reply.includes('https://wa.me/60105898786?text=')&&demand.suggested_reply.includes('Radar-id-111'),'reply carries a HOUZY WhatsApp link tagged with the post');
ok(ad.posted_contact===null&&ad.invites_contact===false&&ad.score<20&&ad.service===null,"a competitor's number in an ad is never stored");
ok(runPatch.new_items===2&&runPatch.demand_items===1&&runPatch.search_credits===2&&runPatch.ai_input_tokens===900,'run log records counts and spend');
ok(calls.some(c=>c.u.endsWith('/rpc/lead_radar_purge')),'old posts purged after each run');

// A manager can run it by hand; the run is attributed to them.
calls=[];r=await call({authorization:'Bearer gm-token'});ok(r.status===200&&calls.find(c=>c.u.endsWith('/rest/v1/lead_radar_runs')&&c.method==='POST').body.triggered_by==='gm-user','manual run attributed to the manager');
// Missing keys stop the run with a clear message instead of a half-run.
delete ENV.OPENAI_API_KEY;r=await call({'x-radar-secret':'cron-fixture'});ok(r.status===503&&(await r.json()).error.includes('OpenAI'),'missing key reported');
console.log('PASS',checks,'lead radar function checks: caller auth, cost guards, de-duplication, partial failure, contact rule, reply link, run log');
