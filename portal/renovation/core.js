/* Pure contract import/reconciliation. No writes, guesses of signature, or activation. */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.RenoCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const money=n=>Math.round((Number(n)+Number.EPSILON)*100);
const cash=n=>(n/100).toFixed(2);
const GROUPS=['厨房铝柜','岩板台面','门窗玻璃','全屋定制','淋浴隔断','车廊泥水','客厅泥水','天花','浴室泥水','PVC折叠门','电气','油漆','保护清洁','赠品及设计'];
function validate(s){
 const errors=[],ids=new Set();let total=0;
 if(!Array.isArray(s.lines)||!s.lines.length)errors.push('没有识别到清单，请补充合同附件或手工录入');
 for(const [i,l] of (s.lines||[]).entries()){
  if(!l.id||ids.has(l.id))errors.push(`第${i+1}项编号为空或重复`);ids.add(l.id);
  if(!l.name?.trim()||!l.group?.trim()||!l.unit?.trim()||!['custom','stock','work','gift'].includes(l.kind))errors.push(`第${i+1}项名称、单位、类型或分组不完整`);
  if(!Number.isFinite(Number(l.qty))||Number(l.qty)<=0||!Number.isFinite(Number(l.rate))||Number(l.rate)<0)errors.push(`第${i+1}项数量或单价无效`);
  else total+=money(Number(l.qty)*Number(l.rate));
  if(l.kind==='gift'&&Number(l.rate)!==0)errors.push(`赠品${l.id}售价必须为零`);
  if(!Array.isArray(l.warranties))errors.push(`第${i+1}项缺少质保核对记录`);
  for(const w of l.warranties||[]){
   if(!w.component?.trim()||!w.source?.trim()||(w.years!==null&&(!Number.isInteger(Number(w.years))||Number(w.years)<=0||Number(w.years)>100)))errors.push(`第${i+1}项质保信息无效，未知期限应留空`);
  }
 }
 if(!Number.isFinite(Number(s.discount))||Number(s.discount)<0||money(s.discount)>total)errors.push('优惠金额无效');
 if(!Number.isFinite(Number(s.net))||Number(s.net)<=0||total-money(s.discount)!==money(s.net))errors.push('工程合计－优惠≠合同价');
 const payments=s.payments||[];
 if(!payments.length||payments.some(p=>!p.name?.trim()||!Number.isFinite(Number(p.amount))||Number(p.amount)<=0)||payments.reduce((n,p)=>n+money(p.amount),0)!==money(s.net))errors.push('付款计划未与合同总价对平');
 return {errors,total:total/100,payments:payments.reduce((n,p)=>n+money(p.amount),0)/100};
}
function expires(start,years){
 if(!start||!Number.isInteger(Number(years))||Number(years)<=0)return null;
 const [y,m,d]=start.slice(0,10).split('-').map(Number);if(!y||!m||!d)return null;
 const target=y+Number(years),last=new Date(Date.UTC(target,m,0)).getUTCDate();
 return `${target}-${String(m).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;
}
function sampleRules(id){
 const w=(component,years,source='合同第7条，第3页')=>({component,years,source});
 if(id<=4)return [w('全铝柜体',11),w('门板',4),w('五金',6)];
 if(id<=6)return [w('岩板台面',6)];
 if(id<=8)return [w('框架、玻璃及移门：厂家期限待补充',null)];
 if(id<=16)return [w('柜体、板材、门板及五金',5)];
 if(id===17)return [w('淋浴隔断框架及玻璃',6),w('淋浴隔断五金',3)];
 if([19,25,29].includes(id))return [w('乙方供应瓷砖本体',11),w('铺贴施工缺陷责任',1)];
 if(id===30)return [w('PVC折叠门产品：合同未明确期限',null),w('安装工艺：范围待确认',null)];
 if(id>=33)return [w('保护／清洁服务：合同未明确期限',null)];
 return [w('施工工艺缺陷责任',1)];
}
function sampleGroup(id){if(id<=4)return GROUPS[0];if(id<=6)return GROUPS[1];if(id<=8)return GROUPS[2];if(id<=16)return GROUPS[3];if(id===17)return GROUPS[4];if(id<=22)return GROUPS[5];if(id<=25)return GROUPS[6];if(id<=27)return GROUPS[7];if(id<=29)return GROUPS[8];return GROUPS[Math.min(id-21,12)];}
// Positional text input {text,x,y,page}; x is normalised to an A4 width of 595.276.
// Only the supplied 15JR contract layout is recognised automatically. Other layouts
// retain extracted text but require manual/JSON review; no fabricated scope or warranty.
function extract(pages,options={}){
 pages=pages.map(page=>page.map(t=>({...t,text:t.text.normalize('NFKC')})));
 const all=pages.flat(),full=all.map(x=>x.text).join(' ').replace(/\s+/g,' '),known=/HZ-RC-20261022-15JR/.test(full);
 const s={lines:[],discount:0,net:0,payments:[],signed_on:'',warnings:[],source_text:full};
 if(!known){s.warnings.push('此合同版式尚未适配自动拆表。请按原文手工录入或导入已核对JSON；不会自动套用范本金额或质保。');return s;}
 s.contract_no='HZ-RC-20261022-15JR';s.address='15 Jalan Rebab 27/2';
 for(const page of pages){
  const rows=[];
  for(const t of [...page].sort((a,b)=>a.y-b.y||a.x-b.x)){
   let r=rows.find(r=>Math.abs(r.y-t.y)<3);if(!r){r={y:t.y,items:[]};rows.push(r);}r.items.push(t);
  }
  let current=null;
  for(const r of rows){
   const cells=r.items.sort((a,b)=>a.x-b.x),text=cells.map(t=>t.text).join(' ');
   if(/小计|Subtotal|附件.*合计|Annex.*Total|^注：/.test(text)){current=null;continue;}
   const number=cells.find(t=>t.x<65&&/^\d+$/.test(t.text.trim()));
   const amount=cells.find(t=>t.x>500&&/^[\d,]+\.\d{2}$/.test(t.text.trim()));
   if(number&&amount){
    const id=Number(number.text),material=id<=17,qty=cells.find(t=>t.x>350&&t.x<420&&/^\d+(\.\d+)?$/.test(t.text.trim()));
    const rate=cells.find(t=>t.x>450&&t.x<500&&/^[\d,]+\.\d{2}$/.test(t.text.trim()));
    if(id<1||id>34||!qty||!rate){current=null;continue;}
    const bounds=material?[64,265,355,409,451]:[64,398,398,423,451];
    const get=(a,b)=>cells.filter(t=>t.x>=a&&t.x<b).map(t=>t.text).join(' ');
    current={id:String(id),name:get(bounds[0],bounds[1]),spec:material?get(265,355):'',qty:Number(qty.text),unit:get(bounds[3],bounds[4]),rate:Number(rate.text.replaceAll(',','')),kind:id<=17?'custom':'work',group:sampleGroup(id),page:number.page,warranties:options.trustedTemplate?sampleRules(id):[{component:'请按本合同逐项核对质保',years:null,source:'待核对合同第7条'}],source_amount:Number(amount.text.replaceAll(',',''))};
    s.lines.push(current);
   }else if(current){
    const material=Number(current.id)<=17;
    const more=cells.filter(t=>t.x>=64&&t.x<(material?265:398)).map(t=>t.text).join(' ');
    if(more)current.name+=' '+more;
    if(material){const spec=cells.filter(t=>t.x>=265&&t.x<355).map(t=>t.text).join(' ');if(spec)current.spec+=' '+spec;}
    const unit=cells.filter(t=>t.x>= (material?409:423)&&t.x<451).map(t=>t.text).join(' ');if(unit)current.unit+=' '+unit;
   }
  }
 }
 const gifts=[['全屋设计服务',1,'项'],['浴室柜镜',4,'面'],['HIGOLD拉篮',2,'套'],['洗手盆',2,'套'],['客厅沙发',1,'套'],['餐桌餐椅',1,'套']];
 // Gifts are recognised only if all six descriptions are present in the actual text.
 if(options.trustedTemplate&&/免费设计|Free design/.test(full)&&/Bathroom vanity mirror/.test(full)&&/HIGOLD/.test(full)&&/Wash basin/.test(full)&&/Living room sofa/.test(full)&&/Dining table/.test(full)){
  gifts.forEach(([name,qty,unit],i)=>s.lines.push({id:'G'+(i+1),name,spec:'具体款式待确认',qty,unit,rate:0,kind:'gift',group:GROUPS[13],page:7,warranties:[{component:'赠送项目：质保范围及期限待确认',years:null,source:'合同附件三，第7页；第7条未单独列明'}]}));
 }else s.warnings.push('赠品及质保未使用范本规则，请按本合同人工补齐。');
 // Read the contract summary and milestones, rather than assuming a blanket 10% discount.
 const numberPattern=/\d[\d,]*\.\d{2}/g;
 const grouped=pages.map(page=>{const rows=[];for(const t of page){let r=rows.find(r=>Math.abs(r.y-t.y)<3);if(!r){r={y:t.y,items:[]};rows.push(r);}r.items.push(t);}return rows.sort((a,b)=>a.y-b.y).map(r=>({...r,text:r.items.sort((a,b)=>a.x-b.x).map(t=>t.text).join(' ').replace(/\s+/g,' ')}));});
 const findMoney=(label)=>{for(const rows of grouped){const r=rows.find(r=>label.test(r.text));if(r){const vals=r.items.filter(t=>t.x>430).flatMap(t=>t.text.match(numberPattern)||[]);if(vals.length)return Number(vals.at(-1).replaceAll(',',''));}}return null;};
 const net=findMoney(/Contract\s+Sum/),discount=findMoney(/Grand\s+Opening\s+Special\s+Discount/);
 if(net!==null)s.net=net;else s.warnings.push('合同价未识别，请手工核对');
 if(discount!==null)s.discount=discount;else s.warnings.push('优惠未识别，请手工核对');
 const stageRows=grouped.find(rows=>rows.some(r=>/Payment\s+Terms/.test(r.text)));
 if(stageRows){for(let i=1;i<=4;i++){
  const r=stageRows.find(r=>new RegExp('第\\s*'+i+'\\s*期').test(r.text));if(!r)continue;
  const amount=r.items.filter(t=>t.x>430).flatMap(t=>t.text.match(numberPattern)||[]).at(-1);
  if(amount)s.payments.push({name:['签约定金','水电隐蔽验收','泥水瓷砖验收','竣工交付'][i-1],amount:Number(amount.replaceAll(',',''))});
 }}
 if(s.lines.filter(l=>l.kind!=='gift').length!==34)s.warnings.push('收费清单未完整识别为34项，请逐项核对');
 for(const l of s.lines)if(l.source_amount!==undefined&&money(l.qty*l.rate)!==money(l.source_amount))s.warnings.push(`第${l.id}项原表金额与数量×单价不一致`);
 s.warnings.push('业主、签署状态、签约日期及工期必须人工核对。','防水5年是通用条款；附件未单列防水，不自动创建防水已承保项目。','第25项本合同写明含开发商标准砖，请与旧报价的排除范围核对。','自动提取的质保需逐项审核；按厂家质保及赠品期限留空，不推测。');
 return s;
}
return {money,cash,validate,expires,extract,GROUPS};
});
