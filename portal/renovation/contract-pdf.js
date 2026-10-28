'use strict';
// Builds the archived e-signed contract: the original PDF, a small "E-signed" footer on each page,
// and one signature page at the end. The signature page is drawn on a canvas so Chinese text
// renders with the system font, then embedded as an image (pdf-lib standard fonts are Latin only).
window.RenoContractPdf=(()=>{
 const LIB='https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
 const FONT='"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC",sans-serif';
 let loading=null;
 function lib(){
  if(window.PDFLib)return Promise.resolve(window.PDFLib);
  loading=loading||new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=LIB;s.onload=()=>resolve(window.PDFLib);s.onerror=()=>{loading=null;reject(new Error('PDF组件加载失败，请检查网络后重试'));};document.head.append(s);});
  return loading;
 }
 async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
 const ascii=s=>String(s??'').replace(/[^\x20-\x7e]/g,'?');
 const time=t=>new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Kuala_Lumpur',hour12:false})+' (GMT+8)';
 const money=n=>'RM '+Number(n||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
 // Strokes are stored as 0..1 points of a roughly 10:3 signature pad.
 function ink(g,strokes,x,y,w,h){g.save();g.strokeStyle='#14231c';g.lineWidth=3;g.lineCap='round';g.lineJoin='round';for(const s of strokes||[]){if(s.length<2)continue;g.beginPath();g.moveTo(x+s[0][0]*w,y+s[0][1]*h);for(const p of s.slice(1))g.lineTo(x+p[0]*w,y+p[1]*h);g.stroke();}g.restore();}
 function wrap(g,text,x,y,width,line){let row='';for(const ch of String(text)){if(g.measureText(row+ch).width>width&&row){g.fillText(row,x,y);y+=line;row=ch;}else row+=ch;}if(row){g.fillText(row,x,y);y+=line;}return y;}
 function page({terms,pages,owner,company}){
  const W=1240,H=1754,c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
  g.fillStyle='#fff';g.fillRect(0,0,W,H);g.fillStyle='#14231c';g.textBaseline='top';
  g.font=`bold 44px ${FONT}`;g.fillText('电子签署页  Electronic Signature Page',90,90);
  g.font=`26px ${FONT}`;g.fillStyle='#4b5a52';g.fillText(`HOUZY HOME 合屋${terms.store?' · '+terms.store:''}`,90,152);
  g.fillStyle='#14231c';g.font=`28px ${FONT}`;let y=225;
  for(const [k,v] of [['合同编号',terms.contract_no],['项目地址',terms.address],['业主',terms.customer_name],['合同总价',money(terms.money?.net)],['原合同页数',`${pages} 页（本页之前）`]]){g.fillText(`${k}：`,90,y);y=wrap(g,v,290,y,860,40);y+=6;}
  g.font=`22px ${FONT}`;g.fillStyle='#4b5a52';g.fillText('原合同PDF指纹 SHA-256：',90,y+4);y=wrap(g,terms.contract_sha256,90,y+40,1060,32)+20;
  const box=(title,who,strokes,lines,top)=>{g.strokeStyle='#b2bcb6';g.lineWidth=2;g.strokeRect(90,top,1060,470);g.fillStyle='#14231c';g.font=`bold 30px ${FONT}`;g.fillText(title,120,top+28);g.font=`26px ${FONT}`;g.fillText(who,120,top+76);
   g.strokeStyle='#dce2df';g.strokeRect(120,top+122,600,180);ink(g,strokes,120,top+122,600,180);g.fillStyle='#4b5a52';g.font=`22px ${FONT}`;let ly=top+320;for(const l of lines)ly=wrap(g,l,120,ly,1000,32);};
  box('甲方 / 业主 Owner',`签署人：${owner.name}`,owner.strokes,[`签署时间：${time(owner.signed_at)}`,'身份验证：业主登记手机号后四位核验通过，在线阅读合同全文后手写签名',`签署凭据：${owner.hash}`],y);
  box('乙方 / HOUZY HOME 授权代表',`会签人：${company.name}`,company.strokes,[`会签时间：${time(company.signed_at)}`],y+500);
  g.fillStyle='#14231c';g.font=`24px ${FONT}`;
  wrap(g,`双方确认：本页附于上述合同原件（共 ${pages} 页）之后，签名适用于合同全部内容。本页由 HOUZY HOME 系统按电子签署记录生成，原合同未签名版本及签署记录同时归档。`,90,Math.min(H-170,y+1010),1060,36);
  return new Promise((resolve,reject)=>c.toBlob(b=>b?b.arrayBuffer().then(resolve,reject):reject(new Error('签署页生成失败')),'image/png'));
 }
 // pdf: ArrayBuffer of the unsigned original. Returns {bytes,sha256} of the signed copy.
 async function build({pdf,terms,owner,company}){
  const {PDFDocument,StandardFonts,rgb}=await lib();
  const doc=await PDFDocument.load(pdf,{updateMetadata:false});const font=await doc.embedFont(StandardFonts.Helvetica);
  const pages=doc.getPages(),total=pages.length+1;
  pages.forEach((p,i)=>{const {width}=p.getSize();p.drawText(ascii(`E-signed copy | ${terms.contract_no} | owner signed ${new Date(owner.signed_at).toISOString().slice(0,10)} | page ${i+1}/${total}`),{x:Math.max(12,width/2-150),y:10,size:7,font,color:rgb(0.35,0.4,0.37)});});
  const image=await doc.embedPng(await page({terms,pages:pages.length,owner,company}));
  const last=doc.addPage([595.28,841.89]);last.drawImage(image,{x:0,y:0,width:595.28,height:841.89});
  last.drawText(ascii(`page ${total}/${total}`),{x:270,y:10,size:7,font,color:rgb(0.35,0.4,0.37)});
  doc.setTitle(ascii(`${terms.contract_no} e-signed`));
  const bytes=await doc.save();return {bytes,sha256:await sha256(bytes)};
 }
 return {build,sha256};
})();
