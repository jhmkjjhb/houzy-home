'use strict';
// Sub-order tracking: staff act on the whole sub-order, or tick a few lines for exceptions.
// The database enforces every rule (no signature, no custom order); this page only explains them.
window.RenoFulfillment=(()=>{
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const BUCKET='renovation-fulfillment';
 // 图纸 / 附件：载入时就签好链接，按钮是真正的链接，手机和微信点了直接打开（不靠弹窗）
 let fileUrls={},fileUrlsAt=0;
 const soMessage=btn=>{const url=new URL('renovation-party-sign.html',location.href);url.searchParams.set('signoff',btn.dataset.id);url.searchParams.set('sign',btn.dataset.token);return url.href;}; // 只复制链接；清单在链接页面里看
 const fileBtn=(path,label)=>{const u=fileUrls[path];return u?`<a class="fx-file-link" href="${E(u)}" target="_blank" rel="noopener" data-act="view_file" data-path="${E(path)}">${label}</a>`:`<button type="button" class="secondary" data-act="view_file" data-path="${E(path)}">${label}</button>`;};
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

 // 子单标题行上的彩色状态：绿 = 已完成的步骤，黄 = 现在这一步，紫 = 等别人签字，红 = 有问题，灰 = 还没到
 // 一张子单现在的状态。keys 用于项目总览的筛选；rank 用于排序（0 有问题 → 1 要我处理 → 2 等别人签字 → 3 已完成）
 function state(w,tracking){
  const t=tracking||empty,items=t.items.filter(i=>i.work_order_id===w.id&&i.stage!=='cancelled');
  if(!items.length)return null;
  const chips=[],keys=new Set(),add=(cls,txt)=>chips.push({cls,txt});
  const customs=items.filter(i=>i.kind==='custom'),goods=items.filter(i=>['custom','stock'].includes(i.kind)),works=items.filter(i=>i.kind==='work');
  const allDone=items.every(i=>i.stage==='done');
  const doneWord=works.length===items.length?'已完工':works.length?'已完成':'已交付';
  let mine=false;
  if(/^增项-/.test(String(w.group_name||''))&&!allDone)add('ok step','✓ 业主已签增项');
  if(allDone){add('ok final','✓ '+doneWord);keys.add('done');}
  else{
   let cur=false;
   const step=(key,n,total,doneTxt,todoTxt)=>{if(!total)return;if(n>=total){add('ok step','✓ '+doneTxt);return;}if(cur){add('later',todoTxt);return;}add('now',n?`${doneTxt} ${n}/${total}`:todoTxt);cur=true;mine=true;keys.add(key);};
   const live=(t.confirmations||[]).find(c=>c.work_order_id===w.id&&['pending','paper_review'].includes(c.status));
   if(customs.length){const n=customs.filter(i=>i.stage!=='pending').length;if(live&&n<customs.length){add('wait',live.status==='pending'?'等业主签名':'纸质单待审核');cur=true;keys.add('wait');if(live.status==='paper_review'){mine=true;keys.add('sign');}}else step('sign',n,customs.length,'已签字','待业主签名');}
   step('order',goods.filter(i=>['ordered','arrived','done'].includes(i.stage)).length,goods.length,'已下单','待下单');
   step('arrive',goods.filter(i=>['arrived','done'].includes(i.stage)).length,goods.length,'已到货','待到货');
   step('schedule',works.filter(i=>['scheduled','working','done'].includes(i.stage)).length,works.length,'已排期','待排期');
   step('finish',items.filter(i=>i.stage==='done').length,items.length,doneWord,doneWord==='已交付'?'待交付':'待完工');
  }
  const issues=items.filter(i=>i.issue_note).length;if(issues){add('bad',`⚠ ${issues}项有问题`);keys.add('issue');}
  if((t.signoffs||[]).some(x=>x.work_order_id===w.id&&x.status==='pending')){add('wait','等工厂 / 负责人签字');keys.add('wait');}
  const rank=issues?0:allDone?3:mine?1:2;
  return {chips,keys:[...keys],rank,okCount:chips.filter(c=>c.cls==='ok step').length};
 }
 // 子单标题行上的彩色状态：绿 = 已完成的步骤，黄 = 现在这一步，紫 = 等别人签字，红 = 有问题，灰 = 还没到
 // 手机上已完成的步骤收成一个「✓N」，灰色的后续步骤不显示
 function badges(w,tracking){
  const st=state(w,tracking);if(!st)return '';
  return `<span class="fx-chips">${st.chips.map(c=>`<span class="fx-chip ${c.cls}">${c.txt}</span>`).join('')}${st.okCount?`<span class="fx-chip okn">✓${st.okCount}</span>`:''}</span>`;
 }
 let filter='all';
 const picking=new Set(); // 哪些子单正在「只处理其中几项」
 // 标题行右边的按钮：就是下一步。复制签名链接直接复制；其它的打开子单并跳到要填的地方
 function primary(w,tracking,options){
  const t=tracking||empty,items=t.items.filter(i=>i.work_order_id===w.id&&i.stage!=='cancelled');
  if(!items.length||w.cancelled_at||options?.locked||items.every(i=>i.stage==='done'))return null;
  if(items.some(i=>i.issue_note))return {label:'处理问题'};
  const b=buckets(items),so=(t.signoffs||[]).filter(x=>x.work_order_id===w.id&&x.status==='signed');
  const covered=(p,ok)=>so.some(x=>x.purpose===p&&items.some(i=>(x.line_ids||[]).includes(i.line_id)&&ok(i)));
  if(covered('arrival',i=>i.stage==='ordered'&&free(i)))return {label:'确认到货（对方已签）'};
  if(covered('install',i=>b.finishable.includes(i)))return {label:'确认完工（对方已签）'};
  const live=(t.confirmations||[]).find(c=>c.work_order_id===w.id&&['pending','paper_review'].includes(c.status));
  if(b.unsigned.length&&!live)return {label:'发起业主签名'};
  if(live?.status==='paper_review')return {label:options?.manager?'审核纸质确认单':'查看纸质确认单'};
  if(b.orderable.length){const all=t.signoffs?(t.signoffs||[]).filter(x=>x.work_order_id===w.id&&x.purpose==='order'&&x.status!=='voided'):null;
   const need=all&&b.orderable.some(i=>i.kind==='custom'&&!all.some(x=>(x.line_ids||[]).includes(i.line_id)));
   return {label:need?'转发工厂确认':'下单'};}
  if(live?.status==='pending')return {label:'复制签名链接',copy:{id:live.id,token:live.signing_token}};
  if(b.arriving.length)return {label:'到货'};
  if(b.toSchedule.length)return {label:'排期'};
  if(b.toStart.length)return {label:'开工'};
  if(b.finishable.length)return {label:b.finishable.every(i=>i.kind==='gift')?'交付':'完工'};
  return null;
 }
 const field=(label,name,attrs='')=>`<label>${label}<input data-f="${name}" ${attrs}></label>`;
 // 手机上分成「拍照」和「相册 / 文件」两个按钮；拍的照片放进同一个输入框，上传逻辑不变
 const file=(label,name,accept)=>`<div class="fx-file"><span class="fx-file-label">${label}</span><div class="fx-file-btns">${/image/.test(accept)?`<label class="fx-pick">📷 拍照<input class="fx-file-input" data-cam type="file" accept="image/jpeg,image/png,image/webp" capture="environment"></label>`:''}<label class="fx-pick">🖼 相册 / 文件<input class="fx-file-input" data-f="${name}" type="file" accept="${accept}"></label></div><span class="fx-file-name muted">未选择</span></div>`;
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
  else if(live)body=`<p><b>纸质确认单待审核</b>：${E(live.signer_name)}（${E(live.signer_relation)}）。</p><div class="actions">${fileBtn(live.paper_path,'查看扫描件')}${o.manager?`<button type="button" data-act="review_paper" data-id="${live.id}" data-approve="1">审核通过</button><button type="button" class="secondary" data-act="review_paper" data-id="${live.id}" data-approve="">退回</button>`:'<span class="muted">须由店长或上级审核</span>'}</div>`;
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
   <div class="actions">${fileBtn(c.document_path,'查看签名时的图纸')}${c.paper_path?`${fileBtn(c.paper_path,'查看纸质确认单')}`:''}</div>
   ${c.method==='electronic'&&c.signature_strokes?`<p>手写签名：</p>${sigSvg(c.signature_strokes)}`:''}</details></li>`).join('');
 }
 function orderBlock(items,o){
  if(o.locked)return '';
  const b=buckets(items),hasStock=b.orderable.some(i=>i.kind==='stock');
  const legacy=o.manager?items.filter(i=>i.legacy_eligible&&['pending','confirmed'].includes(i.stage)&&['custom','stock'].includes(i.kind)):[];
  // 工厂签字确认时填过的厂家、单号、出货日期，直接带进下单表（可改）
  const fs=(o.signoffs||[]).filter(x=>x.status==='signed'&&x.purpose==='order'&&x.ship_on).sort((a,b)=>String(b.signed_at).localeCompare(String(a.signed_at)))[0];
  const val=x=>x?` value="${E(x)}"`:'';
  const form=(prefix='',pre=null)=>`${field('厂家','supplier','maxlength="120"'+val(pre?.signer_company))}${field(prefix||'厂家单号','order_no','maxlength="120"'+val(pre?.factory_ref))}${field('下单日期','ordered_on',`type="date" value="${today()}"`)}${field(pre?.ship_on?'预计到货日（工厂说 '+E(pre.ship_on)+' 出货）':'预计到货日','expected_on','type="date"'+val(pre?.ship_on))}`;
  const legacyHtml=legacy.length?`<details><summary>登记上线前已下单（店长）</summary><div class="work-controls" data-form>${form()}${field('下单情况说明','reason')}<button type="button" class="secondary" data-act="legacy_order">登记历史订单（${legacy.length}项）</button></div></details>`:'';
  if(!b.orderable.length)return (b.unsigned.length?`<div class="work-terms"><b>下单</b><p class="muted">定制项须先由业主签名，才能下单。</p>${legacyHtml}</div>`:legacyHtml?`<div class="work-terms">${legacyHtml}</div>`:'');
  const confirmed=new Set((o.signoffs||[]).filter(x=>x.status==='signed'&&x.purpose==='order').flatMap(x=>x.line_ids||[]));
  const unconfirmed=o.signoffsReady?b.orderable.filter(i=>i.kind==='custom'&&!confirmed.has(i.line_id)):[];
  // 定制项先转发工厂确认下单内容（第 1 步），再下单（第 2 步）。这是常规步骤，不放在「更多操作」里
  const pendOrder=(o.signoffs||[]).filter(x=>x.status==='pending'&&x.purpose==='order'&&unconfirmed.some(i=>(x.line_ids||[]).includes(i.line_id)));
  const step1=!unconfirmed.length?'':pendOrder.length
   ?`<div class="fx-step fx-step-wait"><b>第 1 步 · 已转发工厂确认，等对方签字</b><p class="muted">${pendOrder.map(x=>`${E(x.party)}：验证码 <b class="mono">${E(x.access_code)}</b>`).join('；')}。签字后厂家、单号、出货日期会自动带进下单。</p><div class="actions"><button type="button" class="secondary" data-act="signoff_copy_link" data-id="${pendOrder[0].id}" data-token="${pendOrder[0].signing_token}">复制链接</button><button type="button" class="secondary" data-act="goto_signoff" data-purpose="order">再转发一份</button></div>${soInline('order',o)}</div>`
   :`<div class="fx-step"><b>第 1 步 · 转发给工厂确认下单内容</b><p class="muted">${unconfirmed.length} 项定制：${unconfirmed.map(i=>E(i.name)).join('、')}。工厂会看到清单、业主签名时的图纸和签名，并填写出货日期后签字。</p>${soInline('order',o,true)}</div>`;
  return `<div class="work-terms"><b>下单</b>${b.unsigned.length?`<p class="muted">还有 ${b.unsigned.length} 项定制未签名，这次不会下单。</p>`:''}${step1}<div class="${step1?'fx-step':''}">${step1?`<b>第 2 步 · 下单</b>${pendOrder.length||!unconfirmed.length?'':'<p class="muted">工厂签字后再下单最稳妥；急的话也可以先下单。</p>'}`:''}<div class="work-controls" data-form>${form('',fs)}${hasStock?`<label class="check"><input data-f="stock_confirmed" type="checkbox">现货规格和数量已与业主确认</label>`:''}<button type="button" data-act="place_order">整单下单（${b.orderable.length}项）</button>${o.signoffsReady&&!step1?`<button type="button" class="secondary" data-act="goto_signoff" data-purpose="order">转发给工厂确认下单内容</button>`:''}</div>${step1?'':soInline('order',o)}</div>${legacyHtml}</div>`;
 }
 function batchBlock(w,items,tracking,o){
  const list=tracking.batches.filter(x=>x.work_order_id===w.id);if(!list.length)return '';
  const now=today();
  return `<b>下单记录</b>${list.map(x=>{const waiting=items.some(i=>i.batch_id===x.id&&i.stage==='ordered'),late=waiting&&x.expected_on<now;return `<p>${E(x.supplier)}${x.supplier_order_no?` · 单号 ${E(x.supplier_order_no)}`:''} · 下单 ${E(x.ordered_on)} · 预计到货 ${E(x.expected_on)} · ${items.filter(i=>i.batch_id===x.id).length}项${x.legacy?' · 上线前已下单':''}${late?' <span class="warning">已逾期</span>':''}</p>${o.locked?'':`<details><summary>更正这条记录</summary><div class="work-controls" data-form>${field('厂家','supplier',`value="${E(x.supplier)}"`)}${field('厂家单号','order_no',`value="${E(x.supplier_order_no)}"`)}${field('预计到货日','expected_on',`type="date" value="${E(x.expected_on)}"`)}${field('更正原因','reason')}<button type="button" class="secondary" data-act="correct_batch" data-id="${x.id}">保存更正</button></div></details>`}`;}).join('')}`;
 }
 function soInline(purpose,o,open=false){ // 点「转发…」就在按钮下面展开，不跳到页面别处
  if(!o.signoffsReady)return '';
  return `<div class="work-controls fx-so-inline" data-form data-so-inline="${purpose}"${open?'':' hidden'}><input type="hidden" data-f="purpose" value="${purpose}">${field('签字方（工厂或负责人）','party','maxlength="120"')}${field('给对方的说明（选填）','so_note','maxlength="1000"')}${file('附件：图纸或照片（选填）','so_doc',PDF_IMG)}<button type="button" data-act="signoff_create">生成签字链接</button></div>`;
 }
 function stepBlocks(items,o){ // o.signoffsReady：转发签字功能可用时，每一步旁边给一个转发按钮
  if(o.locked)return '';const b=buckets(items);let html='';
  if(b.arriving.length)html+=`<div class="work-controls" data-form>${field('到货日期','on',`type="date" value="${today()}"`)}<button type="button" data-act="arrive">整单到货（${b.arriving.length}项）</button>${o.signoffsReady?`<button type="button" class="secondary" data-act="goto_signoff" data-purpose="arrival">转发到货验收签字</button>`:''}</div>${soInline('arrival',o)}`;
  if(b.toSchedule.length)html+=`<div class="work-controls" data-form>${field('排期日期','on','type="date"')}<button type="button" data-act="schedule">整单排期（${b.toSchedule.length}项）</button></div>`;
  if(b.toStart.length)html+=`<div class="actions" data-form><button type="button" data-act="start_work">整单开工（${b.toStart.length}项）</button></div>`;
  if(b.finishable.length){const photo=b.finishable.some(i=>i.kind!=='gift');html+=`<div class="work-controls" data-form>${field('完成日期','on',`type="date" value="${today()}"`)}${photo?file('完工照片或文件','proof',PDF_IMG):''}<button type="button" data-act="finish">整单完成（${b.finishable.length}项）</button>${o.signoffsReady?`<button type="button" class="secondary" data-act="goto_signoff" data-purpose="install">转发安装完工签字</button>`:''}</div>${soInline('install',o)}`;}
  return html?`<div class="work-terms"><b>进度</b>${html}</div>`:'';
 }
 // 清单：每项一行。勾选后，下单 / 到货 / 完成 / 标记问题 / 转发签字只处理勾选的项
 function itemList(items,o){
  const done=(o.signoffs||[]).filter(x=>x.status==='signed');
  const tags=i=>done.filter(x=>(x.line_ids||[]).includes(i.line_id)).map(x=>`<span class="fx-tag ok">✓ ${E(PURPOSES[x.purpose])} · ${E(x.signer_company)}</span>`).join('');
  const counts={};items.forEach(i=>{const k=stage(i);counts[k]=(counts[k]||0)+1;});
  const common=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const showStage=i=>items.length===1||stage(i)!==common||i.issue_note||i.change_pending;
  const row=i=>`<label class="fx-row${showStage(i)?'':' same'}"><input type="checkbox" data-line="${E(i.line_id)}" ${o.locked||!open(i)?'disabled':''}><span class="fx-name"><b>${E(i.name)}</b><small>#${E(i.line_id)} · ${kindNames[i.kind]}${i.spec?` · ${E(i.spec)}`:''} · ${E(i.qty??'')} ${E(i.unit)}</small>${i.issue_note?`<small class="warning">⚠ ${E(i.issue_note)}（跟进 ${E(i.issue_follow_up_on)}）</small>`:''}${tags(i)}</span><span class="fx-chip ${i.issue_note?'bad':i.stage==='done'?'ok':i.stage==='pending'?'now':'mid'}">${E(stage(i))}${i.change_pending?' · 改单待签':''}</span></label>`;
  const can=items.filter(i=>!o.locked&&open(i)).length;
  const all=can>1?`<label class="fx-row fx-all"><input type="checkbox" data-allx><span class="fx-name"><b>全选</b><small>勾选全部 ${can} 项（已完成的不能勾）</small></span></label>`:'';
  const pickable=!o.locked&&can>0;
  return `<div class="fx-list">${all}${items.map(row).join('')}</div>${pickable?`<p class="muted fx-hint"><span class="fx-hint-whole">「现在要做」处理整张子单（${items.length} 项）。</span><span class="fx-hint-pick">勾选后，「现在要做」只处理勾选的项。</span> <button type="button" class="fx-link" data-fxpick>${o.picking?'改回整张子单':'只处理其中几项'}</button></p>`:''}`;
 }
 function moreBlock(items,o){
  if(o.locked)return '';
  return `<details class="work-terms fx-more"><summary>更多操作（非常规）：标记问题 · 改单 · 问题处理签字${o.resign?' · 重新发起业主签名':''}</summary>
   ${o.resign?`<div style="margin-top:6px"><b>重新发起业主签名</b>${o.resign}</div>`:''}
   <div class="work-controls" data-form>${field('问题说明（缺件、破损、尺寸不对等）','note')}${field('跟进日期','follow_up_on','type="date"')}<button type="button" class="secondary" data-act="flag_issue">标记问题</button><button type="button" class="secondary" data-act="resolve_issue">问题已解决</button></div>
   ${items.some(i=>i.kind==='custom')?`<div class="work-controls" data-form>${field('改单内容（业主会看到）','change_note')}${file('改单图纸或文件','document',PDF_IMG)}<button type="button" class="secondary" data-act="request_change">发起改单签名</button></div>`:''}
   ${o.signoffsReady?`<div data-form style="margin-top:14px"><b>问题处理签字（转发给负责人）</b><p class="muted">先勾选有问题的项并「标记问题」，再生成链接让负责人处理完签字。下单、到货、完工的转发在上面对应的步骤里。</p>
    <input type="hidden" data-f="purpose" value="issue"><div class="work-controls">${field('签字方（负责人或工厂）','party','maxlength="120"')}${field('给对方的说明（选填）','so_note','maxlength="1000"')}</div>
    <div class="work-controls">${file('附件：图纸或照片（选填）','so_doc',PDF_IMG)}<button type="button" data-act="signoff_create">生成签字链接</button></div></div>`:'<p class="muted">转发签字功能需要先在 Supabase 运行 renovation_party_signoffs_migration.sql。</p>'}</details>`;
 }
 // 对方已签「到货验收」或「安装完工」：把对应的项一键标记到货 / 完成（最后由员工确认）
 function signoffShortcuts(items,o){
  if(o.locked)return '';
  const kl=d=>new Date(d).toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'});
  let html='';
  for(const x of (o.signoffs||[]).filter(x=>x.status==='signed'&&['arrival','install'].includes(x.purpose))){
   const mine=items.filter(i=>(x.line_ids||[]).includes(i.line_id)&&free(i));
   const ready=x.purpose==='arrival'?mine.filter(i=>i.stage==='ordered'):mine.filter(i=>!i.change_pending&&((['custom','stock'].includes(i.kind)&&i.stage==='arrived')||(i.kind==='work'&&i.stage==='working')||(i.kind==='gift'&&i.stage==='pending')));
   if(!ready.length)continue;
   const who=`${E(x.signer_company)} ${E(x.signer_name)} · ${E(new Date(x.signed_at).toLocaleDateString('zh-CN'))}`,names=ready.map(i=>E(i.name)).join('、'),lines=ready.map(i=>E(i.line_id)).join(',');
   if(x.purpose==='arrival')html+=`<div class="actions fx-shortcut" data-form><span>✓ 到货验收已签（${who}）：${names}</span><button type="button" data-act="so_arrive" data-lines="${lines}" data-on="${kl(x.signed_at)}">一键标记到货（${ready.length}项）</button></div>`;
   else html+=`<div class="work-controls fx-shortcut" data-form><span style="flex-basis:100%">✓ 安装完工已签（${who}）：${names}</span>${ready.some(i=>i.kind!=='gift')?file('完工照片或文件','proof',PDF_IMG):''}<button type="button" data-act="so_finish" data-lines="${lines}" data-on="${kl(x.signed_at)}">标记完成（${ready.length}项）</button></div>`;
  }
  return html?`<div class="work-terms"><b>对方已签字，确认后更新进度</b>${html}</div>`:'';
 }
 const soHead=x=>{const ls=x.terms?.lines||[],n=(x.line_ids||[]).length;return `<b>${E(PURPOSES[x.purpose])}</b> · ${E(x.party)} · ${n<=2&&ls.length?ls.map(l=>E(l.name)).join('、'):`${n} 项`}`;}; // 清单在链接里，这里只写项数
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
  const so=signed.map(x=>`<li>${soHead(x)} · ${E(x.signer_company)} ${E(x.signer_name)} · ${E(new Date(x.signed_at).toLocaleString('zh-CN'))}${x.ship_on?`<br>预计出货：<b>${E(x.ship_on)}</b>${x.factory_ref?` · 工厂单号 ${E(x.factory_ref)}`:''}${x.contact_phone?` · 电话 ${E(x.contact_phone)}`:''}`:''}${x.signer_note?`<br>对方备注：<b>${E(x.signer_note)}</b>`:''}
    <details><summary>查看签字</summary>${x.terms?.note?`<p>说明：${E(x.terms.note)}</p>`:''}${x.document_path?`<div class="actions">${fileBtn(x.document_path,'查看附件')}</div>`:''}${sigSvg(x.signature_strokes)}</details></li>`).join('');
  return `<details class="work-terms fx-records"><summary>记录：业主签名 ${nOwner} · 下单 ${nBatch} · 工厂 / 负责人签字 ${signed.length}</summary>
   ${owner?`<b>业主签名</b><ul>${owner}</ul>`:''}${batches}${so?`<b>工厂 / 负责人签字</b><ul>${so}</ul>`:''}</details>`;
 }
 function panel(w,tracking,options){
  const t=tracking||empty,items=t.items.filter(i=>i.work_order_id===w.id&&i.stage!=='cancelled');
  if(!items.length||w.cancelled_at)return '';
  const o={picking:picking.has(w.id),locked:!!options?.locked,manager:!!options?.manager,signoffsReady:Array.isArray(t.signoffs),signoffs:(t.signoffs||[]).filter(x=>x.work_order_id===w.id)};
  const steps=orderBlock(items,o)+stepBlocks(items,o);
  // 下单、排期、完成都要先有执行人（数据库会拦），提前说清楚
  const bk=buckets(items);
  const needAssignee=!o.locked&&(bk.toSchedule.length||bk.finishable.length)&&!String(w.assignee||'').trim()?'<p class="warning fx-need-assignee">⚠ 先在上方填写「执行人」并保存，才能排期和标记完成。</p>':'';
  const now=needAssignee+signoffShortcuts(items,o)+signBlock(w,items,t,o)+steps+pendingSignoffs(o);
  // 先放「现在要做」，再放清单：打开子单第一眼就是要填的东西
  return `<div class="fulfillment${o.picking?' picking':''}" data-wo="${w.id}">${now?`<div class="fx-now"><b class="fx-now-title">现在要做</b>${now}</div>`:''}${itemList(items,o)}${moreBlock(items,o)}${records(w,items,t,o)}<p data-feedback role="status" aria-live="polite"></p></div>`;
 }
 async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
 const picked1=input=>input?.files?.[0]||input?.closest?.('.fx-file')?.querySelector('[data-cam]')?.files?.[0]||null; // 老浏览器里拍的照片留在拍照框
 async function upload(sb,projectId,input,label){
  const f=picked1(input);if(!f)throw new Error(`请先拍照或选择${label}`);
  const ext=(f.name.split('.').pop()||'').toLowerCase(),path=`${projectId}/fulfillment/${crypto.randomUUID()}.${ext}`;
  const hash=await sha256(await f.arrayBuffer());
  const {error}=await sb.storage.from(BUCKET).upload(path,f,{upsert:false,contentType:f.type});
  if(error)throw new Error(`${label}上传失败：${error.message}`);
  return {path,hash};
 }
 function applyFilter(el){
  el.querySelectorAll('[data-fxfilter]').forEach(b=>b.classList.toggle('on',b.dataset.fxfilter===filter));
  el.querySelectorAll('details.work[data-fx]').forEach(d=>{d.hidden=filter!=='all'&&!d.dataset.fx.split(' ').includes(filter);});
  const doneBox=el.querySelector('details.fx-done');if(doneBox){if(filter==='done')doneBox.open=true;doneBox.hidden=filter!=='all'&&filter!=='done';}
 }
 function bind(el,ctx){
  let busy=false;
  // 全选 / 取消全选；单项改动后同步「全选」的勾
  el.addEventListener('change',e=>{
   const fi=e.target.closest?.('.fx-file');
   if(fi&&e.target.type==='file'){const main=fi.querySelector('[data-f]');if(e.target.hasAttribute('data-cam')&&e.target.files.length){try{main.files=e.target.files;}catch(err){}}const f=main.files?.[0]||e.target.files?.[0];fi.querySelector('.fx-file-name').textContent=f?`已选：${f.name}`:'未选择';return;}
   const root=e.target.closest('[data-wo]');if(!root)return;
   const boxes=[...root.querySelectorAll('[data-line]:not(:disabled)')],allx=root.querySelector('[data-allx]');
   if(e.target.matches('[data-allx]'))boxes.forEach(b=>b.checked=e.target.checked);
   else if(allx&&e.target.matches('[data-line]')){const n=boxes.filter(b=>b.checked).length;allx.checked=n===boxes.length;allx.indeterminate=n>0&&n<boxes.length;}
  });
  el.addEventListener('click',async e=>{
   const go=e.target.closest('[data-fxgo],[data-fxcopy]');
   if(go&&el.contains(go)){
    e.preventDefault();e.stopPropagation();const card=go.closest('details.work');
    if(go.dataset.fxcopy){const [cid,tok]=go.dataset.fxcopy.split(':');const url=new URL('renovation-custom-sign.html',location.href);url.searchParams.set('confirmation',cid);url.searchParams.set('sign',tok);
     try{await navigator.clipboard.writeText(url.href);ctx.message('业主签名链接已复制，发给业主即可。业主要输入登记手机号后四位才能查看。');}catch(err){ctx.message('浏览器不让自动复制，请打开子单后点「复制签名链接」。',true);}return;}
    card.open=true;const now=card.querySelector('.fx-now')||card.querySelector('.fulfillment');
    if(now){now.scrollIntoView({block:'center',behavior:'smooth'});now.classList.remove('fx-flash');void now.offsetWidth;now.classList.add('fx-flash');const f=now.querySelector('input:not([type=checkbox]):not([disabled]),button:not([disabled])');if(f)f.focus({preventScroll:true});}
    return;
   }
   const pk=e.target.closest('[data-fxpick]');
   if(pk&&el.contains(pk)){const root=pk.closest('[data-wo]'),id=root.dataset.wo;
    if(picking.has(id)){picking.delete(id);root.querySelectorAll('[data-line],[data-allx]').forEach(b=>{b.checked=false;b.indeterminate=false;});}else picking.add(id);
    root.classList.toggle('picking',picking.has(id));pk.textContent=picking.has(id)?'改回整张子单':'只处理其中几项';return;}
  });
  el.addEventListener('click',e=>{const f=e.target.closest('[data-fxfilter]');if(!f||!el.contains(f))return;filter=filter===f.dataset.fxfilter?'all':f.dataset.fxfilter;applyFilter(el);});
  // 页面重新渲染后，保持刚才选的筛选
  new MutationObserver(()=>{if(el.querySelector('[data-fxfilter]'))applyFilter(el);}).observe(el,{childList:true});
  el.addEventListener('click',async e=>{
   const btn=e.target.closest('[data-act]');if(!btn||!el.contains(btn))return;
   if(btn.tagName==='A'){if(Date.now()-fileUrlsAt<50*60e3)return;e.preventDefault();} // 链接超过 50 分钟就现签一个
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
     if(!v('party').trim()){input('party')?.focus();throw new Error('请先填写「签字方」：工厂名称或负责人名字');}
     const docInput=input('so_doc'),f=picked1(docInput)?await upload(ctx.sb,project.id,docInput,'附件'):null;
     const {data,error}=await ctx.sb.rpc('renovation_signoff_command',{p_id:project.id,p_action:'create',p_data:{work_order_id:root.dataset.wo,line_ids:picked,purpose:v('purpose'),party:v('party'),note:v('so_note'),document_path:f?.path||null,document_sha256:f?.hash||null}});
     if(error)throw error;
     await ctx.onChange();const again=document.querySelector(`[data-wo="${root.dataset.wo}"]`);if(again)again.closest('details').open=true;
     const cb=document.querySelector(`[data-act="signoff_copy_link"][data-id="${data.id}"]`);let copied=false;
     if(cb){try{await navigator.clipboard.writeText(soMessage(cb));copied=true;}catch(e){}}
     const fb=document.querySelector(`[data-wo="${root.dataset.wo}"] [data-feedback]`);if(fb)fb.textContent=copied?`签字链接已复制。验证码 ${data.code} 请另外单独发给对方。`:`签字链接已生成。请点「复制链接」，验证码 ${data.code} 另外单独发。`;
     ctx.message('已生成签字链接');
    }
    else if(act==='so_arrive')await send('arrive',{work_order_id:root.dataset.wo,line_ids:btn.dataset.lines.split(','),on:btn.dataset.on});
    else if(act==='so_finish'){const needs=!!input('proof');const f=needs?await upload(ctx.sb,project.id,input('proof'),'完工照片或文件'):null;await send('finish',{work_order_id:root.dataset.wo,line_ids:btn.dataset.lines.split(','),on:btn.dataset.on,proof_path:f?.path});}
    else if(act==='signoff_copy_link'){await navigator.clipboard.writeText(soMessage(btn));feedback.textContent='链接已复制。对方打开链接、输入验证码后就能看到清单和图纸。验证码请另外单独发。';}
    else if(act==='signoff_copy_code'){await navigator.clipboard.writeText(btn.dataset.code);feedback.textContent=`验证码 ${btn.dataset.code} 已复制。`;}
    else if(act==='signoff_void'){const {error}=await ctx.sb.rpc('renovation_signoff_command',{p_id:project.id,p_action:'void',p_data:{signoff_id:btn.dataset.id,reason:v('reason')}});if(error)throw error;await ctx.onChange();ctx.message('已撤销');}
    else if(act==='view_file'){const tab=window.open('about:blank','_blank');const {data,error}=await ctx.sb.storage.from(BUCKET).createSignedUrl(btn.dataset.path,300);if(error){tab?.close();throw error;}if(tab){tab.opener=null;tab.location.replace(data.signedUrl);}else location.href=data.signedUrl;feedback.textContent='';}
    else if(act==='goto_signoff'){const box=root.querySelector(`[data-so-inline="${btn.dataset.purpose}"]`);if(!box)throw new Error('转发签字功能还没开通');box.hidden=!box.hidden;const party=box.querySelector('[data-f="party"]'),sup=root.querySelector('[data-f="supplier"]')?.value?.trim();if(party&&sup&&!party.value)party.value=sup;if(!box.hidden)party?.focus({preventScroll:true});feedback.textContent=box.hidden?'':'在按钮下面填好签字方，点「生成签字链接」；链接和验证码分开发给对方。';}
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
   }catch(err){const msg=err.message||String(err);const now=document.querySelector(`[data-wo="${root.dataset.wo}"] [data-feedback]`)||feedback;now.textContent=msg;
    // 出错时就在点的按钮下面显示原因，不用往下找
    if(box!==root&&box.isConnected){let m=box.querySelector(':scope > .fx-inline-msg');if(!m){m=document.createElement('p');m.className='fx-inline-msg warning';m.setAttribute('role','alert');box.append(m);}m.textContent=msg;}}
   finally{busy=false;}
  });
 }
 async function load(sb,projectId){
  // 四张表同时读，不排队
  const [so,...r]=await Promise.all(['renovation_party_signoffs','renovation_work_items','renovation_custom_confirmations','renovation_purchase_batches'].map(t=>sb.from(t).select('*').eq('project_id',projectId)));
  for(const x of r)if(x.error)throw x.error;
  const t={items:r[0].data||[],confirmations:r[1].data||[],batches:r[2].data||[],signoffs:so.error?null:(so.data||[])};
  const paths=[...new Set([...t.confirmations.flatMap(c=>[c.document_path,c.paper_path]),...(t.signoffs||[]).map(x=>x.document_path)].filter(Boolean))];
  fileUrls={};
  if(paths.length){try{const {data}=await sb.storage.from(BUCKET).createSignedUrls(paths,3600);for(const x of data||[])if(x.signedUrl&&!x.error)fileUrls[x.path]=x.signedUrl;fileUrlsAt=Date.now();}catch(e){/* 签不出来就退回按钮，点时再签 */}}
  return t;
 }
 return {panel,headline,badges,state,primary,bind,load,buckets};
})();
