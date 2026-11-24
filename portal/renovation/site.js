'use strict';
// 施工监理手机页。内部监理用自己的账号登录；外部监理用门店给的链接 + 4 位验证码。
// 页面上没有任何金额。照片拍完先在手机上印好水印（日期时间、位置、工地、监理、记录类型）再上传。
(()=>{
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const URL_SB='https://csabbxiijzghooppayae.supabase.co',KEY='sb_publishable__9KY2RRSxb1excfVxBTH_Q_5HtFWxmH',BUCKET='renovation-fulfillment';
 const params=new URLSearchParams(location.search),sid=params.get('site'),token=params.get('t');
 const uuid=s=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s||'');
 const KIND={log:'工地日志',arrival:'到货点收',start:'开工',finish:'完工',inspection:'验收',issue:'问题',delay:'延误',pause:'停工'};
 const REASON={factory:'工厂',owner:'业主',weather:'天气',crew:'施工方',other:'其他'};
 const STAGE={pending:'待处理',confirmed:'待下单',ordered:'已下单',arrived:'已到货',scheduled:'已排期',working:'施工中',done:'已完成'};
 // 验收节点：每个节点要拍照逐项打勾
 const CHECKS={
  '水电隐蔽验收':['线管走向和图纸一致','强弱电间距 30cm 以上','水管打压 0.8MPa、30 分钟不掉压','开关插座底盒高度一致'],
  '防水闭水验收':['闭水 48 小时，楼下无渗水','淋浴区防水上墙 1.8 米','地漏、管根加强处理','门槛石挡水'],
  '泥水验收':['敲击无空鼓','2 米靠尺平整度 ≤2mm','砖缝宽度一致','排水坡度正确，不积水'],
  '木工 / 柜体安装验收':['柜体水平、垂直','门板缝隙均匀','五金开合顺畅','尺寸、颜色和定稿图纸一致'],
  '油漆验收':['墙面平整无裂纹','阴阳角顺直','颜色和样板一致','无流坠、无透底'],
  '交房验收':['全屋清洁完成','通水通电全部测试','门窗、五金正常','遗留问题全部处理']
 };
 let sb,el,auth=null,site=null,list=null,busy=false,fix=null,place='';
 const today=()=>site?.today||new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'});
 const say=(t,err)=>{const m=document.getElementById('site-msg');if(!m)return;m.textContent=t||'';m.className=err?'site-msg error':'site-msg';};

 // ── 定位：打开页面就开始找，拍照时用最新的位置 ──
 function locate(){
  if(!navigator.geolocation)return Promise.resolve(fix);
  return new Promise(ok=>navigator.geolocation.getCurrentPosition(p=>{fix={lat:+p.coords.latitude.toFixed(6),lng:+p.coords.longitude.toFixed(6),acc:Math.round(p.coords.accuracy),at:Date.now()};nameIt(fix);ok(fix);},()=>ok(fix),{enableHighAccuracy:true,timeout:8000,maximumAge:60000}));
 }
 // 坐标转成地址（OpenStreetMap，只发经纬度；拿不到就只印经纬度）
 const placeCache={};
 async function nameIt(f){
  const k=f.lat.toFixed(3)+','+f.lng.toFixed(3);if(placeCache[k]!==undefined){place=placeCache[k];return;}
  try{const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=zh,en&lat=${f.lat}&lon=${f.lng}`,{referrerPolicy:'no-referrer'});
   const j=await r.json();const a=j.address||{};place=placeCache[k]=[a.road,a.suburb||a.neighbourhood,a.city||a.town||a.village].filter(Boolean).join(', ')||'';}
  catch(e){placeCache[k]='';}
 }

 // ── 照片原始拍摄时间（相册照片用，读 JPEG 里的 EXIF DateTimeOriginal）──
 function exifTime(buf){
  try{const v=new DataView(buf);if(v.getUint16(0)!==0xFFD8)return null;let o=2;
   while(o<v.byteLength-4){const m=v.getUint16(o),len=v.getUint16(o+2);
    if(m===0xFFE1&&v.getUint32(o+4)===0x45786966){const t=o+10,le=v.getUint16(t)===0x4949,g16=x=>v.getUint16(t+x,le),g32=x=>v.getUint32(t+x,le);
     const scan=(ifd,want)=>{const n=g16(ifd);for(let i=0;i<n;i++){const e=ifd+2+i*12;if(g16(e)===want)return e;}return 0;};
     const ex=scan(g32(4),0x8769);if(!ex)return null;const d=scan(g32(ex+8),0x9003)||scan(g32(4),0x0132);if(!d)return null;
     const at=g32(d+8);let s='';for(let i=0;i<19;i++)s+=String.fromCharCode(v.getUint8(t+at+i));
     const m2=/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d)/.exec(s);return m2?`${m2[1]}-${m2[2]}-${m2[3]} ${m2[4]}:${m2[5]}`:null;}
    o+=2+len;}
  }catch(e){}return null;
 }
 async function sha256(buf){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',buf))].map(b=>b.toString(16).padStart(2,'0')).join('');}
 const WEEK='日一二三四五六';
 // ── 水印相机：照片缩到最长 1600px，左下角印水印，压成 JPEG ──
 async function watermark(file,source,kindLabel){
  const buf=await file.arrayBuffer(),hash=await sha256(buf),shot=source==='album'?exifTime(buf):null;
  const bmp=await createImageBitmap(file,{imageOrientation:'from-image'});
  const scale=Math.min(1,1600/Math.max(bmp.width,bmp.height)),w=Math.round(bmp.width*scale),h=Math.round(bmp.height*scale);
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.drawImage(bmp,0,0,w,h);bmp.close?.();
  const now=new Date(),kl=new Date(now.toLocaleString('en-US',{timeZone:'Asia/Kuala_Lumpur'}));
  const hhmm=`${String(kl.getHours()).padStart(2,'0')}:${String(kl.getMinutes()).padStart(2,'0')}`;
  const date=`${kl.getFullYear()}-${String(kl.getMonth()+1).padStart(2,'0')}-${String(kl.getDate()).padStart(2,'0')} 星期${WEEK[kl.getDay()]}`;
  const loc=fix?`${place?place+' · ':''}${fix.lat}, ${fix.lng}（±${fix.acc}m）`:'未取得定位';
  const lines=[`📍 ${loc}`,`🏠 ${site.project.contract_no} · ${site.project.address||''}`,`👷 ${site.supervisor.name} · ${kindLabel}`];
  if(source==='album')lines.unshift(`⚠ 相册照片${shot?' · 原拍摄 '+shot:' · 无原拍摄时间'}`);
  const u=Math.max(14,Math.round(w/42)),pad=Math.round(u*.8),big=Math.round(u*2.6);
  g.font=`700 ${big}px system-ui,-apple-system,"PingFang SC",sans-serif`;const tw=g.measureText(hhmm).width;
  g.font=`500 ${u}px system-ui,-apple-system,"PingFang SC",sans-serif`;
  const maxW=Math.min(w-pad*2,Math.max(tw+u*12,...lines.map(l=>g.measureText(l).width))+pad*2);
  const boxH=pad+big+u*.6+lines.length*u*1.45+pad*.6,x=pad,y=h-boxH-pad;
  g.fillStyle='rgba(0,0,0,.45)';g.fillRect(x,y,maxW,boxH);g.fillStyle='#c8a96e';g.fillRect(x,y,Math.max(4,u/4),boxH);
  g.fillStyle='#fff';g.textBaseline='top';g.font=`700 ${big}px system-ui,-apple-system,"PingFang SC",sans-serif`;g.fillText(hhmm,x+pad,y+pad);
  g.font=`500 ${u}px system-ui,-apple-system,"PingFang SC",sans-serif`;g.fillText(date,x+pad+tw+u,y+pad+big-u*1.3);
  lines.forEach((l,i)=>{let s=l;while(g.measureText(s).width>maxW-pad*2&&s.length>4)s=s.slice(0,-2);if(s!==l)s=s.slice(0,-1)+'…';g.fillText(s,x+pad,y+pad+big+u*.6+i*u*1.45);});
  g.font=`700 ${Math.round(u*.8)}px system-ui,sans-serif`;g.globalAlpha=.7;g.fillText('HOUZY HOME 工地记录',w-pad-g.measureText('HOUZY HOME 工地记录').width,pad);g.globalAlpha=1;
  const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.85));
  return {blob,preview:URL.createObjectURL(blob),meta:{sha256:hash,taken_at:now.toISOString(),lat:fix?.lat??null,lng:fix?.lng??null,source}};
 }
 async function upload(p){
  const path=`${site.project.id}/site/${site.supervisor.id}/${crypto.randomUUID()}.jpg`;
  const {error}=await sb.storage.from(BUCKET).upload(path,p.blob,{contentType:'image/jpeg',upsert:false});
  if(error)throw new Error('照片上传失败：'+error.message);
  return {...p.meta,path};
 }

 // ── 读数据 ──
 const rpcAuth=()=>auth?{sid:auth.sid,token:auth.token,code:auth.code}:null;
 async function reload(){
  if(auth){const {data,error}=await sb.rpc('renovation_site_open',{p_sid:auth.sid,p_token:auth.token,p_code:auth.code});if(error||!data||data.status!=='ok')return gate(data?.status==='ended'?'这个链接已停用，请联系门店。':'验证已过期，请重新输入验证码。');site=data.site;}
  else{const {data,error}=await sb.rpc('renovation_site_view',{p_project:site.project.id});if(error)throw error;site=data;}
  render();
 }
 async function post(kind,data){
  const {data:r,error}=await sb.rpc('renovation_site_post',{p_project:site.project.id,p_auth:rpcAuth(),p_kind:kind,p_data:data});
  if(error)throw new Error(error.message);site=r.site;render();
 }

 // ── 外部监理：输入验证码 ──
 function gate(note=''){
  el.innerHTML=`<section class="site-card"><h2>输入验证码</h2><p>请输入门店另外发给你的 <b>4 位验证码</b>。</p><label>验证码<input data-code inputmode="numeric" maxlength="4" autocomplete="one-time-code"></label><button type="button" data-verify class="site-primary">进入工地</button><p class="site-msg" role="status">${E(note)}</p></section>`;
  const input=el.querySelector('[data-code]'),go=async()=>{const v=input.value.trim();if(!/^\d{4}$/.test(v)){el.querySelector('.site-msg').textContent='请输入 4 位数字。';return;}
   const {data,error}=await sb.rpc('renovation_site_open',{p_sid:sid,p_token:token,p_code:v});
   if(error||!data)return gate('链接无效，请联系门店重新发送。');
   if(data.status==='wrong_code')return gate(`验证码不正确，还可以试 ${data.remaining} 次。`);
   if(data.status==='locked')return gate('验证码错太多次，链接已锁定，请联系门店。');
   if(data.status==='ended')return gate('这个链接已停用，请联系门店。');
   auth={sid,token,code:v};try{sessionStorage.setItem('site-code-'+sid,v);}catch(e){}site=data.site;render();};
  el.querySelector('[data-verify]').onclick=go;input.onkeydown=e=>{if(e.key==='Enter')go();};input.focus();
 }

 // ── 内部监理：我的工地 ──
 function renderList(){
  el.innerHTML=`<section class="site-head"><p class="site-eyebrow">HOUZY 施工监理</p><h1>我的工地 · ${list.length} 个</h1></section>${list.length?list.map(p=>`<button type="button" class="site-card site-pick" data-open="${p.project_id}"><b>${E(p.contract_no)} · ${E(p.address||'')}</b><span>${p.handover_on?'交房 '+E(p.handover_on):'交房日未定'}${p.arriving?` · 今天有 ${p.arriving} 项到货`:''}${p.open_issues?` · <em>${p.open_issues} 个问题未处理</em>`:''}${p.logged_today?' · 今天已交日志':' · 今天还没交日志'}</span></button>`).join(''):'<section class="site-card"><p>还没有分配给你的工地，请联系店长。</p></section>'}`;
 }

 // ── 工地页 ──
 function todo(){
  const t=today(),out=[];
  for(const w of site.work_orders){
   const arriving=w.items.filter(i=>i.stage==='ordered'),startable=w.items.filter(i=>i.kind==='work'&&['pending','scheduled'].includes(i.stage)),finishable=w.items.filter(i=>(['custom','stock'].includes(i.kind)&&i.stage==='arrived')||(i.kind==='work'&&i.stage==='working'));
   if(arriving.some(i=>i.expected_on&&i.expected_on<=t))out.push({w,act:'arrival',label:`到货点收：${w.group_name}`,sub:`${arriving.length} 项，预计 ${arriving.map(i=>i.expected_on).filter(Boolean).sort()[0]} 到`});
   if(startable.length&&w.planned_start&&w.planned_start<=t)out.push({w,act:'start',label:`开工：${w.group_name}`,sub:`计划 ${w.planned_start} 开工`});
   if(finishable.length&&w.planned_end&&w.planned_end<=t)out.push({w,act:'finish',label:`完工：${w.group_name}`,sub:`计划 ${w.planned_end} 完工`});
  }
  return out;
 }
 function render(){
  const P=site.project,t=today(),open=site.entries.filter(e=>e.kind==='issue'&&e.status==='open'),logged=site.entries.some(e=>e.kind==='log'&&e.on_date===t&&e.mine);
  const days=P.handover_on?Math.round((new Date(P.handover_on)-new Date(t))/864e5):null,tasks=todo();
  const wo=w=>{const st=s=>w.items.filter(i=>i.stage===s).length,acts=[];
   if(st('ordered'))acts.push(`<button type="button" data-act="arrival" data-wo="${w.id}">到货点收</button>`);
   if(w.items.some(i=>i.kind==='work'&&['pending','scheduled'].includes(i.stage)))acts.push(`<button type="button" data-act="start" data-wo="${w.id}">开工</button>`);
   if(w.items.some(i=>(['custom','stock'].includes(i.kind)&&i.stage==='arrived')||(i.kind==='work'&&i.stage==='working')))acts.push(`<button type="button" data-act="finish" data-wo="${w.id}">完工</button>`);
   const done=w.items.every(i=>i.stage==='done');
   return `<details class="site-wo"${done?'':''}><summary><b>${E(w.group_name)}</b><span>${done?'✓ 已完成':`${w.planned_start?E(w.planned_start.slice(5))+'–'+E((w.planned_end||'').slice(5)):'未排期'}${w.assignee?' · '+E(w.assignee):''}`}</span></summary>
    <ul>${w.items.map(i=>`<li><span>${E(i.name)}${i.spec?` <small>${E(i.spec)}</small>`:''}</span><em class="st-${i.stage}">${E(STAGE[i.stage]||i.stage)}${i.stage==='ordered'&&i.expected_on?' · '+E(i.expected_on.slice(5))+' 到':''}</em></li>`).join('')}</ul>
    ${acts.length?`<div class="site-row">${acts.join('')}</div>`:''}</details>`;};
  el.innerHTML=`<section class="site-head">${list?'<button type="button" class="site-back" data-back>‹ 我的工地</button>':''}<p class="site-eyebrow">HOUZY 施工监理 · ${E(site.supervisor.name)}</p><h1>${E(P.contract_no)}</h1><p>${E(P.address||'')}${days!==null?` · 交房 ${E(P.handover_on)}（${days>=0?'还有 '+days+' 天':'已过 '+(-days)+' 天'}）`:''}</p></section>
   <p id="site-msg" class="site-msg" role="status"></p>
   <section class="site-card"><h2>今天要做</h2>
    ${tasks.map(x=>`<button type="button" class="site-task" data-act="${x.act}" data-wo="${x.w.id}"><b>${E(x.label)}</b><span>${E(x.sub)}</span></button>`).join('')}
    ${open.map(e=>`<button type="button" class="site-task bad" data-act="resolve" data-id="${e.id}"><b>⚠ 问题：${E(e.note)}</b><span>${e.data?.responsible?E(e.data.responsible)+' · ':''}${e.data?.due_on?E(e.data.due_on)+' 前处理':'未定期限'} · 点这里登记已处理</span></button>`).join('')}
    <button type="button" class="site-task${logged?' ok':''}" data-act="log"><b>${logged?'✓ 今天的工地日志已交':'交今天的工地日志'}</b><span>拍 1 张以上现场照片 + 一句话，只给公司看</span></button>
   </section>
   <section class="site-card"><h2>记录</h2><div class="site-grid">
    <button type="button" data-act="inspection">验收节点</button><button type="button" data-act="issue">记问题</button>
    <button type="button" data-act="delay">进度延误</button><button type="button" data-act="pause">停工申报</button></div></section>
   ${window.RenoSitePlan?RenoSitePlan.section(site,!auth&&site.supervisor?.kind==='internal'):''}
   <section class="site-card"><h2>子单与清单</h2>${site.work_orders.map(wo).join('')||'<p>还没有子单。</p>'}</section>
   <section class="site-card"><h2>最近记录</h2><ul class="site-log">${site.entries.slice(0,30).map(e=>`<li><b>${E(KIND[e.kind])}</b> · ${E(e.on_date.slice(5))}${e.photo_count?` · 📷${e.photo_count}`:''}${e.kind==='delay'?` · ${E(REASON[e.data?.reason]||'')} ${e.data?.days||''} 天`:''}${e.kind==='inspection'?` · ${E(e.data?.milestone)} ${e.data?.pass?'通过':'不合格'}`:''}${['delay','pause'].includes(e.kind)?` · ${e.status==='confirmed'?'店长已确认':e.status==='rejected'?'店长已驳回':'等店长确认'}`:''}${e.kind==='issue'?` · ${e.status==='open'?'未处理':'已处理'}`:''}${e.note?`<br><small>${E(e.note)}</small>`:''}</li>`).join('')||'<li>还没有记录。</li>'}</ul></section>
   <div id="sheet" class="site-sheet" hidden></div>`;
 }

 // ── 填写面板（拍照 + 表单）──
 let shots=[];
 const photoBox=label=>`<div class="site-photos"><div class="site-thumbs" data-thumbs></div><div class="site-row"><label class="site-shot">📷 拍照<input type="file" accept="image/*" capture="environment" data-shot="camera"></label><label class="site-shot ghost">🖼 相册<input type="file" accept="image/*" data-shot="album"></label></div><small>${E(label)}照片会自动印上日期时间、位置和工地名</small></div>`;
 function openSheet(act,ds){
  shots=[];const s=document.getElementById('sheet'),w=site.work_orders.find(x=>x.id===ds.wo);
  const itemsFor=(test)=>w?w.items.filter(test).map(i=>`<label class="check"><input type="checkbox" data-line value="${E(i.line_id)}" checked> ${E(i.name)}</label>`).join(''):'';
  const woSelect=`<label>子单（选填）<select data-f="work_order_id"><option value="">整个工地</option>${site.work_orders.map(x=>`<option value="${x.id}">${E(x.group_name)}</option>`).join('')}</select></label>`;
  let body='';
  if(act==='log')body=`${photoBox('')}<label>今天做了什么<textarea data-f="note" rows="2" placeholder="例如：泥水师傅 2 人，客厅铺砖完成 70%"></textarea></label>`;
  else if(act==='arrival')body=`<p>${E(w.group_name)}：勾选今天到的</p>${itemsFor(i=>i.stage==='ordered')}${photoBox('')}<label class="check"><input type="checkbox" data-f="bad"> 有缺件 / 破损</label><label>情况说明（有缺件或破损必填）<textarea data-f="note" rows="2"></textarea></label>`;
  else if(act==='start')body=`<p>${E(w.group_name)}：开工</p>${itemsFor(i=>i.kind==='work'&&['pending','scheduled'].includes(i.stage))}${photoBox('')}<label>说明（选填）<textarea data-f="note" rows="2"></textarea></label>`;
  else if(act==='finish')body=`<p>${E(w.group_name)}：完工</p>${itemsFor(i=>(['custom','stock'].includes(i.kind)&&i.stage==='arrived')||(i.kind==='work'&&i.stage==='working'))}${photoBox('完工')}<label>说明（选填）<textarea data-f="note" rows="2"></textarea></label>`;
  else if(act==='inspection')body=`<label>验收节点<select data-f="milestone">${Object.keys(CHECKS).map(k=>`<option>${E(k)}</option>`).join('')}</select></label><div data-checks></div>${photoBox('验收')}<label>不合格要返工什么（有不合格必填）<textarea data-f="note" rows="2"></textarea></label>`;
  else if(act==='issue')body=`${woSelect}<label>问题<textarea data-f="note" rows="2" placeholder="例如：主卧墙角瓷砖空鼓"></textarea></label><label>谁处理<input data-f="responsible" placeholder="例如：泥水师傅"></label><label>几号前处理<input type="date" data-f="due_on"></label>${photoBox('')}`;
  else if(act==='resolve'){const e=site.entries.find(x=>x.id===ds.id);body=`<p>问题：${E(e?.note)}</p>${photoBox('处理后')}<label>怎么处理的<textarea data-f="note" rows="2"></textarea></label>`;}
  else if(act==='delay')body=`${woSelect}<label>慢了几天<input type="number" min="1" max="60" data-f="days" value="1"></label><div class="site-grid" data-reasons>${Object.entries(REASON).map(([k,v])=>`<button type="button" data-reason="${k}">${v}</button>`).join('')}</div><input type="hidden" data-f="reason"><label>说明（业主或其他原因必填）<textarea data-f="note" rows="2"></textarea></label><small>只有「施工方」原因扣监理的工期分；原因要店长确认。</small>`;
  else if(act==='pause')body=`<label>从<input type="date" data-f="from"></label><label>到<input type="date" data-f="to"></label><label>原因<textarea data-f="note" rows="2" placeholder="例如：业主出国，12/20–1/5 暂停"></textarea></label><small>停工期间不算延误、不用交日志；要店长确认。</small>`;
  s.innerHTML=`<div class="site-sheet-box" role="dialog" aria-label="${E(KIND[act]||'处理问题')}"><div class="site-sheet-head"><b>${E(act==='resolve'?'问题已处理':KIND[act])}</b><button type="button" data-close aria-label="关闭">✕</button></div>${body}<p class="site-msg" data-sheet-msg role="status"></p><button type="button" class="site-primary" data-submit="${act}" data-wo="${E(ds.wo||'')}" data-id="${E(ds.id||'')}">提交</button></div>`;
  s.hidden=false;s.dataset.act=act;
  if(act==='inspection'){const sel=s.querySelector('[data-f="milestone"]'),fill=()=>{s.querySelector('[data-checks]').innerHTML=CHECKS[sel.value].map(c=>`<label class="check site-check"><input type="checkbox" data-check="${E(c)}"> ${E(c)}</label>`).join('');};sel.onchange=fill;fill();}
  locate();
 }
 async function submit(btn){
  const s=document.getElementById('sheet'),act=btn.dataset.submit,v=n=>s.querySelector(`[data-f="${n}"]`)?.value?.trim()||'',msg=s.querySelector('[data-sheet-msg]');
  if(busy)return;busy=true;btn.disabled=true;msg.textContent='正在上传照片…';
  try{
   const photos=[];for(const p of shots)photos.push(await upload(p));msg.textContent='正在保存…';
   const lines=[...s.querySelectorAll('[data-line]:checked')].map(x=>x.value);
   if(['arrival','start','finish'].includes(act)&&!lines.length)throw new Error('请至少勾选一项');
   if(act==='resolve'){const {data,error}=await sb.rpc('renovation_site_resolve',{p_entry:btn.dataset.id,p_auth:rpcAuth(),p_data:{note:v('note'),photos}});if(error)throw new Error(error.message);site=data.site;render();say('已登记处理完成');return;}
   const data={note:v('note'),photos};
   if(['arrival','start','finish'].includes(act)){data.work_order_id=btn.dataset.wo;data.line_ids=lines;}
   if(act==='arrival'&&s.querySelector('[data-f="bad"]')?.checked)data.ok=false;
   if(act==='inspection'){data.milestone=v('milestone');data.checks=[...s.querySelectorAll('[data-check]')].map(x=>({item:x.dataset.check,ok:x.checked}));}
   if(act==='issue'){data.work_order_id=v('work_order_id')||null;data.responsible=v('responsible');data.due_on=v('due_on');}
   if(act==='delay'){data.work_order_id=v('work_order_id')||null;data.days=v('days');data.reason=v('reason');}
   if(act==='pause'){data.from=v('from');data.to=v('to');}
   await post(act,data);say(`${KIND[act]}已保存`);
  }catch(e){msg.textContent=e.message||String(e);}finally{busy=false;btn.disabled=false;}
 }
 function bind(){
  window.RenoSitePlan?.bind(el,{get sb(){return sb;},site:()=>site,reload,render,say});
  el.addEventListener('click',async e=>{
   const b=e.target.closest('button');if(!b)return;
   if(b.dataset.open){site={project:{id:b.dataset.open}};try{await reload();}catch(err){say(err.message,true);}return;}
   if(b.hasAttribute('data-back')){site=null;await loadList();return;}
   if(b.dataset.act){openSheet(b.dataset.act,b.dataset);return;}
   if(b.hasAttribute('data-close')){document.getElementById('sheet').hidden=true;shots=[];return;}
   if(b.dataset.reason){const s=document.getElementById('sheet');s.querySelector('[data-f="reason"]').value=b.dataset.reason;s.querySelectorAll('[data-reason]').forEach(x=>x.classList.toggle('on',x===b));return;}
   if(b.dataset.submit){await submit(b);return;}
   if(b.dataset.drop!==undefined){shots.splice(+b.dataset.drop,1);thumbs();return;}
  });
  el.addEventListener('change',async e=>{
   const inp=e.target.closest('[data-shot]');if(!inp||!inp.files?.length)return;
   const s=document.getElementById('sheet'),msg=s.querySelector('[data-sheet-msg]'),act=s.dataset.act;
   msg.textContent='正在印水印…';
   try{if(!fix)await locate();for(const f of inp.files){if(shots.length>=12)break;shots.push(await watermark(f,inp.dataset.shot,act==='resolve'?'问题处理':KIND[act]));}thumbs();msg.textContent=fix?'':'没有取得定位：请允许浏览器使用位置，照片上会写「未取得定位」。';}
   catch(err){msg.textContent='照片处理失败：'+(err.message||err);}
   inp.value='';
  });
 }
 function thumbs(){const t=document.querySelector('#sheet [data-thumbs]');if(t)t.innerHTML=shots.map((p,i)=>`<figure><img src="${p.preview}" alt="现场照片 ${i+1}"><button type="button" data-drop="${i}" aria-label="删除这张">✕</button></figure>`).join('');}
 async function loadList(){const {data,error}=await sb.rpc('renovation_site_my');if(error)throw error;list=data||[];if(list.length===1){site={project:{id:list[0].project_id}};await reload();}else renderList();}

 addEventListener('DOMContentLoaded',async()=>{
  el=document.getElementById('site');const msg=document.getElementById('message');
  try{
   if(!window.supabase)throw new Error('网络组件没有加载，请刷新重试。');
   bind();locate();
   if(sid||token){
    if(!uuid(sid)||!uuid(token))throw new Error('请使用门店发送的完整链接。');
    sb=supabase.createClient(URL_SB,KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    let saved='';try{saved=sessionStorage.getItem('site-code-'+sid)||'';}catch(e){}
    msg.hidden=true;el.hidden=false;
    if(saved){auth={sid,token,code:saved};try{await reload();}catch(e){gate();}}else gate();
   }else{
    sb=supabase.createClient(URL_SB,KEY);
    const {data:{session}}=await sb.auth.getSession();if(!session){location.replace('login.html?next=renovation-site.html');return;}
    msg.hidden=true;el.hidden=false;await loadList();
   }
  }catch(e){msg.textContent=e.message;msg.classList.add('error');}
 });
})();
