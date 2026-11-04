// The server code both payment routes share, against a fake HitPay: it must reuse links, refuse to
// create one when nothing is due, and notice a payment HitPay has not yet told us about.
import assert from 'node:assert/strict';
import { linkForOrder, reconcile, reasonText, MAX_LINKS_PER_DAY } from '../supabase/functions/_shared/hitpay-links.ts';
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
console.log(`PASS ${checks} shared payment code checks`);
