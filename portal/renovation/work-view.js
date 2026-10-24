'use strict';
window.RenoWorkView=(()=>{
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>Number(n||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
 const statuses={draft:'草稿',assigned:'已分配',working:'进行中',done:'已完成'};
 const types={material:'材料与产品',construction:'硬装施工',gift:'赠品与设计服务',mixed:'含多类内容的执行单'};
 const classify=l=>['custom','stock'].includes(l.kind)?'material':l.kind==='work'?'construction':l.kind==='gift'?'gift':'mixed';
 function line(l){return `<article class="work-product"><h4>#${esc(l.id)} · ${esc(l.name)}</h4>${l.en?`<p class="muted">${esc(l.en)}</p>`:''}<dl class="work-data"><div><dt>规格／尺寸／施工范围</dt><dd>${esc(l.spec||'合同未单独注明，请结合项目名称及原合同核对')}</dd></div>${l.category?`<div><dt>所属区域／类别</dt><dd>${esc(l.category)}</dd></div>`:''}<div><dt>合同数量</dt><dd>${esc(l.qty)} ${esc(l.unit)}</dd></div><div><dt>合同单价</dt><dd>RM ${money(l.rate)} / ${esc(l.unit)}</dd></div><div><dt>合同清单金额</dt><dd>RM ${money(Number(l.qty)*Number(l.rate))}</dd></div><div><dt>执行内容</dt><dd>${{custom:'定制产品供应',stock:'现货材料供应',work:'按合同施工范围执行',gift:'合同赠送项目'}[l.kind]||'待核对'}</dd></div>${l.page?`<div><dt>原合同页码</dt><dd>第 ${esc(l.page)} 页</dd></div>`:''}</dl>${l.warranties?.length?`<div class="work-terms"><b>部件质保及依据</b>${l.warranties.map(w=>`<p>${esc(w.component)} · ${w.years?esc(w.years)+'年':'期限待确认'}<br><span class="muted">${esc(w.source||'依据待补充')}</span></p>`).join('')}</div>`:''}</article>`;}
 function render(work,snapshot,locked){
  const groups={material:[],construction:[],gift:[],mixed:[]},byId=new Map(snapshot.lines.map(l=>[String(l.id),l]));
  work.forEach((w,i)=>{
   const lines=w.line_ids.map(id=>byId.get(String(id))).filter(Boolean),missing=w.line_ids.filter(id=>!byId.has(String(id))),kinds=new Set(lines.map(classify));
   const category=kinds.size===1&&!missing.length?[...kinds][0]:'mixed';
   const contents=['material','construction','gift','mixed'].map(k=>{const list=lines.filter(l=>classify(l)===k);return list.length?`<div class="work-category"><h3>${types[k]} · ${list.length}项</h3>${list.map(line).join('')}</div>`:'';}).join('');
   groups[category].push(`<details class="work"><summary><span class="type ${category==='material'?'product':'renovation'}">${esc(types[category])}</span> <b>${esc(w.group_name)}</b> · ${esc(statuses[w.status]||w.status)} · ${lines.length}项</summary>${contents}${missing.length?`<p class="warning">清单项 ${missing.map(esc).join('、')} 未在当前合同版本中找到，请核对原合同。</p>`:''}<p class="muted">以上为合同清单金额，整单优惠在主合同结算；本子单不另收客户费用。施工项包含的辅材以合同范围为准。</p><div class="work-controls"><label>负责人<input id="assignee-${i}" value="${esc(w.assignee)}" ${locked?'disabled':''}></label><label>状态<select id="work-status-${i}" ${locked?'disabled':''}>${Object.entries(statuses).map(([v,n])=>`<option value="${v}" ${v===w.status?'selected':''}>${n}</option>`).join('')}</select></label><button data-work="${i}" ${locked?'disabled':''}>保存进度</button></div></details>`);
  });
  return Object.entries(groups).filter(([,cards])=>cards.length).map(([type,cards])=>`<section class="work-section work-${type}"><h3>${types[type]} <span class="muted">${cards.length}张执行单</span></h3>${cards.join('')}</section>`).join('')||'<p>尚未生成子订单，确认合同后可按清单生成。</p>';
 }
 return {render,classify};
})();
