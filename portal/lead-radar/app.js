'use strict';
// Pure view helpers (tested in tests/lead-radar-view.cjs); the page wiring follows below.
window.LeadRadarView=(()=>{
 const SERVICES={full_house:'全屋装修',kitchen:'厨房橱柜',wardrobe:'衣柜',bathroom:'浴室',aluminium:'铝合金柜',other:'其他'};
 const PLATFORMS={facebook_group:'Facebook 群',facebook:'Facebook',threads:'Threads',instagram:'Instagram',tiktok:'TikTok',reddit:'Reddit',xiaohongshu:'小红书',lowyat:'Lowyat',youtube:'YouTube',web:'网页'};
 const STATUS={new:'新',replied:'已回复',contacted:'已联系',invalid:'无效',won:'已转客户'};
 const LABELS={ad:'同行广告',irrelevant:'无关',out_of_area:'外地'};
 const LANG={en:'英文',zh:'中文',ms:'马来语'};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const safeUrl=u=>/^https?:\/\//i.test(String(u||''))?String(u):null;
 const age=(i,now)=>now-new Date(i.found_at).getTime();
 function trends(items,days,now=Date.now()){
  const demand=items.filter(i=>i.label==='demand'&&age(i,now)<=days*864e5);
  const tally=pick=>{const m=new Map();for(const i of demand)for(const k of new Set(pick(i).map(x=>String(x||'').trim()).filter(Boolean)))m.set(k,(m.get(k)||0)+1);return [...m].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,6);};
  return {total:demand.length,service:tally(i=>[SERVICES[i.service]||'其他']),area:tally(i=>[i.area]),keywords:tally(i=>(i.keywords||[]).map(k=>String(k).toLowerCase()))};
 }
 function visible(items,f){
  const q=(f.search||'').trim().toLowerCase();
  return items.filter(i=>i.label==='demand'
   &&(!f.service||i.service===f.service)&&(!f.platform||i.platform===f.platform)
   &&(f.state==='all'||(f.state==='done'?i.status!=='new':i.status==='new'))
   &&(!q||[i.title,i.snippet,i.area,(i.keywords||[]).join(' ')].join(' ').toLowerCase().includes(q)))
   .sort((a,b)=>(b.score||0)-(a.score||0)||new Date(b.found_at)-new Date(a.found_at));
 }
 function counts(items,now=Date.now()){
  const month=new Date(now);month.setDate(1);month.setHours(0,0,0,0);
  const demand=items.filter(i=>i.label==='demand');
  return {open:demand.filter(i=>i.status==='new').length,filtered:items.filter(i=>LABELS[i.label]).length,
   handled:demand.filter(i=>i.status==='replied'||i.status==='contacted').length,
   won:demand.filter(i=>i.status==='won'&&i.handled_at&&new Date(i.handled_at)>=month).length};
 }
 function bars(rows){if(!rows.length)return '<p class="radar-note">暂无数据</p>';const max=rows[0][1];return rows.map(([k,v])=>`<div class="radar-bar"><span title="${esc(k)}">${esc(k)}</span><i><b style="width:${Math.round(v/max*100)}%"></b></i><em>${v}</em></div>`).join('');}
 // The first WhatsApp message names the post, so the customer knows why HOUZY is writing.
 function contactText(i){const svc=SERVICES[i.service]||'renovation';
  if(i.lang==='zh')return `您好，我是新山 HOUZY HOME。看到您在网上发帖找${svc}师傅，想了解一下您的需求，可以免费上门量尺报价。`;
  if(i.lang==='ms')return 'Salam, saya dari HOUZY HOME di JB. Saya nampak post anda mencari kontraktor renovation. Boleh saya tahu lebih lanjut? Kami boleh buat ukur tapak percuma.';
  return 'Hi, this is HOUZY HOME in JB. I saw your post looking for a renovation contractor and would be happy to help, including a free site measurement.';}
 function contactUrl(i){const n=String(i.posted_contact||'').replace(/\D/g,'');return /^60\d{9,10}$/.test(n)?`https://wa.me/${n}?text=${encodeURIComponent(contactText(i))}`:null;}
 function card(i){
  const tier=i.score>=80?'hot':i.score>=65?'warm':'cool',done=i.status!=='new',link=safeUrl(i.url),wa=i.invites_contact?contactUrl(i):null;
  const date=i.published_hint?`<span>${esc(i.published_hint)}</span>`:'<span class="radar-chip radar-unverified">日期未验证</span>';
  const used=i.status==='contacted'||i.status==='won';
  return `<article class="radar-card${i.status==='invalid'||i.status==='won'?' radar-done':''}" data-id="${esc(i.id)}">
  <div class="radar-score radar-${tier}"><b>${Number(i.score)||0}</b><small>意向分</small></div>
  <div class="radar-body">
   <div class="radar-meta"><span class="radar-chip radar-service">${esc(SERVICES[i.service]||'其他')}</span><span class="radar-chip">${esc(PLATFORMS[i.platform]||i.platform)}</span>${i.area?`<span>${esc(i.area)}</span>`:''}${date}${LANG[i.lang]?`<span>${LANG[i.lang]}</span>`:''}</div>
   ${i.title?`<h3>${esc(i.title)}</h3>`:''}<p class="radar-quote">${esc(i.snippet)}</p>
   <p class="radar-why"><b>AI 判断：</b>${esc(i.reason)}</p>
   ${wa?`<div class="radar-callbox"><span class="radar-chip radar-call">客户已留号</span><span class="radar-num">${esc(i.posted_contact)}</span><button type="button" class="radar-wa" data-contact="${esc(i.id)}" ${used?'disabled':''}>${used?'已联系过':'WhatsApp 联系（只限一次）'}</button><small>客户在帖子里邀请承包商联系。开头说明是看到他的帖子；客户拒绝后请标记“无效”。</small></div>`:''}
   ${i.suggested_reply?`<details class="radar-reply"><summary>建议回复（带 HOUZY WhatsApp 链接）</summary><p id="reply-${esc(i.id)}">${esc(i.suggested_reply)}</p></details>`:''}
   <div class="radar-actions">${link?`<a class="radar-btn secondary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">打开原帖 ↗</a>`:''}${i.suggested_reply?`<button type="button" data-copy="${esc(i.id)}">复制回复</button>`:''}
    <span class="radar-status">${['replied','invalid','won'].map(s=>`<button type="button" class="secondary" data-mark="${s}" data-id="${esc(i.id)}" aria-pressed="${i.status===s}">${STATUS[s]}</button>`).join('')}${done?`<button type="button" class="secondary" data-mark="new" data-id="${esc(i.id)}">撤销</button>`:''}</span></div>
   ${done?`<p class="radar-who">${esc(STATUS[i.status])} · ${esc(i.handled_by_name||'同事')} · ${esc(new Date(i.handled_at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}))}${i.note?` · ${esc(i.note)}`:''}</p>`:''}
  </div></article>`;
 }
 function filteredRow(i){const link=safeUrl(i.url);return `<div class="radar-frow"><span>${esc(LABELS[i.label]||i.label)}</span><div><p>${link?`<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(i.title||link)}</a>`:esc(i.title)}</p><p class="radar-note">${esc(i.snippet).slice(0,240)}</p><p class="radar-note">AI 理由：${esc(i.reason)}</p></div></div>`;}
 return {SERVICES,PLATFORMS,STATUS,esc,trends,visible,counts,bars,card,filteredRow,contactUrl};
})();

