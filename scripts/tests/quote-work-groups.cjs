const fs=require('fs'),vm=require('vm'),assert=require('assert');
let src=fs.readFileSync('portal/quote.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
src=src.replace(/  render\(\);\n\}\)\(\);\s*$/,'globalThis.api={P,makeRoom,workCodes,workHtml,compute,applyCatalog};})();');
const ctx={console,document:{addEventListener(){}},localStorage:{getItem(){return null},setItem(){}},setTimeout,clearTimeout};vm.createContext(ctx);vm.runInContext(src,ctx);const a=ctx.api;
for(const type of ['living','bedroom','kitchen','bath','laundry','balcony','porch']){
 const r=a.makeRoom(type,type,1);a.P.rooms=[r];r.work.demo_floor=true;r.work.floor_tile=true;
 const html=a.workHtml(r);assert(html.indexOf('1. 拆除工程')<html.indexOf('2. 新建／安装工程'));
 const [demo,install]=html.split('2. 新建／安装工程');assert(!/data-work-code="floor_tile"/.test(demo));assert(!/data-work-code="demo_/.test(install));
 for(const code of a.workCodes(r))assert.equal((html.match(new RegExp('type="checkbox" data-work-room="'+r.id+'" data-work-code="'+code+'"','g'))||[]).length,1,code);
 assert(!html.includes('data-goto-price'));assert(r.work.demo_floor&&r.work.floor_tile);
}
const r=a.makeRoom('living','test',1);a.P.rooms=[r];r.work.floor_tile=true;r.tileConfig={floor_tile:{dim:'300×600 mm',thickness:'10 mm',finish:'哑光',method:'正铺',mode:'all',areaMode:'manual',areaUnit:'ft2',area:100}};
a.applyCatalog([{code:'floor_tile',spec:'300×600 mm',scope:'all',unit:'平方尺',materialUnit:'平方尺',mat:16,aux:2,lab:5,waste:3},{code:'floor_tile',spec:'300×600 mm',scope:'labour',unit:'平方尺',materialUnit:'平方尺',mat:99,aux:3,lab:7,waste:3}]);
let row=a.compute().rows.find(x=>x.code==='floor_tile');assert.equal(row.total,2348);
r.tileConfig.floor_tile.mode='labour';row=a.compute().rows.find(x=>x.code==='floor_tile');assert.equal(row.total,1000);assert.equal(row.uMat,0);
r.tileConfig.floor_tile.dim='800×800 mm';row=a.compute().rows.find(x=>x.code==='floor_tile');assert(row.catalogPending);assert.equal(row.total,0);
console.log('Passed: demolition/new-build grouping across seven spaces, no duplicate or lost choices, no price-maintenance shortcuts, scope-specific company rates, material waste and missing-price handling');
