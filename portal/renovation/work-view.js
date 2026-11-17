'use strict';
window.RenoWorkView=(()=>{
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>Number(n||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
 const statuses={draft:'草稿',assigned:'已分配',working:'进行中',done:'已完成'};
 const types={material:'材料与产品',construction:'硬装施工',gift:'赠品与设计服务',mixed:'含多类内容的执行单'};
 const shortGroup=(name,items)=>{const m=/^增项-[0-9a-f-]{36} · ?(.*)$/i.exec(String(name||''));if(!m)return name;const n=(items||[]).filter(Boolean);return n.length?`增项：${n.slice(0,2).join('、')}${n.length>2?` 等${n.length}项`:''}${m[1]?`（${m[1]}）`:''}`:`增项${m[1]?' · '+m[1]:''}`;};
 const classify=l=>['custom','stock'].includes(l.kind)?'material':l.kind==='work'?'construction':l.kind==='gift'?'gift':'mixed';
 function line(l){return `<article class="work-product"><h4>#${esc(l.id)} · ${esc(l.name)}</h4>${l.en?`<p class="muted">${esc(l.en)}</p>`:''}<dl class="work-data"><div><dt>规格／尺寸／施工范围</dt><dd>${esc(l.spec||'合同未单独注明，请结合项目名称及原合同核对')}</dd></div>${l.category?`<div><dt>所属区域／类别</dt><dd>${esc(l.category)}</dd></div>`:''}<div><dt>合同数量</dt><dd>${esc(l.qty)} ${esc(l.unit)}</dd></div><div><dt>合同单价</dt><dd>RM ${money(l.rate)} / ${esc(l.unit)}</dd></div><div><dt>合同清单金额</dt><dd>RM ${money(Number(l.qty)*Number(l.rate))}</dd></div><div><dt>执行内容</dt><dd>${{custom:'定制产品供应',stock:'现货材料供应',work:'按合同施工范围执行',gift:'合同赠送项目'}[l.kind]||'待核对'}</dd></div>${l.page?`<div><dt>原合同页码</dt><dd>第 ${esc(l.page)} 页</dd></div>`:''}</dl>${l.warranties?.length?`<div class="work-terms"><b>部件质保及依据</b>${l.warranties.map(w=>`<p>${esc(w.component)} · ${w.years?esc(w.years)+'年':'期限待确认'}<br><span class="muted">${esc(w.source||'依据待补充')}</span></p>`).join('')}</div>`:''}</article>`;}
 function render(work,snapshot,locked,tracking,options){
  const F=window.RenoFulfillment;
  const groups={material:[],construction:[],gift:[],mixed:[]},cards=[],byId=new Map(snapshot.lines.map(l=>[String(l.id),l])),removed=new Set((snapshot.deductions||[]).map(d=>String(d.line_id)));
  work.forEach((w,i)=>{
   if(w.cancelled_at){cards.push({rank:4,cat:'mixed',keys:['done'],html:`<details class="work" data-fx="done"><summary>增项已作废 · ${esc(shortGroup(w.group_name,w.line_ids.map(id=>byId.get(String(id))?.name)))}</summary><p>此增项及执行单已作废，不再计费或安排施工。</p></details>`});groups.mixed.push(`<details class="work"><summary>增项已作废 · ${esc(shortGroup(w.group_name,w.line_ids.map(id=>byId.get(String(id))?.name)))}</summary><p>此增项及执行单已作废，不再计费或安排施工。</p></details>`);return;}
   const lines=w.line_ids.map(id=>byId.get(String(id))).filter(Boolean),missing=w.line_ids.filter(id=>!byId.has(String(id))),kinds=new Set(lines.map(classify));
   const category=kinds.size===1&&!missing.length?[...kinds][0]:'mixed';
   const contents=['material','construction','gift','mixed'].map(k=>{const list=lines.filter(l=>classify(l)===k);return list.length?`<div class="work-category"><h3>${types[k]} · ${list.length}项</h3>${list.map(line).join('')}</div>`:'';}).join('');
   // 跟踪面板已经逐项列出清单，所以合同明细（单价、金额、质保）默认收起；没有跟踪面板时直接展开
   const panel=F?F.panel(w,tracking,{locked,manager:options?.manager}):'';
   const st=F?.state?.(w,tracking);
   const card=`<details class="work" data-fx="${esc((st?.keys||['other']).join(' '))}"><summary><span class="type ${category==='material'?'product':'renovation'}">${esc(types[category])}</span> <b>${esc(shortGroup(w.group_name,lines.map(l=>l.name)))}</b> · ${lines.length}项 ${F?.badges?.(w,tracking)||`· ${esc(F?.headline(w,tracking)||statuses[w.status]||w.status)}`}</summary><div class="work-controls fx-assignee"><label>执行人（师傅或外部负责人）<input id="assignee-${i}" value="${esc(w.assignee)}" ${locked||w.cancelled_at?'disabled':''}></label><button data-work="${i}" ${locked||w.cancelled_at?'disabled':''}>保存执行人</button></div>${panel}<details class="work-contract"${panel?'':' open'}><summary>合同明细（规格、单价、金额、质保）· ${lines.length}项</summary>${contents}${missing.filter(id=>removed.has(String(id))).length?`<p class="muted">已由客户签署减项、不再执行：${missing.filter(id=>removed.has(String(id))).map(esc).join('、')}</p>`:''}${missing.filter(id=>!removed.has(String(id))).length?`<p class="warning">清单项 ${missing.filter(id=>!removed.has(String(id))).map(esc).join('、')} 未在当前合同版本中找到，请核对原合同。</p>`:''}<p class="muted">以上为合同清单金额，整单优惠在主合同结算；本子单不另收客户费用。施工项包含的辅材以合同范围为准。</p></details></details>`;
   groups[category].push(card);cards.push({rank:st?st.rank:1.5,cat:category,keys:st?.keys||['other'],html:card});
  });
  // 有履约跟踪时：顶部总览（点一下只看这一类），要处理的子单排前面，已完成的收到最下面
  if(F?.state&&tracking&&cards.some(c=>c.keys[0]!=='other')){
   const order=['material','construction','gift','mixed'],sorted=[...cards].sort((a,b)=>a.rank-b.rank||order.indexOf(a.cat)-order.indexOf(b.cat));
   const live=sorted.filter(c=>c.rank<3),done=sorted.filter(c=>c.rank>=3);
   const labels=[['issue','⚠ 有问题','bad'],['sign','待业主签名','now'],['order','待下单','now'],['arrive','待到货','now'],['schedule','待排期','now'],['finish','待完成','now'],['wait','等对方签字','wait'],['done','已完成','ok']];
   const count=k=>cards.filter(c=>c.keys.includes(k)).length;
   const overview=`<div class="fx-overview"><span class="fx-overview-title">共 ${cards.length} 张子单</span>${labels.filter(([k])=>count(k)).map(([k,l,cls])=>`<button type="button" class="fx-chip ${cls}" data-fxfilter="${k}">${l} ${count(k)}</button>`).join('')}<span class="muted fx-overview-hint">点标签只看这一类，再点一次看全部</span></div>`;
   return overview+`<section class="work-section fx-live">${live.map(c=>c.html).join('')||'<p class="muted">没有要处理的子单。</p>'}</section>`+(done.length?`<details class="fx-done work-section"><summary>已完成 ${done.length} 张</summary>${done.map(c=>c.html).join('')}</details>`:'');
  }
  return Object.entries(groups).filter(([,cards])=>cards.length).map(([type,cards])=>`<section class="work-section work-${type}"><h3>${types[type]} <span class="muted">${cards.length}张执行单</span></h3>${cards.join('')}</section>`).join('')||'<p>尚未生成子订单，确认合同后可按清单生成。</p>';
 }
 return {render,classify};
})();
