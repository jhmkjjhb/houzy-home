// The download button sits far down the page. html2canvas offsets the capture by the window
// scroll unless told otherwise, which produced blank statement PDFs; a scrolled page must
// capture the same statement as an unscrolled one. The statement must also always be one A4
// page, even with a long payment history.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
 const b=await chromium.launch();const ctx=await b.newContext({acceptDownloads:true,viewport:{width:1280,height:900}});const page=await ctx.newPage();
 await page.route('http://localhost/t',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset=utf-8><body style="margin:0"><div style="height:6000px"></div></body>'}));
 await page.goto('http://localhost/t');
 await page.addScriptTag({url:'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js'});
 await page.addScriptTag({content:fs.readFileSync('portal/renovation/installment-statement.js','utf8')});
 // Count non-white pixels of the captured canvas when it is turned into the page image.
 await page.evaluate(()=>{const raw=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(type,...rest){if(type==='image/jpeg'){const d=this.getContext('2d').getImageData(0,0,this.width,this.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]<200)n++;window.inked=n;}return raw.call(this,type,...rest);};});
 const company={legalName:'HOUZY HOME SDN BHD',registrationNumber:'123',taxStatus:'TIN',bankName:'Bank',accountName:'HOUZY',accountNumber:'000'};
 const data={status:'unpaid',installment:2,amount:95000,received:0,refunded:0,pending:0,balance:95000,reference:'HZ-RC-TEST-P02',generated_at:'2026-10-28T08:00:00Z',customer_name:'Owner',address:'35 Austin Mutiara',contract_no:'HZ-RC-TEST',stage_name:'水电',project_total:468000,entries:[]};
 const pdf=async(d,y)=>{await page.evaluate(y=>scrollTo(0,y),y);const [dl]=await Promise.all([page.waitForEvent('download'),page.evaluate(({d,company})=>RenoInstallmentStatement.download(d,company),{d,company})]);
  const bytes=fs.readFileSync(await dl.path()).toString('latin1');return {ink:await page.evaluate(()=>window.inked),pages:(bytes.match(/\/Type\s*\/Page[^s]/g)||[]).length};};
 const top=await pdf(data,0),scrolled=await pdf(data,4500);
 assert(top.ink>5000,'statement renders content');
 assert(scrolled.ink>top.ink*0.9,`scrolled page still captures the statement (${scrolled.ink} vs ${top.ink})`);
 const long=await pdf({...data,status:'partial',received:14000,balance:81000,entries:Array.from({length:14},(_,i)=>({paid_on:'2026-10-0'+(1+i%9),kind:'receipt',method:'bank_transfer',verified:true,amount:1000}))},4500);
 assert.deepEqual([top.pages,scrolled.pages,long.pages],[1,1,1],'every statement is a single A4 page');
 console.log('PASS: statement captured at top and after scrolling, always one A4 page (14-row history too)',top.ink,scrolled.ink);await b.close();
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
