// Staff and customer pages style every <header>/<h1> (dark green bar, serif !important). The
// statement is captured inside those pages, so it must keep its own white header and plain
// headings, and an unpaid statement must show the bank account before the payment history.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
 const b=await chromium.launch();const page=await b.newPage({viewport:{width:390,height:844}});
 const css=['houzy-brand.css','renovation/style.css','renovation/workspace.css','renovation/customer-workspace.css'].map(f=>fs.readFileSync('portal/'+f,'utf8')).join('\n');
 await page.setContent(`<meta charset=utf-8><style>${css}</style><body class="customer-workspace"><div id="out"></div></body>`);
 await page.addScriptTag({content:fs.readFileSync('portal/renovation/installment-statement.js','utf8')});
 const company={legalName:'HOUZY HOME SDN. BHD.',registrationNumber:'1',taxStatus:'C 1',bankName:'UOB',accountName:'HOUZY HOME SDN. BHD.',accountNumber:'226-308-905-9'};
 const base={installment:2,amount:95000,reference:'R-P02',generated_at:'2026-10-28T08:00:00Z',customer_name:'Owner',address:'A',contract_no:'C',stage_name:'S',project_total:100000,entries:[{paid_on:'2026-10-01',kind:'receipt',method:'bank_transfer',verified:true,amount:30000}]};
 for(const [status,extra] of [['partial',{received:30000,refunded:0,pending:0,balance:65000}],['paid',{received:95000,refunded:0,pending:0,balance:0}]]){
  const r=await page.evaluate(({d,company})=>{const out=document.getElementById('out');out.innerHTML=RenoInstallmentStatement.render(d,company);
   const h=out.querySelector('.reno-statement header'),h1=out.querySelector('.reno-statement h1'),text=out.textContent;
   return {bg:getComputedStyle(h).backgroundColor,color:getComputedStyle(h).color,font:getComputedStyle(h1).fontFamily,bank:text.indexOf('Payment account'),history:text.indexOf('Payment history'),account:text.includes('226-308-905-9')};},{d:{...base,status,...extra},company});
  assert.equal(r.bg,'rgb(255, 255, 255)',`${status}: header must stay white, got ${r.bg}`);
  assert.notEqual(r.color,'rgb(255, 255, 255)',`${status}: header text must not be white`);
  assert(!/serif/i.test(r.font.replace(/sans-serif/gi,'')),`${status}: heading must not use the page serif font (${r.font})`);
  if(status==='paid')assert(r.bank<0&&!r.account,'paid statement shows no bank account');
  else assert(r.account&&r.bank>0&&r.bank<r.history,'unpaid statement shows the bank account before the payment history');
 }
 console.log('PASS: statement keeps white header and plain headings inside page CSS; unpaid shows bank account first, paid shows none');await b.close();
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
