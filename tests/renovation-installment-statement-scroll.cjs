// The download button sits far down the page. html2canvas offsets the capture by the window
// scroll unless told otherwise, which produced blank statement PDFs; a scrolled page must
// capture the same statement as an unscrolled one.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
 const b=await chromium.launch();const page=await b.newPage({viewport:{width:1280,height:900}});
 await page.route('http://localhost/t',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset=utf-8><body style="margin:0"><div style="height:6000px"></div></body>'}));
 await page.goto('http://localhost/t');
 await page.addScriptTag({url:'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js'});
 await page.addScriptTag({content:fs.readFileSync('portal/renovation/installment-statement.js','utf8')});
 // Keep the rendered canvas instead of saving a file, and count its non-white pixels.
 await page.evaluate(()=>{html2pdf.Worker.prototype.save=function(){return this.toCanvas().get('canvas').then(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]<200)n++;window.inked=n;});};});
 const data={status:'unpaid',installment:2,amount:95000,received:0,refunded:0,pending:0,balance:95000,reference:'HZ-RC-TEST-P2',generated_at:'2026-10-28T08:00:00Z',customer_name:'Owner',address:'35 Austin Mutiara',contract_no:'HZ-RC-TEST',stage_name:'水电',project_total:468000,entries:[]};
 const company={legalName:'HOUZY HOME SDN BHD',registrationNumber:'123',taxStatus:'TIN',bankName:'Bank',accountName:'HOUZY',accountNumber:'000'};
 const ink=async y=>{await page.evaluate(y=>scrollTo(0,y),y);await page.evaluate(({data,company})=>RenoInstallmentStatement.download(data,company),{data,company});return page.evaluate(()=>window.inked);};
 const top=await ink(0),scrolled=await ink(4500);
 assert(top>5000,'statement renders content');
 assert(scrolled>top*0.9,`scrolled page still captures the statement (${scrolled} vs ${top})`);
 console.log('PASS: statement PDF captures content at top and after scrolling',top,scrolled);await b.close();
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
