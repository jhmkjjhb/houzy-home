// Signing-only page: an owner may forward the link to a family member to sign. The page must show only
// that addition and the signature pad — never the contract, payments, progress, other additions or the
// project total — and the link staff copy must not carry the project's customer token.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const assert=require('node:assert/strict');const fs=require('node:fs');
function fixture(){
 window.__f={calls:[],args:[],signed:false};const f=window.__f;
 const terms={category:'material',name:'台面升级',contract_no:'TEST-SIGN-001',address:'Austin · 测试项目',spec:'测试规格',qty:1,unit:'项',rate:3200,amount:3200,payment_node:'确认后',warranty_note:'待补充合同凭证'};
 window.supabase={createClient:()=>({rpc:async(name,args)=>{f.calls.push(name);f.args.push(args);
  if(name==='renovation_signing_link_view')return {data:{id:args.p_addition,status:f.signed?'signed':'pending',terms,terms_hash:'a'.repeat(64),signer_name:f.signed?'家人代签':null,signed_at:f.signed?'2026-10-28T08:00:00Z':null,signature_hash:f.signed?'b'.repeat(64):null,signature_strokes:f.signed?[[[0.1,0.2],[0.5,0.6]]]:[]}};
  if(name==='renovation_signing_link_sign'){f.signed=true;sessionStorage.setItem('signed','1');return {data:{ok:true,signed_at:'2026-10-28T08:00:00Z',signature_hash:'b'.repeat(64)}};}
  return {data:{contract_no:'LEAK',net:999999}};
 }})};
 if(sessionStorage.getItem('signed'))f.signed=true;
}
(async()=>{
 // Staff copy the new page with only the addition id and its signing token.
 const additions=fs.readFileSync('portal/renovation/additions.js','utf8'),copy=additions.slice(additions.indexOf('data-copy-sign]'),additions.indexOf('catch(e){feedback.replaceChildren()'));
 assert.match(copy,/renovation-sign\.html/);assert.doesNotMatch(copy,/customer_token|url\.hash/,'copied signing link must not carry the project token');
 const page_=fs.readFileSync('portal/renovation-sign.html','utf8');assert.doesNotMatch(page_,/customer\.js|core\.js|finance-staff/,'signing page loads no project views');

 const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:false});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1')return route.continue();if(u.pathname.endsWith('supabase.min.js'))return route.fulfill({contentType:'application/javascript',body:`(${fixture.toString()})()`});return route.abort();});
 const base=(process.env.RENO_BASE_URL||'http://127.0.0.1:8137')+'/portal/renovation-sign.html';
 page.setDefaultTimeout(15000);
 await page.goto(base);await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('完整签署链接'));
 await page.goto(base+'?addition=33333333-3333-4333-8333-333333333333&sign=22222222-2222-4222-8222-222222222222');await page.locator('[data-submit]').waitFor();
 const text=await page.locator('body').innerText();
 assert.match(text,/台面升级/);assert.match(text,/RM 3,200\.00/);
 assert.doesNotMatch(text,/签署后项目应收总额|LEAK|999,999|付款进度|工程进度|验收质保/,'nothing beyond this addition is shown');
 assert.deepEqual([...new Set(await page.evaluate(()=>window.__f.calls))],['renovation_signing_link_view'],'only the signing-link view is requested');
 assert(await page.evaluate(()=>window.__f.args.every(a=>!('p_token' in a))),'no project token is ever sent');
 await page.locator('[data-name]').fill('家人代签');const box=await page.locator('canvas').boundingBox();
 await page.mouse.move(box.x+20,box.y+30);await page.mouse.down();await page.mouse.move(box.x+200,box.y+100,{steps:12});await page.mouse.up();await page.locator('[data-consent]').check();
 await page.screenshot({path:(process.env.SHOT_DIR||'.')+'/sign-link-mobile.png',fullPage:true});
 await Promise.all([page.waitForEvent('load'),page.locator('[data-submit]').click()]);
 await page.waitForFunction(()=>document.querySelector('#addition-signing').textContent.includes('已签署'));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow at 390px');
 assert.deepEqual(errors,[]);
 console.log('PASS: signing-only page shows one addition, no totals/contract/payments, no project token sent or copied, delegate signature submits, 390px fits, no JS errors');
 await browser.close();
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
