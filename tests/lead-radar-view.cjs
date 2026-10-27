const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const ctx={window:{}};vm.runInNewContext(fs.readFileSync('portal/lead-radar/app.js','utf8'),ctx);const V=ctx.window.LeadRadarView;let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};
const now=Date.parse('2026-10-26T08:00:00+08:00'),day=864e5,at=d=>new Date(now-d*day).toISOString();
const items=[
 {id:'a',label:'demand',score:92,service:'kitchen',platform:'facebook_group',area:'Skudai',keywords:['Kitchen cabinet','防水'],found_at:at(1),status:'new',title:'Need kitchen',snippet:'<img src=x onerror=alert(1)>',url:'https://facebook.com/groups/1/posts/2',reason:'业主找橱柜',suggested_reply:'Hi https://wa.me/60105898786',invites_contact:true,posted_contact:'+60123456821',lang:'en',published_hint:'1 day ago'},
 {id:'b',label:'demand',score:70,service:'kitchen',platform:'threads',area:'Skudai',keywords:['kitchen cabinet'],found_at:at(3),status:'replied',handled_by_name:'Ali',handled_at:at(1),title:'',snippet:'cari kontraktor',url:'javascript:alert(1)',reason:'',lang:'ms'},
 {id:'c',label:'demand',score:88,service:'full_house',platform:'reddit',area:'Mount Austin',keywords:[],found_at:at(20),status:'won',handled_at:new Date(now-2*day).toISOString(),snippet:'old but won',url:'https://reddit.com/r/x',reason:''},
 {id:'d',label:'ad',score:10,service:null,platform:'instagram',found_at:at(1),status:'new',snippet:'we renovate',url:'https://instagram.com/p/1',reason:'广告'},
];
// Trends describe customer demand, so competitor ads and posts outside the period must not count.
let t=V.trends(items,7,now);ok(t.total===2&&t.service[0][0]==='厨房橱柜'&&t.service[0][1]===2,'7-day trend counts only recent demand');
ok(t.keywords.find(k=>k[0]==='kitchen cabinet')[1]===2,'keywords merged regardless of letter case');
ok(V.trends(items,30,now).total===3,'30-day window includes older demand');
// One place, one row: the AI's spellings of the same area are merged so trend counts are not split.
ok(['JB','Johor Bahru','新山','johor bahru '].every(x=>V.areaOf(x)==='新山')&&V.areaOf('Skudai, JB')==='Skudai'&&V.areaOf('Nusajaya')==='Iskandar Puteri'&&V.areaOf('Jbx Park')==='Jbx Park','area spellings merged, specific place wins');
const mixed=[{label:'demand',area:'JB',keywords:['cari kontraktor','area jb'],found_at:at(1)},{label:'demand',area:'Johor Bahru',keywords:['Johor Bahru','kitchen'],found_at:at(1)}];
const tm=V.trends(mixed,7,now);ok(tm.area.length===1&&tm.area[0][0]==='新山'&&tm.area[0][1]===2,'JB and Johor Bahru counted as one area');
ok(!tm.keywords.some(([k])=>/jb|johor/.test(k))&&tm.keywords.length===2,'place names are not shown as keywords');
// Default view is the work queue: unhandled demand only, highest score first.
let v=V.visible(items,{state:'open'});ok(v.length===1&&v[0].id==='a','open queue hides handled posts and ads');
v=V.visible(items,{state:'all'});ok(v.map(i=>i.id).join()==='a,c,b','all demand sorted by score');
ok(V.visible(items,{state:'all',search:'kontraktor'}).length===1&&V.visible(items,{state:'all',service:'full_house'}).length===1,'search and service filters work');
const c=V.counts(items,now);ok(c.open===1&&c.filtered===1&&c.handled===1&&c.won===1,'overview counts match the lists');
// Post text comes from the internet: it must be shown as text, and only web links may be opened.
const a=V.card(items[0]),b=V.card(items[1]);
ok(!a.includes('<img')&&a.includes('&lt;img'),'post text escaped');
ok(!b.includes('javascript:')&&!b.includes('打开原帖'),'non-web links are not rendered');
ok(a.includes('客户已留号')&&a.includes('只限一次')&&!b.includes('客户已留号'),'contact button only for posts that invited contact');
ok(V.contactUrl(items[0]).startsWith('https://wa.me/60123456821?text=')&&V.contactUrl({posted_contact:'12345'})===null,'WhatsApp link only for a valid +60 number');
ok(V.card({...items[0],status:'contacted',handled_at:at(0)}).includes('已联系过'),'contact button locked after the one allowed contact');
ok(b.includes('Ali')&&b.includes('已回复'),'colleague who replied is shown');
ok(V.card({...items[0],published_hint:null}).includes('日期未验证'),'missing date shown as unverified');
console.log('PASS',checks,'lead radar view checks: trends, queue, counts, escaping, link safety, contact-once UI');
