'use strict';
const $=id=>document.getElementById(id),C=RenoCore;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
const states={draft:'合同草稿',confirmed:'合同已确认',executing:'履约中',accepted:'已竣工验收'};
const kinds={custom:'定制供货',stock:'现货材料',work:'施工服务',gift:'赠送项目'};
let sb,actor,stores=[],project=null,snapshot=blank(),busy=false,dirty=false,upload=null,work=[];
function blank(){return {lines:[],payments:[],net:0,discount:0,signed_on:'',warnings:[],source_text:'',contract_path:''};}
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
async function guarded(fn){if(busy)return;busy=true;try{await fn();}catch(e){message(e.message||String(e),true);}finally{busy=false;}}
async function rpc(action,data){const {data:row,error}=await sb.rpc('renovation_command',{p_id:project.id,p_revision:project.revision,p_action:action,p_data:data});if(error)throw error;project=row;return row;}
function input(value,attrs=''){return `<input value="${esc(value)}" ${attrs}>`;}
function options(map,val){return Object.entries(map).map(([v,n])=>`<option value="${esc(v)}" ${v===val?'selected':''}>${esc(n)}</option>`).join('');}
function updateTotals(){const result=C.validate(snapshot);$('gross').textContent=fmt(result.total);return result;}
function renderLines(){
 const locked=project&&project.state!=='draft';
 $('lines').innerHTML=snapshot.lines.map((l,i)=>`<details class="line" data-line="${i}"><summary><b>#${esc(l.id)} · ${esc(l.name)}</b><span class="muted"> · RM ${fmt(l.qty*l.rate)}</span></summary><div class="line-head"><h3>原文与执行安排</h3><button class="secondary" data-delete="${i}" ${locked?'disabled':''}>移除</button></div><div class="grid">
 <label>原清单编号${input(l.id,'data-key="id"')}</label><label>执行方式<select data-key="kind">${options(kinds,l.kind)}</select></label><label class="wide">子订单执行分组${input(l.group,'data-key="group" list="groups"')}</label>
 <label class="full">名称${input(l.name,'data-key="name"')}</label><label class="full">规格／范围${input(l.spec,'data-key="spec"')}</label>
 <label>数量${input(l.qty,'data-key="qty" type="number" min="0.001" step="any"')}</label><label>单位${input(l.unit,'data-key="unit"')}</label><label>合同单价 RM${input(l.rate,'data-key="rate" type="number" min="0" step="0.01"')}</label><label>来源页码${input(l.page||'','data-key="page" type="number" min="1"')}</label></div>
 <div class="warranty"><b>部件质保 · 未知期限留空</b>${(l.warranties||[]).map((w,j)=>`<div class="warranty-row" data-warranty="${j}"><label>部件／保障范围${input(w.component,'data-wkey="component"')}</label><label>年限${input(w.years??'','data-wkey="years" type="number" min="1" max="100" step="1"')}</label><label>合同来源／厂家凭证${input(w.source,'data-wkey="source"')}</label><button class="secondary" data-delete-warranty="${j}" ${locked?'disabled':''}>移除</button></div>`).join('')}<button class="secondary" data-add-warranty="${i}" ${locked?'disabled':''}>＋ 部件质保</button></div><span class="muted">行金额 RM <span data-amount>${fmt(l.qty*l.rate)}</span>${l.page?' · 原合同第'+esc(l.page)+'页':''}</span></details>`).join('')+'<datalist id="groups">'+C.GROUPS.map(g=>`<option value="${g}">`).join('')+'</datalist>';
 if(locked)$('lines').querySelectorAll('input,select').forEach(e=>e.disabled=true);
}
function renderPayments(){
 $('payments').innerHTML=snapshot.payments.map((p,i)=>`<div class="payment" data-payment="${i}"><label>付款节点${input(p.name,'data-pkey="name"')}</label><label>约定应收 RM${input(p.amount,'data-pkey="amount" type="number" min="0.01" step="0.01"')}</label><button class="secondary" data-delete-payment="${i}">移除</button></div>`).join('');
 if(project&&project.state!=='draft')$('payments').querySelectorAll('input,button').forEach(e=>e.disabled=true);
}
function renderWarranty(){
 $('warranty-preview').innerHTML=snapshot.lines.map(l=>`<div class="customer-line"><b>${esc(l.id)} · ${esc(l.name)}</b>${(l.warranties||[]).map(w=>`<div class="term"><span>${esc(w.component)}</span><span>${w.years?esc(w.years)+'年':'期限待确认'} · ${project?.accepted_on?'到期 '+esc(C.expires(project.accepted_on,w.years)||'待补充'):'竣工验收后起算'}</span></div><div class="muted">${esc(w.source)}</div>`).join('')}</div>`).join('');
}
function render(){
 $('editor').hidden=false;$('list').hidden=true;$('back-list').hidden=false;$('new-project').hidden=true;const locked=project&&project.state!=='draft';
 if(project){$('contract-no').value=project.contract_no;$('customer-name').value=project.customer_name;$('customer-phone').value=project.customer_phone;$('address').value=project.address;$('store').value=project.store_id;}
 for(const id of ['store','contract-no','customer-name','customer-phone','address'])$(id).disabled=!!project;
 $('create').hidden=!!project;$('state').textContent=project?states[project.state]:'未保存';$('revision').textContent=project?'云端版本 '+project.revision:'';
 $('title').textContent=project?project.contract_no:'新建整装订单';
 $('discount').value=snapshot.discount;$('net').value=snapshot.net;$('signed-on').value=snapshot.signed_on||'';
 $('raw').textContent=snapshot.source_text||'暂无提取原文';
 $('warnings').innerHTML=(snapshot.warnings||[]).length?'<div class="warning"><b>导入核对提醒</b><ul>'+snapshot.warnings.map(w=>`<li>${esc(w)}</li>`).join('')+'</ul></div>':'';
 for(const id of ['discount','net','signed-on','add-line','add-payment','save','import-json'])$(id).disabled=!project||locked;
 $('contract-file').disabled=!!locked;
 $('view-contract').textContent=upload?'预览所选合同PDF':'查看归档合同';
 $('view-contract').disabled=!upload&&!snapshot.contract_path;
 $('confirm').disabled=!project||locked;$('split').disabled=!project||!['confirmed','executing'].includes(project.state);
 $('accept').disabled=!project||project.state!=='executing';$('accepted-on').value=project?.accepted_on||'';$('customer-link').disabled=!project||project.state==='draft';$('rotate-link').disabled=!project;$('customer-code').disabled=!project||project.state==='draft';
 renderLines();renderPayments();updateTotals();renderWarranty();
}
async function loadList(){
 const {data,error}=await sb.from('renovation_projects').select('id,contract_no,customer_name,address,state,revision,snapshot,created_at').order('created_at',{ascending:false}).limit(200);
 if(error)throw new Error('整装档案暂不可用，请联系管理员完成整装功能部署。原商品订单仍可使用。');
 $('list').innerHTML=(data||[]).map(p=>`<article class="project"><span class="type renovation">🏠 整装主单</span><h2>${esc(p.contract_no)} · ${esc(p.customer_name)}</h2><p>${esc(p.address)}</p><div class="actions"><b>RM ${fmt(p.snapshot?.net)}</b><span>${states[p.state]}</span><button class="secondary" data-open="${p.id}">查看主单与子单 →</button></div></article>`).join('')||'<p>暂无整装项目，从新建订单开始。</p>';
}
async function openProject(id){
 if(dirty&&!confirm('当前核对内容尚未保存，确定切换项目？'))return;
 const {data,error}=await sb.from('renovation_projects').select('*').eq('id',id).single();if(error)throw error;
 project=data;snapshot=Object.assign(blank(),data.snapshot);dirty=false;upload=null;$('signed').checked=false;$('reviewed').checked=false;
 const results=await Promise.all([sb.from('renovation_work_orders').select('*').eq('project_id',id).order('group_name'),sb.from('renovation_audit').select('action,created_at,actor').eq('project_id',id).order('created_at',{ascending:false}).limit(30)]);
 for(const r of results)if(r.error)throw r.error;
 work=results[0].data;render();
 $('work-orders').innerHTML=work.map((w,i)=>`<details class="work"><summary><span class="type renovation">整装子单</span> <b>${esc(w.group_name)}</b> · ${{draft:'草稿',assigned:'已分配',working:'进行中',done:'已完成'}[w.status]}</summary><p>原清单项：${w.line_ids.map(esc).join('、')} · 不重复收取客户费用</p><div class="work-controls"><label>负责人${input(w.assignee,`id="assignee-${i}"`)}</label><label>状态<select id="work-status-${i}">${options({draft:'草稿',assigned:'已分配',working:'进行中',done:'已完成'},w.status)}</select></label><button data-work="${i}" ${project.state==='accepted'?'disabled':''}>保存进度</button></div></details>`).join('');
 if(project.state==='accepted')$('work-orders').querySelectorAll('input,select').forEach(e=>e.disabled=true);
 const actionNames={save:'保存合同核对版本',confirm:'确认并锁定合同',split:'生成子订单',work:'更新履约进度',accept:'确认竣工验收',rotate_link:'撤销旧客户链接'};
 $('audit').innerHTML=results[1].data.map(a=>`<p>${esc(new Date(a.created_at).toLocaleString())} · ${esc(actionNames[a.action]||a.action)}</p>`).join('')||'<p>尚无操作记录</p>';
 history.replaceState(null,'','#'+id);message('已读取云端项目，版本 '+project.revision);
}
async function archive(file,kind='contract'){
 if(!project)throw new Error('请先补齐客户资料并保存项目草稿，再归档文件');
 if(!file||file.size>20*1024*1024||file.type!=='application/pdf')throw new Error('请选择20MB以内的PDF文件');
 const path=`${project.id}/${kind}-${crypto.randomUUID()}.pdf`;
 const {error}=await sb.storage.from('renovation-contracts').upload(path,file,{contentType:'application/pdf',upsert:false});if(error)throw error;return path;
}
async function parsePDF(file){
 const pdfjs=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
 pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
 const buffer=await file.arrayBuffer();
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const doc=await pdfjs.getDocument({data:buffer,isEvalSupported:false}).promise;
 try{if(doc.numPages>100)throw new Error('合同超过100页，请拆分后核对');const pages=[];
 for(let i=1;i<=doc.numPages;i++){const p=await doc.getPage(i),v=p.getViewport({scale:1}),content=await p.getTextContent();pages.push(content.items.filter(t=>t.str?.trim()).map(t=>({text:t.str,x:t.transform[4]*595.276/v.width,y:v.height-t.transform[5],page:i})));}
 return C.extract(pages,{trustedTemplate:hash==='29268b3341f26213a1ad5bd7f7e4f3f083ee97b2c96f7eedf67ec3394ee87dca'});
 }finally{await doc.destroy();}
}
function reset(){project=null;snapshot=blank();dirty=false;upload=null;work=[];for(const id of ['contract-no','customer-name','customer-phone','address','signed-on','contract-file'])$(id).value='';$('signed').checked=$('reviewed').checked=false;$('work-orders').innerHTML='';$('audit').innerHTML='';history.replaceState(null,'',location.pathname);render();}
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
$('back-list').onclick=()=>guarded(async()=>{
 if(dirty&&!confirm('当前核对内容尚未保存，确定返回主订单列表？'))return;
 await loadList();dirty=false;$('editor').hidden=true;$('list').hidden=false;
 $('back-list').hidden=true;$('new-project').hidden=false;$('title').textContent='整装主订单';
 history.replaceState(null,'',location.pathname);message('每个项目只显示一张整装主单；点开后查看合同、清单与履约子单。');window.scrollTo(0,0);
});
$('list').onclick=e=>{const b=e.target.closest('[data-open]');if(b)guarded(()=>openProject(b.dataset.open));};
$('new-project').onclick=()=>{if(dirty&&!confirm('当前核对内容尚未保存，确定离开？'))return;reset();};
$('create').onclick=()=>guarded(async()=>{
 if(project)return;const p={store_id:$('store').value,contract_no:$('contract-no').value.trim(),customer_name:$('customer-name').value.trim(),customer_phone:$('customer-phone').value.trim(),address:$('address').value.trim()};
 if(Object.values(p).some(x=>!x))throw new Error('请补齐门店、合同编号、姓名、电话和施工地址');
 const phone=C.normalizePhone(p.customer_phone);if(!phone)throw new Error('请填写含国家区号的完整客户手机号，例如+60101234567');p.customer_phone=phone;
 // Retain UUID for safe retry if the response is lost.
 const key=JSON.stringify(p);let id=sessionStorage.getItem('reno-create-'+key);if(!id){id=crypto.randomUUID();sessionStorage.setItem('reno-create-'+key,id);}
 const {data,error}=await sb.rpc('renovation_command',{p_id:id,p_revision:0,p_action:'create',p_data:p});if(error)throw error;
 project=data;render();history.replaceState(null,'','#'+project.id);await loadList();
 message(upload?'项目草稿已保存，已选择的合同与清单已保留；请核对后点击“保存核对版本”归档。':'项目草稿已保存，可以选择合同PDF。');
});
$('contract-file').onchange=()=>guarded(async()=>{
 const file=$('contract-file').files[0];if(!file)return;
 if(file.size>20*1024*1024||!(/\.pdf$/i.test(file.name)))throw new Error('请选择20MB以内的PDF合同');
 message('正在读取PDF文字与表格…');const parsed=await parsePDF(file);
 if(project&&parsed.contract_no&&parsed.contract_no!==project.contract_no)throw new Error('合同编号与当前项目不一致，请先核对，不会导入到其他项目');
 if(snapshot.lines.length&&!confirm('导入将替换尚未锁定的清单，是否继续？'))return;
 if(!project){if(parsed.contract_no)$('contract-no').value=parsed.contract_no;if(parsed.address&&!$('address').value.trim())$('address').value=parsed.address;}
 upload=file;snapshot={...parsed,contract_path:''};dirty=true;render();message(`已提取${snapshot.lines.length}项。请核对原文、付款计划及质保，尚未归档或派工。`);
});
$('lines').oninput=e=>{const a=e.target.closest('[data-line]');if(!a||project?.state!=='draft')return;const l=snapshot.lines[+a.dataset.line],w=e.target.closest('[data-warranty]');if(w&&e.target.dataset.wkey){const k=e.target.dataset.wkey;l.warranties[+w.dataset.warranty][k]=k==='years'?(e.target.value===''?null:Number(e.target.value)):e.target.value;}else if(e.target.dataset.key){const k=e.target.dataset.key;l[k]=['qty','rate','page'].includes(k)?Number(e.target.value):e.target.value;a.querySelector('[data-amount]').textContent=fmt(l.qty*l.rate);}dirty=true;updateTotals();};
$('lines').onclick=e=>{if(project?.state!=='draft')return;const b=e.target.closest('button');if(!b)return;const line=b.closest('[data-line]'),i=Number(line?.dataset.line);if(b.dataset.delete!==undefined)snapshot.lines.splice(i,1);else if(b.dataset.addWarranty!==undefined)snapshot.lines[i].warranties.push({component:'',years:null,source:''});else if(b.dataset.deleteWarranty!==undefined)snapshot.lines[i].warranties.splice(+b.dataset.deleteWarranty,1);else return;dirty=true;renderLines();updateTotals();};
$('add-line').onclick=()=>{snapshot.lines.push({id:'M-'+crypto.randomUUID().slice(0,8),name:'',spec:'',qty:1,unit:'lot',rate:0,kind:'work',group:'待分组',warranties:[{component:'质保待核对',years:null,source:'待补充合同条款'}]});dirty=true;renderLines();};
for(const [id,key] of [['discount','discount'],['net','net'],['signed-on','signed_on']])$(id).oninput=()=>{snapshot[key]=id==='signed-on'?$(id).value:Number($(id).value);dirty=true;updateTotals();};
$('payments').oninput=e=>{const r=e.target.closest('[data-payment]');if(!r)return;const k=e.target.dataset.pkey;if(k){snapshot.payments[+r.dataset.payment][k]=k==='amount'?Number(e.target.value):e.target.value;dirty=true;}};
$('payments').onclick=e=>{const i=e.target.dataset.deletePayment;if(i!==undefined){snapshot.payments.splice(+i,1);dirty=true;renderPayments();}};
$('add-payment').onclick=()=>{snapshot.payments.push({name:'',amount:0});dirty=true;renderPayments();};
$('save').onclick=()=>guarded(async()=>{
 if(!project)throw new Error('请先保存项目草稿');const result=updateTotals();if(result.errors.length)throw new Error(result.errors.join('；'));
 if(upload){snapshot.contract_path=await archive(upload);upload=null;}
 if(!snapshot.contract_path)throw new Error('请上传对应合同PDF原件');
 await rpc('save',snapshot);dirty=false;await openProject(project.id);await loadList();message('合同原件和核对版本已保存；确认签署前仍是草稿。');
});
$('confirm').onclick=()=>guarded(async()=>{
 if(dirty)throw new Error('先保存本次核对版本，再确认合同');
 if(!$('signed').checked||!$('reviewed').checked)throw new Error('请完成签署及清单核对确认');
 if(!confirm('确认后锁定合同清单与质保；后续不得直接覆盖，确定？'))return;
 await rpc('confirm',{signed:true,reviewed:true});await openProject(project.id);await loadList();
});
$('split').onclick=()=>guarded(async()=>{await rpc('split',{});await openProject(project.id);await loadList();message('子订单已按执行分组生成，未增加客户应收。');});
$('work-orders').onclick=e=>guarded(async()=>{const b=e.target.closest('[data-work]');if(!b)return;const i=+b.dataset.work;await rpc('work',{id:work[i].id,assignee:$('assignee-'+i).value,status:$('work-status-'+i).value});await openProject(project.id);});
$('view-contract').onclick=()=>guarded(async()=>{
 if(!upload&&!snapshot.contract_path)throw new Error('请先选择合同PDF，或打开已有归档合同的项目');
 // Open during the click gesture, before requesting a private storage URL.
 const tab=window.open('about:blank','_blank');
 if(!tab)throw new Error('浏览器拦截了合同窗口，请允许此网站弹出窗口后重试');
 tab.opener=null;
 try{
  if(upload){const url=URL.createObjectURL(upload);tab.location.replace(url);setTimeout(()=>URL.revokeObjectURL(url),300000);message('正在预览所选合同PDF；请点击“保存核对版本”完成归档。');return;}
  const {data,error}=await sb.storage.from('renovation-contracts').createSignedUrl(snapshot.contract_path,120);
  if(error)throw error;
  if(!data?.signedUrl)throw new Error('未能获取合同链接，请重试');
  tab.location.replace(data.signedUrl);message('已打开归档合同PDF。');
 }catch(e){tab.close();throw e;}
});
$('accept').onclick=()=>guarded(async()=>{const date=$('accepted-on').value;if(!date)throw new Error('请填写竣工验收日期');if(!work.length||work.some(w=>w.status!=='done'))throw new Error('先完成全部子订单，再确认竣工验收');const file=$('acceptance-file').files[0];if(!file)throw new Error('请上传双方竣工验收凭证');if(!confirm('确认验收凭证和日期无误，并按合同启动质保？'))return;const path=await archive(file,'acceptance');await rpc('accept',{accepted_on:date,acceptance_path:path});await openProject(project.id);await loadList();});
$('customer-code').onclick=()=>guarded(async()=>{
 if(!project||project.state==='draft')throw new Error('先确认合同');
 const code=project.customer_token.replaceAll('-','').slice(0,20).toUpperCase().match(/.{4}/g).join('-');
 const text='HOUZY HOME 整装合同查询\n合同编号：'+project.contract_no+'\n登记手机号：+'+project.customer_phone+'\n合同查阅码：'+code+'\n入口：https://houzyhome.com/portal/customer.html\n请选择对应国家区号，输入登记手机号和查阅码。查阅码仅限业主及授权联系人，请勿公开转发。';
 await navigator.clipboard.writeText(text);message('已复制登记手机号、合同查阅码及查询入口，请发给业主。');
});
$('customer-link').onclick=()=>guarded(async()=>{if(!project||project.state==='draft')throw new Error('先确认合同');const url=new URL('renovation-customer.html',location.href);url.hash=project.customer_token;await navigator.clipboard.writeText(url.href);message('已复制客户链接，仅发给业主或授权联系人。');});
$('rotate-link').onclick=()=>guarded(async()=>{if(!confirm('旧客户链接和合同查阅码将立即失效，需要重新发送新查询资料，继续？'))return;const {error}=await sb.rpc('renovation_rotate_link',{p_id:project.id,p_revision:project.revision});if(error)throw error;await openProject(project.id);message('旧客户链接和查阅码已失效，可以重新复制客户查询资料。');});
$('export').onclick=()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}));a.href=url;a.download=(project?.contract_no||'整装清单')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import-json').onclick=()=>$('json-file').click();
$('json-file').onchange=()=>guarded(async()=>{const f=$('json-file').files[0];if(!f)return;if(f.size>2*1024*1024)throw new Error('JSON不得超过2MB');const s=JSON.parse(await f.text());if(!Array.isArray(s.lines)||s.lines.length>500||!Array.isArray(s.payments))throw new Error('清单格式无效');if(s.lines.some(l=>!l||typeof l!=='object'||!Array.isArray(l.warranties)||l.warranties.some(w=>!w||typeof w!=='object')))throw new Error('清单或质保记录格式无效');if(s.lines.some(l=>['id','name','group','unit','kind'].some(k=>typeof l[k]!=='string')||l.warranties.some(w=>typeof w.component!=='string'||typeof w.source!=='string'))||s.payments.some(p=>typeof p.name!=='string')||(s.warnings!==undefined&&!Array.isArray(s.warnings)))throw new Error('JSON字段类型不正确，请按导出格式填写');if(!confirm('用此JSON替换当前未锁定清单？对应PDF仍需上传。'))return;const path=snapshot.contract_path;snapshot={...blank(),...s,contract_path:path};dirty=true;render();});
(async()=>{try{
 if(!window.supabase)throw new Error('登录组件加载失败，请刷新或检查网络');
 sb=supabase.createClient('https://csabbxiijzghooppayae.supabase.co','sb_publishable__9KY2RRSxb1excfVxBTH_Q_5HtFWxmH');
 const {data:{session},error}=await sb.auth.getSession();if(error)throw error;if(!session){location.replace('login.html?next=renovation.html');return;}
 const result=await sb.rpc('get_my_profile');if(result.error||!result.data)throw new Error('无法读取员工身份');actor=result.data;
 if(!['staff','store_manager','regional_manager','general_manager','admin','superadmin'].includes(actor.role))throw new Error('此入口仅供门店员工及管理人员使用');
 const sr=await sb.from('stores').select('id,name').eq('active',true);if(sr.error)throw sr.error;stores=sr.data;
 $('store').innerHTML=stores.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');if(actor.store_id)$('store').value=actor.store_id;
 await loadList();const id=location.hash.slice(1);if(/^[0-9a-f-]{36}$/i.test(id))await openProject(id);else message('每个项目只显示一张整装主单；点开后查看合同、清单与履约子单。');
 }catch(e){message(e.message,true);$('new-project').disabled=true;}
})();
