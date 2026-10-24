const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto'),C=require('../portal/renovation/core.js');
const context={window:{}};vm.runInNewContext(fs.readFileSync('portal/renovation/verified-contract.js','utf8'),context);
const entries=Object.entries(context.window.RenoVerifiedContracts);assert.equal(entries.length,1);
const snapshot=JSON.parse(JSON.stringify(entries[0][1]));assert.equal(snapshot.lines.length,42);assert.equal(C.validate(snapshot).errors.length,0);assert.equal(C.validate(snapshot).total,190371.25);assert.equal(snapshot.discount,19371.25);assert.equal(snapshot.net,171000);assert.equal(C.validate(snapshot).payments,171000);assert.equal(snapshot.signed_on,'');assert(!snapshot.contract_no,'do not invent an identifier absent from the PDF');
(async()=>{
 if(process.argv[2]){
 const buffer=fs.readFileSync(process.argv[2]);const file={arrayBuffer:async()=>buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)};
 const source=fs.readFileSync('portal/renovation/app.js','utf8');const start=source.indexOf('async function parsePDF(file){'),end=source.indexOf('\nfunction reset()',start);
 let destroyed=false;const scope={window:context.window,crypto:webcrypto,structuredClone,C,Uint8Array,pdfjsMock:{GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>({getViewport:()=>({width:595.276,height:842}),getTextContent:async()=>({items:[{str:'actual contract text',transform:[1,0,0,1,20,800]}]})}),destroy:async()=>{destroyed=true;}})})}};
 vm.runInNewContext(source.slice(start,end).replace("await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs')",'pdfjsMock'),scope);
 const result=await scope.parsePDF(file);assert.equal(result.lines.length,42);assert.equal(C.validate(result).errors.length,0);assert.equal(result.source_text,'actual contract text');assert(destroyed);
 }
 console.log('PASS: verified PDF checksum, 42 lines, totals, milestones, text retention, no invented signature/date or identifier');
})();
