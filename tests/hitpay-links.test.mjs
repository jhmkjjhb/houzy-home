// The server code both payment routes share, against a fake HitPay: it must reuse links, refuse to
// create one when nothing is due, and notice a payment HitPay has not yet told us about.
import assert from 'node:assert/strict';
import { linkForOrder, reconcile, closeLinks, reasonText, MAX_LINKS_PER_DAY } from '../supabase/functions/_shared/hitpay-links.ts';
let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};
const base={payable:true,seq:2,installments:3,pct:40,amount:400,currency:'MYR',order_no:'H-1',links_today:0,customer_name:'王',customer_phone:'6012',description:null,link:null};
function setup({quote=base,open=[],remote={},created={id:'r1',url:'https://pay/r1'},failFirst=0}={}){
 const rpc=[],http=[];let posts=0;
 const admin={rpc:async(n,a)=>{rpc.push([n,a]);if(n==='hitpay_open_links')return{data:open,error:null};if(n==='hitpay_link_prepare')return{data:quote,error:null};if(n==='hitpay_link_save')return{data:{payment_url:a.p_url,payment_request_id:a.p_request},error:null};if(n==='hitpay_record_payment')return{data:{result:'recorded',fully_paid:true},error:null};throw new Error(n);}};
 const fetchFn=async(u,init)=>{http.push([u,init]);if(init?.method==='POST'){posts++;if(posts<=failFirst)return new Response(JSON.stringify({message:'method off'}),{status:422});return new Response(JSON.stringify(created),{status:200});}const id=decodeURIComponent(u.split('/').pop());return new Response(JSON.stringify(remote[id]||{status:'pending'}),{status:200});};
 return{rpc,http,deps:{admin,key:'k',fetchFn,baseUrl:'https://houzyhome.com'}};}
let t=setup();let out=await linkForOrder('o1','customer',null,t.deps);
ok(out.payment_url==='https://pay/r1'&&out.seq===2,'creates a link for what is due');
const sent=JSON.parse(t.http.find(h=>h[1]?.method==='POST')[1].body);ok(sent.amount==='400.00','HitPay is asked for the server amount');ok(sent.redirect_url.endsWith('/portal/customer.html?hitpay=return'),'returns to the customer page, not staff');ok(sent.reference_number==='H-1','reference is the order number');
ok(t.rpc.find(r=>r[0]==='hitpay_link_save')[1].p_source==='customer','records who created it');
t=setup({quote:{...base,link:{payment_url:'https://pay/same',payment_request_id:'same'}}});out=await linkForOrder('o1','staff','u1',t.deps);ok(out.payment_url==='https://pay/same'&&out.reused,'reuses the open link');ok(!t.http.some(h=>h[1]?.method==='POST'),'without asking HitPay for another');
t=setup({quote:{payable:false,reason:'pending_verify'}});out=await linkForOrder('o1','customer',null,t.deps);ok(!out.payable&&out.message.includes('现金'),'explains why it cannot be paid');ok(!t.http.some(h=>h[1]?.method==='POST'),'creates nothing');
t=setup({quote:{...base,links_today:MAX_LINKS_PER_DAY}});out=await linkForOrder('o1','customer',null,t.deps);ok(out.reason==='too_many','daily limit');ok(!t.http.some(h=>h[1]?.method==='POST'),'stops at the limit');
t=setup({failFirst:2});out=await linkForOrder('o1','staff','u1',t.deps);ok(out.payment_url,'falls back to fewer payment methods');
t=setup({failFirst:9});await assert.rejects(linkForOrder('o1','staff','u1',t.deps),/method off/);checks++;
// A payment HitPay has not notified us about is noticed first.
t=setup({open:['r9'],remote:{r9:{status:'completed',amount:'400.00'}},quote:{payable:false,reason:'paid'}});out=await linkForOrder('o1','staff','u1',t.deps);
const rec=t.rpc.find(r=>r[0]==='hitpay_record_payment')[1];ok(rec.p_request==='r9'&&rec.p_amount===400,'records the amount HitPay reports');ok(out.reconciled&&out.status==='completed','and reports it');
t=setup({open:['r9'],remote:{r9:{status:'pending'}}});ok(!(await reconcile('o1',t.deps)).recorded,'an unpaid link records nothing');ok(!t.rpc.some(r=>r[0]==='hitpay_record_payment'),'no record written');
ok(reasonText('review').includes('核对'),'readable reason');ok(reasonText('x'),'unknown reason still reads');
// HitPay answering badly must not stop staff opening an order, but our own write failure must surface.
{const admin={rpc:async n=>n==='hitpay_open_links'?{data:['bad','down'],error:null}:{data:{},error:null}};const fetchFn=async u=>{if(u.endsWith('down'))throw new TypeError('network');return new Response('<html>oops</html>',{status:200});};ok(!(await reconcile('o1',{admin,key:'k',fetchFn,baseUrl:''})).recorded,'bad HitPay answers are skipped');
 const broken={rpc:async n=>n==='hitpay_open_links'?{data:['x'],error:null}:{data:null,error:{message:'db down'}}};await assert.rejects(reconcile('o1',{admin:broken,key:'k',fetchFn:async()=>new Response(JSON.stringify({status:'completed',amount:1}),{status:200}),baseUrl:''}),/db down/);checks++;}
