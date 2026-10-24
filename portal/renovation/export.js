'use strict';
window.RenoExport=(()=>{
 const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 function rows(project,snapshot){
  const result=[['HOUZY HOME · 整装合同核对清单'],['合同编号',project?.contract_no||'未保存项目'],['业主',project?.customer_name||''],['项目地址',project?.address||''],['签约日期',snapshot.signed_on||'待核对'],['核对版本',project?.revision||'未保存'],['说明','本表供核对使用，合同及双方有效签署文件为准；付款计划不代表实际收款。'],[],['工程明细'],['编号','名称','规格／范围','数量','单位','单价 RM','金额 RM','执行分组','合同页码','部件质保／依据']];
  for(const l of snapshot.lines)result.push([l.id,l.name,l.spec,l.qty,l.unit,l.rate,Math.round((Number(l.qty)*Number(l.rate)+Number.EPSILON)*100)/100,l.group,l.page||'',(l.warranties||[]).map(w=>`${w.component}：${w.years? w.years+'年':'期限待确认'}；${w.source||'依据待补充'}`).join('\n')]);
  result.push([],['清单合计 RM',snapshot.lines.reduce((a,l)=>a+Math.round((Number(l.qty)*Number(l.rate)+Number.EPSILON)*100),0)/100],['整单优惠 RM',snapshot.discount],[snapshot.has_additions?'项目当前应收总额 RM':'合同总价 RM',snapshot.net],[],['付款计划（非实际收款）'],['付款节点','约定应收 RM']);
  for(const p of snapshot.payments)result.push([p.name,p.amount]);
  result.push([],['待核对提醒']);for(const w of snapshot.warnings||[])result.push([w]);
  return result;
 }
 const encoder=new TextEncoder();
 function zip(files){
  const parts=[],directory=[];let offset=0;
  const header=n=>new Uint8Array(n),view=a=>new DataView(a.buffer);
  for(const [name,text] of Object.entries(files)){
   const filename=encoder.encode(name),data=encoder.encode(text);let crc=0xffffffff;
   for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
   const local=header(30),v=view(local);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,filename.length,true);
   parts.push(local,filename,data);
   const central=header(46),c=view(central);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,filename.length,true);c.setUint32(42,offset,true);directory.push(central,filename);offset+=local.length+filename.length+data.length;
  }
  const size=directory.reduce((a,b)=>a+b.length,0),end=header(22),e=view(end);e.setUint32(0,0x06054b50,true);e.setUint16(8,Object.keys(files).length,true);e.setUint16(10,Object.keys(files).length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
  return new Blob([...parts,...directory,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 }
 function workbook(table){
  const cells=table.map((row,i)=>`<row r="${i+1}">${row.map((value,j)=>{const ref=String.fromCharCode(65+j)+(i+1);return typeof value==='number'&&Number.isFinite(value)?`<c r="${ref}"><v>${value}</v></c>`:`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;}).join('')}</row>`).join('');
  return zip({
   '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
   '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
   'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="合同核对清单" sheetId="1" r:id="rId1"/></sheets></workbook>',
   'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
   'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="15" customWidth="1"/><col min="2" max="3" width="40" customWidth="1"/><col min="4" max="9" width="18" customWidth="1"/><col min="10" max="10" width="65" customWidth="1"/></cols><sheetData>${cells}</sheetData></worksheet>`
  });
 }
 function download(project,snapshot){const url=URL.createObjectURL(workbook(rows(project,snapshot))),a=document.createElement('a');a.href=url;a.download=(project?.contract_no||'整装项目').replace(/[\\/:*?"<>|]/g,'_')+'_核对清单.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 function print(project,snapshot){
  const tab=window.open('about:blank','_blank');if(!tab)throw new Error('请允许此网站弹出窗口后再打印清单');tab.opener=null;
  const table=rows(project,snapshot);tab.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>合同核对清单</title><style>body{font:12px/1.6 sans-serif;color:#22362e;margin:24px}table{border-collapse:collapse;width:100%;table-layout:fixed}td{border:1px solid #ccd5cf;padding:6px;white-space:pre-wrap;overflow-wrap:anywhere}tr{break-inside:avoid}tr:first-child{font-size:20px;font-weight:bold}button{padding:10px 20px;margin-bottom:16px}@page{size:A4 landscape;margin:10mm}@media print{button{display:none}body{margin:0}}</style></head><body><button onclick="window.print()">打印／保存为PDF</button><table>${table.map(row=>`<tr>${row.length===1?`<td colspan="10">${xml(row[0])}</td>`:row.length===0?'<td colspan="10">　</td>':row.map((v,i)=>`<td${i===row.length-1&&row.length<10?` colspan="${11-row.length}"`:''}>${xml(v)}</td>`).join('')}</tr>`).join('')}</table></body></html>`);tab.document.close();
 }
 return {rows,workbook,download,print};
})();
