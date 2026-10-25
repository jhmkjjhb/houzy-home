const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
(async()=>{
 const fields=Object.fromEntries(['data-name','data-consent','data-feedback','data-clear','data-reload','data-submit'].map(k=>[k,{value:'Customer',checked:true}]));
 const ctx={scale(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}};
 const canvas={clientWidth:600,getContext:()=>ctx,setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,width:600,height:180})};
 const panel={querySelector:s=>s==='[data-signature]'?canvas:fields[s.slice(1,-1)],querySelectorAll:()=>Object.values(fields)};
 const elements={'addition-signing':panel,'customer-additions-list':{},'customer-additions-panel':{}};
 let submits=0,reads=0,resolveSubmit;
 const client={rpc:async name=>{
  if(name==='renovation_customer_additions')return {data:[]};
  if(name==='renovation_customer_addition_sign_view'){reads++;return {data:{status:'pending',terms:{},terms_hash:'hash'}};}
  submits++;return new Promise(resolve=>resolveSubmit=resolve);
 }};
 const sandbox={URLSearchParams,location:{search:'?addition=11111111-1111-1111-1111-111111111111&sign=22222222-2222-2222-2222-222222222222',reload(){}},document:{getElementById:id=>elements[id]},RenoFinanceView:{esc:s=>String(s??''),money:()=>''},confirm:()=>true};
 sandbox.window={addEventListener(){}};
 vm.runInNewContext(fs.readFileSync('portal/renovation/addition-signing.js','utf8'),sandbox);
 const signing=sandbox.window.RenoAdditionSigning;
 await signing.mount(client,'project');
 const event=(pointerId,x=60)=>({pointerId,button:0,clientX:x,clientY:40,preventDefault(){}});
 canvas.onpointerdown(event(1));
 canvas.onpointerdown(event(2));
 canvas.onpointerup(event(2));
 for(let i=1;i<=8;i++)canvas.onpointermove(event(1,60+i*30));
 await fields['data-submit'].onclick();assert.equal(submits,0,'cannot submit an unfinished stroke');
 canvas.onlostpointercapture(event(1));
 const pending=fields['data-submit'].onclick();assert.equal(submits,1,'second finger cannot end the active stroke');
 fields['data-reload'].onclick();assert.equal(reads,1,'cannot reload while submission is pending');
 resolveSubmit({error:{message:'Try again'}});await pending;
 assert.equal(signing.isDirty(),true,'failed submission preserves unsaved signature');
 fields['data-clear'].onclick();assert.equal(signing.isDirty(),true,'clearing ink preserves unsaved form warning');
 await fields['data-submit'].onclick();assert.equal(submits,1,'cleared signature cannot submit');
 console.log('PASS: pointer ownership, capture loss, unfinished stroke, pending submission, retry preservation and unsaved form warning');
})().catch(e=>{console.error(e);process.exitCode=1;});
