// 整单报价器自动同步：手机上改的报价，电脑打开后自动变成最新版（含平面图）；两边都改时不能悄悄丢掉一边。
// 两个浏览器上下文 = 两台设备（各自的本机存储），共用一个假的云端（slots + 图片），不连真实 Supabase。
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8137';
const UID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const cloud = { slots: {}, files: {} };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
function backend(op, a) {
  if (op === 'list') return Object.values(cloud.slots).map(({ document, ...r }) => r).sort((x, y) => x.slot - y.slot);
  if (op === 'get') return cloud.slots[a.slot] || null;
  if (op === 'save') {
    const cur = cloud.slots[a.p_slot];
    if ((cur ? cur.revision : 0) !== a.p_expected_revision) return { error: { message: 'Quote slot changed; refresh the list before saving' } };
    const info = a.p_document.project.info;
    cloud.slots[a.p_slot] = { slot: a.p_slot, revision: (cur?.revision || 0) + 1, customer_name: info.name, customer_phone: info.phone, updated_at: new Date().toISOString(), document: a.p_document };
    return { data: [{ slot: a.p_slot, revision: cloud.slots[a.p_slot].revision, updated_at: cloud.slots[a.p_slot].updated_at }] };
  }
  if (op === 'upload') { assert.ok(a.path.startsWith(UID + '/'), '图片放在自己账号的文件夹'); if (cloud.files[a.path]) return { error: { message: 'The resource already exists', statusCode: '409' } }; cloud.files[a.path] = a.b64; return {}; }
  if (op === 'sign') return { data: a.paths.map(p => ({ path: p, signedUrl: `${BASE}/__img/${encodeURIComponent(p)}` })) };
}
const FAKE = `window.supabase={createClient(){const call=(op,a)=>window.__sb(op,a);
 const q=t=>{const st={};const o={select(){return o},order(){return call('list').then(d=>({data:d,error:null}))},eq(k,v){st[k]=v;return o},
  maybeSingle(){return call('get',{slot:st.slot}).then(d=>({data:d&&{slot:d.slot,revision:d.revision,customer_phone:d.customer_phone},error:null}))},
  single(){return call('get',{slot:st.slot}).then(d=>({data:d,error:d?null:{message:'not found'}}))}};return o};
 return {auth:{getSession:async()=>({data:{session:{user:{id:'${UID}'}}},error:null})},from:q,
  rpc:async(n,a)=>{const r=await call('save',a);return {data:r.data||null,error:r.error||null}},
  storage:{from:()=>({upload:async(path,blob)=>{const b64=await new Promise(ok=>{const f=new FileReader();f.onload=()=>ok(f.result.split(',')[1]);f.readAsDataURL(blob)});return {error:(await call('upload',{path,b64})).error||null}},
   createSignedUrls:async(paths)=>call('sign',{paths})})}};}};`;
async function device(browser, name) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => page.__onDialog ? page.__onDialog(d) : d.accept());
  await page.exposeFunction('__sb', (op, a) => backend(op, a));
  await page.route('**/supabase-js@*/**', r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.route('**/__img/**', r => r.fulfill({ contentType: 'image/png', body: Buffer.from(cloud.files[decodeURIComponent(r.request().url().split('/__img/')[1])], 'base64') }));
  return { ctx, page, errors, name };
}
const quote = (extra = {}) => ({ houseType: 'condo_2', rooms: [{ id: 'r1', name: '主卧', type: 'bedroom', level: 1, w: 3, d: 3, packs: [] }], house: {}, prices: {}, info: { name: '测试客户', phone: '0123456789', address: 'JB' }, discount: 0, design: true, plans: [{ id: 'A', name: '方案 A', specs: {}, roomSpecs: {} }], ...extra });
const wait = (page, fn, arg, ms = 15000) => page.waitForFunction(fn, arg, { timeout: ms });
(async () => {
  const browser = await chromium.launch();
  try {
    const phone = await device(browser, 'phone'), pc = await device(browser, 'pc');
    // 手机：已有一份报价+一张平面图，打开后自动连到云端空位并上传图片
    await phone.page.addInitScript(([q, png]) => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('houzy-quote-v2', JSON.stringify(q)); localStorage.setItem('houzy-quote-v2-images', JSON.stringify({ drawings: [{ level: 1, img: 'data:image/png;base64,' + png, name: 'plan' }], rooms: {} })); } }, [quote(), PNG]);
    await phone.page.goto(`${BASE}/portal/quote-v2.html`);
    await wait(phone.page, () => JSON.parse(localStorage.getItem('houzy-quote-v2-cloud') || 'null')?.slot === 1);
    assert.equal(Object.keys(cloud.files).length, 1, '平面图已上传');
    assert.equal(cloud.slots[1].document.imageRefs.drawings[0].path.startsWith(UID), true);
    assert.equal(JSON.stringify(cloud.slots[1].document).includes('base64'), false, '报价数据里不夹图片原文');
    // 电脑：第一次从「我的云端报价」打开第 1 份 → 拿到报价和平面图
    await pc.page.goto(`${BASE}/portal/quote-v2.html?tab=quote`);
    await pc.page.evaluate(() => { const b = document.createElement('button'); b.dataset.cloudOpen = '1'; b.setAttribute('data-cloud-open', '1'); document.body.append(b); b.click(); });
    await wait(pc.page, () => JSON.parse(localStorage.getItem('houzy-quote-v2')).info.name === '测试客户');
    await wait(pc.page, () => JSON.parse(localStorage.getItem('houzy-quote-v2-images')).drawings.length === 1);
    // 手机改客户地址 → 几秒后自动传云端
    await phone.page.click('[data-tab="quote"]').catch(() => {});
    await phone.page.fill('[data-info="address"]', 'Taman Phone 1');
    await phone.page.locator('body').click({ position: { x: 1, y: 1 } });
    await new Promise(r => setTimeout(r, 6000));
    assert.equal(cloud.slots[1].document.project.info.address, 'Taman Phone 1', '手机的修改自动到了云端');
    assert.equal(cloud.slots[1].revision, 2);
    // 电脑切回来（获得焦点）→ 自动换成最新版
    await pc.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await wait(pc.page, () => JSON.parse(localStorage.getItem('houzy-quote-v2')).info.address === 'Taman Phone 1');
    // 两边都改：电脑断线时改了，手机也改了；电脑回来要问，选「取消」= 用电脑这版覆盖，不能悄悄丢
    await pc.page.click('[data-tab="quote"]').catch(() => {});
    await phone.page.fill('[data-info="address"]', 'Taman Phone 2'); await phone.page.locator('body').click({ position: { x: 1, y: 1 } });
    await new Promise(r => setTimeout(r, 6000));
    assert.equal(cloud.slots[1].revision, 3);
    await pc.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('houzy-quote-v2')); s.info.address = 'Taman PC'; localStorage.setItem('houzy-quote-v2', JSON.stringify(s)); });
    await pc.page.reload();
    let asked = '';
    pc.page.__onDialog = d => { asked = d.message(); d.dismiss(); };
    await wait(pc.page, () => true);
    await new Promise(r => setTimeout(r, 4000));
    assert.match(asked, /另一台设备上也改过/, '两边都改过时要问');
    await new Promise(r => setTimeout(r, 1500));
    assert.equal(cloud.slots[1].document.project.info.address, 'Taman PC', '选了本机版 → 云端被本机覆盖');
    assert.deepEqual([...phone.errors, ...pc.errors], [], '没有页面错误');
    console.log('quote-v2 autosync: auto upload with images, cross-device open, auto pull, conflict prompt — passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
