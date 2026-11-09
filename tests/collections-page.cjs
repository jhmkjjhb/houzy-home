// Style collections page: every style must lead to a real enquiry, use only HOUZY's own files,
// open in the site's colours and switch to a style's own readable colours once picked, and work on a phone. Needs PLAYWRIGHT_MODULE.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const TYPES = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.svg':'image/svg+xml', '.webp':'image/webp', '.jpg':'image/jpeg', '.png':'image/png' };
let pass = 0; const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); pass++; };
const lum = h => { const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4); return .2126*c[0]+.7152*c[1]+.0722*c[2]; };
const contrast = (a,b) => { const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p); return (x+.05)/(y+.05); };
(async () => {
  const server = http.createServer((req,res)=>{ const f=path.join(root,decodeURIComponent(req.url.split('?')[0])); if(!f.startsWith(root)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end();} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res); }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const html = fs.readFileSync(path.join(root,'collections.html'),'utf8');
  // The page takes inspiration only: no borrowed names, files or links.
  ok(!/signature\.my|anggun/i.test(html + fs.readFileSync(path.join(root,'collections.css'),'utf8')), 'no material from the reference site');
  const browser = await chromium.launch({ channel:'chrome' });
  const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
  await page.route(/googletagmanager/, r => r.abort());
  const failed = []; page.on('response', r => { if (r.url().startsWith(base) && r.status()>=400) failed.push(r.url()); });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/collections.html');
  const styles = await page.evaluate(() => STYLES);
  ok(styles.length === 6, 'six styles');
  // Customers must be able to reach this page from the homepage, in every site language.
  const home = fs.readFileSync(path.join(root,'index.html'),'utf8');
  ok((home.match(/href="\/collections\.html"/g)||[]).length >= 1, 'homepage links to the style page');
  ok((home.match(/nav_styles:'/g)||[]).length === 5, 'homepage link translated in five languages');
  // Only licensed photos: every style and inspiration image must be on the credits list or already on the site.
  const credits = fs.readFileSync(path.join(root,'images/styles/CREDITS.md'),'utf8');
  const all = styles.flatMap(s => [s.hero, ...s.shots.map(x=>x[0]), ...(s.ideas||[]).map(x=>x[0])]);
  for (const p of all) {
    // The cream-style set in /hanlu/ has no recorded source; the owner chose on 2026-11-09 to keep it live.
    if (p.startsWith('/images/styles/hanlu/')) continue;
    else if (p.startsWith('/images/styles/')) ok(credits.includes('`'+path.basename(p,'.jpg')+'`'), 'photo has a recorded source: ' + p);
    else ok(false, 'photo outside the licensed folder: ' + p);
  }
  ok(!/output\/|三老爹|works\.html/.test(html), 'no unlicensed pack, video frames or paused works page');
  // The owner asked for no portrait photos.
  const sizes = await page.evaluate(paths => Promise.all(paths.map(p => new Promise(r => { const i=new Image(); i.onload=()=>r([p,i.naturalWidth,i.naturalHeight]); i.onerror=()=>r([p,0,0]); i.src=p; }))), all);
  for (const [p,w,h] of sizes) if (!p.startsWith('/images/styles/hanlu/')) ok(w > h && w >= 800, 'landscape photo: ' + p + ' ' + w + 'x' + h);
  // Order follows Malaysian demand, with the most asked-for style first.
  ok(styles.map(s=>s.id).join() === 'hening,kayu,krim,senja,serambi,batu', 'styles in Malaysian demand order');
  // The page opens on a random style in the site's time-of-day colours; a style's own colours only come after a click.
  ok(await page.locator('.c-name[aria-selected=true]').count() === 1, 'page opens with one style selected');
  const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const rgb = h => 'rgb(' + [1,3,5].map(i=>parseInt(h.slice(i,i+2),16)).join(', ') + ')';
  const siteBg = await bodyBg();
  ok(!styles.some(s => rgb(s.theme.bg) === siteBg), 'page opens in the site colours, not a style colour');
  // Browser translation must not turn the style names into nonsense.
  ok(await page.locator('.c-name strong').evaluateAll(l => l.every(e => e.getAttribute('translate') === 'no')), 'style names protected from browser translation');
  const seen = new Set();
  for (const s of styles) {
    await page.click('#tab-' + s.id);
    const link = decodeURIComponent(await page.getAttribute('#ask','href'));
    // Staff must see which style the customer asked about, on the store's number.
    ok(link.startsWith('https://wa.me/60105898786?text=') && link.includes(s.name), s.id + ' enquiry names the style');
    ok(await page.getAttribute('#tab-'+s.id,'aria-selected') === 'true', s.id + ' tab selected');
    ok(s.chips.length === 4, s.id + ' board has four materials');
    // The same photo twice makes a style look thin, and a customer should not meet one photo under two styles.
    const photos = [s.hero, ...s.shots.map(x=>x[0])];
    ok(new Set(photos).size === photos.length, s.id + ' shows each photo once');
    photos.forEach(x => { ok(!seen.has(x), 'photo used by one style only: ' + x); seen.add(x); });
    await page.waitForTimeout(1500);
    ok(await bodyBg() === rgb(s.theme.bg), s.id + ' click switches the page to the style colours');
    ok(contrast(s.theme.bg,s.theme.ink) >= 7, s.id + ' body text readable');
    ok(contrast(s.theme.bg,s.theme.soft) >= 4.5, s.id + ' secondary text readable');
    ok(contrast(s.theme.bg,s.theme.accent) >= 4.5, s.id + ' labels readable');
    ok(contrast(s.theme.deep,s.theme.onDeep) >= 7, s.id + ' closing band readable');
    for (const p of [s.hero, ...s.shots.map(x=>x[0]), ...s.chips.map(c=>c.tile).filter(Boolean)]) ok(fs.existsSync(path.join(root,p)), 'file exists ' + p);
    await page.waitForFunction(() => { const i=document.getElementById('room'); return i.complete && i.naturalWidth>0; });
    ok(await page.evaluate(() => { const g=[...document.querySelectorAll('#gallery img')]; return g.length>=5; }), s.id + ' gallery filled');
  }
  // The inspiration wall must never read as HOUZY's own work.
  await page.click('#tab-krim');
  ok(await page.locator('#ideas').isVisible(), 'cream style shows its inspiration wall');
  // Stock photos must be labelled as reference, never as HOUZY's own work or showroom.
  const ideasText = await page.textContent('#ideas');
  ok(ideasText.match(/style reference|风格参考/), 'inspiration wall says photos are a style reference');
  ok(!ideasText.match(/以往作品|HOUZY 作品|样品间实拍|HOUZY projects we built/), 'inspiration wall does not claim stock photos as HOUZY work');
  const krimIdeas = styles.find(s=>s.id==='krim').ideas.length;
  ok(krimIdeas >= 12 && await page.locator('.c-idea').count() === krimIdeas, 'every cream inspiration image is shown, and there are enough to browse');
  await page.locator('.c-filter').nth(2).click();
  const filtered = await page.locator('.c-idea').count();
  ok(filtered > 0 && filtered < 18, 'room filter narrows the images');
  await page.locator('.c-idea').first().click();
  ok(await page.evaluate(() => document.getElementById('box').open), 'inspiration image opens');
  ok((await page.textContent('#box-text')).match(/Inspiration|灵感参考/), 'large view keeps the inspiration label');
  ok((await page.textContent('#box-text')).includes('/ ' + filtered), 'large view stays within the filtered set');
  await page.keyboard.press('Escape');
  await page.locator('.c-filter').first().click();
  await page.click('#tab-hening');
  ok(await page.locator('#ideas').isHidden(), 'other styles have no inspiration wall');
  // Enquiries from this page must count in Google Ads like the homepage ones.
  const fired = await page.evaluate(() => { const stop = e => e.preventDefault(); document.addEventListener('click', stop); document.getElementById('ask').click(); document.removeEventListener('click', stop); return [...window.dataLayer].some(a => a[0] === 'event' && a[1] === 'conversion'); });
  ok(fired, 'WhatsApp enquiry records a conversion');
  // Sharing a link to one style opens that style.
  await page.goto(base + '/collections.html#senja');
  ok(await page.getAttribute('#tab-senja','aria-selected') === 'true', 'link opens the named style');
  // Keyboard users can move between styles and look through photos.
  await page.focus('#tab-senja'); await page.keyboard.press('ArrowRight');
  ok(await page.getAttribute('#tab-serambi','aria-selected') === 'true', 'arrow key changes style');
  await page.locator('.c-shot').first().click();
  ok(await page.evaluate(() => document.getElementById('box').open), 'photo opens');
  await page.keyboard.press('ArrowRight');
  ok((await page.textContent('#box-text')).includes('2 / 5'), 'arrow moves to next photo');
  await page.keyboard.press('Escape');
  ok(!await page.evaluate(() => document.getElementById('box').open), 'escape closes photo');
  // A designer credit is a claim about a real person: it stays hidden until someone is named.
  ok(await page.evaluate(() => STYLES.every(s => s.designer === null)), 'no designer named without real details');
  ok(await page.locator('#designer').isHidden(), 'credit hidden when no designer is named');
  await page.evaluate(() => { current.designer = { name:'Test Person', title:{zh:'主案设计师',en:'Lead designer'}, years:8, signature:'/favicon.svg' }; render(); });
  ok(await page.locator('#designer').isVisible(), 'credit shows once a designer is named');
  ok((await page.textContent('#designer')).includes('Lead designer · 8 years in practice'), 'credit shows role and years');
  await page.click('[data-lang=zh]');
  ok((await page.textContent('#designer')).includes('主案设计师 · 从业 8 年'), 'credit follows the language');
  await page.click('[data-lang=en]');
  ok(await page.getAttribute('#designer img','alt') === 'Test Person', 'signature image names the person');
  await page.evaluate(() => { current.designer = { name:'Test Person', title:{zh:'主案设计师',en:'Lead designer'} }; render(); });
  ok(await page.locator('#designer img').count() === 0 && !(await page.textContent('#designer')).includes('years'), 'optional details left out cleanly');
  await page.evaluate(() => { current.designer = null; render(); });
  await page.click('[data-lang=en]');
  ok((await page.textContent('h1')).includes('Six ways'), 'English headline');
  ok(decodeURIComponent(await page.getAttribute('#ask','href')).includes('Hi, I saw'), 'English enquiry text');
  await page.click('[data-lang=zh]');
  const facts = await page.locator('.c-facts').boundingBox(), gallery = await page.locator('.c-gallery').boundingBox();
  ok(Math.abs(facts.x - gallery.x) < 1, 'facts line up with the gallery');
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height:844 });
    await page.waitForTimeout(100);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at ' + width);
  }
  ok(errors.length === 0, 'no page errors: ' + errors.join('; '));
  ok(failed.length === 0, 'no missing files: ' + failed.join(', '));
  await browser.close(); server.close();
  console.log(`PASS ${pass} collections page checks`);
})().catch(e => { console.error(e.message); process.exit(1); });