(()=>{
 if(typeof document==='undefined'||!document.getElementById('feed'))return;
 const V=window.LeadRadarView,$=id=>document.getElementById(id);
 const URL_BASE='https://csabbxiijzghooppayae.supabase.co',KEY='sb_publishable__9KY2RRSxb1excfVxBTH_Q_5HtFWxmH';
 let sb,actor,level=0,items=[],period=7;
 const LEVEL={staff:1,store_manager:2,regional_manager:3,general_manager:4,admin:4,superadmin:5};
 const message=(t,error=false)=>{$('message').textContent=t;$('message').hidden=!t;$('message').classList.toggle('error',error);};
 const filters=()=>({service:$('filter-service').value,platform:$('filter-platform').value,state:$('filter-state').value,search:$('filter-search').value});
 function render(){
  const c=V.counts(items);$('count-new').textContent=c.open;$('count-filtered').textContent=c.filtered;$('count-replied').textContent=c.handled;$('count-won').textContent=c.won;
  const t=V.trends(items,period);$('trend-service').innerHTML=V.bars(t.service);$('trend-area').innerHTML=V.bars(t.area);
  $('trend-keywords').innerHTML=t.keywords.map(([k,v])=>`<span>${V.esc(k)}<b>${v}</b></span>`).join('')||'<p class="radar-note">暂无数据</p>';
  const list=V.visible(items,filters());
  $('feed').innerHTML=list.map(V.card).join('')||`<p class="radar-empty">${items.some(i=>i.label==='demand')?'这个筛选下没有帖子。把状态改成“全部”可以查看已处理的帖子。':'近 30 天还没有找到真实需求。雷达每天早上 7 点运行，新结果会出现在这里。'}</p>`;
  const rest=items.filter(i=>['ad','irrelevant','out_of_area'].includes(i.label));
  $('filtered-summary').textContent=`查看 AI 过滤掉的帖子（近 30 天 ${rest.length} 条）`;$('filtered').innerHTML=rest.slice(0,50).map(V.filteredRow).join('');
 }
 async function loadRun(){
  const {data}=await sb.from('lead_radar_runs').select('started_at,finished_at,status,queries_run,new_items,demand_items,errors').order('started_at',{ascending:false}).limit(1);
  const r=data?.[0];if(!r){$('run-info').hidden=false;$('run-info').textContent='雷达还没有运行过。部署后每天早上 7 点（马来西亚时间）自动运行。';return;}
  const when=new Date(r.started_at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const state={running:'运行中',ok:'完成',partial:'部分完成',failed:'失败'}[r.status]||r.status;
  $('run-info').hidden=false;$('run-info').textContent=`最近运行：${when} · ${state} · 搜索 ${r.queries_run} 组关键词 · 新帖 ${r.new_items} 条 · 真实需求 ${r.demand_items} 条`+((r.errors||[]).length?` · ${r.errors.length} 个错误（管理员可在关键词设置下方查看）`:'');
  if(level>=4&&(r.errors||[]).length)$('queries').dataset.errors=JSON.stringify(r.errors.slice(0,10));
 }
 async function loadItems(){
  const since=new Date(Date.now()-30*864e5).toISOString();
  const {data,error}=await sb.from('lead_radar_items').select('id,url,title,snippet,platform,found_at,published_hint,label,score,service,area,lang,keywords,reason,suggested_reply,invites_contact,posted_contact,status,handled_by_name,handled_at,note').gte('found_at',since).neq('label','pending').order('found_at',{ascending:false}).limit(1000);
  if(error)throw new Error('需求雷达暂不可用，请联系管理员完成部署。');
  items=data||[];
  const platforms=[...new Set(items.filter(i=>i.label==='demand').map(i=>i.platform))];const current=$('filter-platform').value;
  $('filter-platform').innerHTML='<option value="">全部</option>'+platforms.map(p=>`<option value="${V.esc(p)}" ${p===current?'selected':''}>${V.esc(V.PLATFORMS[p]||p)}</option>`).join('');
  render();
 }
 async function loadQueries(){
  const {data,error}=await sb.from('lead_radar_queries').select('id,query,lang,active').order('created_at');if(error){$('queries').textContent='关键词暂时无法读取。';return;}
  const errs=JSON.parse($('queries').dataset.errors||'[]');
  $('queries').innerHTML=(errs.length?`<div class="radar-errors"><b>最近一次运行的错误</b>${errs.map(e=>`<p>${V.esc(e.step)}：${V.esc(e.detail)}</p>`).join('')}</div>`:'')+
   `<p class="radar-note">已启用 ${data.filter(q=>q.active).length} / ${data.length} 个</p>`+data.map(q=>`<div class="radar-query"><label><input type="checkbox" data-toggle="${V.esc(q.id)}" ${q.active?'checked':''}> ${V.esc(q.query)}</label><span>${{en:'英文',zh:'中文',ms:'马来语'}[q.lang]}</span><button type="button" class="secondary" data-delete="${V.esc(q.id)}">删除</button></div>`).join('');
 }
 async function mark(id,status){
  const {data,error}=await sb.rpc('lead_radar_mark',{p_item:id,p_status:status,p_note:null});
  if(error)throw new Error(error.message);
  Object.assign(items.find(i=>i.id===id),data);render();
 }
 document.addEventListener('click',async e=>{
  const m=e.target.closest('[data-mark]');
  if(m){m.disabled=true;try{await mark(m.dataset.id,m.dataset.mark);message(m.dataset.mark==='new'?'已撤销，帖子回到未处理。':`已标记为「${V.STATUS[m.dataset.mark]}」，同事会看到。`);}catch(err){message(err.message,true);m.disabled=false;}return;}
  const c=e.target.closest('[data-copy]');
  if(c){const p=$('reply-'+c.dataset.copy);try{await navigator.clipboard.writeText(p.textContent);message('已复制。请核对后到原帖手动发出，再点“已回复”。');}catch{p.closest('details').open=true;const r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r);message('已选中回复文字，请按复制。');}return;}
  const w=e.target.closest('[data-contact]');
  if(w){const item=items.find(i=>i.id===w.dataset.contact),url=V.contactUrl(item);if(!url)return;
   // Open the tab inside the click so it is not blocked, then record the one allowed contact before loading WhatsApp.
   const tab=window.open('about:blank','_blank');w.disabled=true;
   try{await mark(item.id,'contacted');if(tab){tab.opener=null;tab.location.href=url;}else location.href=url;message('已记录联系。这个号码不能再次联系。');}
   catch(err){tab?.close();message(err.message,true);w.disabled=false;}return;}
  const p=e.target.closest('[data-period]');
  if(p){period=Number(p.dataset.period);document.querySelectorAll('[data-period]').forEach(b=>b.setAttribute('aria-pressed',b===p));render();return;}
  const del=e.target.closest('[data-delete]');
  if(del&&confirm('删除这个关键词？已找到的帖子会保留。')){const {error}=await sb.from('lead_radar_queries').delete().eq('id',del.dataset.delete);if(error)message('删除失败：'+error.message,true);await loadQueries();}
 });
 document.addEventListener('change',async e=>{
  const t=e.target.closest('[data-toggle]');
  if(t){const {error}=await sb.from('lead_radar_queries').update({active:t.checked}).eq('id',t.dataset.toggle);if(error){message('保存失败：'+error.message,true);t.checked=!t.checked;}else await loadQueries();}
 });
 ['filter-service','filter-platform','filter-state'].forEach(id=>$(id).addEventListener('change',render));$('filter-search').addEventListener('input',render);
 $('query-form').addEventListener('submit',async e=>{e.preventDefault();const query=$('query-text').value.trim();if(query.length<3){message('关键词至少 3 个字。',true);return;}
  const {error}=await sb.from('lead_radar_queries').insert({query,lang:$('query-lang').value,created_by:actor.id});
  if(error){message(error.code==='23505'?'这个关键词已经存在。':'添加失败：'+error.message,true);return;}$('query-text').value='';message('已添加，下次运行时开始搜索。');await loadQueries();});
 $('run-now').addEventListener('click',async()=>{
  if(!confirm('立即运行会消耗 Firecrawl 积分和 OpenAI 费用，约需 2–3 分钟。确定运行？'))return;
  const b=$('run-now');b.disabled=true;message('雷达运行中，请不要关闭页面…');
  try{const {data:{session}}=await sb.auth.getSession();
   const r=await fetch(URL_BASE+'/functions/v1/lead-radar',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:KEY}});
   const out=await r.json().catch(()=>({}));if(!r.ok&&r.status!==502)throw new Error(out.error||'运行失败，请稍后再试。');
   message(`运行${out.status==='ok'?'完成':out.status==='partial'?'部分完成':'失败'}：新帖 ${out.new_items||0} 条，真实需求 ${out.demand_items||0} 条。`,out.status==='failed');
   await Promise.all([loadRun(),loadItems()]);if(level>=4)await loadQueries();
  }catch(err){message(err.message,true);}finally{b.disabled=false;}
 });
 (async()=>{try{
  if(!window.supabase)throw new Error('登录组件加载失败，请刷新或检查网络');
  sb=supabase.createClient(URL_BASE,KEY);
  const {data:{session},error}=await sb.auth.getSession();if(error)throw error;if(!session){location.replace('login.html?next=lead-radar.html');return;}
  const result=await sb.rpc('get_my_profile');if(result.error||!result.data)throw new Error('无法读取员工身份');actor=result.data;level=LEVEL[actor.role]||0;
  if(!level||actor.active===false)throw new Error('需求雷达仅限门店员工和管理人员使用。');
  await Promise.all([loadRun(),loadItems()]);
  ['overview','trends','feed-section','filtered-section'].forEach(id=>$(id).hidden=false);
  if(level>=4){$('admin-section').hidden=false;$('run-now').hidden=false;await loadQueries();}
  message('');
 }catch(err){message(err.message||'需求雷达暂时无法读取。',true);}})();
})();
