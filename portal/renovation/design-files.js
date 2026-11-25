'use strict';
// 整装订单里的「设计图纸」：店员上传效果图 / 施工图；改图时「换新版」，旧版留在历史里。监理在现场页只看到最新版。
window.RenoDesign=(()=>{
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const BUCKET='renovation-fulfillment',KIND={render:'效果图',drawing:'施工图'},MAX=20*1024*1024;
 const OK_TYPE=['application/pdf','image/jpeg','image/png','image/webp'];
 let ctx=null,files=[],urls={},ver=0,shares=[];
 const link=a=>{const u=new URL('renovation-design.html',location.href);u.searchParams.set('share',a.id);u.searchParams.set('t',a.token);return u.href;};
 async function load(c){
  ctx=c;const id=++ver,el=document.getElementById('design-files');if(!el)return;
  const {data,error}=await c.sb.from('renovation_design_files').select('*').eq('project_id',c.project.id).is('removed_at',null).order('created_at');
  if(id!==ver)return;
  if(error){el.innerHTML='<p class="muted">设计图纸功能需要先在 Supabase 运行 renovation_design_files_migration.sql。</p>';return;}
  files=data||[];urls={};
  try{const r=await c.sb.from('renovation_design_shares').select('*').eq('project_id',c.project.id).is('revoked_at',null).order('created_at');shares=r.error?null:(r.data||[]);}catch(e){shares=null;}
  const paths=files.map(f=>f.path);
  if(paths.length){try{const {data:u}=await c.sb.storage.from(BUCKET).createSignedUrls(paths,3600);for(const x of u||[])if(x.signedUrl)urls[x.path]=x.signedUrl;}catch(e){}}
  if(id!==ver)return;render();
 }
 const isImg=f=>/^image\//.test(f.mime||'');
 const day=s=>String(s||'').slice(0,10);
 function thumb(f){const u=urls[f.path];if(!u)return '<span class="design-thumb">📄</span>';
  return `<a class="design-thumb" href="${E(u)}" target="_blank" rel="noopener">${isImg(f)?`<img src="${E(u)}" alt="${E(f.title)}" loading="lazy">`:'<span>PDF</span>'}</a>`;}
 function render(){
  const el=document.getElementById('design-files');if(!el)return;
  const cur=files.filter(f=>!f.superseded_at),hist=id=>{const out=[];let f=files.find(x=>x.id===id);while(f?.replaces){f=files.find(x=>x.id===f.replaces);if(f)out.push(f);}return out;};
  const card=f=>{const h=hist(f.id);return `<li class="design-item">${thumb(f)}<div><b>${E(f.title)}</b><br><small>第 ${E(f.version)} 版 · ${E(day(f.created_at))} 上传</small>
   <div class="actions"><button type="button" class="secondary" data-dact="pick">换新版</button><input type="file" accept="${OK_TYPE.join(',')}" data-dreplace="${f.id}" hidden><button type="button" class="secondary" data-dact="remove" data-id="${f.id}">删除</button></div>
   ${h.length?`<details><summary>历史版本（${h.length}）</summary><ul>${h.map(o=>`<li>${urls[o.path]?`<a href="${E(urls[o.path])}" target="_blank" rel="noopener">第 ${E(o.version)} 版</a>`:`第 ${E(o.version)} 版`} · ${E(day(o.created_at))} 上传 · ${E(day(o.superseded_at))} 被替换</li>`).join('')}</ul></details>`:''}</div></li>`;};
  const group=k=>{const list=cur.filter(f=>f.kind===k);return `<div class="work-terms"><b>${KIND[k]}（${list.length}）</b>${list.length?`<ul class="design-list">${list.map(card).join('')}</ul>`:'<p class="muted">还没有上传。</p>'}</div>`;};
  el.innerHTML=`${group('render')}${group('drawing')}
   <div class="work-terms"><b>上传图纸</b><div class="fx-form" data-dform><div class="fx-fields">
    <label>类型<select data-df="kind"><option value="render">效果图</option><option value="drawing">施工图</option></select></label>
    <label>名称<input data-df="title" maxlength="80" placeholder="例如：厨房效果图、水电点位图"></label>
    <label>文件（PDF / 图片，≤20MB）<input type="file" data-df="file" accept="${OK_TYPE.join(',')}" multiple></label></div>
    <div class="fx-actions"><button type="button" data-dact="upload">上传</button></div></div>
    <p class="muted">改图时请点那张图的「换新版」，监理和现场只会看到最新版；旧版留在「历史版本」里。</p>
    <p class="muted" data-dfeedback role="status"></p></div>${shareBox()}`;
 }
 function shareBox(){
  if(shares===null)return '<div class="work-terms"><b>发给师傅 / 厂家看图</b><p class="muted">需要先在 Supabase 运行 renovation_design_share_migration.sql。</p></div>';
  return `<div class="work-terms"><b>发给师傅 / 厂家看图（${shares.length}）</b>
   <p class="muted">对方打开链接就能看本项目所有图纸的最新版（看不到价格和业主电话），不用验证码；项目竣工验收后自动失效。不用了就点「停用」。</p>
   ${shares.length?`<ul class="design-list">${shares.map(a=>`<li class="design-item"><div><b>${E(a.label)}</b><br><small>${E(day(a.created_at))} 建 · ${a.opened_at?`最近打开 ${E(day(a.opened_at))}`:'还没打开过'}</small>
    <div class="actions"><button type="button" class="secondary" data-dact="copylink" data-link="${E(link(a))}">复制链接</button><button type="button" class="secondary" data-dact="revoke" data-id="${a.id}">停用</button></div></div></li>`).join('')}</ul>`:''}
   <div class="fx-form"><div class="fx-fields"><label>给谁看<input data-df="share" maxlength="60" placeholder="例如：木工 张师傅、橱柜厂"></label></div><div class="fx-actions"><button type="button" data-dact="share">生成看图链接</button></div></div></div>`;
 }
 async function put(f){
  if(!OK_TYPE.includes(f.type))throw new Error(`「${f.name}」格式不支持，只能传 PDF、JPG、PNG、WEBP`);
  if(f.size>MAX)throw new Error(`「${f.name}」超过 20MB，请压缩后再传`);
  const ext=f.type==='application/pdf'?'pdf':(f.type.split('/')[1]||'jpg').replace('jpeg','jpg');
  const path=`${ctx.project.id}/design/${crypto.randomUUID()}.${ext}`;
  const {error}=await ctx.sb.storage.from(BUCKET).upload(path,f,{contentType:f.type,upsert:false});
  if(error)throw new Error(`「${f.name}」上传失败：${error.message}`);
  return {path,mime:f.type,size:f.size};
 }
 const save=async d=>{const {error}=await ctx.sb.rpc('renovation_design_file_save',{p_project:ctx.project.id,p_data:d});if(error)throw error;};
 function bind(el){
  const say=(t,err)=>{const m=el.querySelector('[data-dfeedback]');if(m){m.textContent=t;m.classList.toggle('warning',!!err);}};
  el.addEventListener('click',async e=>{
   const b=e.target.closest('[data-dact]');if(!b||!ctx)return;
   if(b.dataset.dact==='pick'){b.parentElement.querySelector('[data-dreplace]')?.click();return;}
   b.disabled=true;
   try{
    if(b.dataset.dact==='upload'){
     const form=b.closest('[data-dform]'),list=[...(form.querySelector('[data-df="file"]').files||[])];if(!list.length)throw new Error('请先选择文件');
     const kind=form.querySelector('[data-df="kind"]').value,title=form.querySelector('[data-df="title"]').value.trim();
     for(const f of list){say(`正在上传 ${f.name}…`);const up=await put(f);await save({kind,title:list.length>1||!title?(title?`${title} · `:'')+f.name.replace(/\.[^.]+$/,''):title,...up});}
     await load(ctx);say(`已上传 ${list.length} 个文件。`);return;
    }
    if(b.dataset.dact==='copylink'){await navigator.clipboard.writeText(b.dataset.link);say('链接已复制，直接发给对方就行。');return;}
    if(b.dataset.dact==='share'){
     const label=el.querySelector('[data-df="share"]').value.trim();if(!label)throw new Error('请写给谁看，例如：木工 张师傅');
     const {error}=await ctx.sb.rpc('renovation_design_share_save',{p_project:ctx.project.id,p_data:{label}});if(error)throw error;
     await load(ctx);say(`已生成「${label}」的看图链接，点「复制链接」发给对方。`);return;
    }
    if(b.dataset.dact==='revoke'){
     if(!confirm('停用这个看图链接？对方马上就看不到了。'))return;
     const {error}=await ctx.sb.rpc('renovation_design_share_save',{p_project:ctx.project.id,p_data:{revoke_id:b.dataset.id}});if(error)throw error;
     await load(ctx);say('已停用。');return;
    }
    if(b.dataset.dact==='remove'){
     if(!confirm('删除这张图？删除后监理也看不到了。'))return;
     await save({remove_id:b.dataset.id});await load(ctx);say('已删除。');return;
    }
   }catch(err){say(err.message||String(err),true);}finally{b.disabled=false;}
  });
  el.addEventListener('change',async e=>{
   const inp=e.target.closest('[data-dreplace]');if(!inp||!ctx||!inp.files?.[0])return;
   try{say('正在上传新版…');const up=await put(inp.files[0]);await save({kind:files.find(x=>x.id===inp.dataset.dreplace)?.kind||'render',replaces:inp.dataset.dreplace,...up});await load(ctx);say('已换成新版，旧版收进了「历史版本」。');}
   catch(err){say(err.message||String(err),true);}
  });
 }
 return {load,bind};
})();
