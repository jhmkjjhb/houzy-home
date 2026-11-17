'use strict';
// Sub-order tracking: staff act on the whole sub-order, or tick a few lines for exceptions.
// The database enforces every rule (no signature, no custom order); this page only explains them.
window.RenoFulfillment=(()=>{
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const BUCKET='renovation-fulfillment';
 const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'});
 const stageNames={custom:{pending:'待业主签名',confirmed:'已签名待下单',ordered:'已下单',arrived:'已到货',done:'已安装'},stock:{pending:'待下单',confirmed:'待下单',ordered:'已下单',arrived:'已到货',done:'已安装'},work:{pending:'待排期',scheduled:'已排期',working:'施工中',done:'已完工'},gift:{pending:'待交付',done:'已交付'}};
 const kindNames={custom:'定制',stock:'现货',work:'施工',gift:'赠品'};
 const empty={items:[],confirmations:[],batches:[],signoffs:[]};
 // 手写签名按笔画保存（0~1 的相对坐标），这里画成图给员工看
 const sigSvg=strokes=>`<svg viewBox="0 0 600 180" role="img" aria-label="手写签名" style="width:100%;max-width:420px;height:auto;display:block;border:1px solid #dce2df;border-radius:6px;background:#fff">${(Array.isArray(strokes)?strokes:[]).filter(x=>Array.isArray(x)&&x.length>1).map(x=>`<polyline fill="none" stroke="#22362e" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" points="${x.map(q=>`${(+q[0]*600).toFixed(1)},${(+q[1]*180).toFixed(1)}`).join(' ')}"/>`).join('')}</svg>`;
 const PURPOSES={order:'工厂确认下单内容',arrival:'到货验收',install:'安装完工',issue:'问题处理'};
 const stage=i=>i.stage==='cancelled'?'已取消':stageNames[i.kind]?.[i.stage]||i.stage;
 const open=i=>i.stage!=='done'&&i.stage!=='cancelled';
 const free=i=>!i.issue_note;
 function buckets(items){
  return {
   unsigned:items.filter(i=>i.kind==='custom'&&i.stage==='pending'),
   orderable:items.filter(i=>free(i)&&((i.kind==='custom'&&i.stage==='confirmed')||(i.kind==='stock'&&['pending','confirmed'].includes(i.stage)))),
   arriving:items.filter(i=>free(i)&&i.stage==='ordered'),
   toSchedule:items.filter(i=>free(i)&&i.kind==='work'&&i.stage==='pending'),
   toStart:items.filter(i=>free(i)&&i.kind==='work'&&i.stage==='scheduled'),
   finishable:items.filter(i=>free(i)&&!i.change_pending&&((['custom','stock'].includes(i.kind)&&i.stage==='arrived')||(i.kind==='work'&&i.stage==='working')||(i.kind==='gift'&&i.stage==='pending')))
  };
 }
 function headline(w,tracking){
  const items=(tracking||empty).items.filter(i=>i.work_order_id===w.id&&i.stage!=='cancelled');
  if(!items.length)return '';
  if(items.every(i=>i.stage==='done'))return '已完成';
  const b=buckets(items),live=(tracking.confirmations||[]).find(c=>c.work_order_id===w.id&&['pending','paper_review'].includes(c.status));
  if(items.some(i=>i.issue_note))return '有问题待处理';
  if(live)return live.status==='pending'?'等待业主签名':'纸质确认单待审核';
  if(b.unsigned.length)return '待发起业主签名';
  if(b.orderable.length)return '待下单';
  if(b.arriving.length)return items.some(i=>i.stage==='arrived')?'部分到货':'已下单待到货';
  return '进行中';
 }
 const field=(label,name,attrs='')=>`<label>${label}<input data-f="${name}" ${attrs}></label>`;
 const file=(label,name,accept)=>`<label>${label}<input data-f="${name}" type="file" accept="${accept}"></label>`;
 const PDF_IMG='application/pdf,image/jpeg,image/png,image/webp';
 const relationField=`<label>与业主的关系<select data-f="signer_relation"><option>本人</option><option>配偶</option><option>子女</option><option>父母</option><option>其他家人</option></select></label>`;
 function signBlock(w,items,tracking,o){
  const customs=items.filter(i=>i.kind==='custom');if(!customs.length)return '';
  const all=tracking.confirmations.filter(c=>c.work_order_id===w.id).sort((a,b)=>b.version-a.version);
  const live=all.find(c=>['pending','paper_review'].includes(c.status)),signed=all.find(c=>c.status==='signed');
  let body='';
  if(o.locked){body='';}
  else if(live?.status==='pending')body=`<p><b>等待业主签名</b>（第${live.version}版）。业主须输入登记手机号后四位才能查看。</p><div class="actions"><button type="button" class="secondary" data-act="copy_link" data-id="${live.id}" data-token="${live.signing_token}">复制签名链接</button></div>
   <details><summary>业主已签纸质确认单</summary><div class="work-controls" data-form>${file('扫描件','paper',PDF_IMG)}${field('签名人姓名','signer_name','maxlength="100"')}${relationField}<button type="button" data-act="submit_paper" data-id="${live.id}">提交店长审核</button></div></details>
   <details><summary>撤销这份确认单</summary><div class="work-controls" data-form>${field('撤销原因','reason')}<button type="button" class="secondary" data-act="void_signature" data-id="${live.id}">撤销</button></div></details>`;
  else if(live)body=`<p><b>纸质确认单待审核</b>：${E(live.signer_name)}（${E(live.signer_relation)}）。</p><div class="actions"><button type="button" class="secondary" data-act="view_file" data-path="${E(live.paper_path)}">查看扫描件</button>${o.manager?`<button type="button" data-act="review_paper" data-id="${live.id}" data-approve="1">审核通过</button><button type="button" class="secondary" data-act="review_paper" data-id="${live.id}" data-approve="">退回</button>`:'<span class="muted">须由店长或上级审核</span>'}</div>`;
  else{
   const waiting=customs.filter(i=>['pending','confirmed'].includes(i.stage));
   if(waiting.length)body=`<div class="work-controls" data-form>${file(signed?'新版定稿图纸（旧签名将失效，业主会看到）':'定稿图纸或确认文件（业主会看到，请勿含成本价）','document',PDF_IMG)}${field('给业主的说明（选填，业主会看到）','note')}<button type="button" data-act="request_signature">${signed?'重新发起业主签名':'整单发起业主签名'}（${waiting.length}项）</button></div>`;
  }
  // 已签过、只是可以重新发起的，不算「现在要做」，放进「更多操作」
  if(signed&&!live&&body){o.resign=body;return '';}
  return body?`<div class="work-terms"><b>业主签名 · 定制必签</b>${body}</div>`:'';
 }
 function ownerHistory(w,tracking){
  const all=tracking.confirmations.filter(c=>c.work_order_id===w.id&&c.status==='signed').sort((a,b)=>b.version-a.version);
  return all.map(c=>`<li>第${c.version}版${c.kind==='change'?'（改单）':''} · ${E(c.signer_name)}（${E(c.signer_relation)}）· ${E(new Date(c.signed_at).toLocaleString('zh-CN'))} · ${c.method==='paper'?'纸质':'电子'}${c.terms?.change_note?` · ${E(c.terms.change_note)}`:''}
   <details><summary>查看业主签名</summary><p>签名的清单（${(c.terms?.lines||[]).length}项）：${(c.terms?.lines||[]).map(l=>`${E(l.name)}${l.spec?`（${E(l.spec)}）`:''} × ${E(l.qty)} ${E(l.unit)}`).join('；')}</p>${c.terms?.note?`<p>说明：${E(c.terms.note)}</p>`:''}
   <div class="actions"><button type="button" class="secondary" data-act="view_file" data-path="${E(c.document_path)}">查看签名时的图纸</button>${c.paper_path?`<button type="button" class="secondary" data-act="view_file" data-path="${E(c.paper_path)}">查看纸质确认单</button>`:''}</div>
   ${c.method==='electronic'&&c.signature_strokes?`<p>手写签名：</p>${sigSvg(c.signature_strokes)}`:''}</details></li>`).join('');
 }
 function orderBlock(items,o){
  if(o.locked)return '';
  const b=buckets(items),hasStock=b.orderable.some(i=>i.kind==='stock');
  const legacy=o.manager?items.filter(i=>i.legacy_eligible&&['pending','confirmed'].includes(i.stage)&&['custom','stock'].includes(i.kind)):[];
  const form=(prefix='')=>`${field('厂家','supplier','maxlength="120"')}${field(prefix||'厂家单号','order_no','maxlength="120"')}${field('下单日期','ordered_on',`type="date" value="${today()}"`)}${field('预计到货日','expected_on','type="date"')}`;
  const legacyHtml=legacy.length?`<details><summary>登记上线前已下单（店长）</summary><div class="work-controls" data-form>${form()}${field('下单情况说明','reason')}<button type="button" class="secondary" data-act="legacy_order">登记历史订单（${legacy.length}项）</button></div></details>`:'';
  if(!b.orderable.length)return (b.unsigned.length?`<div class="work-terms"><b>下单</b><p class="muted">定制项须先由业主签名，才能下单。</p>${legacyHtml}</div>`:legacyHtml?`<div class="work-terms">${legacyHtml}</div>`:'');
  return `<div class="work-terms"><b>下单</b>${b.unsigned.length?`<p class="muted">还有 ${b.unsigned.length} 项定制未签名，这次不会下单。</p>`:''}<div class="work-controls" data-form>${form()}${hasStock?`<label class="check"><input data-f="stock_confirmed" type="checkbox">现货规格和数量已与业主确认</label>`:''}<button type="button" data-act="place_order">整单下单（${b.orderable.length}项）</button></div>${legacyHtml}</div>`;
 }
 function batchBlock(w,items,tracking,o){
  const list=tracking.batches.filter(x=>x.work_order_id===w.id);if(!list.length)return '';
  const now=today();
  return `<b>下单记录</b>${list.map(x=>{const waiting=items.some(i=>i.batch_id===x.id&&i.stage==='ordered'),late=waiting&&x.expected_on<now;return `<p>${E(x.supplier)}${x.supplier_order_no?` · 单号 ${E(x.supplier_order_no)}`:''} · 下单 ${E(x.ordered_on)} · 预计到货 ${E(x.expected_on)} · ${items.filter(i=>i.batch_id===x.id).length}项${x.legacy?' · 上线前已下单':''}${late?' <span class="warning">已逾期</span>':''}</p>${o.locked?'':`<details><summary>更正这条记录</summary><div class="work-controls" data-form>${field('厂家','supplier',`value="${E(x.supplier)}"`)}${field('厂家单号','order_no',`value="${E(x.supplier_order_no)}"`)}${field('预计到货日','expected_on',`type="date" value="${E(x.expected_on)}"`)}${field('更正原因','reason')}<button type="button" class="secondary" data-act="correct_batch" data-id="${x.id}">保存更正</button></div></details>`}`;}).join('')}`;
 }
 function stepBlocks(items,o){
  if(o.locked)return '';const b=buckets(items);let html='';
  if(b.arriving.length)html+=`<div class="work-controls" data-form>${field('到货日期','on',`type="date" value="${today()}"`)}<button type="button" data-act="arrive">整单到货（${b.arriving.length}项）</button></div>`;
  if(b.toSchedule.length)html+=`<div class="work-controls" data-form>${field('排期日期','on','type="date"')}<button type="button" data-act="schedule">整单排期（${b.toSchedule.length}项）</button></div>`;
  if(b.toStart.length)html+=`<div class="actions" data-form><button type="button" data-act="start_work">整单开工（${b.toStart.length}项）</button></div>`;
  if(b.finishable.length){const photo=b.finishable.some(i=>i.kind!=='gift');html+=`<div class="work-controls" data-form>${field('完成日期','on',`type="date" value="${today()}"`)}${photo?file('完工照片或文件','proof',PDF_IMG):''}<button type="button" data-act="finish">整单完成（${b.finishable.length}项）</button></div>`;}
  return html?`<div class="work-terms"><b>进度</b>${html}</div>`:'';
 }
 // 进度一行看完：签名 → 下单 → 到货 → 完成，当前这一步高亮
 function progress(items){
  const goods=items.filter(i=>['custom','stock'].includes(i.kind)),customs=items.filter(i=>i.kind==='custom');
  const steps=[];
  if(customs.length)steps.push(['业主签名',customs.filter(i=>i.stage!=='pending').length,customs.length]);
  if(goods.length){steps.push(['下单',goods.filter(i=>['ordered','arrived','done'].includes(i.stage)).length,goods.length]);steps.push(['到货',goods.filter(i=>['arrived','done'].includes(i.stage)).length,goods.length]);}
  steps.push(['完成',items.filter(i=>i.stage==='done').length,items.length]);
  let current=false;
  return `<div class="fx-steps">${steps.map(([n,d,t])=>{const ok=d>=t,cls=ok?'ok':current?'':'now';if(!ok)current=true;return `<span class="fx-step ${cls}">${ok?'✓ ':''}${n} ${d}/${t}</span>`;}).join('<span class="fx-arrow">→</span>')}${items.some(i=>i.issue_note)?`<span class="fx-step bad">⚠ ${items.filter(i=>i.issue_note).length}项有问题</span>`:''}</div>`;
 }
 // 清单：每项一行。勾选后，下单 / 到货 / 完成 / 标记问题 / 转发签字只处理勾选的项
 function itemList(items,o){
  const done=(o.signoffs||[]).filter(x=>x.status==='signed');
  const tags=i=>done.filter(x=>(x.line_ids||[]).includes(i.line_id)).map(x=>`<span class="fx-tag ok">✓ ${E(PURPOSES[x.purpose])} · ${E(x.signer_company)}</span>`).join('');
  const row=i=>`<label class="fx-row"><input type="checkbox" data-line="${E(i.line_id)}" ${o.locked||!open(i)?'disabled':''}><span class="fx-name"><b>${E(i.name)}</b><small>#${E(i.line_id)} · ${kindNames[i.kind]}${i.spec?` · ${E(i.spec)}`:''} · ${E(i.qty??'')} ${E(i.unit)}</small>${i.issue_note?`<small class="warning">⚠ ${E(i.issue_note)}（跟进 ${E(i.issue_follow_up_on)}）</small>`:''}${tags(i)}</span><span class="fx-tag ${i.stage==='done'?'ok':''}">${E(stage(i))}${i.change_pending?' · 改单待签':''}</span></label>`;
  return `<div class="fx-list">${items.map(row).join('')}</div>${o.locked?'':'<p class="muted fx-hint">不勾选 = 整张子单；勾选后，下面的操作只处理勾选的项。</p>'}`;
 }
 function moreBlock(items,o){
  if(o.locked)return '';
  return `<details class="work-terms fx-more"><summary>更多操作：标记问题 · 改单 · 转发工厂 / 负责人签字${o.resign?' · 重新发起业主签名':''}</summary>
   ${o.resign?`<div style="margin-top:6px"><b>重新发起业主签名</b>${o.resign}</div>`:''}
   <div class="work-controls" data-form>${field('问题说明（缺件、破损、尺寸不对等）','note')}${field('跟进日期','follow_up_on','type="date"')}<button type="button" class="secondary" data-act="flag_issue">标记问题</button><button type="button" class="secondary" data-act="resolve_issue">问题已解决</button></div>
   ${items.some(i=>i.kind==='custom')?`<div class="work-controls" data-form>${field('改单内容（业主会看到）','change_note')}${file('改单图纸或文件','document',PDF_IMG)}<button type="button" class="secondary" data-act="request_change">发起改单签名</button></div>`:''}
   ${o.signoffsReady?`<div data-form style="margin-top:14px"><b>转发给工厂 / 负责人签字</b><p class="muted">生成链接和 4 位验证码，分开发给对方。对方看不到价格和业主电话。</p>
    <div class="work-controls"><label>签字用途<select data-f="purpose">${Object.entries(PURPOSES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>${field('签字方（工厂或负责人）','party','maxlength="120"')}</div>
    <div class="work-controls">${field('给对方的说明（选填）','so_note','maxlength="1000"')}${file('附件：图纸或照片（选填）','so_doc',PDF_IMG)}<button type="button" data-act="signoff_create">生成签字链接</button></div></div>`:'<p class="muted">转发签字功能需要先在 Supabase 运行 renovation_party_signoffs_migration.sql。</p>'}</details>`;
 }
 const soHead=x=>`<b>${E(PURPOSES[x.purpose])}</b> · ${E(x.party)} · ${(x.line_ids||[]).length}项（${(x.terms?.lines||[]).map(l=>E(l.name)).join('、')}）`;
 // 等待对方签字的链接放在操作区（要用验证码）
 function pendingSignoffs(o){
  const list=(o.signoffs||[]).filter(x=>x.status==='pending');if(!list.length)return '';
  return `<div class="work-terms"><b>等待工厂 / 负责人签字</b><ul>${list.map(x=>`<li>${soHead(x)}${(x.failed_checks||0)>=8?' · <span class="warning">验证码错太多次已锁定，请撤销后重发</span>':''}
    <div class="actions"><span>验证码 <b class="mono" style="font-size:1.15em;letter-spacing:2px">${E(x.access_code)}</b></span><button type="button" class="secondary" data-act="signoff_copy_link" data-id="${x.id}" data-token="${x.signing_token}">复制链接</button><button type="button" class="secondary" data-act="signoff_copy_code" data-code="${E(x.access_code)}">复制验证码</button></div>
    ${o.locked?'':`<details><summary>撤销这个链接</summary><div class="work-controls" data-form>${field('撤销原因','reason')}<button type="button" class="secondary" data-act="signoff_void" data-id="${x.id}">撤销</button></div></details>`}</li>`).join('')}</ul></div>`;
 }
 // 记录：业主签名、下单、已签的转发签字，默认收起
 function records(w,items,t,o){
  const owner=ownerHistory(w,t),batches=batchBlock(w,items,t,o),signed=(o.signoffs||[]).filter(x=>x.status==='signed').sort((a,b)=>String(b.signed_at).localeCompare(String(a.signed_at)));
  const nOwner=t.confirmations.filter(c=>c.work_order_id===w.id&&c.status==='signed').length,nBatch=t.batches.filter(x=>x.work_order_id===w.id).length;
  if(!nOwner&&!nBatch&&!signed.length)return '';
  const so=signed.map(x=>`<li>${soHead(x)} · ${E(x.signer_company)} ${E(x.signer_name)} · ${E(new Date(x.signed_at).toLocaleString('zh-CN'))}${x.signer_note?`<br>对方备注：<b>${E(x.signer_note)}</b>`:''}
    <details><summary>查看签字</summary>${x.terms?.note?`<p>说明：${E(x.terms.note)}</p>`:''}${x.document_path?`<div class="actions"><button type="button" class="secondary" data-act="view_file" data-path="${E(x.document_path)}">查看附件</button></div>`:''}${sigSvg(x.signature_strokes)}</details></li>`).join('');
  return `<details class="work-terms fx-records"><summary>记录：业主签名 ${nOwner} · 下单 ${nBatch} · 工厂 / 负责人签字 ${signed.length}</summary>
   ${owner?`<b>业主签名</b><ul>${owner}</ul>`:''}${batches}${so?`<b>工厂 / 负责人签字</b><ul>${so}</ul>`:''}</details>`;
 }
 function panel(w,tracking,options){
  const t=tracking||empty,items=t.items.filter(i=>i.work_order_id===w.id&&i.stage!=='cancelled');
  if(!items.length||w.cancelled_at)return '';
  const o={locked:!!options?.locked,manager:!!options?.manager,signoffsReady:Array.isArray(t.signoffs),signoffs:(t.signoffs||[]).filter(x=>x.work_order_id===w.id)};
  const now=signBlock(w,items,t,o)+orderBlock(items,o)+stepBlocks(items,o)+pendingSignoffs(o);
  return `<div class="fulfillment" data-wo="${w.id}">${progress(items)}${itemList(items,o)}${now?`<div class="fx-now"><b class="fx-now-title">现在要做</b>${now}</div>`:''}${moreBlock(items,o)}${records(w,items,t,o)}<p data-feedback role="status" aria-live="polite"></p></div>`;
 }
 async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
 async function upload(sb,projectId,input,label){
  const f=input?.files?.[0];if(!f)throw new Error(`请先选择${label}`);
  const ext=(f.name.split('.').pop()||'').toLowerCase(),path=`${projectId}/fulfillment/${crypto.randomUUID()}.${ext}`;
  const hash=await sha256(await f.arrayBuffer());
  const {error}=await sb.storage.from(BUCKET).upload(path,f,{upsert:false,contentType:f.type});
  if(error)throw new Error(`${label}上传失败：${error.message}`);
  return {path,hash};
 }
 function bind(el,ctx){
  let busy=false;
  el.addEventListener('click',async e=>{
   const btn=e.target.closest('[data-act]');if(!btn||!el.contains(btn))return;
   const root=btn.closest('[data-wo]'),box=btn.closest('[data-form]')||root,feedback=root.querySelector('[data-feedback]');
   if(busy)return;busy=true;feedback.textContent='正在处理…';
   const v=n=>box.querySelector(`[data-f="${n}"]`)?.value??'',input=n=>box.querySelector(`[data-f="${n}"]`);
   const picked=[...root.querySelectorAll('[data-line]:checked')].map(x=>x.dataset.line);
   const base={work_order_id:root.dataset.wo};if(picked.length)base.line_ids=picked;
   const project=ctx.project(),act=btn.dataset.act;
   const send=async(action,data)=>{const {error}=await ctx.sb.rpc('renovation_fulfillment_command',{p_id:project.id,p_revision:project.revision,p_action:action,p_data:data});if(error)throw error;await ctx.onChange();const again=document.querySelector(`[data-wo="${root.dataset.wo}"]`);if(again)again.closest('details').open=true;ctx.message('已保存');};
   try{
    if(act==='copy_link'){const url=new URL('renovation-custom-sign.html',location.href);url.searchParams.set('confirmation',btn.dataset.id);url.searchParams.set('sign',btn.dataset.token);await navigator.clipboard.writeText(url.href);feedback.textContent='已复制，请发给业主。业主须输入登记手机号后四位才能查看和签名。';}
    else if(act==='signoff_create'){
     const docInput=input('so_doc'),f=docInput?.files?.[0]?await upload(ctx.sb,project.id,docInput,'附件'):null;
     const {data,error}=await ctx.sb.rpc('renovation_signoff_command',{p_id:project.id,p_action:'create',p_data:{work_order_id:root.dataset.wo,line_ids:picked,purpose:v('purpose'),party:v('party'),note:v('so_note'),document_path:f?.path||null,document_sha256:f?.hash||null}});
     if(error)throw error;
     const url=new URL('renovation-party-sign.html',location.href);url.searchParams.set('signoff',data.id);url.searchParams.set('sign',data.token);
     try{await navigator.clipboard.writeText(url.href);}catch(e){}
     await ctx.onChange();const again=document.querySelector(`[data-wo="${root.dataset.wo}"]`);if(again)again.closest('details').open=true;
     const fb=document.querySelector(`[data-wo="${root.dataset.wo}"] [data-feedback]`);if(fb)fb.textContent=`签字链接已复制。验证码 ${data.code}，请另外单独发给对方（下方记录里也能看到）。`;
     ctx.message('已生成签字链接');
    }
    else if(act==='signoff_copy_link'){const url=new URL('renovation-party-sign.html',location.href);url.searchParams.set('signoff',btn.dataset.id);url.searchParams.set('sign',btn.dataset.token);await navigator.clipboard.writeText(url.href);feedback.textContent='链接已复制。验证码请另外单独发给对方。';}
    else if(act==='signoff_copy_code'){await navigator.clipboard.writeText(btn.dataset.code);feedback.textContent=`验证码 ${btn.dataset.code} 已复制。`;}
    else if(act==='signoff_void'){const {error}=await ctx.sb.rpc('renovation_signoff_command',{p_id:project.id,p_action:'void',p_data:{signoff_id:btn.dataset.id,reason:v('reason')}});if(error)throw error;await ctx.onChange();ctx.message('已撤销');}
    else if(act==='view_file'){const {data,error}=await ctx.sb.storage.from(BUCKET).createSignedUrl(btn.dataset.path,300);if(error)throw error;window.open(data.signedUrl,'_blank','noopener');feedback.textContent='';}
    else if(act==='request_signature'){const f=await upload(ctx.sb,project.id,input('document'),'定稿图纸或确认文件');await send(act,{...base,document_path:f.path,document_sha256:f.hash,note:v('note')});}
    else if(act==='request_change'){if(!picked.length)throw new Error('请勾选要修改的清单项');const f=await upload(ctx.sb,project.id,input('document'),'改单图纸或文件');await send('request_signature',{...base,document_path:f.path,document_sha256:f.hash,change_note:v('change_note')});}
    else if(act==='submit_paper'){const f=await upload(ctx.sb,project.id,input('paper'),'纸质确认单扫描件');await send(act,{confirmation_id:btn.dataset.id,paper_path:f.path,paper_sha256:f.hash,signer_name:v('signer_name'),signer_relation:v('signer_relation')});}
    else if(act==='review_paper')await send(act,{confirmation_id:btn.dataset.id,approve:!!btn.dataset.approve});
    else if(act==='void_signature')await send(act,{confirmation_id:btn.dataset.id,reason:v('reason')});
    else if(act==='place_order')await send(act,{...base,supplier:v('supplier'),order_no:v('order_no'),ordered_on:v('ordered_on'),expected_on:v('expected_on'),stock_confirmed:!!input('stock_confirmed')?.checked});
    else if(act==='legacy_order')await send(act,{...base,supplier:v('supplier'),order_no:v('order_no'),ordered_on:v('ordered_on'),expected_on:v('expected_on'),reason:v('reason')});
    else if(act==='correct_batch')await send(act,{batch_id:btn.dataset.id,supplier:v('supplier'),order_no:v('order_no'),expected_on:v('expected_on'),reason:v('reason')});
    else if(act==='arrive'||act==='schedule')await send(act,{...base,on:v('on')});
    else if(act==='start_work')await send(act,base);
    else if(act==='finish'){const needs=!!input('proof');const f=needs?await upload(ctx.sb,project.id,input('proof'),'完工照片或文件'):null;await send(act,{...base,on:v('on'),proof_path:f?.path});}
    else if(act==='flag_issue'){if(!picked.length)throw new Error('请勾选有问题的清单项');await send(act,{...base,note:v('note'),follow_up_on:v('follow_up_on')});}
    else if(act==='resolve_issue'){if(!picked.length)throw new Error('请勾选已解决的清单项');await send(act,base);}
   }catch(err){const now=document.querySelector(`[data-wo="${root.dataset.wo}"] [data-feedback]`)||feedback;now.textContent=err.message||String(err);}
   finally{busy=false;}
  });
 }
 async function load(sb,projectId){
  const r=await Promise.all(['renovation_work_items','renovation_custom_confirmations','renovation_purchase_batches'].map(t=>sb.from(t).select('*').eq('project_id',projectId)));
  for(const x of r)if(x.error)throw x.error;
  const so=await sb.from('renovation_party_signoffs').select('*').eq('project_id',projectId);
  return {items:r[0].data||[],confirmations:r[1].data||[],batches:r[2].data||[],signoffs:so.error?null:(so.data||[])};
 }
 return {panel,headline,bind,load,buckets};
})();
