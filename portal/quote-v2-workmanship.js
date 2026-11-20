/* Client-facing method notes. These are illustrative scope guides, not contractual specs. */
(function (root) {
  const source = [
    { label: 'CIDB CIS 7:2021 / QLASSIC', url: 'https://www.cidb.gov.my/eng/construction-industry-standard-cis/', note: 'Workmanship assessment reference. It becomes a project requirement only when the parties agree to include it in the contract.' },
    { label: 'Standards Malaysia MS 1294-3:2017', url: 'https://mysol.jsm.gov.my/preview-file/eyJpdiI6ImIzRWVZZmdha3JWeFZOU1pXRzZTd3c9PSIsInZhbHVlIjoiSklwYm1XdEVQa0s4RkI4SkdRNE1iZz09IiwibWFjIjoiOTE2ZTk4NmQ1OGY2MDQ0MWM5ZjUzNDZiN2MzNzUwYmRkNzFlY2QxMjkxYjUyYzI0Y2RiM2U1YTVlYmJiOWUyOSJ9', note: 'Code of practice for internal and external ceramic and mosaic floor tiling in normal conditions.' },
    { label: 'CIDB waterproofing inspection guidance', url: 'https://www.cidb.gov.my/wp-content/uploads/2022/07/187-Guideline-for-Volumetric-Module-House-Manufacturing-Design-Construction-min.pdf', note: 'Includes waterproofing checks, ponding test and tile-installation inspection in its quality-verification section.' },
    { label: 'Knauf plasterboard installation guide', url: 'https://knauf.com/en-AU/our-services/knauf-gypsum/training/plasterboard-installation-guide', note: 'Manufacturer installation guidance; final system must match the selected board and framing system.' }
  ];
  const types = {
    tile: { title: 'Tiling · 瓷砖铺贴', steps: ['Check substrate, falls, tile batch and setting-out before laying.', 'Apply compatible adhesive or approved bedding method; maintain even joints and movement joints where required.', 'Cut edges neatly, fill joints after curing, clean the surface and inspect level, alignment and hollowness.'], stepsZh: ['检查基层、排水坡度、瓷砖批次及排版。', '按选定系统铺贴，控制缝宽和平整度；需要处留伸缩缝。', '固化后填缝清洁，检查平整、对缝、空鼓和排水。'], checks: ['Layout and joint width agreed before work.', 'Falls drain toward floor trap; edges and thresholds finished.', 'Keep spare tiles and record product / batch.'], checksZh: ['施工前确认排版及缝宽。', '水流向地漏，收边和门槛完整。', '留存备用砖并记录产品与批次。'], art: 'tile' },
    waterproof: { title: 'Waterproofing · 防水', steps: ['Prepare a sound, clean substrate and seal corners, pipe penetrations and floor-trap junctions.', 'Apply the specified waterproofing system in the manufacturer’s stated coats and coverage; reinforce junctions as required.', 'Allow curing, pond-test the area, repair leaks and retest before covering with screed or tiles.'], stepsZh: ['基层清洁牢固，处理阴阳角、管根和地漏接口。', '按指定产品说明施工规定遍数和用量，节点按系统加强。', '养护后做蓄水检查，有渗漏先修补复测，再覆盖保护层或瓷砖。'], checks: ['Product and coverage recorded.', 'Pond test result and duration recorded before concealment.', 'No water loss or leakage at adjacent areas.'], checksZh: ['记录产品与施工用量。', '覆盖前记录蓄水测试时长与结果。', '相邻区域无渗漏或异常水位下降。'], art: 'waterproof' },
    ceiling: { title: 'Ceiling · 天花', steps: ['Confirm ceiling level, service routes, access panels and light positions.', 'Install framing to the selected system and secure board joints to framing.', 'Tape and finish joints, sand, prime and paint; inspect level, joints and perimeter details.'], stepsZh: ['确认天花标高、管线、检修口和灯位。', '按选定系统安装龙骨，板缝落在龙骨上并可靠固定。', '接缝处理、打磨、底漆及面漆，检查平整度和边口收口。'], checks: ['Access to valves and services remains possible.', 'No visible sagging, open joints or uneven perimeter.', 'Board type matches wet-area requirements where applicable.'], checksZh: ['阀门及设备检修位置可开启。', '无明显下垂、裂缝或边口高低不平。', '潮湿区域板材按已选系统确认。'], art: 'ceiling' },
    cabinet: { title: 'Custom cabinetry · 定制柜', steps: ['Verify site dimensions, wall plumb, service locations and door swing.', 'Confirm carcass, board thickness, finish, edge banding, hardware and internal layout against the approved drawing.', 'Install level and plumb, anchor as appropriate, adjust doors and drawers, then protect and hand over.'], stepsZh: ['复核现场尺寸、墙体垂直度、管线及门扇开启。', '按确认图核对柜体、板厚、饰面、封边、五金和内部布局。', '找平找直后按条件固定，调试柜门抽屉并保护交付。'], checks: ['Approved drawing and finish sample signed off.', 'Doors and drawers operate without collision; gaps are consistent.', 'Exposed edges, wall junctions and anchoring are finished.'], checksZh: ['施工图及饰面样板已确认。', '柜门抽屉开合顺畅，无碰撞，缝隙均匀。', '外露封边、靠墙收口及固定完成。'], art: 'cabinet' },
    plumbing: { title: 'Plumbing · 水管改位', steps: ['Trace existing services and confirm new fixture positions and access.', 'Reroute compatible pipes with accessible joints and suitable support; protect concealed runs.', 'Pressure-test before closing walls or floors, flush lines and check every connection under operation.'], stepsZh: ['确认现有管线及新洁具位置，预留检修条件。', '使用适配管材改管，接头可检修处尽量可达，暗管做好保护。', '封墙地前试压，通水冲洗并逐个检查接口。'], checks: ['Test result recorded before concealment.', 'Hot and cold lines are correctly identified.', 'Drainage flows freely with no visible leakage.'], checksZh: ['隐蔽前留存试压结果。', '冷热水管辨识正确。', '排水通畅，接口无渗漏。'], art: 'plumbing' },
    demolition: { title: 'Demolition · 拆除', steps: ['Confirm the demolition boundary, building rules, service isolation and protection.', 'Remove finishes in a controlled sequence; avoid structural elements and retained services.', 'Sort and remove debris, then inspect exposed substrate and record hidden conditions.'], stepsZh: ['确认拆除边界、物业要求、断水电及成品保护。', '按顺序拆除饰面，避开结构构件和保留管线。', '分类清运后检查基层，记录拆开后发现的隐蔽情况。'], checks: ['Protected areas and retained items remain undamaged.', 'No structural cutting outside approved scope.', 'Hidden defects are documented before additional work.'], checksZh: ['保留物和保护区域无损坏。', '未超批准范围切割结构。', '新增隐蔽问题先记录并确认再施工。'], art: 'demolition' },
    generic: { title: 'Workmanship guide · 工艺说明', steps: ['Confirm dimensions, material, finish, boundaries and exclusions with the client before work.', 'Prepare the substrate and install to the approved drawing and product manufacturer’s instructions.', 'Inspect the finished work with the client and record any agreed touch-ups.'], stepsZh: ['施工前与客户确认尺寸、材料、饰面、范围及不包含内容。', '按确认图纸和产品说明处理基层并施工。', '完工后与客户共同检查，记录约定的修补事项。'], checks: ['Approved sample / drawing matches the installed work.', 'Edges, junctions and operating parts are complete.', 'Product documents and care instructions are handed over where available.'], checksZh: ['成品与确认样板、图纸一致。', '边口、接口及活动部件完成。', '适用时交付产品资料和维护说明。'], art: 'generic' }
  };
  // Original-page references from HOUZY's 138-page workmanship handbook.
  // Page numbers are the printed PDF page numbers, not inferred standards.
  const manual = [
    { id:'start', title:'开工准备与现场保护', en:'Site Preparation & Protection', desc:'施工前交底、现场保护与进场准备。', descEn:'Pre-start briefing, site protection and mobilization.', pages:[7,8,9,10], match:()=>true },
    { id:'demolition', title:'墙体拆改与砌筑', en:'Demolition & Masonry', desc:'拆改边界、砌筑及墙体相关工艺图示。', descEn:'Demolition boundaries, masonry and wall details.', pages:[12,13,14], match:(k,s)=>k.has('demolition')||/masonry|brick|wall_build|拆除|拆改|砌墙|砌筑|墙体/.test(s) },
    { id:'water-electric', title:'水电施工与设备安装', en:'Plumbing, Electrical & Fixture Installation', desc:'水电线路敷设、测试及洁具、灯具等安装节点。', descEn:'Service routing, testing and fixture installation details.', pages:Array.from({length:21},(_,i)=>i+16), match:(k,s)=>k.has('plumbing')||/electric|power|wiring|outlet|switch|lighting|水电|电路|电线|插座|开关|灯具|洁具|排水|给水|热水器/.test(s) },
    { id:'carpentry', title:'木作与柜体施工', en:'Carpentry & Cabinetry', desc:'木作材料、施工步骤、固定与检查。', descEn:'Woodwork materials, installation and inspection.', pages:Array.from({length:10},(_,i)=>i+39), match:(k,s)=>k.has('cabinet')||/woodwork|carpentry|joinery|木作|定制柜|柜体|柜门|衣柜|橱柜|木工/.test(s) },
    { id:'wet-area', title:'防水、瓦工与墙地面工艺', en:'Waterproofing, Tiling & Wall/Floor Finishes', desc:'防水节点、基层处理、铺贴及相关验收图示。', descEn:'Waterproofing details, substrate preparation, tiling and inspection.', pages:Array.from({length:26},(_,i)=>i+50), match:(k,s)=>k.has('tile')||k.has('waterproof')||/瓷砖|地砖|墙砖|铺贴|防水|泥作|找平/.test(s) },
    { id:'pipe-noise', title:'管道隔音', en:'Pipe Sound Insulation', desc:'管道包覆及隔音施工流程。', descEn:'Pipe wrapping and sound insulation process.', pages:Array.from({length:8},(_,i)=>i+77), match:(k,s)=>k.has('plumbing')||/管道|隔音|排水管/.test(s) },
    { id:'plaster-paint', title:'石膏板接缝与油漆', en:'Plasterboard Joints & Painting', desc:'板缝处理、基层及涂装步骤与示意。', descEn:'Joint treatment, surface preparation and painting.', pages:Array.from({length:11},(_,i)=>i+85), match:(k,s)=>k.has('ceiling')||/油漆|乳胶漆|涂料|批灰|石膏板|吊顶|天花/.test(s) },
    { id:'materials', title:'精工辅材与材料展示', en:'Workmanship Materials & Products', desc:'手册内材料表及品牌产品介绍；具体品牌、型号与颜色以本项目确认单为准。', descEn:'Reference materials and brands from the handbook; project selections are confirmed separately.', pages:[96,97,98,99,100,102,103,104,105,107,108,109,110,112,113,114,115,116,117,118,119,120], match:()=>true },
    { id:'six-system', title:'六恒舒适系统', en:'Six-Constant Comfort System', desc:'毛细管网施工流程及系统节点。', descEn:'Capillary network installation and system details.', pages:Array.from({length:8},(_,i)=>i+121), match:(k,s)=>/六恒|毛细管|新风|恒温|恒湿/.test(s) },
    { id:'whole-house-sop', title:'全案施工落地标准流程', en:'Whole-Home Construction Workflow', desc:'手册中的项目阶段、施工方与业主/材料采购方流程。', descEn:'Project stages and workflows for the contractor, client and material procurement.', pages:Array.from({length:7},(_,i)=>i+130), match:()=>true }
  ];
  const pick = (key, label = '') => {
    const s = `${key} ${label}`.toLowerCase();
    if (/waterproof|防水|bath_tile|wet_tile|wp/.test(s)) return 'waterproof';
    if (/tile|瓷砖|地砖|墙砖|mosaic|踏步|porch_tile/.test(s)) return 'tile';
    if (/ceiling|天花|plaster_ceiling|ceil_/.test(s)) return 'ceiling';
    if (/cab|柜|wardrobe|vanity|bookcase|counter|headboard|shelf/.test(s)) return 'cabinet';
    if (/pipe|water|plumb|水管|给排水|heater|sink/.test(s)) return 'plumbing';
    if (/demo|hack|dismant|拆|清拆/.test(s)) return 'demolition';
    return 'generic';
  };
  function drawing(type, en) {
    const captions = { tile: ['Substrate', 'Adhesive bed', 'Tile + joint'], waterproof: ['Substrate', 'Waterproof layer', 'Pond test'], ceiling: ['Slab', 'Frame', 'Board finish'], cabinet: ['Wall', 'Anchored carcass', 'Door + hardware'], plumbing: ['Supply', 'Tested joints', 'Fixture'], demolition: ['Protect', 'Controlled removal', 'Clear + inspect'], generic: ['Prepare', 'Install', 'Inspect'] }[type];
    const words = en ? captions : ({ tile:['基层','粘结层','瓷砖 + 填缝'], waterproof:['基层','防水层','蓄水检查'], ceiling:['楼板','龙骨','板面'], cabinet:['墙体','柜体固定','柜门 + 五金'], plumbing:['管线','试压接口','洁具'], demolition:['成品保护','分区拆除','清运检查'], generic:['基层准备','按图施工','检查交付'] }[type]);
    const colors = ['#e5dac4','#c8a96e','#245640'];
    return `<svg viewBox="0 0 720 190" role="img" aria-label="${en ? 'Work sequence diagram' : '施工步骤示意图'}"><path d="M70 105H650" stroke="#d7c9ad" stroke-width="3"/>${words.map((w,i)=>`<g transform="translate(${130+i*230},0)"><circle cx="0" cy="82" r="42" fill="${colors[i]}"/><text x="0" y="87" text-anchor="middle" fill="${i===2?'white':'#153927'}" font-size="16" font-weight="700">${i+1}</text><text x="0" y="155" text-anchor="middle" fill="#153927" font-size="16">${w}</text></g>`).join('')}</svg>`;
  }
  function get(key, label) { const kind=pick(key,label); return { kind, ...types[kind], source: kind==='tile'?source[1]:kind==='waterproof'?source[2]:kind==='ceiling'?source[3]:source[0] }; }
  function manualSections(lines) {
    const kinds = new Set(), labels = [];
    (lines || []).forEach(line => {
      const key = line.pack || line.code || '', label = line.name || line.from || '';
      kinds.add(pick(key, label)); labels.push(`${key} ${label}`);
    });
    const search = labels.join(' ');
    return manual.filter(section => section.match(kinds, search));
  }
  root.HOUZY_WORKMANSHIP = { get, drawing, source, manualSections };
})(window);