// Expiry and closing
t=setup({quote:{...base,expires_at:'2026-11-05 10:00:00'}});await linkForOrder('o1','staff','u1',t.deps);ok(JSON.parse(t.http.find(h=>h[1]?.method==='POST')[1].body).expiry_date==='2026-11-05 10:00:00','the link expires with the order');
t=setup();await linkForOrder('o1','staff','u1',t.deps);ok(!('expiry_date' in JSON.parse(t.http.find(h=>h[1]?.method==='POST')[1].body)),'later installments have no expiry');
ok(reasonText('expired').includes('失效'),'expired reason reads clearly');
let sentPut=null;
function closer(ids,remote,delStatus=200,extra=[],putStatus=200){const rpc=[],http=[];const admin={rpc:async(n,a)=>{rpc.push([n,a]);if(n==='hitpay_links_to_close')return{data:ids,error:null};if(n==='hitpay_links_to_extend')return{data:extra||[],error:null};return{data:{result:'review'},error:null};}};const fetchFn=async(u,i={})=>{http.push([u,i.method||'GET']);if(i.method==='DELETE')return new Response('{}',{status:delStatus});if(i.method==='PUT'){sentPut=JSON.parse(i.body);return new Response('{}',{status:putStatus});}const id=decodeURIComponent(u.split('/').pop());const x=remote[id];return x==='gone'?new Response('',{status:404}):new Response(JSON.stringify(x||{status:'pending'}),{status:200});};return{rpc,http,deps:{admin,key:'k',fetchFn,baseUrl:''}};}
t=closer(['a'],{});let res=await closeLinks(t.deps);ok(res.closed===1&&t.http.some(h=>h[1]==='DELETE'),'an unpaid link is deleted at HitPay');ok(t.rpc.some(r=>r[0]==='hitpay_link_closed'&&r[1].p_request==='a'),'and marked closed');
t=closer(['a'],{a:{status:'completed',amount:'9.00'}});res=await closeLinks(t.deps);ok(res.paid===1&&!t.http.some(h=>h[1]==='DELETE'),'a link already paid is recorded, not deleted');ok(t.rpc.find(r=>r[0]==='hitpay_record_payment')[1].p_amount===9,'with the amount paid');
t=closer(['a'],{a:'gone'});res=await closeLinks(t.deps);ok(res.closed===1&&!t.http.some(h=>h[1]==='DELETE'),'a link HitPay no longer has simply closes');
t=closer(['a','b'],{},500);res=await closeLinks(t.deps);ok(res.failed===2&&res.closed===0&&!t.rpc.some(r=>r[0]==='hitpay_link_closed'),'a failed delete stays queued for the next run');
t=closer([],{},200,[{id:'x',amount:700,expiry_date:'2026-11-09 10:00:00'}]);res=await closeLinks(t.deps);ok(res.extended===1&&sentPut.expiry_date==='2026-11-09 10:00:00'&&sentPut.amount==='700.00'&&sentPut.currency==='MYR','extending updates HitPay with the required fields');ok(t.rpc.some(r=>r[0]==='hitpay_link_extended'&&r[1].p_request==='x'),'and records it');
t=closer([],{},200,[{id:'x',amount:700,expiry_date:'d'}],500);res=await closeLinks(t.deps);ok(res.failed===1&&!t.rpc.some(r=>r[0]==='hitpay_link_extended'),'a failed update stays queued');
console.log(`PASS ${checks} shared payment code checks`);
