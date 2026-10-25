'use strict';
(async()=>{
 const $=id=>document.getElementById(id),V=RenoFinanceView,E=V.esc,M=V.money;
 const labels=['查看合同','付款进度','增项确认','工程进度','验收质保'];
 const tips=['打开归档合同，核对工程清单、材料规格与双方约定。','付款计划与实际付款分别记录，待核对现金尚未计入已付。','新增单须经客户在专属链接电子签署后才生效。','执行分组状态由门店登记，不代表仓库实时库存或自动派工。','质保在竣工验收确认后起算，期限未知的部件请联系门店核对。'];
 const states={confirmed:'合同已确认',executing:'工程进行中',accepted:'已竣工验收'};
 const params=new URLSearchParams(location.search),uuid=s=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s||'');
 const token=location.hash.slice(1);let sb,project,step=uuid(params.get('addition'))&&uuid(params.get('sign'))?2:Math.max(0,labels.indexOf(params.get('section'))),tourTimer=null,refreshTimer=null,refreshBusy=false;
 function stopTour(){clearInterval(tourTimer);tourTimer=null;$('customer-tour').textContent='▷ 自动导览';$('customer-tour').setAttribute('aria-pressed','false');}
 function selectStep(index,manual=false){
  if(manual)stopTour();step=index;
  document.querySelectorAll('[data-customer-step]').forEach(el=>el.hidden=Number(el.dataset.customerStep)!==step);
  document.querySelectorAll('#customer-journey [data-step]').forEach(el=>{if(Number(el.dataset.step)===step)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});
  $('customer-step-counter').textContent=String(step+1).padStart(2,'0')+' / 05';$('customer-scene-progress').textContent=`第 ${step+1} 项 · ${labels[step]}`;$('customer-guide-text').textContent=tips[step];$('customer-next').textContent=step===4?'返回合同 →':'查看下一项 →';
  const url=new URL(location.href);url.searchParams.set('section',labels[step]);history.replaceState(null,'',url);
  const scene=document.querySelector(`[data-customer-step="${step}"]`);scene.classList.remove('enter');void scene.offsetWidth;scene.classList.add('enter');
  window.dispatchEvent(new Event('reno:customer-step'));
  if(manual&&innerWidth<761)$('customer-workspace').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
 }
 function renderProject(p){
  const detailsOpen=$('customer-checklist')?.open;
  $('project-status').textContent=states[p.state]||'待门店确认';$('contract-number').textContent=p.contract_no;
  $('project').innerHTML=`<div><span class="project-type">整装项目</span><h2>${E(p.contract_no)}</h2><p>${E(p.address)}</p></div><div class="project-total"><span>${Number(p.additions_total)>0?'项目当前应收总额':'合同金额'}</span><strong>${M(p.net)}</strong>${Number(p.additions_total)>0?`<small>原合同 ${M(p.original_net)} ＋ 增项 ${M(p.additions_total)}</small>`:''}</div>`;
  const lines=Array.isArray(p.lines)?p.lines:[];
  $('lines').innerHTML=`<details id="customer-checklist" ${detailsOpen?'open':''}><summary>我的工程与产品清单 <span class="muted">（${lines.length}项，点击展开）</span></summary>${lines.map(l=>`<article class="customer-line"><h3>${E(l.id)} · ${E(l.name)} ${l.gift?'<span class="type renovation">赠送</span>':''}</h3><p>${E(l.spec||'')} · ${E(l.qty)} ${E(l.unit)}</p></article>`).join('')||'<p>暂无可显示清单，请联系门店核对。</p>'}</details>`;
  $('lines').hidden=false;
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'});
  $('acceptance-status').innerHTML=p.accepted_on?`<div class="callout positive">✓ 竣工验收日期：${E(p.accepted_on)}。以下按部件及合同条款查看质保。</div>`:'<div class="callout">尚未确认竣工验收，以下合同约定质保尚未起算。</div>';
  const opened=new Set([...$('warranty-lines').querySelectorAll('details[open]')].map(el=>el.dataset.line));
  $('warranty-lines').innerHTML=lines.map((l,i)=>`<details class="warranty-card" data-line="${E(l.id??i)}" ${opened.has(String(l.id??i))?'open':''}><summary>${E(l.id)} · ${E(l.name)}</summary>${(l.warranties||[]).map(w=>{
   const end=RenoCore.expires(p.accepted_on,w.years);
   return `<div class="warranty-row"><b>${E(w.component)}</b><span>${w.years?E(w.years)+'年':'期限待确认'} · ${!w.years?'联系HOUZY补充凭证':!p.accepted_on?'竣工验收后起算':`${end<today?'已届满':'质保期内'}，到期日 ${E(end)}`}</span></div><p class="mini-note">依据：${E(w.source||'待补充合同凭证')}</p>`;
  }).join('')||'<p class="mini-note">此项质保范围待确认，请联系HOUZY。</p>'}</details>`).join('')||'<p class="mini-note">暂无部件质保明细，请联系门店核对合同。</p>';
 }
 function renderProgress(data,error){
  const el=$('customer-progress');
  if(error||!data){el.innerHTML='<div class="callout">工程明细暂时无法同步，请刷新档案或联系门店核对；其他已读取资料仍可查看。</div>';return;}
  const work=Array.isArray(data.work_orders)?data.work_orders:[],done=work.filter(w=>w.status==='done').length;
  if(!work.length){el.innerHTML='<div class="callout">门店尚未生成可显示的执行分组，请联系门店了解安排。</div>';return;}
  const status={draft:'待安排',assigned:'已安排',working:'进行中',done:'已完成'};
  el.innerHTML=`<div class="progress-summary"><span>执行分组完成</span><strong>${done} <small>/ ${work.length}</small></strong></div><div class="progress-track" role="progressbar" aria-label="已完成执行分组数量" aria-valuemin="0" aria-valuemax="${work.length}" aria-valuenow="${done}"><span style="width:${done/work.length*100}%"></span></div><p class="mini-note">按已完成分组数量展示，不代表工程量或施工时间占比。</p><div class="execution-list">${work.map(w=>`<article class="execution-item ${w.status==='done'?'done':''}"><span class="execution-icon" aria-hidden="true">${w.status==='done'?'✓':'◷'}</span><div class="execution-copy"><strong>${E(w.group_name)}</strong><small>${w.updated_at?'最近更新 '+E(new Date(w.updated_at).toLocaleDateString('zh-CN',{timeZone:'Asia/Kuala_Lumpur'})):'等待门店更新'}</small></div><span class="status-badge">${E(status[w.status]||'待门店核对')}</span></article>`).join('')}</div><div class="callout">完成全部执行分组后，仍须单独完成竣工验收，质保才开始起算。</div>`;
 }
 function lockUnavailable(text){stopTour();clearInterval(refreshTimer);$('customer-workspace').hidden=true;$('customer-controls').hidden=true;$('customer-guide').hidden=true;$('message').textContent=text;$('message').classList.add('error');}
 try{
  if(!uuid(token))throw new Error('请使用HOUZY发送的完整项目链接，或返回手机号查询。');
  if(!window.supabase)throw new Error('网络组件未加载，请刷新重试。');
  sb=supabase.createClient('https://csabbxiijzghooppayae.supabase.co','sb_publishable__9KY2RRSxb1excfVxBTH_Q_5HtFWxmH',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const initial=await sb.rpc('renovation_customer_view',{p_token:token});
  if(initial.error)throw new Error('暂时无法读取项目，请联系HOUZY核对链接。');
  if(!initial.data)throw new Error('项目尚未确认或链接已失效，请联系HOUZY。');
  project=initial.data;renderProject(project);$('customer-workspace').hidden=false;$('customer-controls').hidden=false;$('customer-guide').hidden=false;selectStep(step);
  $('message').textContent='项目档案已读取。请按章节查看合同、款项、工程与质保。';
  const viewButton=$('view-signed-contract');viewButton.hidden=false;
  viewButton.onclick=async()=>{
   stopTour();if(viewButton.disabled)return;viewButton.disabled=true;$('contract-message').textContent='正在准备临时合同链接…';
   try{
    const {data,error}=await sb.functions.invoke('renovation-contract',{body:{token}});
    if(error||!data?.url)throw new Error(data?.error||'暂时无法打开合同，请稍后重试或联系HOUZY。');
    const target=new URL(data.url);
    if(target.protocol!=='https:'||target.hostname!=='csabbxiijzghooppayae.supabase.co'||!target.pathname.startsWith('/storage/v1/object/sign/renovation-contracts/'))throw new Error('合同链接无效，请联系HOUZY。');
    $('contract-message').textContent='合同链接已准备，有效期2分钟。';location.assign(target.href);
   }catch(e){$('contract-message').textContent=e.message;}finally{viewButton.disabled=false;}
  };
  await RenoAdditionSigning.mount(sb,token);$('customer-finance-panel').hidden=false;
  async function refresh(){
   if(refreshBusy)return;refreshBusy=true;$('refresh-payments').disabled=$('refresh-project').disabled=true;
   try{
    const results=await Promise.allSettled([sb.rpc('renovation_customer_view',{p_token:token}),sb.rpc('renovation_customer_payment_view',{p_token:token}),sb.rpc('renovation_customer_progress_view',{p_token:token})]);
    const values=results.map(r=>r.status==='fulfilled'?r.value:{error:r.reason});
    if(!values[0].error&&!values[0].data){lockUnavailable('项目链接已失效或尚未确认，请返回手机号查询或联系门店。');return;}
    const next=values[0].data,finance=values[1].data;
    const changed=next&&(Number(next.scope_revision||0)!==Number(project.scope_revision||0)||next.state!==project.state||Number(next.net)!==Number(project.net));
    if(changed&&(RenoAdditionSigning.isDirty()||RenoAdditionSigning.isBusy())){stopTour();$('payment-sync').textContent='项目资料有更新，请先完成或重新核对当前签署，再刷新档案。';$('message').textContent=$('payment-sync').textContent;return;}
    if(values[0].error||values[1].error||!finance){renderProgress(values[2].data,values[2].error);throw new Error('部分档案暂时无法同步，请刷新重试；下方保留上次读取内容。');}
    if(next&&finance&&(Number(next.scope_revision||0)!==Number(finance.scope_revision||0)||Number(next.net)!==Number(finance.summary.total))){$('payment-sync').textContent='项目资料正在更新，请稍后刷新，暂保留上次读取的内容。';$('message').textContent=$('payment-sync').textContent;return;}
    if(next&&!values[0].error){project=next;renderProject(project);}
    renderProgress(values[2].data,values[2].error);
    await RenoAdditionSigning.refresh();
    if(!RenoAdditionSigning.isDirty()&&!RenoAdditionSigning.isBusy())await RenoAdditionSigning.refreshSigning();
    const opened=[...$('customer-payments').querySelectorAll('details')].map(e=>e.open);
    $('customer-payments').innerHTML=V.customer(finance);$('customer-payments').querySelectorAll('details').forEach((e,i)=>e.open=Boolean(opened[i]));
    $('payment-sync').textContent='已与门店同步 · '+new Date().toLocaleTimeString('zh-CN')+' · 每30分钟自动更新';$('message').textContent='项目档案已更新，付款与工程状态以门店记录为准。';
   }catch(e){$('payment-sync').textContent=e.message;$('message').textContent=e.message;}
   finally{refreshBusy=false;$('refresh-payments').disabled=$('refresh-project').disabled=false;}
  }
  $('customer-journey').onclick=e=>{const b=e.target.closest('[data-step]');if(b)selectStep(Number(b.dataset.step),true);};
  $('customer-next').onclick=()=>selectStep((step+1)%5,true);
  $('customer-tour').onclick=()=>{
   if(tourTimer){stopTour();return;}
   if(RenoAdditionSigning.isDirty()||RenoAdditionSigning.isBusy()){$('message').textContent='请先完成当前签署或重新核对签署内容，再开始导览。';return;}
   $('customer-tour').textContent='Ⅱ 暂停导览';$('customer-tour').setAttribute('aria-pressed','true');
   tourTimer=setInterval(()=>{if(document.hidden||RenoAdditionSigning.isDirty()||RenoAdditionSigning.isBusy()){stopTour();return;}if(step===4){stopTour();return;}selectStep(step+1);},9000);
  };
  $('customer-scenes').addEventListener('pointerdown',stopTour);$('customer-scenes').addEventListener('focusin',stopTour);
  $('refresh-payments').onclick=$('refresh-project').onclick=()=>{stopTour();return refresh();};
  await refresh();if($('customer-workspace').hidden)return;refreshTimer=setInterval(()=>{if(!document.hidden)refresh();},30*60*1000);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopTour();else refresh();});
  window.addEventListener('pagehide',()=>{stopTour();clearInterval(refreshTimer);});
  window.addEventListener('pageshow',e=>{if(e.persisted){refresh();clearInterval(refreshTimer);refreshTimer=setInterval(()=>{if(!document.hidden)refresh();},30*60*1000);}});
 }catch(e){lockUnavailable(e.message);}
})();
