'use strict';
// 整装订单里的「施工监理」标签：指定监理（内部账号 / 外部链接）、看工地记录和照片、店长确认延误和停工、抽查验收、提示可以收款。
window.RenoSiteStaff=(()=>{
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const KIND={log:'工地日志',arrival:'到货点收',start:'开工',finish:'完工',inspection:'验收',issue:'问题',delay:'延误',pause:'停工'};
 const REASON={factory:'工厂',owner:'业主',weather:'天气',crew:'施工方',other:'其他'};
 const MANAGER=['store_manager','regional_manager','general_manager','admin','superadmin'];
 let ctx=null,data=null,ver=0;
 const link=s=>{const u=new URL('renovation-site.html',location.href);u.searchParams.set('site',s.id);u.searchParams.set('t',s.access_token);return u.href;};
 async function load(c){
  ctx=c;const id=++ver,el=document.getElementById('site-staff');if(!el)return;
  if(!c.project||!['confirmed','executing','accepted'].includes(c.project.state)){el.innerHTML='<p class="muted">合同确认后可以指定施工监理。</p>';badge(0);return;}
  const [sup,ent]=await Promise.all([c.sb.from('renovation_site_supervisors').select('*').eq('project_id',c.project.id).order('created_at'),c.sb.from('renovation_site_entries').select('*').eq('project_id',c.project.id).order('created_at',{ascending:false}).limit(120)]);
  if(id!==ver)return;
  if(sup.error||ent.error){el.innerHTML='<p class="muted">施工监理功能需要先在 Supabase 运行 renovation_site_supervision_migration.sql。</p>';badge(0);return;}
  data={sups:sup.data||[],entries:ent.data||[],urls:{}};
  const paths=[...new Set(data.entries.slice(0,40).flatMap(e=>(e.photos||[]).map(p=>p.path)))];
  if(paths.length){try{const {data:u}=await c.sb.storage.from('renovation-fulfillment').createSignedUrls(paths,3600);for(const x of u||[])if(x.signedUrl)data.urls[x.path]=x.signedUrl;}catch(e){}}
  if(id!==ver)return;render();
 }
 function badge(n){const b=document.getElementById('site-badge');if(b)b.textContent=n?` · 待确认 ${n}`:'';}
 function render(){
  const el=document.getElementById('site-staff'),manager=MANAGER.includes(ctx.actor?.role),locked=ctx.project.state==='accepted';
  const active=data.sups.filter(s=>s.active),name=id=>data.sups.find(s=>s.id===id)?.name||'监理';
  const waiting=data.entries.filter(e=>['delay','pause'].includes(e.kind)&&e.status==='open');badge(waiting.length);
  const passed=data.entries.filter(e=>e.kind==='inspection'&&e.data?.pass&&e.status!=='rejected');
  const issues=data.entries.filter(e=>e.kind==='issue'&&e.status==='open');
  const photos=e=>(e.photos||[]).length?`<div class="site-staff-photos">${e.photos.map(p=>data.urls[p.path]?`<a href="${E(data.urls[p.path])}" target="_blank" rel="noopener"><img src="${E(data.urls[p.path])}" alt="现场照片" loading="lazy"></a>`:'<span class="muted">📷</span>').join('')}${e.photos.some(p=>p.source==='album')?'<span class="warning-chip">含相册照片</span>':''}${e.photos.some(p=>p.reused)?'<span class="warning-chip">有重复照片</span>':''}${e.photos.some(p=>p.lat==null)?'<span class="warning-chip">无定位</span>':''}</div>`:'';
  const line=e=>`<li><b>${E(KIND[e.kind])}</b> · ${E(e.on_date)} · ${E(name(e.supervisor_id))}${e.kind==='delay'?` · ${E(REASON[e.data?.reason]||'')} ${E(e.data?.days)} 天`:''}${e.kind==='pause'?` · ${E(e.data?.from)} 至 ${E(e.data?.to)}`:''}${e.kind==='inspection'?` · ${E(e.data?.milestone)} ${e.data?.pass?(e.data?.first_try?'一次通过':'返工后通过'):'不合格'}`:''}${e.kind==='arrival'&&e.data?.ok===false?' · 有缺件/破损':''}${e.kind==='issue'?` · ${e.status==='open'?'未处理':'已处理'}`:''}${e.status==='confirmed'?' · 店长已确认':e.status==='rejected'?' · 店长已驳回':''}${e.note?`<br><span>${E(e.note)}</span>`:''}${photos(e)}</li>`;
  el.innerHTML=`
   ${passed.length?`<div class="site-staff-pay">✓ 监理已验收：${passed.slice(0,3).map(e=>`${E(e.data.milestone)}（${E(e.on_date.slice(5))}）`).join('、')}。如果对应收款节点已到，可以向业主收下一期款。</div>`:''}
   <div class="work-terms"><b>施工监理</b>
    ${active.length?`<ul class="site-staff-list">${active.map(s=>`<li><b>${E(s.name)}</b> · ${s.kind==='internal'?'内部账号':'外部监理'}${s.phone?' · '+E(s.phone):''} · ${E(s.started_on)} 起
     ${s.kind==='external'&&!locked?`<div class="actions"><span>验证码 <b class="mono" style="letter-spacing:2px">${E(s.access_code)}</b></span><button type="button" class="secondary" data-sact="copy" data-link="${E(link(s))}">复制链接</button><button type="button" class="secondary" data-sact="copycode" data-code="${E(s.access_code)}">复制验证码</button></div>`:''}
     ${locked?'':`<details><summary>结束这位监理</summary><button type="button" class="secondary" data-sact="end" data-id="${s.id}">结束（链接 / 账号不再能看这个工地）</button></details>`}</li>`).join('')}</ul>`:'<p class="muted">还没有指定监理。</p>'}
    ${locked?'':`<div class="site-staff-pick"><b>公司的施工监理</b><div data-candidates class="site-staff-cands"><span class="muted">正在读取…</span></div></div>
    <details class="site-staff-ext"${active.length?'':' open'}><summary>或者用外部监理（不用开账号，发链接 + 验证码）</summary><div class="fx-form"><div class="fx-fields"><label>外部监理名字<input data-sf="name" maxlength="80"></label><label>电话<input data-sf="phone" maxlength="40" type="tel"></label></div><div class="fx-actions"><button type="button" class="secondary" data-sact="add_external">生成外部监理链接</button></div></div></details>`}
    <p class="muted" data-sfeedback role="status"></p>
   </div>
   ${waiting.length?`<div class="work-terms"><b>等${manager?'你':'店长'}确认（${waiting.length}）</b><ul class="site-staff-log">${waiting.map(e=>`${line(e)}${manager?`<div class="fx-form" data-sid="${e.id}"><div class="fx-fields"><label>说明（驳回必填）<input data-sf="review_note"></label></div><div class="fx-actions"><button type="button" data-sact="confirm" data-id="${e.id}">属实，确认</button><button type="button" class="secondary" data-sact="reject" data-id="${e.id}">驳回</button></div></div>`:''}`).join('')}</ul><p class="muted">只有确认为「施工方」原因的延误才扣监理工期分；确认的停工期间不算延误、不用交日志。</p></div>`:''}
   ${issues.length?`<div class="work-terms"><b>未处理的问题（${issues.length}）</b><ul class="site-staff-log">${issues.map(line).join('')}</ul></div>`:''}
   <div class="work-terms"><b>工地记录</b>${data.entries.length?`<ul class="site-staff-log">${data.entries.filter(e=>!(['delay','pause'].includes(e.kind)&&e.status==='open')).slice(0,40).map(e=>`${line(e)}${manager&&e.kind==='inspection'&&e.data?.pass&&e.status!=='rejected'?`<details><summary>抽查：这个验收不算通过</summary><div class="fx-form" data-sid="${e.id}"><div class="fx-fields"><label>原因<input data-sf="review_note"></label></div><div class="fx-actions"><button type="button" class="secondary" data-sact="reject" data-id="${e.id}">抽查不通过</button></div></div></details>`:''}`).join('')}</ul>`:'<p class="muted">监理还没有交记录。</p>'}</div>`;
  if(!locked)candidates(el);
 }
 // 打开标签就列出公司所有施工监理：名字、电话、正在管几个工地，点「指定」即可
 async function candidates(el){
  const box=el.querySelector('[data-candidates]');if(!box)return;
  const {data:list,error}=await ctx.sb.rpc('renovation_supervisor_candidates');
  const taken=new Set(data.sups.filter(s=>s.active&&s.profile_id).map(s=>s.profile_id));
  if(error){box.innerHTML='<span class="muted">读取失败，请刷新重试。</span>';return;}
  box.innerHTML=(list||[]).length?list.map(p=>`<div class="site-staff-cand"><span><b>${E(p.name)}</b>${p.phone?' · '+E(p.phone):''}<br><small>正在管 ${E(p.sites??0)} 个工地</small></span>${taken.has(p.id)?'<em>已是本工地监理</em>':`<button type="button" data-sact="add_internal" data-pid="${E(p.id)}">指定</button>`}</div>`).join(''):'<span class="muted">公司还没有「施工监理」账号。请在员工后台「用户管理」里，把监理的账号角色设为「施工监理」。</span>';
 }
 function bind(el){
  el.addEventListener('click',async e=>{
   const b=e.target.closest('[data-sact]');if(!b||!ctx)return;
   const box=b.closest('.fx-form')||b.closest('.work-terms')||el,fb=el.querySelector('[data-sfeedback]'),v=n=>box.querySelector(`[data-sf="${n}"]`)?.value?.trim()||'';
   const tell=(t,err)=>{const m=box.querySelector(':scope > .fx-inline-msg')||Object.assign(document.createElement('p'),{className:'fx-inline-msg'});m.classList.toggle('warning',!!err);m.textContent=t;box.append(m);};
   try{
    const act=b.dataset.sact;
    if(act==='copy'){await navigator.clipboard.writeText(b.dataset.link);tell('链接已复制。验证码请另外单独发给监理。');return;}
    if(act==='copycode'){await navigator.clipboard.writeText(b.dataset.code);tell(`验证码 ${b.dataset.code} 已复制。`);return;}
    b.disabled=true;
    if(act==='add_internal'||act==='add_external'){
     const payload=act==='add_internal'?{profile_id:b.dataset.pid}:{name:v('name'),phone:v('phone')};
     const {data:r,error}=await ctx.sb.rpc('renovation_supervisor_save',{p_project:ctx.project.id,p_data:payload});if(error)throw error;
     await load(ctx);const msg=r.kind==='external'?`外部监理链接已生成，验证码 ${r.code}。点「复制链接」发给对方，验证码另外发。`:'已指定。监理用自己的账号登录就能看到这个工地。';
     const f=document.querySelector('#site-staff [data-sfeedback]');if(f)f.textContent=msg;return;
    }
    if(act==='end'){const {error}=await ctx.sb.rpc('renovation_supervisor_save',{p_project:ctx.project.id,p_data:{end_id:b.dataset.id}});if(error)throw error;await load(ctx);return;}
    if(act==='confirm'||act==='reject'){const {error}=await ctx.sb.rpc('renovation_site_review',{p_entry:b.dataset.id,p_action:act,p_note:v('review_note')});if(error)throw error;await load(ctx);return;}
   }catch(err){tell(err.message||String(err),true);b.disabled=false;}
  });
 }
 return {load,bind};
})();
