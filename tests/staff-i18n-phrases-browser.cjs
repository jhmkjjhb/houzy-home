// Switching the staff portal language must translate hard-coded Chinese UI text, including
// panels rendered later (the monthly dashboard loads asynchronously), without touching
// customer data, and switching back to 简体中文 must restore the original wording.
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch();const page=await browser.newPage();let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};
const js=fs.readFileSync(path.join(__dirname,'../portal/staff-i18n-phrases.js'),'utf8');
await page.setContent(`<body><div class="nav-sec">主面板</div><span id="radar">需求雷达</span>
<input id="q" placeholder="门店"><div id="cust">王人</div><div id="role">店长 · 001 Austin</div><div id="box"></div>
<div translate="no" id="keep">本月</div><script>${js}</script></body>`);
await page.evaluate(()=>StaffPhrases.apply('en'));
ok(await page.textContent('#radar')==='Lead Radar','sidebar item translated');
ok(await page.textContent('#role')==='Store Manager · 001 Austin','role label translated, store name kept');
ok(await page.getAttribute('#q','placeholder')==='Store','placeholder translated');
ok(await page.textContent('#cust')==='王人','customer data with a dictionary character inside is untouched');
ok(await page.textContent('#keep')==='本月','translate="no" respected');
await page.evaluate(()=>{document.getElementById('box').innerHTML='<div>📈 与上月对比</div><div>上月: RM 27.30</div><div>无滞销品（60 天内有动销）</div>';});
await page.waitForFunction(()=>document.getElementById('box').textContent.includes('Last month'));
const box=await page.textContent('#box');
ok(box.includes('📈 Compared with last month')&&box.includes('Last month: RM 27.30')&&box.includes('No slow-moving stock (all sold within 60 days)'),'asynchronously rendered dashboard translated: '+box);
await page.evaluate(()=>StaffPhrases.apply('th'));
ok(await page.textContent('#radar')==='เรดาร์ลูกค้า','switching between foreign languages uses the Chinese original');
await page.evaluate(()=>StaffPhrases.apply('zh-TW'));
ok(await page.textContent('#radar')==='需求雷達','traditional Chinese');
await page.evaluate(()=>StaffPhrases.apply('zh-CN'));
ok(await page.textContent('#radar')==='需求雷达'&&(await page.textContent('#box')).includes('与上月对比'),'back to simplified restores originals');
ok(await page.getAttribute('#q','placeholder')==='门店','placeholder restored');
await page.evaluate(()=>{document.getElementById('radar').firstChild.nodeValue='订单管理';StaffPhrases.apply('ms');});
ok(await page.textContent('#radar')==='Pesanan','text changed by the app while in Chinese is picked up as the new original');
await browser.close();console.log('PASS',checks,'staff phrase translation checks');})().catch(e=>{console.error(e);process.exit(1);});
