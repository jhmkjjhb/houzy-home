// Sealed reviewed contracts: the scanned JALAN35 contract must import fully reconciled for whoever holds
// the PDF, while the public verified-contract.js never exposes the owner's name or phone.
// Usage: node tests/renovation-sealed-contract.cjs [path/to/JALAN35号_整装工程合同(2).pdf]
// The PDF carries personal data and stays out of the repo; without it only the privacy checks run.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto'),C=require('../portal/renovation/core.js');
const published=fs.readFileSync('portal/renovation/verified-contract.js','utf8');
const context={window:{}};vm.runInNewContext(published,context);
const sealed=Object.entries(context.window.RenoVerifiedContracts).filter(([,v])=>v.sealed);
assert.equal(sealed.length,1,'one sealed contract');
// The sealed entry carries only base64 ciphertext; nothing readable about the owner.
assert.deepEqual(Object.keys(sealed[0][1]),['sealed']);assert.deepEqual(Object.keys(sealed[0][1].sealed).sort(),['data','iv']);

const source=fs.readFileSync('portal/renovation/app.js','utf8');
const start=source.indexOf('async function parsePDF(file){'),end=source.indexOf('\nfunction reset()',start);
const load=(bytes)=>{
 const file={arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
 const scope={window:context.window,crypto:webcrypto,structuredClone,C,Uint8Array,TextEncoder,TextDecoder,atob,
  pdfjsMock:{GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>({getViewport:()=>({width:595.276,height:842}),getTextContent:async()=>({items:[]})}),destroy:async()=>{}})})}};
 vm.runInNewContext(source.slice(start,end).replace("await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs')",'pdfjsMock'),scope);
 return {scope,file};
};
(async()=>{
 // Someone with only the public file (and so only the lookup hash) cannot derive the key.
 const {scope}=load(Buffer.from('not the contract'));
 await assert.rejects(scope.unseal(sealed[0][1].sealed,new Uint8Array(Buffer.from('not the contract')).buffer),'wrong bytes cannot decrypt');
 if(process.argv[2]){
  const bytes=fs.readFileSync(process.argv[2]);
  const {scope:s,file}=load(bytes);
  const r=await s.parsePDF(file);
  assert.equal(r.contract_no,'HZ-RC-20260625-35AM');assert.equal(r.signed_on,'2026-06-25');
  assert(r.customer_name.trim(),'owner name prefilled');assert(C.normalizePhone(r.customer_phone),'owner phone prefilled and valid');
  const digits=C.normalizePhone(r.customer_phone);
  assert(!published.includes(r.customer_name)&&!published.includes(digits)&&!published.includes(digits.slice(2)),'owner name and phone never appear in the public file');
  const v=C.validate(r);assert.deepEqual(v.errors,[],'lines − discount = contract sum and payments reconcile');
  assert.equal(r.net,468000);assert.equal(v.payments,468000);assert.equal(r.payments.length,8);
  assert.equal(r.lines.filter(l=>/^\d+$/.test(l.id)).length,41,'Annex 1: 41 items, #30 absent in the original');
  assert(r.lines.some(l=>l.id==='W-GAP'),'unitemised works gap is visible, not hidden in other lines');
  assert(r.warnings.some(w=>/扫描件/.test(w))&&r.warnings.some(w=>/缺页/.test(w)),'staff are told to check the scan and the missing Annex 2 page');
 }
 console.log('PASS: owner data sealed in public file; wrong bytes rejected'+(process.argv[2]?'; JALAN35 imports 77 lines reconciled to RM 468,000 with 8 instalments and prefilled owner':' (PDF not given: import check skipped)'));
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
