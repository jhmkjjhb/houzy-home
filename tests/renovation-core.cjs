const assert=require('node:assert/strict'),fs=require('node:fs'),C=require('../portal/renovation/core.js');
const pages=JSON.parse(fs.readFileSync('tests/fixtures/renovation-15jr-spans.json'));
const s=C.extract(pages,{trustedTemplate:true});
assert.equal(s.lines.length,40);assert.equal(s.lines.filter(l=>l.kind==='gift').length,6);
assert.deepEqual(C.validate(s),{errors:[],total:190871.25,payments:171000});
assert.equal(s.net,171000);assert.equal(s.discount,19871.25);
assert.equal(s.lines.find(l=>l.id==='22').rate,2000);
assert.equal(s.lines.find(l=>l.id==='15').rate,5600);assert.equal(s.lines.find(l=>l.id==='16').rate,8400);
assert.equal(s.lines.find(l=>l.id==='25').warranties.length,2);
assert.equal(s.lines.find(l=>l.id==='34').group,'保护清洁');
assert.equal(C.expires('2024-02-29',1),'2025-02-28');assert.equal(C.expires('2026-10-24',11),'2037-10-24');assert.equal(C.expires(null,6),null);assert.equal(C.expires('2026-10-24',null),null);
const changed=C.extract(pages);assert(changed.lines.every(l=>l.warranties.every(w=>w.years===null)),'modified/unverified PDF never inherits sample warranties');assert.equal(changed.lines.length,34);
const unrelated=C.extract([[{text:'A different contract',x:0,y:0,page:1}]]);assert.equal(unrelated.lines.length,0);assert(C.validate(unrelated).errors.length);
for(const mutate of [x=>x.lines.push(x.lines[0]),x=>x.net++,x=>x.payments[0].amount++,x=>x.lines[0].qty=0,x=>x.lines[0].rate=-1,x=>x.lines[0].warranties[0].years=0,x=>x.lines[39].rate=1]){const x=structuredClone(s);mutate(x);assert(C.validate(x).errors.length);}
console.log('PASS: actual-contract extraction, money, gifts, warranty mapping, unknown-template handling, leap dates and malformed inputs');

for(const [raw,cc,expected] of [['010-1234567','60','60101234567'],['+60 10 1234567','60','60101234567'],['60101234567','60','60101234567'],['0060101234567','60','60101234567'],['８１２３４５６７','65','6581234567'],['+8613812345678','60',null],['foo1234567','60',null],['123','60',null]])assert.equal(C.normalizePhone(raw,cc),expected);
console.log('PASS: phone canonicalisation, full-width digits, country mismatch and invalid input');
