'use strict';
// Sub-order tracking: staff act on the whole sub-order, or tick a few lines for exceptions.
// The database enforces every rule (no signature, no custom order); this page only explains them.
window.RenoFulfillment=(()=>{
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const BUCKET='renovation-fulfillment';
 const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'});
 const stageNames={custom:{pending:'待业主签名',confirmed:'已签名待下单',ordered:'已下单',arrived:'已到货',done:'已安装'},stock:{pending:'待下单',confirmed:'待下单',ordered:'已下单',arrived:'已到货',done:'已安装'},work:{pending:'待排期',scheduled:'已排期',working:'施工中',done:'已完工'},gift:{pending:'待交付',done:'已交付'}};
 const kindNames={custom:'定制',stock:'现货',work:'施工',gift:'赠品'};
 const empty={items:[],confirmations:[],batches:[]};
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
  const history=all.filter(c=>c.status==='signed').map(c=>`<li>第${c.version}版${c.kind==='change'?'（改单）':''} · ${E(c.signer_name)}（${E(c.signer_relation)}）· ${E(new Date(c.signed_at).toLocaleString('zh-CN'))} · ${c.method==='paper'?'纸质':'电子'}${c.terms?.change_note?` · ${E(c.terms.change_note)}`:''}</li>`).join('');
  let body='';
  if(o.locked){body='';}
  else if(live?.status==='pending')body=`<p><b>等待业主签名</b>（第${live.version}版）。业主须输入登记手机号后四位才能查看。</p><div class="actions"><button type="button" class="secondary" data-act="copy_link" data-id="${live.id}" data-token="${live.signing_token}">复制签名链接</button></div>
   <details><summary>业主已签纸质确认单</summary><div class="work-controls" data-form>${file('扫描件','paper',PDF_IMG)}${field('签名人姓名','signer_name','maxlength="100"')}${relationField}<button type="button" data-act="submit_paper" data-id="${live.id}">提交店长审核</button></div></details>
   <details><summary>撤销这份确认单</summary><div class="work-controls" data-form>${field('撤销原因','reason')}<button type="button" class="secondary" data-act="void_signature" data-id="${live.id}">撤销</button></div></details>`;
  else if(live)body=`<p><b>纸质确认单待审核</b>：${E(live.signer_name)}（${E(live.signer_relation)}）。</p><div class="actions"><button type="button" class="secondary" data-act="view_file" data-path="${E(live.paper_path)}">查看扫描件</button>${o.manager?`<button type="button" data-act="review_paper" data-id="${live.id}" data-approve="1">审核通过</button><button type="button" class="secondary" data-act="review_paper" data-id="${live.id}" data-approve="">退回</button>`:'<span class="muted">须由店长或上级审核</span>'}</div>`;
  else{
   const waiting=customs.filter(i=>['pending','confirmed'].includes(i.stage));
   if(waiting.length)body=`<div class="work-controls" data-form>${file(signed?'新版定稿图纸（旧签名将失效）':'定稿图纸或确认文件','document',PDF_IMG)}${field('备注（选填）','note')}<button type="button" data-act="request_signature">${signed?'重新发起业主签名':'整单发起业主签名'}（${waiting.length}项）</button></div>`;
  }
  return `<div class="work-terms"><b>业主签名 · 定制必签</b>${body}${history?`<ul>${history}</ul>`:''}</div>`;
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
  return `<div class="work-terms"><b>下单记录</b>${list.map(x=>{const waiting=items.some(i=>i.batch_id===x.id&&i.stage==='ordered'),late=waiting&&x.expected_on<now;return `<p>${E(x.supplier)}${x.supplier_order_no?` · 单号 ${E(x.supplier_order_no)}`:''} · 下单 ${E(x.ordered_on)} · 预计到货 ${E(x.expected_on)} · ${items.filter(i=>i.batch_id===x.id).length}项${x.legacy?' · 上线前已下单':''}${late?' <span class="warning">已逾期</span>':''}</p>${o.locked?'':`<details><summary>更正这条记录</summary><div class="work-controls" data-form>${field('厂家','supplier',`value="${E(x.supplier)}"`)}${field('厂家单号','order_no',`value="${E(x.supplier_order_no)}"`)}${field('预计到货日','expected_on',`type="date" value="${E(x.expected_on)}"`)}${field('更正原因','reason')}<button type="button" class="secondary" data-act="correct_batch" data-id="${x.id}">保存更正</button></div></details>`}`;}).join('')}</div>`;
 }
 function stepBlocks(items,o){
  if(o.locked)return '';const b=buckets(items);let html='';
  if(b.arriving.length)html+=`<div class="work-controls" data-form>${field('到货日期','on',`type="date" value="${today()}"`)}<button type="button" data-act="arrive">整单到货（${b.arriving.length}项）</button></div>`;
  if(b.toSchedule.length)html+=`<div class="work-controls" data-form>${field('排期日期','on','type="date"')}<button type="button" data-act="schedule">整单排期（${b.toSchedule.length}项）</button></div>`;
  if(b.toStart.length)html+=`<div class="actions" data-form><button type="button" data-act="start_work">整单开工（${b.toStart.length}项）</button></div>`;
  if(b.finishable.length){const photo=b.finishable.some(i=>i.kind!=='gift');html+=`<div class="work-controls" data-form>${field('完成日期','on',`type="date" value="${today()}"`)}${photo?file('完工照片或文件','proof',PDF_IMG):''}<button type="button" data-act="finish">整单完成（${b.finishable.length}项）</button></div>`;}
  return html?`<div class="work-terms"><b>进度</b>${html}</div>`:'';
 }
 function exceptionBlock(items,o){
  const rows=items.map(i=>`<label class="check"><input type="checkbox" data-line="${E(i.line_id)}" ${o.locked||!open(i)?'disabled':''}> #${E(i.line_id)} ${E(i.name)} · ${kindNames[i.kind]} · ${E(stage(i))}${i.change_pending?' · 改单待签名':''}${i.issue_note?` · <span class="warning">问题：${E(i.issue_note)}（跟进 ${E(i.issue_follow_up_on)}）</span>`:''}</label>`).join('');
  return `<details class="work-terms"><summary>按项查看和处理例外（${items.length}项）</summary>${rows}${o.locked?'':`<p class="muted">勾选后，上方的下单、到货、完成只处理勾选的项，可用于分开下单。</p>
   <div class="work-controls" data-form>${field('问题说明（缺件、破损、尺寸不对等）','note')}${field('跟进日期','follow_up_on','type="date"')}<button type="button" class="secondary" data-act="flag_issue">标记问题</button><button type="button" class="secondary" data-act="resolve_issue">问题已解决</button></div>
   ${items.some(i=>i.kind==='custom')?`<div class="work-controls" data-form>${field('改单内容（已下单后修改）','change_note')}${file('改单图纸或文件','document',PDF_IMG)}<button type="button" class="secondary" data-act="request_change">发起改单签名</button></div>`:''}`}</details>`;
 }
 function panel(w,tracking,options){
  const t=tracking||empty,items=t.items.filter(i=>i.work_order_id===w.id&&i.stage!=='cancelled');
  if(!items.length||w.cancelled_at)return '';
  const o={locked:!!options?.locked,manager:!!options?.manager};
  return `<div class="fulfillment" data-wo="${w.id}">${signBlock(w,items,t,o)}${orderBlock(items,o)}${batchBlock(w,items,t,o)}${stepBlocks(items,o)}${exceptionBlock(items,o)}<p data-feedback role="status" aria-live="polite"></p></div>`;
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
  return {items:r[0].data||[],confirmations:r[1].data||[],batches:r[2].data||[]};
 }
 return {panel,headline,bind,load,buckets};
})();
