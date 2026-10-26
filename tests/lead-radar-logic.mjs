import assert from 'node:assert/strict';
const L=await import('../supabase/functions/lead-radar/logic.ts');let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};

// The same Facebook post arrives via m./www. hosts and share-tracking parameters; it must count once.
const a=L.urlKey('https://www.facebook.com/groups/123/posts/456/?mibextid=abc&utm_source=x');
ok(a==='facebook.com/groups/123/posts/456','tracking parameters and www removed');
ok(L.urlKey('https://m.facebook.com/groups/123/posts/456')===a,'mobile host collapses to the same post');
ok(L.urlKey('https://forum.example.com/t?id=9&utm_medium=y')==='forum.example.com/t?id=9','meaningful query kept');
ok(L.urlKey('javascript:alert(1)')===null&&L.urlKey('not a url')===null,'non-web links rejected');
ok(L.platformOf(a.replace(/^/,'https://'))==='facebook_group'&&L.platformOf('https://www.threads.com/@x/post/1')==='threads','platform recognised for staff filters');

// Dates come only from the search engine's own prefix; without one the page must say "unverified".
ok(L.publishedHint('6 days ago · I need a contractor')==='6 days ago','English relative date read');
ok(L.publishedHint('3 天前 · 求推荐新山装修')==='3 天前','Chinese relative date read');
ok(L.publishedHint('Looking for contractor 2 days ago maybe')===null,'a date inside the sentence is not treated as the post date');

// Numbers are normalised to +60 so staff dial the right person; anything else is ignored.
ok(L.malaysianMobile('pls WhatsApp me 012-345 6821 thanks')==='+60123456821','local mobile normalised');
ok(L.malaysianMobile('call +60 11-2345 6789')==='+601123456789','11-digit international mobile normalised');
ok(L.malaysianMobile('budget RM60000, unit 12-3')===null,'prices and unit numbers are not phone numbers');
ok(L.waLink('+60 10-589 8786','Radar-ab12cd')==='https://wa.me/60105898786?text=Hi%20HOUZY%2C%20I%20saw%20your%20reply%20%5BRadar-ab12cd%5D','reply link names its source post');

// AI output is untrusted: unknown ids, duplicates and bad values must not reach the table.
const ids=new Set(['p1','p2','p3']);
const parsed=L.parseClassifications({items:[
 {id:'p1',label:'demand',score:140,confidence:1.7,service:'kitchen',area:'Skudai',lang:'zh',keywords:['橱柜','防水','a','b','c','d'],reason:'业主找橱柜',reply:'您好',invites_contact:true},
 {id:'p1',label:'ad',score:5,confidence:.9,service:'other',area:'',lang:'en',keywords:[],reason:'dup',reply:'',invites_contact:false},
 {id:'p2',label:'ad',score:88,confidence:.8,service:'kitchen',area:'JB',lang:'en',keywords:[],reason:'广告',reply:'Hi',invites_contact:true},
 {id:'zz',label:'demand',score:90,confidence:.9,service:'kitchen',area:'',lang:'en',keywords:[],reason:'',reply:'',invites_contact:false},
 {id:'p3',label:'spam',score:50},
]},ids);
ok(parsed.length===2,'only known ids with valid labels kept, first answer per id wins');
ok(parsed[0].score===100&&parsed[0].confidence===1&&parsed[0].keywords.length===5,'scores and lists clamped to table limits');
ok(parsed[1].score===19&&parsed[1].reply===''&&parsed[1].invites_contact===false,'an ad never ranks as a lead, gets no reply and never yields a contact');
ok(L.parseClassifications('garbage',ids).length===0,'malformed output ignored');
ok(L.responseText({output:[{type:'reasoning'},{content:[{type:'output_text',text:'{"items":[]}'}]}]})==='{"items":[]}','Responses API text located');

// Strict structured output requires every property to be listed as required.
const props=L.CLASSIFY_SCHEMA.properties.items.items;ok(Object.keys(props.properties).sort().join()===props.required.slice().sort().join(),'schema valid for strict mode');
console.log('PASS',checks,'lead radar logic checks: url de-duplication, platform, date hints, phone normalisation, untrusted AI output');
