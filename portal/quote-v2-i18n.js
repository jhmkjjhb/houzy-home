/* UI copy only. Quote data, prices, filenames and customer input stay untouched. */
(function (root) {
  const pairs = [
    ['报价器 · QUOTE STUDIO','QUOTE STUDIO · 报价器'],
    ['参考做法','Illustrative method'],['项目标准待确认','Project specification to be confirmed'],['施工步骤','Work sequence'],['验收要点','What to inspect'],['参考资料','Reference'],['本说明用于理解项目范围；具体施工标准以本项目双方书面确认内容为准。','This guide explains the scope. The project standard must be confirmed in writing by both parties.'],['项目具体标准以双方书面确认内容为准。','Project specifications are subject to written agreement by both parties.'],['参考做法 · 项目标准待确认','Illustrative method · project specification to be confirmed'],
    ['价格已保存并用于当前报价；这一项已从“只看没核定的”列表移除。','Price saved and applied to this quote. This item has moved out of the unconfirmed list.'],['逐项点「确认此价格」会立即保存并用于报价；批量修改可点上方「保存」。','Confirm a row to save its price and apply it to the quote immediately. Use Save above for batch changes.'],
    ['请填写长和宽','Enter length and width'],['尺寸还是默认值','Dimensions are still default values'],['预估先按默认尺寸算','The estimate uses default dimensions'],['请现场量好后点「尺寸已确认」','Measure on site, then confirm dimensions'],['请先加窗户尺寸','Add window dimensions first'],['单价待公司核定','Unit price needs company confirmation'],['请填写价格','Enter the price'],['暂未计入总价','Not yet included in the total'],['还没定选材','materials are not selected'],['正式报价前要定好','Confirm before issuing a final quote'],['暂按标准档估价','Using a standard-grade estimate'],['价差待公司核定','Price difference needs company confirmation'],['有','There are'],['项用的是参考价（公司还没核定）','items use unconfirmed reference prices'],
    ['选最接近的，再加减卧室、卫生间、楼层；尺寸是常见估算，现场要复尺','Choose the closest layout, then adjust bedrooms, bathrooms and levels. Dimensions are estimates and need a site measurement.'],['图片或 PDF；PDF 多页会按顺序放到各楼层。照着图加房间、填尺寸。','Upload an image or PDF. Multi-page PDFs are assigned to levels in order. Use the plan to add spaces and dimensions.'],['每隔约 2 分钟自动存一份，最多 15 份，只存在这台电脑这个浏览器里。点「恢复」会先把当前内容也备份一份。','A backup is saved about every two minutes, up to 15 versions, in this browser. Restoring first saves the current version.'],
    ['③ 全屋项目','③ Whole-home work'],['结构与申请','Structure & permits'],['智能家居系统','Smart-home system'],['门窗与安防','Doors, windows & security'],['外部、屋顶与加建','Exterior, roof & extension'],['完工与环保','Completion & environment'],['人工增加项（全屋）','Custom work (whole home)'],['收费','Fees'],['这单免收','Waive on this quote'],['恢复收取','Restore charge'],['恢复自动','Restore automatic'],['选了施工项目后自动出现','Automatically appears once work is selected'],['全屋项目填好了，下一步：选怎么做、用什么材料 →','Whole-home work complete. Next: methods & materials →'],['设计费单价','Design fee rate'],['优惠金额','Discount amount'],
    ['先在「② 房间」定好每个空间做什么，这里按空间类型统一选材料和选品：点一个选项，这一类空间都用它；某一间要不同，点「某间要不同」单独改。选项下面是换成它以后总价的变化，没想好的先按标准档估价。','First set the scope for each space under “② Spaces”. Here you can choose materials for a whole space type, then override individual spaces as needed. Each option shows its effect on the total; undecided choices use a standard-grade estimate.'],['先在「② 房间」选要做的项目。','Select work items under “② Spaces” first.'],
    ['不属于某个房间的工程。开工放线、成品保护、公寓物业申请、垃圾清运、开荒清洁、水管打压、楼上搬运会按房间自动加上，不用在这里选。','Work that applies to the whole home. Site setup, protection, permits, waste removal, cleaning, pressure testing and carrying are added automatically by space.'],['价目表没有、或者不确定的项目（例如屋顶翻新、外墙防水、特殊加建），自己填名称、单位、数量和单价。房间里的项目请到该房间里加。','For work outside the price book, enter its name, unit, quantity and price. Add work for one space in that space.'],['下面这些按房间和工程量自动加上，不用另外选；某一单不收的，点「这单免收」。','These fees are calculated from spaces and scope. Use “Waive on this quote” when a fee does not apply.'],['不含在报价里、要提前告诉客户的：物业装修押金（客户直接交物业，完工退还）、施工期间水电费、白蚁防治 / 大垃圾箱 / 工程保险（需要的话在上面「结构与申请」里选）。','Tell the client about excluded costs: property renovation deposit, utilities during construction and optional termite treatment, skip rental or insurance.'],
    ['公司价目表','Company price book'],['直接在这里改价','Edit prices here'],['改了价格后点这里保存','Save price changes'],['下载价格模板','Download price template'],['从系统读取瓷砖片价','Load tile prices from system'],['上传填好的价格','Upload completed price file'],['删掉已上传的价格','Remove uploaded prices'],['怎么填','How to fill prices'],
    ['每平方尺','Per sq ft'],['每平方米（自动换算）','Per m² (auto convert)'],['硬装（施工）','Build (works)'],['材料（主材 / 定制 / 产品）','Materials (finishes / custom / products)'],['瓷砖统一规格价','Tile prices by size & finish'],['只看没核定的（含参考价）','Unconfirmed only (including reference prices)'],['已确认价格','Confirmed prices'],['全部项目','All items'],['有规格的项目','Items with options'],['项目 / 规格','Item / option'],['辅料','Consumables'],['人工','Labour'],['损耗%','Waste %'],['合计单价','Total unit price'],['确认此价格','Confirm this price'],['规格','Specification'],['单位','Unit'],['工序','Work stage'],['说明','Notes'],['方案','Plan'],['客户','Client'],['预估报价','Estimate'],['正式报价','Final quote'],['单价(RM)','Unit price (RM)'],['金额(RM)','Amount (RM)'],
    ['所有报价单的单价和选材价差都从这里来。当前其他项目优先采用 2026-11-16 新山市场调查表的建议价；原表注明多数为估算，签约前仍需核定。瓷砖砖材按规格和表面全屋共用一套 RM/片价格，铺贴另计。改价格的方法：下载模板 → 用 Excel 填好 → 上传。','All unit prices and material adjustments come from this price book. Most current prices are market estimates and need confirmation before signing. Tile material prices are shared by size and finish; installation is priced separately. Download the template, edit it in Excel, then upload it.'],
    ['个项目还没有单价','items have no unit price'],['个选材价差还没填','material adjustments are missing'],['个用的是参考价，等公司核定','items use reference prices pending company approval'],['还没上传过，现在用的是系统自带的参考价。','No price file uploaded. System reference prices are in use.'],
    ['「项目单价」：材料、辅料、人工都是卖给客户的价格（每个单位），损耗% 只加在材料上。','Item unit prices: material, consumables and labour are customer prices per unit. Waste applies to materials only.'],['「选材价差」：客户选了这个选项，每个单位比标准档多收多少，便宜的填负数。','Material adjustment: enter the difference from standard grade per unit; use a negative number for cheaper options.'],['空着 = 还没定，报价单会提示「单价待核定 / 价差待定」；填 0 = 不加价。','Blank means pending confirmation; 0 means no extra charge.'],['不要改「类型」和「编号」两列。只填售价，不要填成本。','Keep the type and ID columns unchanged. Enter selling prices, not costs.'],['价格只存在这台电脑的浏览器里，其他员工的电脑要各自上传一次。','Prices are stored in this browser. Each staff computer needs its own upload.'],
    ['还没选房屋类型','Choose a property type first'], ['房屋类型','Property type'], ['按这个户型排房间','Generate spaces from this layout'], ['按这个户型重新排房间','Regenerate spaces from this layout'], ['复制成新方案','Duplicate as a new plan'], ['新建报价（清空当前）','New quotation (clear current)'],
    ['Studio 开放式','Open studio'], ['复式 Duplex','Duplex'], ['一起选','Select together'], ['和其他公共区一起选','Select with other living areas'], ['和其他卧室一起选','Select with other bedrooms'], ['和其他卫浴一起选','Select with other bathrooms'], ['合并…','Merge…'], ['手绘图/照片','Sketch / photo'], ['可拖进来','Drag here'], ['下一间','Next space'], ['已选','Selected'],
    ['演示给客户','Present to client'], ['报价总额','Quote total'], ['客户姓名','Client name'],
    ['① 选房屋类型','① Property type'], ['① 户型','① Property'], ['② 房间','② Spaces'], ['③ 全屋','③ Whole home'], ['④ 选材','④ Materials'], ['⑤ 报价单','⑤ Quotation'], ['价目表','Price book'],
    ['选好后自动排出常见房间，按实际情况增删。点任何一个房间就进入该房间。','Choose a property type to generate typical spaces. Add or remove spaces to match the site, then select a space to edit.'],
    ['选好后自动排出常见房间','Choose a property type to generate typical spaces'],
    ['点卡片选择；已选的卡片点名字会跳到要填的数字，点左边的 ✓ 才是取消。数量按尺寸自动算，卡片里只有少数需要确认的数字。','Select a work item. Select its name to edit quantities; use the checkmark to remove it. Quantities are calculated from dimensions.'],
    ['价目表没有的、现场还要再看的，先人工增加一项，写清名称和暂定单价。','Add a custom item with a description and provisional unit price for work that still needs a site check.'],
    ['点击 PDF 按钮会直接下载文件。客户方案版每个空间一个包价，项目不拆单价，也不显示尺寸和材料品牌。品牌表格可在 Excel 编辑；专属文件可导回本报价器继续修改。','PDF files download directly. The client proposal shows one package price per space without dimensions, brands or unit prices. Edit the spreadsheet in Excel; import the project file here to continue editing.'],
    ['标「暂定」的项目材料还没定，暂按标准档估价，定好后金额可能变化。','Provisional materials use standard grade estimates; the amount may change after selection.'],
    ['全部检查通过，可以出','All checks passed. Ready to issue a '],
    ['正式报价（全部定好）','Final quote (all confirmed)'], ['预估报价（可有暂定项）','Estimate (provisional items allowed)'],
    ['导出详细 PDF','Download detailed PDF'], ['导出客户方案 PDF','Download client proposal PDF'], ['导出品牌表格 XLSX','Download branded XLSX'], ['导出专属文件','Export editable project'], ['导入专属文件','Import editable project'], ['导出 / 导入','Export / Import'],
    ['PDF：还有','PDF: '], ['项待处理',' items to resolve'], ['（按空间包价）','(package price by space)'], ['（预估）','(estimate)'],
    ['逐项处理','Resolve one by one'], ['上一项','Previous'], ['下一项','Next'], ['确认这一项','Confirm item'], ['确认尺寸','Confirm dimensions'], ['保存窗户尺寸','Save window size'], ['选择材料或做法','Select material or method'],
    ['必须处理','Action required'], ['请确认','Please confirm'], ['去改','Edit'], ['检查','Checks'], ['有不确定的项目？','Unsure about an item?'], ['待核定单价','Unit prices to confirm'],
    ['费用构成','Cost breakdown'], ['正式报价单','Final quotation'], ['预估报价单','Estimate quotation'], ['报价单排法','Group quote by'], ['按施工工序','Work sequence'], ['按房间','Space'], ['按硬装 / 材料 / 软装','Build / Materials / Furnishing'],
    ['客户：','Client: '], ['施工面积','Floor area'], ['项目','Item'], ['空间','Space'], ['数量','Quantity'], ['单价','Unit price'], ['金额','Amount'], ['综合单价','All-in unit price'],
    ['工程直接费','Direct works'], ['硬装','Build'], ['材料','Materials'], ['软装','Furnishing'], ['设计费','Design fee'], ['管理费','Management fee'], ['不可预见费','Contingency'], ['优惠','Discount'], ['合计','Total'], ['付款节点','Payment schedule'], ['全屋','Whole home'],
    ['平面示意','Floor plan'], ['方块大小按面积','Tile size follows area'], ['蓝色 = 已选工程','Green = selected work'], ['红框 = 有待处理','Red = needs attention'], ['平面图','Floor plan'], ['上传','Upload'], ['删除','Delete'], ['关闭','Close'], ['换一张','Replace'], ['看平面图','View plan'], ['看这间在平面图上的位置','Locate this space on plan'], ['收起平面图','Hide floor plan'],
    ['还没有房间','No spaces yet'], ['加一层','Add a level'], ['之前的版本（自动备份）','Previous versions (auto backup)'], ['恢复这个版本','Restore this version'], ['恢复','Restore'],
    ['这间要做什么','Work in this space'], ['这组要做什么','Work in this group'], ['已选','Selected'], ['还可以加的项目','More work items'], ['还没选，从下面点要做的项目。','No items selected. Choose from the list below.'], ['不确定 / 价目表没有的项目','Custom or unpriced work'], ['人工增加项','Add custom item'], ['小计','Subtotal'],
    ['长','Length'], ['宽','Width'], ['高','Height'], ['层高','Ceiling height'], ['尺','ft'], ['平方尺','sq ft'], ['尺寸已现场确认','Site dimensions confirmed'], ['尺寸已确认','Dimensions confirmed'], ['现在是默认尺寸，改过数字也会自动确认','These are default dimensions. Editing a value also confirms it.'],
    ['这间已完成','Space complete'], ['重新编辑','Edit again'], ['这间完成','Complete space'], ['这间不做，完成','Skip and complete'], ['下一间','Next space'], ['下一步：全屋项目','Next: whole-home work'], ['删除房间','Delete space'], ['合并','Merge'], ['取消','Cancel'], ['复制这间做法到','Copy this selection to'], ['未选工程','No work selected'], ['不做','Skip'], ['已完成','Completed'], ['点开查看','Open to view'], ['收起','Collapse'],
    ['共管公寓','Condominium'], ['普通公寓','Apartment'], ['排屋','Terrace house'], ['半独立式','Semi-detached'], ['独立式','Bungalow'], ['联排分层','Townhouse'], ['有地','Landed'],
    ['主人房','Primary bedroom'], ['主卧卫生间','Primary bathroom'], ['公共卫生间','Shared bathroom'], ['客房','Guest bedroom'], ['卧室','Bedroom'], ['卫生间','Bathroom'], ['客厅','Living room'], ['餐厅','Dining room'], ['厨房','Kitchen'], ['干厨房','Dry kitchen'], ['湿厨房','Wet kitchen'], ['开放式厨房','Open kitchen'], ['开放起居/睡眠区','Open living/sleeping area'], ['书房','Study'], ['洗衣区','Laundry'], ['阳台','Balcony'], ['家庭厅','Family room'], ['储物间','Store'], ['走廊/玄关','Hall / foyer'], ['楼梯','Stairs'], ['后院/花园','Backyard / garden'], ['后院','Backyard'], ['加建空间','Extension'], ['后院加建','Rear extension'], ['车廊/前院','Car porch / front yard'], ['车廊','Car porch'], ['加建','Extension'], ['底层','Ground floor'], ['户内','Interior'], ['户外','Outdoor'],
    ['拆除','Demolition'], ['砌墙','Wall construction'], ['泥水','Masonry'], ['水电','Electrical and plumbing'], ['木工','Carpentry'], ['油漆','Painting'], ['天花','Ceiling'], ['门窗','Doors and windows'], ['瓷砖','Tiles'], ['地砖','Floor tiles'], ['墙砖','Wall tiles'], ['防水','Waterproofing'], ['灯具','Lighting'], ['柜体','Cabinetry'], ['窗帘','Curtains'], ['洁具','Sanitaryware'], ['标准档','Standard grade'], ['暂定','Provisional'], ['待定','Pending'], ['确认','Confirm'], ['已确认','Confirmed'],
    ['平方尺','sq ft'],
  ];
  const catalog = [
    ['开工放线定位','Site setting-out'],['成品及公共区域保护（地面/电梯/走廊）','Protection of finishes and shared areas'],['物业装修申请代办','Property renovation permit administration'],['水管打压测试','Water-pipe pressure test'],['材料搬运上楼（2楼及以上）','Carrying materials to upper levels'],['建筑垃圾清运','Construction-waste removal'],['开荒清洁','Post-construction cleaning'],
    ['拆改与现场保护','Demolition & site protection'],['水电隐蔽','Concealed electrical & plumbing'],['泥水瓷砖 / 地面','Masonry, tiles & flooring'],['天花墙面','Ceilings & walls'],['定制柜与门窗','Cabinetry, doors & windows'],['设备安装与收尾','Fixtures & completion'],['户外与外围工程','External works'],
    ['轻钢龙骨石膏板隔墙','Light-gauge plasterboard partition'],['智能网关 + 全屋场景调试','Smart-home gateway & scene setup'],['智能门锁（指纹/密码/App）','Smart door lock'],['配电箱移位','Relocate distribution board'],['弱电箱（网络/电视/监控集中箱）','Low-voltage network cabinet'],['热水管保温','Hot-water pipe insulation'],['除甲醛 / 空气治理','Indoor air treatment'],['拆墙/开门洞','Wall demolition / door opening'],['动承重墙','Structural wall alteration'],['改建申请（市政局准证）','Municipal alteration permit'],['换配电箱','Replace distribution board'],['单相改三相电','Single to three-phase supply'],['网络/电视线','Network / TV wiring'],['燃气管道','Gas piping'],['换进户主水管','Replace incoming water main'],['全屋净水器','Whole-home water filter'],['排污管/化粪池接驳','Sewer / septic connection'],['水泵/水箱','Water pump / tank'],['监控 CCTV','CCTV'],['可视门铃','Video doorbell'],['换大门','Replace entrance door'],['防盗铁花','Security grilles'],['自动大门','Automatic gate'],['加建/扩建（地基+砌墙+屋顶）','Extension (foundation, walls & roof)'],['屋顶补漏','Roof leak repair'],['户外地坪','Outdoor paving'],['户外贴瓷砖','Outdoor tiling'],['户外花坛与造型','Outdoor planters & features'],['外墙油漆','Exterior painting'],['换雨水管','Replace rainwater pipes'],['围墙/栏杆','Boundary wall / railing'],['白蚁防治','Termite treatment'],['大垃圾箱租用（RORO bin）','RORO skip rental'],['工程保险（CAR）','Construction all-risk insurance'],['户外排水沟','Outdoor drainage channel'],
    ['拆旧','Demolition'],['地面','Floors'],['墙面','Walls'],['天花','Ceilings'],['水电','Electrical & plumbing'],['防水与瓷砖','Waterproofing & tiles'],['洁具设备','Bathroom fixtures'],['定制柜','Custom cabinetry'],['门窗窗帘','Doors, windows & curtains'],['户外','Outdoor'],['软装家具','Furniture & styling'],
    ['卫浴','Bathrooms'],['洗衣房','Laundry'],['公共区','Living areas'],['室外','Outdoor'],
    ['墙体改造（拆墙 / 砌墙 / 门洞）','Wall alteration (demolition, masonry & openings)'],['拆旧柜 / 旧家具','Remove old cabinets & furniture'],['拆旧地砖','Remove old floor tiles'],['铲旧墙皮','Remove existing wall finish'],['拆旧墙砖','Remove old wall tiles'],['拆旧天花','Remove existing ceiling'],['拆旧（地砖+墙砖+洁具）','Bathroom demolition (tiles & fixtures)'],
    ['地面翻新','Floor renovation'],['墙面防潮/防霉处理','Wall damp & mould treatment'],['墙面翻新','Wall renovation'],['天花吊顶','Suspended ceiling'],['天花重刷（不吊顶）','Ceiling repaint (no suspended ceiling)'],['石膏线','Cornice'],['防潮天花','Moisture-resistant ceiling'],
    ['插座开关+灯位','Sockets, switches & light points'],['智能家居（本间）','Smart home (this space)'],['空调预埋','Air-conditioning provision'],['吊扇','Ceiling fan'],['水路改造','Plumbing alteration'],['洗衣机水位','Washing-machine water point'],['下水管包封','Waste-pipe boxing'],['热水器','Water heater'],
    ['地砖+操作区墙砖+防水','Kitchen floor tile, splashback & waterproofing'],['防水+地砖+墙砖','Waterproofing, floor & wall tiles'],['防水+地砖','Waterproofing & floor tiles'],['改马桶/排水位置','Relocate toilet or drain'],['浴缸','Bathtub'],['拖把池','Utility sink'],['洁具（马桶+花洒+排风）','Bathroom fixtures (toilet, shower & exhaust)'],['淋浴区（淋浴盘/挡水 + 玻璃隔断）','Shower area (tray or curb & glass screen)'],['浴室柜+镜子','Vanity & mirror'],['晾衣架','Drying rack'],
    ['橱柜（地柜+吊柜+台面）','Kitchen cabinets & countertop'],['橱柜功能五金','Cabinet fittings'],['衣柜','Wardrobe'],['电视柜/背景墙','TV cabinet & feature wall'],['神龛/神台柜','Altar cabinet'],['鞋柜','Shoe cabinet'],['餐边柜','Sideboard'],['床头背景','Headboard feature'],['岩板背景墙','Sintered-stone feature wall'],['护墙板','Wall panelling'],['书柜/储物柜','Bookcase / storage'],['洗衣柜','Laundry cabinet'],['书桌','Desk'],['其他定制小件（按项）','Other custom pieces (per item)'],
    ['换门','Replace door'],['推拉门/移门','Sliding door'],['玻璃隔断','Glass partition'],['酒柜','Wine cabinet'],['窗套','Window casing'],['飘窗台面','Bay-window ledge'],['地台 / 榻榻米','Raised platform / tatami'],['吧台','Bar counter'],['软包 / 硬包背景','Upholstered / hard-panel feature'],['镜面墙','Mirror wall'],['文化石墙','Stone-clad wall'],['玻璃砖墙','Glass-block wall'],['马赛克','Mosaic'],['墙面挂网防裂','Wall crack-control mesh'],['波打线 / 地面拼花','Floor border / inlay'],['地面垫高回填','Floor raising & infill'],['旧木地板打磨翻新','Timber-floor sanding & refinishing'],['户外防腐木地板','Outdoor decking'],['音响线预埋','Audio wiring provision'],['墙体开孔','Wall core drilling'],['厨下净水器','Under-sink water filter'],
    ['换窗','Replace window'],['窗帘','Curtains'],['纱窗','Insect screens'],['窗台石','Window sill'],['封阳台','Enclose balcony'],['楼梯踏步','Stair treads'],['楼梯扶手/栏杆','Stair handrail & balustrade'],['踏步灯','Step lights'],['楼梯灯（上下双控）','Stair lighting (two-way switching)'],['挑空/高处脚手架','Scaffolding for high spaces'],
    ['防滑地砖','Anti-slip floor tiles'],['排水沟','Drainage channel'],['阳光棚（只做顶）','Sun canopy (roof only)'],['阳光房（顶 + 四周玻璃）','Sunroom (roof & glazed sides)'],['车棚','Carport'],['客厅软装','Living-room furniture & styling'],['餐厅软装','Dining-room furniture & styling'],['卧室软装','Bedroom furniture & styling'],['书房软装','Study furniture & styling'],['户外软装','Outdoor furniture & styling'],['雨棚','Awning'],['户外灯','Outdoor lights'],
    ['项目方案报价','Project proposal'],['预估项目方案','Preliminary project proposal'],['详细工程报价','Detailed quotation'],['全屋工程','Whole-home works'],['整体方案','Overall proposal'],['现场增项','Site variation'],['工程项目','Works item'],['综合服务','Professional services'],['设计、项目管理、税费及优惠调整','Design, project management, tax & adjustments'],['空间与包含项目','Spaces & included works'],['空间包价','Space package price'],['做法与尺寸','Method & dimensions'],['报价合计','Quotation total'],['报价日期','Quotation date'],['报价模式','Quote mode'],['未填写','Not provided'],['HOUZY HOME · 为每一个家精心规划','HOUZY HOME · Designed for living'],['本版仅展示项目内容与总价；具体规格以双方确认文件为准。','This version shows scope and total prices only. Final specifications are subject to written confirmation.'],['具体施工范围与材料以最终确认方案为准。','Scope and materials are subject to the final agreed proposal.'],['此版为预估方案：部分尺寸、材料或价格尚待确认，最终施工范围及金额以双方确认的正式文件为准。','This is a preliminary proposal. Some dimensions, materials and prices still need confirmation.'],['各空间包价含设计、管理、税费与优惠的分摊；具体规格以双方确认的技术附件为准。','Space package prices include allocated design, management, tax and discounts. Specifications follow the agreed technical schedule.']
  ];
  // Quote data labels are separate from interface copy. Keep every price-book
  // name and note translatable so English PDF/XLSX exports do not inherit the
  // Chinese source labels.
  const exportTerms = [
    ['项','item'],['件','piece'],['个','pc'],['处','location'],['车次','trip'],['个点位','point'],['回路','circuit'],['台','unit'],['次','visit'],['延尺','linear ft'],['条','length'],['级','step'],['樘','set'],['套','set'],['张','set'],['盏','light'],['幅','piece'],['把','set'],['盆','pot'],
    ['拆除旧柜/旧洁具/旧门窗','Remove old cabinets, sanitaryware & doors/windows'],['拆除旧天花','Remove existing ceiling'],['铲除旧墙面批灰/油漆','Remove existing wall skim coat and paint'],['砸墙/拆隔断墙','Wall / partition demolition'],['承重墙开洞加固','Structural wall opening and reinforcement'],['结构工程师审图签字','Structural engineer drawing review and certification'],['卫生间降板/二次排水处理','Lowered bathroom slab and secondary drainage'],['电路开槽穿管布线','Electrical chasing, conduits and wiring'],['网络/电视线预埋','Concealed network / TV cabling'],['给排水管改造','Water supply and drainage alteration'],['空调铜管+排水管预埋','Concealed air-conditioning copper and drain pipes'],['燃气管道改造','Gas piping alteration'],['地面水泥砂浆找平','Cement-mortar floor levelling'],['地砖铺贴','Floor tile installation'],['墙砖铺贴','Wall tile installation'],['SPC 石塑地板铺装','SPC vinyl flooring installation'],['踢脚线','Skirting'],['瓷砖美缝','Tile grouting'],['门槛石/挡水条','Threshold stone / shower curb'],['防臭地漏','Anti-odour floor trap'],['门廊/车库户外防滑砖','Outdoor anti-slip tiles (porch / garage)'],['石膏板吊顶','Plasterboard ceiling'],['天花叠级/灯槽','Stepped ceiling / cove lighting'],['墙面批灰找平','Wall skim coat and levelling'],['天花乳胶漆','Ceiling emulsion paint'],['外墙防水漆','Exterior waterproof coating'],['橱柜 · 地柜','Kitchen base cabinets'],['橱柜 · 吊柜','Kitchen wall cabinets'],['石英石台面','Quartz countertop'],['衣柜定制','Custom wardrobe'],['电视柜/电视背景墙','TV console / feature wall'],['阳台封窗','Balcony window enclosure'],['开关插座面板安装','Switch and socket faceplate installation'],['基础灯具供应+安装','Supply and installation of standard light fittings'],['排气扇','Exhaust fan'],['浴室镜/镜柜','Bathroom mirror / mirror cabinet'],['马桶','Toilet'],['花洒/淋浴龙头','Shower set / mixer'],['淋浴玻璃隔断','Shower glass screen'],['热水器安装','Water heater installation'],['厨房水槽+龙头','Kitchen sink and tap'],['楼梯灯+上下双控开关','Stair lights with two-way switches'],['吊扇线路+加固吊点','Ceiling-fan wiring and reinforced mounting'],['可视门铃/对讲','Video doorbell / intercom'],['户外灯/庭院灯点位','Outdoor / garden light point'],['大板砖/岩板铺贴加价','Large-format / sintered-stone tile surcharge'],['床头背景墙','Headboard feature wall'],['铝合金窗更换','Aluminium window replacement'],['户外地面贴防滑瓷砖','Outdoor anti-slip floor tiles'],['定制书桌／工作台','Custom desk / workbench'],['吊柜升降拉篮','Wall-cabinet lift-up basket'],['吊柜碗碟沥水架','Wall-cabinet dish rack'],['水槽柜垃圾桶拉出','Pull-out bin in sink cabinet'],['抽屉刀叉餐具分隔盘','Drawer cutlery organiser'],['米箱','Rice dispenser'],['衣柜抽拉裤架','Pull-out trouser rack'],['衣柜抽拉衣物拉篮','Pull-out wardrobe basket'],['衣柜下拉升降衣架','Pull-down wardrobe rail'],['衣柜内旋转/推拉镜','Rotating / pull-out wardrobe mirror'],['衣柜首饰/领带格抽屉','Wardrobe jewellery / tie drawer insert'],['衣柜抽拉鞋架','Pull-out shoe rack'],['神龛/神台柜定制','Custom altar cabinet'],['成品淋浴盘','Ready-made shower tray'],['浴帘杆 + 浴帘','Shower-curtain rod and curtain'],['淋浴区墙内壁龛','Recessed shower niche'],['腰线/花砖','Tile border / decorative tiles'],['休息平台实木地板','Solid-timber landing flooring'],['休息平台石材','Stone landing'],['楼梯踏步打磨油漆','Stair-tread sanding and painting'],['休息平台打磨油漆','Landing sanding and painting'],['钢化玻璃栏板 + 木扶手','Tempered-glass balustrade and timber handrail'],['铁艺栏杆','Wrought-iron railing'],['实木栏杆 + 扶手','Solid-timber balustrade and handrail'],['铝合金栏杆','Aluminium railing'],['嵌墙踏步灯','Recessed wall step light'],['人体感应踏步灯','Motion-sensor step light'],['阳光房玻璃围合','Sunroom glass enclosure'],['木纹格栅天花','Wood-grain slatted ceiling'],['铝扣板天花','Aluminium-panel ceiling'],['弧形造型天花','Curved feature ceiling'],['沙发','Sofa'],['茶几','Coffee table'],['边几','Side table'],['地毯','Rug'],['装饰吊灯','Decorative pendant light'],['挂画','Wall art'],['餐桌椅','Dining table and chairs'],['床架 + 床垫','Bed frame and mattress'],['床头柜','Bedside table'],['梳妆台','Dressing table'],['床品','Bedding'],['落地灯/台灯','Floor / table lamp'],['书桌椅','Desk and chair'],['成品书架','Ready-made bookshelf'],['户外桌椅','Outdoor table and chairs'],['遮阳伞','Parasol'],['绿植','Plants'],['强化复合木地板铺装','Laminate flooring installation'],['实木地板铺装','Solid-timber flooring installation'],['智能红外遥控器','Smart infrared controller'],['定制小件','Custom item'],
    ['无电梯人工搬运材料上楼及垃圾下楼','Manual carrying of materials up and construction waste down where no lift is available'],['底漆一遍+天花专用白漆两遍','One primer coat plus two coats of ceiling white paint'],['按设计风格搭配基础软装配饰','Basic furniture and accessories matched to the design style'],['按客户确认的材质、尺寸、承重及走线要求制作','Made to the client-approved material, dimensions, load and cable-routing requirements'],['高柜多层联动拉篮','Multi-tier pull-out pantry basket'],['水槽下拉出式分类垃圾桶','Pull-out waste-sorting bins under sink'],['按抽屉宽度配置','Configured to drawer width'],['阻尼滑轨抽拉裤架','Soft-close pull-out trouser rack'],['阻尼滑轨拉篮','Soft-close pull-out basket'],['高位下拉式挂衣架','Pull-down wardrobe lift'],['柜内隐藏式穿衣镜','Concealed wardrobe mirror'],['绒布分格抽屉','Velvet-lined compartment drawer'],['柜内抽拉鞋架','Pull-out shoe rack inside cabinet'],['不做玻璃隔断时使用','Used when no glass shower screen is installed'],['与踏板同木种','Same timber as the stair treads'],['与踏步同石材','Same stone as the stair treads'],['原踏步打磨、补缝、上漆','Sand existing treads, fill gaps and repaint'],['与踏步同油漆','Same paint finish as the stair treads'],['感应自动亮灭','Automatic motion-sensor switching'],['含运送、更换及运往合法垃圾场','Includes delivery, replacement and disposal at a licensed waste facility'],['工程期间第三者责任及工程一切险','Third-party liability and construction all-risk insurance during the project'],['拆装配电箱、延长主线、重新接回路并测试','Disconnect and refit distribution board, extend the main cable, reconnect circuits and test'],
    ['墙面乳胶漆（一底两面）','Wall emulsion paint (one primer coat + two finish coats)'],['墙面批灰找平','Wall skim coat and levelling'],['石膏板吊顶','Plasterboard ceiling'],['天花乳胶漆','Ceiling emulsion paint'],['电路开槽穿管布线','Electrical chasing, conduit and wiring'],['空调铜管+排水管预埋','Concealed air-conditioning copper and drain pipes'],['专用回路（空调/热水器等大功率电器）','Dedicated circuit (air conditioner, water heater and other high-load appliances)'],['新增满批','Full skim coat'],['尺寸：','Dimensions: '],['宽 ','Width '],['高 ','Height '],['长 ','Length '],['周长','Perimeter'],['面积','Area'],['净面积','Net area'],['按面积计费','charged by area'],['含材料','Materials included'],['不含材料','Materials excluded'],['标准品牌','Standard brand'],['普通品牌（示范价）','Standard brand (sample price)'],['普通 SIRIM 认证电线','Standard SIRIM-certified cable'],['Nippon Paint','Nippon Paint'],['标准','Standard'],['暂定','Provisional'],['待定','Pending'],['报价合计','Quotation total'],['工程直接费','Direct works cost'],['设计费','Design fee'],['管理费','Management fee'],['不可预见费','Contingency'],['优惠','Discount'],['施工工序','Work stage'],['房间','Space'],['工序','Work stage'],['项目','Item'],['数量','Quantity'],['单位','Unit'],['说明','Notes']
  ];
  const specTerms = [
    ['干区地面材料','Dry-area floor finish'],['地砖尺寸','Floor tile size'],['墙砖尺寸','Wall tile size'],['地砖表面','Floor tile finish'],['墙砖表面','Wall tile finish'],['瓷砖供应','Tile supply'],['石材品种','Stone type'],['实木地板木种','Solid-wood species'],['地板档次','Flooring grade'],['墙面做法','Wall finish'],['油漆品牌','Paint brand'],['基层处理','Substrate preparation'],['天花做法','Ceiling design'],['天花板材','Ceiling board'],['格栅材料','Slat material'],['铝扣板规格','Aluminium ceiling-panel size'],['柜体板材','Cabinet carcass material'],['板材环保等级','Board emission grade'],['门板饰面','Door finish'],['门板造型','Door style'],['拉手','Handles'],['封边工艺','Edging'],['背板','Back panel'],['顶部收口','Top closure'],['踢脚','Plinth'],['五金','Hardware'],['衣柜门款式','Wardrobe door style'],['柜内灯','Cabinet lighting'],['厨房台面','Kitchen countertop'],['浴室柜类型','Vanity type'],['柜体材质','Cabinet material'],['台面与台盆','Countertop and basin'],['镜子','Mirror'],['拆除范围','Demolition scope'],['防水高度','Waterproofing height'],['墙砖铺到','Wall tile height'],['踏步做法','Stair-tread finish'],['扶手栏杆做法','Handrail and balustrade'],['木种','Timber species'],['石材','Stone'],['踏步油漆','Stair-tread paint'],['防滑处理','Anti-slip treatment'],['栏杆颜色','Railing colour'],['顶面材料','Roof material'],['框架','Frame'],['四周围合','Enclosure'],['围合玻璃','Enclosure glass'],['框架颜色','Frame colour'],['推拉门款式','Sliding-door style'],['隔断玻璃','Partition glass'],['隔断框','Partition frame'],['浴缸款式','Bathtub style'],['室内门材质','Interior-door material'],['窗户类型','Window type'],['窗户开启方式','Window opening style'],['纱窗类型','Insect-screen type'],['马桶款式','Toilet style'],['洁具品牌','Sanitaryware brand'],['花洒类型','Shower type'],['厨房水槽','Kitchen sink'],['厨房龙头','Kitchen tap'],['卫浴五金挂件','Bathroom accessories'],['地漏','Floor trap'],['美缝','Tile grout'],['防水涂料','Waterproofing product'],['水管','Water pipe'],['电线品牌','Cable brand'],['窗帘类型','Curtain type'],['吊扇供应','Ceiling-fan supply'],['吊扇品牌','Ceiling-fan brand'],['入户大门','Main entrance door'],['外墙漆品牌','Exterior paint brand'],['CCTV 摄像头','CCTV camera'],['CCTV 品牌','CCTV brand'],['大门电机','Gate motor'],['马桶 / 蹲厕','Toilet / squat pan'],['窗套材料','Window-casing material'],['地台做法','Raised-platform design'],['吧台台面','Bar countertop'],['软包 / 硬包做法','Upholstered / hard-panel finish'],['镜面','Mirror finish'],['文化石材料','Cultured-stone material'],['玻璃砖','Glass block'],['波打线做法','Floor-border design'],['回填材料','Infill material'],['地板翻新做法','Floor-refinishing method'],['户外地板材料','Outdoor decking material'],['开孔类型','Core-drilling type'],['净水器类型','Water-filter type'],['岩板做法','Sintered-stone finish'],['软装档次','Furnishing grade'],['风格','Style'],['淋浴区地面','Shower-area floor'],['隔断形式','Screen layout'],['玻璃','Glass'],['五金颜色','Hardware colour'],['开关面板品牌','Switch brand'],['面板颜色','Faceplate colour'],['智能开关类型','Smart-switch type'],['智能系统','Smart-home platform'],['灯具档次','Lighting grade'],['色温','Colour temperature']
  ];
  const descriptionTerms = [
    ['按设计图现场弹出墙体、门洞、柜体、水电点位位置线，与客户现场确认后开工','Set out wall, doorway, cabinet and M&E positions from the design drawings; confirm on site with the client before work begins.'],
    ['室内地面铺保护膜+夹板，门框、窗框、电梯、走廊贴保护，完工后撤除','Protect indoor floors with film and plywood; protect door and window frames, lift and corridor. Remove protection when work is complete.'],
    ['代办管理处装修申请及工人出入证；装修押金由客户直接交物业，不含在本报价内，完工后物业退还','Submit the renovation application and arrange worker access passes. The client pays the refundable renovation deposit directly to management; it is excluded from this quotation.'],
    ['人工拆除，可回收件交还客户，其余随建筑垃圾清运','Manual removal. Reusable items are returned to the client; remaining debris is removed with construction waste.'],
    ['墙面切槽，阻燃 PVC 线管，插座 2.5mm²、照明 1.5mm² 电线（示范规格），接线盒预埋，完工出具线路走向图','Chase walls and install flame-retardant PVC conduits. Sample wiring: 2.5 mm² for sockets and 1.5 mm² for lighting. Embed junction boxes and provide an as-built wiring layout.'],
    ['从配电箱单独拉线，4mm² 电线+独立断路器，避免跳闸','Run a dedicated 4 mm² cable from the distribution board with an individual circuit breaker to prevent nuisance tripping.'],
    ['铜管包保温棉，冷凝水管按坡度接至排水点，预留室外机位置','Insulate copper pipes; slope the condensate drain to a drainage point and allow space for the outdoor unit.'],
    ['轻钢龙骨+9mm 石膏板（厨卫用防潮板），接缝贴网格带，预留检修口','Light-gauge steel framing with 9 mm plasterboard (moisture-resistant board in kitchens and bathrooms). Tape joints with mesh and provide an access panel.'],
    ['满批腻子两遍，打磨平整，阴阳角顺直','Apply two full coats of wall filler, sand smooth and keep internal and external corners straight.'],
    ['抗碱底漆一遍+乳胶面漆两遍，品牌色号客户选定（示范价按中档漆）','Apply one coat of alkali-resistant primer and two coats of emulsion paint. The client selects the brand and colour; sample pricing assumes a mid-range paint.'],
    ['底漆一遍+天花专用白漆两遍','Apply one coat of primer and two coats of ceiling white paint.'],
    ['沿天花与墙面交角安装石膏线，接缝批平后刷漆','Install cornice along ceiling-to-wall joints, fill and smooth the joints, then paint.'],
    ['轻钢龙骨+9mm 石膏板（厨卫用防潮板），接缝贴网格带，预留检修口','Light-gauge steel framing with 9 mm plasterboard (moisture-resistant board in kitchens and bathrooms). Tape joints with mesh and provide an access panel.'],
    ['底漆一遍+天花专用白漆两遍','Apply one coat of primer and two coats of ceiling white paint.'],
    ['沿天花与墙面交角安装石膏线，接缝批平后刷漆','Install cornice along ceiling-to-wall joints, fill and smooth the joints, then paint.'],
    ['完工后全屋开荒保洁：玻璃、瓷砖、柜内、地面清洁，达到可入住状态','Post-construction deep clean throughout: glass, tiles, cabinet interiors and floors, ready for occupation.'],
    ['铺防潮膜，悬浮式安装，四周留 8-10mm 伸缩缝，踢脚线压边','Install a moisture barrier and floating floor, leave an 8–10 mm expansion gap around the perimeter, and cover the edge with skirting.'],
    ['墙面批灰后刷基膜，专用胶粘贴，对花拼缝（款式客户选定）','After wall skim coating, apply wallpaper primer and adhesive; align the pattern and join seams. The client selects the design.'],
    ['按客户确认的材质、尺寸、承重及走线要求制作','Made to the client-approved material, dimensions, load capacity and cable-routing requirements.'],
    ['按设计图做叠级造型及暗藏灯槽，灯槽内预留灯带电源','Build stepped ceiling details and concealed light coves to the design; provide power for LED strips inside the cove.'],
    ['按设计图制作，预留电视、机顶盒线路孔位','Build to the design and provide cable openings for the TV and set-top box.'],
    ['按现场尺寸定做，防水柜体，下水加防臭存水弯','Made to site measurements with a water-resistant cabinet and odour-trap waste connection.'],
    ['品牌色号客户选定（示范价按中档漆）','The client selects the paint brand and colour; sample pricing assumes a mid-range product.'],
    ['新旧墙交接、开槽处挂玻纤网/钢丝网，再批灰','Reinforce new-to-existing wall joints and chased areas with fibreglass or wire mesh before skim coating.'],
    ['无电梯人工搬运材料上楼及垃圾下楼','Manual carrying of materials upstairs and construction waste downstairs where no lift is available.'],
    ['垃圾装袋，运至合法垃圾场，含车费及人工','Bag and transport waste to a licensed disposal site; transport and labour included.'],
    ['参考价同铲旧地砖，待公司核定','Reference price follows existing floor-tile removal and is pending company approval.'],
    ['瓷砖按客户选定款式（示范价按 600×600 抛釉砖）；水泥砂浆+瓷砖胶铺贴，十字卡留缝 2mm，空鼓率 ≤5%','Tiles are selected by the client (sample price assumes 600 × 600 mm glazed tiles). Install with mortar and tile adhesive, use 2 mm spacers, and keep hollow spots to 5% or less.'],
    ['防水干透后蓄水约 2 寸高，48 小时后检查楼下无渗漏，客户签字确认后才能贴砖','After waterproofing cures, pond water to about 2 in. Check the ceiling below for leaks after 48 hours; obtain client sign-off before tiling.'],
    ['1:3 水泥砂浆找平，平整度误差 ≤3mm/2m','Level with 1:3 cement mortar; flatness tolerance ≤3 mm over 2 m.'],
    ['墙面拉毛/界面剂处理，瓷砖胶薄贴，阳角 45° 倒角或加收边条','Roughen the wall or apply bonding agent, fix tiles with thin-bed adhesive, and mitre external corners at 45° or use edge trim.'],
    ['安装后逐个通电测试','Test each unit after installation.'],
    ['灯槽内 LED 灯带，每约 15 尺配一个变压器，色温客户选定','Install LED strip lighting in the cove, with one driver for about every 15 ft. The client selects the colour temperature.'],
    ['抗碱底漆一遍+乳胶面漆两遍','Apply one coat of alkali-resistant primer and two coats of emulsion paint.'],
    ['防潮板柜体（示范规格），阻尼铰链、抽屉滑轨，踢脚板防水','Moisture-resistant cabinet carcass (sample specification), soft-close hinges and drawer runners, with a water-resistant plinth.'],
    ['石英石台面（示范价），前沿倒角，水槽台下安装，接缝打胶','Quartz countertop (sample price), eased front edge, undermount sink and sealed joints.'],
    ['到顶衣柜，含挂衣杆、层板、抽屉，板材及门板款式客户选定','Full-height wardrobe with hanging rails, shelves and drawers. The client selects the board and door finish.'],
    ['安装烟机、灶具，烟管接至外墙，燃气接口测漏','Install the range hood and hob, vent the duct outdoors, and leak-test the gas connection.'],
    ['安排基膜','Apply wallpaper primer.'],
    ['电视柜/电视背景墙','TV console / feature wall'],
    ['本单临时价覆盖公司价','This quote uses a project-specific price in place of the company price.'],
    ['示范规格','Sample specification'],['示范价','Sample price'],['按现场尺寸定做','Made to site measurements'],['客户选定','Client selection'],['按设计图施工','Build to the approved drawings'],
  ];
  descriptionTerms.push(...`
电镐铲除至结构层，清理基层，渣土装袋	Use an electric breaker to remove material to the structural slab, clean the substrate and bag the debris.
拆除旧吊顶板及龙骨，检查原有电线，渣土装袋	Remove the existing ceiling boards and framing, inspect existing wiring and bag the debris.
铲除起皮、空鼓、发霉的旧批灰层至基层，便于重新批灰	Remove peeling, hollow or mouldy skim coat back to the substrate in preparation for replastering.
电镐铲除旧墙砖及粘结层至基层，渣土装袋；参考价同铲旧地砖，待公司核定	Use an electric breaker to remove wall tiles and adhesive to the substrate, then bag debris. Reference price follows floor-tile removal and is pending company approval.
按放线位置切割后拆除，断口修整，不得损伤相邻墙体及楼板	Cut along the set-out lines and demolish; trim the edges without damaging adjacent walls or slabs.
砖墙砌筑，每隔约 2 尺加拉结筋并与原墙植筋连接，双面水泥砂浆批荡	Build the brick wall with wall ties at about every 2 ft, anchored into the existing wall, then cement-render both sides.
开洞处加过梁；封洞处砌砖并与原墙拉结，双面批荡	Install a lintel over new openings. Infill closed openings with tied-in brickwork and render both sides.
按结构工程师图纸施工，加钢梁或钢筋混凝土加固，工程师现场验收	Follow the structural engineer’s drawings; reinforce with steel beams or reinforced concrete, subject to the engineer’s site inspection.
准备图纸及文件，向地方市政局申请装修/改建准证；准证批准前不动工相关项目	Prepare drawings and documents and apply to the local council for a renovation or alteration permit. Do not start the affected work before approval.
持证结构工程师出具加固方案、签字盖章，并到现场验收	A licensed structural engineer prepares and certifies the reinforcement design and inspects the work on site.
移位后重新找坡排水，二次排水层+防水加强，确保排水通畅不积水	After relocation, regrade for drainage and add a secondary drainage layer with reinforced waterproofing to prevent ponding.
搭设/拆除脚手架，高空作业做好安全防护	Erect and dismantle scaffolding with appropriate fall protection for work at height.
更换新配电箱，含主开关、漏电保护器、各回路断路器，逐个标注回路名称	Replace the distribution board, including the main switch, residual-current protection and circuit breakers; label each circuit.
Cat6 网线/电视线穿管暗装，集中到弱电箱或路由器位置	Conceal Cat6 network and TV cables in conduit and terminate them at the low-voltage cabinet or router location.
冷热水 PPR 管、排水 PVC 管（示范规格），墙内开槽暗装，热水管包保温	Conceal hot- and cold-water PPR pipes and PVC drainage pipes in wall chases (sample specification); insulate hot-water pipes.
给水管按 1.5 倍工作压力保压 30 分钟不掉压，拍照留档后才能封槽	Pressure-test the water supply at 1.5 times working pressure for 30 minutes with no pressure drop. Photograph the result before closing the chase.
由持证燃气技工施工，完工做气密性测试	Work must be completed by a licensed gas technician, followed by a gas-tightness test.
基层清理→刷界面剂→防水涂料两遍（地面满涂，墙面上翻 1 尺，淋浴区上翻 6 尺）→阴角、管根加贴网格布	Clean the substrate, apply bonding agent and two coats of waterproofing (full floor coverage; 1 ft up walls and 6 ft in the shower). Reinforce internal corners and pipe penetrations with mesh.
水泥砂浆找坡，坡度约 1%，坡向地漏，淋浴区不积水	Form a cement-mortar fall of about 1% toward the floor trap, with no ponding in the shower area.
与地面同色系踢脚线，结构胶+钢钉固定，接口 45° 拼接	Install matching-colour skirting with construction adhesive and brad nails; mitre joints at 45°.
清缝后打环氧美缝剂，颜色客户选定	Clean the tile joints and apply epoxy grout in the client-selected colour.
人造石门槛石，卫生间门口做挡水坎，防止水外流	Install an engineered-stone threshold and a bathroom doorway water stop to prevent water escaping.
人造石窗台板，外沿倒圆角，底部打胶防水	Install an engineered-stone sill with a rounded outer edge and a sealed, waterproof underside.
立管外包隔音棉，龙骨+水泥板包封后贴砖，预留检修口	Wrap the soil pipe with acoustic insulation, enclose it with framing and cement board, tile the surface and provide an access panel.
不锈钢防臭地漏（示范价），装在找坡最低点	Install a stainless-steel odour-trap floor drain (sample price) at the lowest point of the floor fall.
踏步砖+踢面砖，前沿加防滑条，逐级水平校正	Install tread and riser tiles, add anti-slip nosing and level each step.
户外防滑砖，按约 1% 坡度找坡到排水沟	Install outdoor anti-slip tiles with an approximately 1% fall toward the drain.
外墙高压清洗、修补裂缝，外墙底漆+弹性防水面漆两遍；高处搭架另计	Pressure-wash the exterior and repair cracks; apply exterior primer and two coats of flexible waterproof topcoat. High-level scaffolding is charged separately.
柜体与墙体膨胀螺栓固定，柜门阻尼铰链	Fix the cabinet carcass to the wall with expansion anchors and fit soft-close door hinges.
到顶或半高鞋柜，斜层板/平层板，预留换鞋凳位置	Build a full-height or half-height shoe cabinet with angled or flat shelves and space for a shoe bench.
实木复合门+门套，静音门锁，三片合页，门吸	Fit an engineered timber door and frame with a quiet latch, three hinges and a door stop.
铝合金窗框+钢化玻璃，打胶防水（需先获物业同意）	Aluminium window frame with tempered glass, sealed against water ingress. Obtain management approval first.
扶手高度约 3 尺，栏杆间距 ≤4 寸，与踏步牢固连接	Set the handrail at about 3 ft high, keep baluster gaps at 4 in. or less, and secure the assembly to the stairs.
镀锌方管铁花，防锈底漆+面漆，膨胀螺栓固定	Fabricate grillework from galvanised box sections, apply anti-rust primer and topcoat, and fix with expansion anchors.
面板品牌客户选定（示范价按中档），安装后逐个通电测试	The client selects the faceplate brand (sample price assumes mid-range); test each point after installation.
LED 筒灯/吸顶灯（示范价），色温客户选定；装饰吊灯另计	LED downlights or ceiling lights (sample price); the client selects the colour temperature. Decorative pendants are charged separately.
吊顶式或墙式排气扇，风管接到外墙或管井	Install a ceiling- or wall-mounted exhaust fan and duct it to the exterior wall or service shaft.
不锈钢五金件，打孔后硅胶密封防渗水	Fit stainless-steel accessories and seal drilled holes with silicone to prevent water ingress.
防雾浴室镜或镜柜，尺寸配合浴室柜宽度	Install an anti-fog bathroom mirror or mirror cabinet sized to match the vanity.
马桶（示范价），法兰密封圈安装，底部打胶，试水无渗漏	Toilet (sample price), installed with a wax-free sealing ring; seal the base and test for leaks.
防水柜体+台盆+龙头，下水加防臭存水弯	Water-resistant vanity cabinet with basin and tap; fit an odour-trap waste connection.
冷热水混水花洒，安装高度按客户身高确认	Install a hot-and-cold mixer shower at a height agreed with the client.
8mm 钢化玻璃，不锈钢五金，底部挡水条，打胶防水	8 mm tempered glass with stainless-steel hardware and a bottom water-retaining strip; seal against water ingress.
即热/储水式热水器（示范价），接专用回路及漏电保护	Instant or storage water heater (sample price), connected to a dedicated circuit with residual-current protection.
不锈钢水槽台下安装，冷热水龙头，下水防臭	Undermount stainless-steel sink with hot-and-cold tap and odour-trap waste.
手摇/电动晾衣架，膨胀螺栓固定于天花	Install a manual or motorised drying rack and anchor it to the ceiling with expansion bolts.
楼上、楼下各一个开关，都能控制楼梯灯	Install one switch upstairs and one downstairs; both control the stair lights.
预留吊扇专用线路及调速开关位，天花内加固吊钩，可承重吊扇	Provide a dedicated ceiling-fan circuit and speed-control switch; reinforce the ceiling fixing to carry the fan.
室外防水摄像头，网线/电源线穿管，接入录像主机，手机可远程查看（示范规格）	Outdoor-rated camera with network and power cables in conduit, connected to the recorder for remote viewing by phone (sample specification).
门口机+室内机，布线穿管，调试通话及开锁	Install the entrance and indoor units, run wiring in conduit, and test intercom and door-release functions.
持牌电工出图并向 TNB 申请改三相供电，更换三相电表箱及主开关，各回路按三相平衡分配；以 TNB 批准为准	A licensed electrician prepares drawings and applies to TNB for three-phase supply. Replace the meter board and main switch, balance circuits across phases, subject to TNB approval.
拆除旧镀锌管，由水表后更换为 PPR/PVC 主水管并接入屋内总阀，完工后打压测试	Remove the old galvanised pipe, replace the main with PPR/PVC from the meter to the internal stop valve, then pressure-test on completion.
主水管入户处安装总过滤器（型号客户选定），含旁通阀及冲洗排水，接驳后检查无渗漏	Install a whole-house filter at the incoming main (client-selected model), with bypass and flush drain; check all connections for leaks.
卫生间移位或扩建时新做排污管，按坡度接入原有排污井或化粪池，完工后通水测试	For bathroom relocation or extension, install a new soil pipe at the required fall to the existing inspection chamber or septic tank, then water-test.
户外防水线管及防水接线盒，独立开关或定时控制，灯具款式另选	Install outdoor-rated conduit and junction boxes with a separate switch or timer. Light fitting style is selected separately.
拆除旧落水管，更换 PVC/铝合金落水管及固定卡，接入户外排水沟	Remove the old downpipe, install a PVC or aluminium replacement with clips, and connect it to the outdoor drain.
900×1800 及以上大板：需吸盘搬运、背涂、找平系统，铺贴人工另加	For slabs 900 × 1800 mm or larger, use suction-cup handling, back-buttering and a levelling system. Additional installation labour applies.
防潮板柜体，预留洗衣机、烘干机位置及水电	Moisture-resistant cabinet carcass with space and service connections for a washer and dryer.
上下柜或到顶柜，中段可做开放台面放电器	Upper and lower cabinets or a full-height unit, with an optional open counter for appliances.
按设计图做软包/木饰面/灯槽造型，预留床头插座开关	Build upholstered or timber-finished panels and light coves to the design; provide bedside sockets and switches.
到顶柜体，层板可调，门板款式客户选定	Full-height cabinet with adjustable shelves and client-selected door finish.
不锈钢碗碟拉篮，阻尼滑轨	Stainless-steel dish basket with soft-close runners.
防盗/实木大门，含门框、门锁、门吸，门框与墙体打胶	Security or solid-wood entrance door with frame, lock and door stop; seal the frame-to-wall joint.
拆旧窗后安装铝合金窗框+玻璃（规格客户选定），外框打胶防水	Remove the existing window and install an aluminium frame with client-selected glazing; seal the perimeter against water ingress.
隐形/推拉纱窗，配合窗户尺寸定做	Custom-made retractable or sliding insect screen sized to the window.
吊顶内预留窗帘盒，宽约 6 寸，可装双轨	Provide a ceiling-recessed curtain pocket about 6 in. wide for a double track.
底漆+艺术漆多遍施工，纹理样板客户确认后施工	Apply primer and multiple coats of decorative paint after the client approves the texture sample.
安装吊扇及调速开关，检查平衡无晃动	Install the ceiling fan and speed controller; check that it runs smoothly without wobble.
按批准图纸施工：地基、砖墙、屋顶（金属板或瓦）、新旧屋面接缝防水；水电瓷砖另按各项计	Build to approved drawings, including foundations, brick walls and a metal-sheet or tiled roof; waterproof the junction with the existing roof. M&E and tiling are priced separately.
绘制扩建图纸并向地方市政局申请批准；未批准前不得动工	Prepare extension drawings and apply to the local council. Work must not begin before approval.
钢结构框架+防锈漆，顶面阳光板/金属板（规格客户选定），排水槽引水	Steel frame with anti-rust coating and client-selected polycarbonate or metal roofing; gutters direct rainwater away.
砖墙或铁栏杆围墙（款式客户选定），基础与原地面连接	Build a client-selected brick or metal boundary wall/railing, with foundations tied into the existing ground.
平开/推拉自动门电机+遥控器，含门体改装及布线，后备电池	Swing or sliding gate motor with remote, gate modification, wiring and backup battery.
混凝土排水沟+盖板，按坡度接至公共排水	Concrete drain with cover, graded to connect to the public drainage system.
户外地坪基层、找坡与面层；混凝土、压花或其他面层按现场做法核价，不含贴瓷砖	Outdoor paving includes base preparation, falls and surface finish. Concrete, stamped concrete or other finishes are priced to site conditions; tiling is excluded.
参考现有门廊/车库户外防滑砖单价；按现场基层和排水坡度核对，基层重做及排水沟另计	Reference the existing porch/garage anti-slip tile rate and confirm substrate and drainage falls on site. Substrate reconstruction and drains are extra.
花坛砌筑、抹灰及造型饰面；按尺寸、材料和设计详图核价，不含植物及灌溉	Build, render and finish planters to the design. Price depends on dimensions and materials; plants and irrigation are excluded.
上屋顶检查漏点，更换破损瓦片/补防水，完工后淋水测试	Inspect the roof for leaks, replace damaged tiles or renew waterproofing, then perform a hose test.
增压水泵或屋顶水箱安装，接主水管，含浮球阀	Install a booster pump or roof tank connected to the main water supply, including a float valve.
布帘+纱帘双层，面料客户选定，按窗宽 2 倍打褶	Double-layer curtains with drape and sheer; client-selected fabric, gathered to twice the window width.
150–200mm 窄柜不锈钢调味拉篮，阻尼滑轨	Stainless-steel pull-out spice rack for a 150–200 mm narrow cabinet, with soft-close runners.
转角地柜联动拉篮，充分利用转角空间	Corner base-cabinet pull-out system to make full use of corner storage.
吊柜内下拉式升降拉篮，方便够取	Pull-down lift basket inside the wall cabinet for easy access.
吊柜内不锈钢碗碟沥水架，带接水盘	Stainless-steel dish drainer inside the wall cabinet, with drip tray.
嵌入式米箱（出米口/抽拉式）	Built-in rice dispenser with outlet or pull-out design.
吊柜上翻门气撑或上翻器，含安装	Wall-cabinet lift-up door stay or mechanism, including installation.
预留保险箱位并加固底板，保险箱另购	Allow for a safe and reinforce the cabinet base. Safe supplied separately.
按客户确认的款式和尺寸定做（神台、地主位、下柜抽屉/柜门），神台灯要预留电源插座	Custom altar cabinet to client-approved style and dimensions, including altar, earth-god shelf and lower storage. Provide a power outlet for altar lighting.
亚克力/石材成品淋浴盘，按淋浴区尺寸订做，含下水	Custom-size acrylic or stone shower tray, including waste fitting.
两面钢化玻璃转角，不锈钢五金，底部挡水，打胶防水	Two tempered-glass panels meeting at a corner, with stainless-steel hardware, bottom water stop and silicone sealing.
钻石形钢化玻璃，不锈钢五金，底部挡水，打胶防水	Diamond-shaped tempered-glass screen with stainless-steel hardware, bottom water stop and silicone sealing.
开墙槽做壁龛，内部防水后贴砖，阳角收边	Cut a wall recess, waterproof and tile the interior, then finish the external corners.
墙砖中间加一道腰线或花砖，按长度计	Add a tile border or decorative tile band through the wall; priced by length.
实木踏板外挂包覆原踏步，含踢面板，打磨上漆	Overlay existing stairs with solid-wood treads and risers; sand and apply finish.
10–12 mm 钢化夹胶玻璃，不锈钢夹具	10–12 mm tempered laminated glass with stainless-steel clamps.
铁艺花式栏杆，防锈底漆+面漆	Decorative wrought-iron railing with anti-rust primer and topcoat.
实木立柱、栏杆、扶手，上漆	Solid-wood posts, balusters and handrail, finished with paint.
方管焊接，烤漆	Welded box-section steel with powder-coated finish.
铝合金型材，免维护	Maintenance-free aluminium profiles.
墙面预埋底盒，嵌入式 LED 踏步灯	Recess a back box in the wall and install an embedded LED stair light.
铝合金框+钢化玻璃围合，含门窗五金，打胶防水；需先获物业/市政同意	Aluminium frame and tempered-glass enclosure, including door/window hardware and waterproof sealing. Obtain management or council approval first.
地面及墙脚注药或打孔灌药，出具保用书	Apply termiticide to floors and wall bases by injection or drilled treatment; provide a warranty certificate.
格栅+龙骨安装，间距按设计	Install slats on battens at the spacing shown in the design.
轻钢龙骨+铝扣板，防潮易拆，适合厨卫	Light-gauge steel framing with removable, moisture-resistant aluminium ceiling panels, suitable for kitchens and bathrooms.
按设计做弧形/曲线造型，接缝批平	Form curved details to the design and skim joints smooth.
成品软装，款式按客户确认的风格和档次，含送货安装	Ready-made furnishing selected to the client-approved style and grade; delivery and installation included.
铺防潮膜，悬浮式安装，四周留 8-10mm 伸缩缝，踢脚线压边；档次在「④ 选材」定	Install a moisture barrier and floating floor, leave an 8–10 mm expansion gap, and cover edges with skirting. Select the grade under “④ Materials”.
岩板按墙面排版切割，专用胶 + 挂件/背板固定，对缝、磨边；预留开关插座孔位	Set out and cut sintered stone to the wall layout; fix with approved adhesive and brackets/backing, align joints and polish edges. Allow for switch and socket openings.
墙面找平后打底龙骨/卡扣安装，收口线条，预留开关插座孔位	Level the wall, install battens or clips and finish with trim. Allow for switch and socket openings.
按洞口实测下单，含上下轨/吊轨、滑轮、锁扣与收口；门洞不平先修整	Order to measured opening size, including tracks, rollers, latch and trim. Make the opening true before installation if needed.
钢化玻璃 + 框，顶地固定，玻璃胶收口；尺寸按现场复测	Framed tempered glass fixed to floor and ceiling, with silicone-finished edges; verify dimensions on site.
轻钢龙骨 + 双面石膏板，中间填隔音棉；门洞处加固，接缝贴网带批平	Light-gauge steel framing with plasterboard on both sides and acoustic insulation inside; reinforce door openings and tape/skim joints.
石材六面防护，水泥砂浆铺贴，留缝填缝；完工后打磨、结晶	Seal all six sides of the stone, lay with cement mortar, grout the joints, then polish and crystallise on completion.
石材踏步+踢面，前沿倒边	Stone treads and risers with a finished front edge.
地面找平、铺防潮层和龙骨/夹板基层，实木地板钉装，四周留伸缩缝	Level the floor, install a moisture barrier and batten/plywood base, nail down solid timber flooring and leave perimeter expansion gaps.
铲除返潮墙皮到底层，防水砂浆/防潮涂料，再做防霉腻子	Remove damp wall finish to the base, apply waterproof mortar or damp-proof coating, then use anti-mould filler.
浴缸 + 龙头 + 下水，安装后放水试漏	Install the bathtub, tap and waste; fill with water and check for leaks.
陶瓷拖把池 + 龙头，下水接驳，安装后试水	Install a ceramic mop sink and tap, connect the waste and water-test.
按设计做酒格/吊杯架，可选玻璃门和柜内灯	Build wine storage and glass racks to the design; glass doors and cabinet lighting are optional.
窗洞四周找方，基层板 + 饰面/石材，收口打胶	Square the window opening, install backing board and finish/stone, then seal the edges.
按飘窗实测下料，台面磨边，下方防水垫底，打胶收口	Measure and cut the bay-window top, polish its edges, install a waterproof underlay and seal the perimeter.
龙骨/柜体框架，面板 + 储物格，按需做升降桌或抽屉	Frame with battens or cabinet carcass, add panels and storage, with optional lift-up desk or drawers.
柜体 + 台面，预留插座和灯位	Cabinet and countertop with provision for sockets and lighting.
木基层 + 海绵（软包）+ 布艺/皮革包面，分块安装	Timber substrate with foam padding and fabric/leather upholstery, installed in panels.
防潮背板 + 防爆膜镜面，结构胶 + 机械固定	Moisture-resistant backing with safety-film mirror, fixed with structural adhesive and mechanical fasteners.
墙面拉毛，专用胶粘贴，勾缝，表面防护	Roughen the wall, fix with designated adhesive, grout and apply surface protection.
玻璃砖专用砂浆砌筑，每层加钢筋，勾缝	Lay glass blocks with purpose-made mortar, reinforce each course and grout joints.
基层找平，专用胶贴，环氧或普通填缝	Level the substrate, fix with designated adhesive and grout with epoxy or standard grout.
按图切割拼铺，转角 45° 对角	Cut and lay to the drawings, with 45° diagonal corners.
分层回填压实，面层水泥砂浆找平	Backfill and compact in layers, then level the surface with cement mortar.
机器粗磨到细磨，补缝，上漆/木蜡油 2-3 遍	Machine-sand from coarse to fine, fill gaps and apply 2–3 coats of varnish or hardwax oil.
龙骨架空，不锈钢螺丝固定，留缝排水，表面木油	Install on raised battens with stainless-steel screws, leave drainage gaps and apply timber oil.
音箱线穿管预埋到功放位，墙面留出线盒	Conceal speaker cables in conduit to the amplifier location and provide a wall outlet box.
水钻开孔，孔内加套管，外侧防雨封堵	Core-drill the opening, install a sleeve and weather-seal the exterior.
接进水和废水，单独水龙头，试压无渗漏	Connect the water supply and waste, install a dedicated tap and pressure-test for leaks.
弱电箱 + 网络模块，网络/电视/监控线集中接入	Low-voltage cabinet with network modules; terminate network, TV and CCTV cables centrally.
热水管外包保温棉，减少热损失和冷凝水	Insulate hot-water pipes to reduce heat loss and condensation.
全屋喷涂治理剂，柜内重点处理，完工后检测出报告	Apply treatment throughout the home, with focused treatment inside cabinets; test and provide a report on completion.
替换普通开关面板，接线后加入 App 配网测试；零火款需开关盒有零线	Replace the standard switch, connect and pair it with the app. Neutral-and-live models require a neutral wire in the switch box.
电动轨道 + 电机，预留插座，配网后可 App/语音/定时控制	Motorised track and motor with a nearby power outlet; app, voice and schedule control after pairing.
安装、配对网关，设置联动场景	Install and pair the hub, then configure linked scenes.
学习空调/电视遥控，接入 App	Learn the air-conditioner/TV remote and connect it to the app.
网关安装配网，全部设备接入，设置常用场景并教客户使用	Install and connect the hub, add all devices, configure common scenes and show the client how to use them.
按门厚开孔安装，录入指纹，配网测试；不适用的门需另加改装	Drill to suit the door thickness, install the lock, enrol fingerprints and test connectivity. Door modifications are extra where required.
吊扇产品，按客户选的品牌和尺寸；安装另计	Ceiling fan supplied to the client-selected brand and size; installation charged separately.
墙面批平后上基膜，无缝墙布整幅粘贴	Skim and level the wall, apply wallpaper primer and paste the seamless wallcovering in full-width drops.
按现场尺寸定做，防水柜体，下水加防臭存水弯	Made to site measurements with a water-resistant cabinet and odour-trap waste connection.
`.trim().split('\n').map(row => row.split('\t')));
  const optionTerms = `
SPC 石塑地板	SPC vinyl flooring
强化复合木地板	Laminate flooring
实木地板	Solid timber flooring
石材（大理石/花岗岩）	Stone (marble/granite)
普通亮面	Standard gloss
质感	Textured finish
质感亮面	Textured gloss
质感哑面	Textured matte
哑光	Matte
柔光	Soft sheen
亮光	Gloss
防滑	Anti-slip
包工包料	Labour and materials included
客户自备砖	Tiles supplied by client
花岗岩	Granite
大理石	Marble
水磨石	Terrazzo
菠萝格（Merbau）	Merbau
橡木	Oak
柚木	Teak
标准 5 mm	Standard 5 mm
加厚 8 mm	Thickened 8 mm
多层实木复合	Engineered timber
乳胶漆	Emulsion paint
墙纸	Wallpaper
艺术漆	Decorative paint
墙布	Wallcovering
旧墙局部修补	Patch repairs to existing walls
新墙满批	Full skim coat to new walls
铲除旧漆重做	Remove old paint and refinish
平顶	Flat ceiling
四周 L-box 灯槽（中间不吊）	Perimeter L-box cove (no central drop)
叠级+灯槽	Stepped ceiling with light cove
双层回字形叠级	Double stepped tray ceiling
弧形造型	Curved feature
木纹格栅	Wood-grain slats
铝扣板（厨卫）	Aluminium ceiling panels (kitchen/bathroom)
普通石膏板	Standard plasterboard
防潮石膏板	Moisture-resistant plasterboard
硅酸钙板	Calcium silicate board
铝合金木纹格栅	Aluminium wood-grain slats
WPC 木塑格栅	WPC slats
实木格栅	Solid timber slats
条形扣板	Strip ceiling panels
多层实木板	Plywood
防潮颗粒板	Moisture-resistant particleboard
铝合金	Aluminium
E1 级	E1 grade
E0 级	E0 grade
ENF 级（无醛添加）	ENF grade (no added formaldehyde)
双饰面	Melamine-faced
肤感（超哑）	Super-matte soft-touch
烤漆	Baked paint finish
木皮	Wood veneer
实木	Solid timber
平板门	Flat-panel door
框式门（法式/美式线条）	Frame-panel door (French/American profile)
铝框玻璃门	Aluminium-frame glass door
格栅门	Slatted door
明装拉手	Surface-mounted handle
隐形拉手（铝合金嵌入）	Concealed handle (recessed aluminium)
免拉手（反弹器）	Handleless (push-to-open)
门板开槽（一体拉手）	Integrated routed handle
ABS 封边	ABS edge banding
PUR 激光封边（无缝）	PUR laser edge banding (seamless)
9 mm 背板	9 mm back panel
18 mm 加厚背板	18 mm reinforced back panel
到顶（顶线/见光板收口）	Full height (cornice/finished side panel)
不到顶（上方留空）	Below ceiling (open above)
同色踢脚板	Matching-colour plinth
铝合金踢脚	Aluminium plinth
悬空（底部灯带）	Floating (with under-cabinet lighting)
阻尼铰链+缓冲滑轨	Soft-close hinges and drawer runners
悍高（HIGOLD）	Higold
DTC（东泰）	DTC
平开门	Hinged door
推拉移门	Sliding door
开放式（无门）	Open (no doors)
感应灯带	Sensor-activated LED strip
石英石	Quartz stone
岩板	Sintered stone
成品浴室柜	Ready-made vanity
定制浴室柜	Custom vanity
PVC 防水板	PVC waterproof board
防潮多层实木板	Moisture-resistant plywood
陶瓷一体盆	Integrated ceramic basin
石英石台面 + 台下盆	Quartz countertop with undermount basin
岩板台面 + 台下盆	Sintered-stone countertop with undermount basin
防雾镜	Anti-fog mirror
LED 智能镜	LED smart mirror
镜柜	Mirror cabinet
地砖 + 墙砖全拆	Remove all floor and wall tiles
只拆地砖（墙砖保留）	Remove floor tiles only (retain wall tiles)
只拆墙砖（地砖保留）	Remove wall tiles only (retain floor tiles)
淋浴区 1.8 m + 其余上翻 30 cm	1.8 m in shower area + 30 cm elsewhere
淋浴区到顶 + 其余上翻 30 cm	Full height in shower area + 30 cm elsewhere
全部墙面到顶	Full height on all walls
满墙到顶	Full wall height
到吊顶下（约 8 尺）	To underside of ceiling (approx. 8 ft)
半墙 4 尺（上面刷漆）	Half wall, 4 ft (paint above)
瓷砖踏步	Tiled stair treads
实木踏板	Solid timber treads
石材踏步	Stone treads
原踏步打磨油漆	Sand and repaint existing treads
不锈钢立柱 + 木扶手	Stainless-steel balusters with timber handrail
实木栏杆	Solid timber railing
黑色方管栏杆（现代简约）	Black box-section railing (modern minimalist)
踏步下 LED 灯带	LED strip under stair treads
实木复合	Engineered timber
木器清漆	Timber varnish
地坪漆	Floor coating
彩色水泥漆	Coloured cement paint
铝合金防滑条	Aluminium anti-slip strip
开防滑槽	Cut anti-slip grooves
黑色	Black
白色	White
木色	Timber colour
不锈钢本色	Natural stainless steel
香槟金	Champagne gold
阳光板（Polycarbonate）	Polycarbonate roofing
夹胶钢化玻璃	Tempered laminated glass
铝合金隔热板（三明治板）	Insulated aluminium sandwich panel
金属浪板（Metal Deck）	Metal deck roofing
铝合金百叶（可调）	Adjustable aluminium louvres
镀锌钢（防锈漆）	Galvanised steel (anti-rust coating)
不锈钢	Stainless steel
铝合金推拉窗	Aluminium sliding window
铝合金折叠门	Aluminium folding door
固定玻璃 + 部分推拉	Fixed glass with partial sliding panels
无框玻璃	Frameless glass
6 mm 钢化透明	6 mm clear tempered glass
8 mm 钢化透明	8 mm clear tempered glass
夹胶玻璃	Laminated glass
隔热 Low-E 玻璃	Insulated Low-E glass
茶色/灰色钢化玻璃	Bronze/grey tempered glass
香槟	Champagne
灰色	Grey
铝合金框 + 钢化玻璃	Aluminium frame with tempered glass
极窄边框（铝合金）	Ultra-slim aluminium frame
木质移门（吊轨）	Timber sliding door (top-hung track)
钢化清玻	Clear tempered glass
长虹玻璃	Fluted glass
磨砂玻璃	Frosted glass
铝合金框	Aluminium frame
黑色细框（工业风）	Slim black frame (industrial style)
无框	Frameless
亚克力独立浴缸	Freestanding acrylic bathtub
砌台嵌入式（含砌台贴砖）	Built-in on tiled masonry platform
按摩浴缸	Whirlpool bathtub
实木复合门	Engineered timber door
免漆门（PVC 覆膜）	Pre-finished door (PVC film)
烤漆门	Baked-paint door
实心实木门	Solid timber door
铝合金玻璃门	Aluminium glass door
普通铝合金窗	Standard aluminium window
隔音窗（双层夹胶玻璃）	Sound-insulating window (double laminated glazing)
断桥铝窗（中空玻璃）	Thermal-break aluminium window (double glazing)
推拉窗	Sliding window
平开窗	Casement window
上悬窗	Top-hung window
推拉纱窗	Sliding insect screen
隐形卷帘纱窗	Retractable roller insect screen
折叠纱窗	Folding insect screen
固定纱窗	Fixed insect screen
分体马桶	Two-piece toilet
连体马桶	One-piece toilet
壁挂入墙马桶（含隐藏水箱）	Wall-hung toilet with concealed cistern
智能马桶	Smart toilet
明装普通花洒	Exposed standard shower set
明装恒温花洒	Exposed thermostatic shower set
暗装入墙花洒	Concealed shower set
即热式	Instantaneous
储水式	Storage type
热泵热水器	Heat-pump water heater
太阳能热水器	Solar water heater
不锈钢单槽	Single-bowl stainless-steel sink
不锈钢双槽	Double-bowl stainless-steel sink
石英石水槽	Quartz sink
不锈钢台下盆	Undermount stainless-steel basin
普通龙头	Standard tap
抽拉式龙头	Pull-out tap
普通排气扇	Standard exhaust fan
静音排气扇	Quiet exhaust fan
带灯排气扇	Exhaust fan with light
太空铝	Space aluminium
哑黑	Matte black
拉丝金	Brushed gold
普通防臭地漏	Standard odour-trap floor drain
侧排地漏	Side-outlet floor drain
长条线性地漏	Linear floor drain
人造石	Engineered stone
瓷砖踢脚	Tile skirting
PVC 踢脚	PVC skirting
铝合金/不锈钢踢脚	Aluminium/stainless-steel skirting
实木踢脚	Solid timber skirting
隐形踢脚（与墙面齐平）	Flush concealed skirting
环氧彩砂美缝	Epoxy grout
普通填缝剂	Standard grout
聚脲美缝	Polyurea grout
JS 柔性防水	JS flexible waterproofing
聚氨酯防水	Polyurethane waterproofing
防水卷材	Waterproof membrane
PPR 水管	PPR water pipe
PEX 水管	PEX water pipe
不锈钢水管	Stainless-steel water pipe
PU 线条	PU moulding
布帘 + 纱帘（双层）	Drape and sheer curtains (double layer)
遮光布帘 + 纱帘	Blackout drape and sheer
卷帘	Roller blind
斑马帘	Zebra blind
铝百叶	Aluminium blinds
木百叶	Timber blinds
电动窗帘（布帘）	Motorised fabric curtains
手摇升降晾衣架	Manual lift drying rack
电动升降晾衣架	Motorised lift drying rack
墙挂折叠晾衣架	Wall-mounted folding drying rack
客户自购（只安装）	Client-supplied (installation only)
我们供应吊扇	Ceiling fan supplied by HOUZY
钢制防盗门	Steel security door
实木大门	Solid timber entrance door
铝合金大门	Aluminium entrance gate
铁艺大门	Wrought-iron gate
智能防盗门（含智能锁）	Smart security door with smart lock
镀锌铁花	Galvanised grille
不锈钢铁花	Stainless-steel grille
隐形防盗网（钢丝）	Invisible stainless-steel wire grille
2MP 普通	2 MP standard
4MP 高清	4 MP high definition
4MP 彩色夜视 + 人形侦测	4 MP colour night vision with human detection
Ezviz（萤石）	Ezviz
普通可视门铃	Standard video doorbell
Wi-Fi 手机可视门铃	Wi-Fi video doorbell
平移门（Sliding）	Sliding gate
双开摇臂门（Swing）	Double swing gate
折叠门（Folding）	Folding gate
普通电机	Standard motor
中高档电机	Mid-to-high-grade motor
进口电机（Nice / BFT）	Imported motor (Nice/BFT)
坐便马桶	Close-coupled toilet
蹲厕（含水箱）	Squat toilet with cistern
木饰面窗套	Timber-finished window casing
石材窗套	Stone window casing
铝合金/不锈钢窗套	Aluminium/stainless-steel window casing
木地台（下方储物）	Timber platform with storage below
地台 + 抽屉	Platform with drawers
榻榻米（带升降桌）	Tatami platform with lift-up table
岩板台面	Sintered-stone countertop
实木台面	Solid timber countertop
布艺软包	Fabric upholstery
皮革软包	Leather upholstery
硬包（木基层 + 布/皮）	Upholstered hard panel (timber backing with fabric/leather)
银镜	Silver mirror
茶镜/灰镜	Bronze/grey mirror
车边银镜	Bevelled silver mirror
文化石（人造）	Cultured stone (man-made)
天然板岩	Natural slate
透明玻璃砖	Clear glass blocks
磨砂/彩色玻璃砖	Frosted/coloured glass blocks
陶瓷马赛克	Ceramic mosaic
玻璃马赛克	Glass mosaic
石材马赛克	Stone mosaic
瓷砖波打线	Tile border
石材波打线	Stone border
水刀拼花	Waterjet-cut inlay
轻质回填（陶粒/泡沫混凝土）	Lightweight infill (LECA/foam concrete)
砂浆砖渣回填	Mortar and brick-rubble infill
打磨 + 清漆（PU）	Sanding and PU varnish
打磨 + 木蜡油	Sanding and hardwax oil
樟子松防腐木	Preservative-treated pine
WPC 塑木	WPC decking
空调孔（65-80 mm）	Air-conditioning opening (65–80 mm)
排烟/排风孔（150 mm 以上）	Exhaust opening (150 mm or larger)
RO 反渗透（带储水桶）	RO filtration (with storage tank)
超滤 UF（无废水）	UF filtration (no wastewater)
普通岩板（6 mm）	Standard sintered stone (6 mm)
连纹岩板（大板对纹）	Book-matched sintered stone slabs
厚岩板（9-12 mm）	Thick sintered stone (9–12 mm)
木饰面（多层板基材）	Timber veneer (plywood substrate)
竹木纤维集成墙板	Bamboo-wood fibre wall panels
WPC 木塑墙板	WPC wall panels
实木护墙板	Solid timber wall panelling
经济	Economy
中档	Mid-range
高档	Premium
现代简约	Modern minimalist
奶油风	Soft neutral
北欧	Scandinavian
新中式	Modern Chinese
轻奢	Modern luxury
侘寂/原木	Wabi-sabi / natural timber
瓷砖找坡 + 石材挡水条	Tiled floor fall with stone water-stop
地面找坡（不做挡水）	Sloped floor (no water-stop)
一字型	Straight
L 型	L-shaped
钻石型	Diamond-shaped
浴帘杆（不做玻璃）	Shower-curtain rod (no glass screen)
10 mm 钢化透明	10 mm clear tempered glass
8 mm 钢化磨砂	8 mm frosted tempered glass
8 mm 长虹玻璃	8 mm fluted glass
枪灰	Gunmetal grey
LWD（马来西亚制造）	LWD (Made in Malaysia)
PLK（马来西亚制造）	PLK (Made in Malaysia)
reTOUCH（马来西亚品牌）	reTOUCH (Malaysian brand)
UMS / neiken（马来西亚制造）	UMS / neiken (Made in Malaysia)
Bull 公牛	Bull
Panasonic 松下	Panasonic
Schneider 施耐德	Schneider
Legrand 罗格朗	Legrand
单火智能开关（旧房免拉零线）	Single-live smart switch (no neutral wire required)
零火智能开关（更稳定）	Live-and-neutral smart switch (more stable)
智能触屏场景面板	Smart touchscreen scene panel
小米米家	Xiaomi Mi Home
Aqara（支持 Apple Home）	Aqara (Apple Home compatible)
标准 LED 筒灯/吸顶灯	Standard LED downlight/ceiling light
防眩筒灯+射灯	Anti-glare downlights and spotlights
3000K 暖光	3000K warm white
4000K 自然光	4000K natural white
6000K 白光	6000K cool white
`.trim().split('\n').map(row => row.split('\t'));
  const nameTerms = `
铲除旧地砖（含旧找平层）	Remove existing floor tiles (including old screed)
铲除旧墙砖（含粘结层）	Remove existing wall tiles (including adhesive)
新砌隔断墙（双面批荡）	Build new partition wall (render both sides)
门洞改造（封旧门洞/开新门洞）	Modify doorway (close existing/open new)
改建申请（市政局 Majlis 装修/改建准证）	Renovation/alteration permit application (local council)
挑空/高天花脚手架（高空作业）	Scaffolding for double-height/high ceilings
配电箱更换（主开关+漏电保护 RCCB）	Replace distribution board (main switch + RCCB)
防水涂刷（地面满涂+墙面上翻）	Waterproofing (full floor coverage with wall upturn)
闭水试验（48 小时）	48-hour ponding test
地面找坡（往地漏方向）	Form floor fall toward floor drain
下水管包封（含隔音棉）	Enclose waste pipe (including acoustic insulation)
楼梯踏步砖（含防滑条）	Tiled stair treads (including anti-slip strips)
室内门（含门套、锁、合页）	Interior door (frame, lock and hinges included)
防盗铁花（窗/门）	Security grilles (windows/doors)
天花灯带（含变压器）	Ceiling LED strip (driver included)
卫浴五金挂件套（毛巾架/纸巾架/挂钩）	Bathroom accessory set (towel rail, paper holder and hooks)
浴室柜（含台盆、龙头）	Bathroom vanity (basin and tap included)
烟机灶具安装（电器客户自购）	Install range hood and hob (appliances supplied by client)
CCTV 监控摄像头（含布线+主机分摊）	CCTV camera (wiring and recorder allocation included)
单相电改三相电（含 TNB 申请）	Convert single-phase to three-phase power (TNB application included)
进户主水管更换（水表至屋内）	Replace incoming main water pipe (meter to house)
全屋净水器（户外总过滤器）	Whole-house water filter (outdoor main filter)
雨水管（落水管）更换	Replace rainwater downpipe
洗衣柜（洗衣机上方/旁边）	Laundry cabinet (above/beside washer)
碗碟拉篮（地柜抽拉）	Pull-out dish basket (base cabinet)
大门更换（含门框、锁）	Replace entrance door (frame and lock included)
窗帘盒（暗藏轨道位）	Curtain pocket (concealed track recess)
墙纸（代替乳胶漆）	Wallpaper (instead of emulsion paint)
艺术漆（代替乳胶漆）	Decorative paint (instead of emulsion paint)
吊扇安装（吊扇客户自购或另计）	Install ceiling fan (client-supplied or priced separately)
厨房/后院扩建（地基+砌墙+屋顶）	Kitchen/rear extension (foundation, walls and roof)
扩建图纸及市政局（Majlis）申请	Extension drawings and local council application
顶棚（雨棚 / 阳光棚 / 阳光房顶）	Canopy (awning, sunshade or sunroom roof)
户外地坪（混凝土/压花地坪）	Outdoor paving (concrete/stamped finish)
窗帘（含轨道/罗马杆安装）	Curtains (track/rod installation included)
基础软装配饰包（靠垫/花艺/摆件）	Basic furnishing accessories (cushions, florals and decor)
调味拉篮（窄柜）	Spice pull-out (narrow cabinet)
转角拉篮（小怪物/飞碟）	Corner pull-out (magic corner/round carousel)
高身柜拉篮（储物高柜）	Tall pantry pull-out basket
吊柜上翻门支撑（气撑/上翻器）	Wall-cabinet lift-up door stay
衣柜保险箱位（含加固）	Wardrobe safe compartment (reinforcement included)
实木楼梯踏板（含踢面）	Solid timber stair treads (risers included)
石材楼梯踏步（含踢面）	Stone stair treads (risers included)
白蚁防治（地面/墙脚药剂处理）	Termite treatment (floor/wall-base application)
工程保险（Contractor All Risk）	Contractor’s All Risks insurance
吊扇（产品）	Ceiling fan (product)
石材地面铺贴（大理石/花岗岩）	Stone floor installation (marble/granite)
浴缸（含龙头、下水、安装）	Bathtub (tap, waste and installation included)
拖把池（含龙头）	Mop sink (tap included)
吧台（含柜体和台面）	Bar counter (cabinet and countertop included)
马赛克铺贴（含材料）	Mosaic installation (materials included)
地面垫高回填（每 4 寸）	Floor raising and infill (per 4 inches)
墙体开孔（水钻）	Core-drill wall opening
厨下净水器（含安装）	Under-sink water filter (installation included)
除甲醛 / 空气治理（含检测）	Formaldehyde/air treatment (testing included)
智能开关（含安装、配网）	Smart switch (installation and pairing included)
智能窗帘电机（含电动轨道）	Smart curtain motor (motorised track included)
智能传感器（人体/门窗/温湿度）	Smart sensors (motion, door/window, temperature/humidity)
吊扇产品（我们供应）	Ceiling fan supplied by HOUZY
墙布（代替乳胶漆）	Wallcovering (instead of emulsion paint)
定制浴室柜（含台面、台盆、龙头）	Custom vanity (countertop, basin and tap included)
`.trim().split('\n').map(row => row.split('\t'));
  const specTermsExtra = [
    ['地面与瓷砖','Flooring and tiles'],['浴室柜','Bathroom vanity'],['防水与墙砖','Waterproofing and wall tiles'],['踏步灯做法','Stair-light method'],['阳光棚/阳光房','Canopy / sunroom'],['推拉门 / 玻璃隔断 / 浴缸','Sliding doors / glass screens / bathtub'],['门窗选材','Doors and windows'],['卫浴 / 厨房选品','Bathroom and kitchen fittings'],['热水器类型','Water-heater type'],['泥水 / 水电辅材','Masonry / M&E consumables'],['门槛石 / 窗台石材质','Threshold / window-sill stone'],['石膏线材料','Cornice material'],['窗帘 / 晾衣架 / 吊扇','Curtains / drying racks / ceiling fans'],['大门 / 外墙 / 安防','Entrance gate / exterior / security'],['自动大门款式','Automatic gate style'],['其他工艺做法','Other methods and finishes'],['飘窗台面材料','Bay-window countertop material'],['马赛克材料','Mosaic material'],['岩板 / 护墙板','Sintered stone / wall panelling'],['护墙板材料','Wall-panelling material'],['淋浴区','Shower area'],['开关面板 / 智能开关','Switch plates / smart switches']
  ];
  const tileTerms = [
    ['铺贴辅料及人工','Tiling consumables and labour'],['瓷砖材料','Tile material'],['瓷砖片价','Tile price per piece'],['片价待定','Tile rate pending'],['旧面积价','Legacy area rate'],['砖材规格','Tile specification'],['砖材规格：','Tile specification: '],['砖材见统一规格价','Tile material priced by standard size and finish'],['尺寸＋表面','size + finish'],['尺寸+表面','size + finish'],['含损耗','including waste'],['未计损耗','excluding waste'],['损耗','waste'],['RM/片','RM/piece'],['RM / 片','RM/piece'],['每片砖材价','Tile price per piece'],['统一规格价','standard size-and-finish rate'],['铺贴辅料／人工','Tiling consumables/labour'],['铺贴辅料与人工','Tiling consumables and labour'],['铺贴辅料／人工另按面积计','Tiling consumables/labour priced separately by area'],['辅料和人工按面积计费','consumables and labour charged by area'],['旧通用片价','legacy general per-piece rate'],['分表面片价','per-piece rate by finish'],['铺贴另计','installation priced separately'],['选此表面时须补价','a rate is required when this finish is selected'],['请输入非负的每片价格','Enter a non-negative price per piece'],['标准规格','Standard specification'],['面积单价按：','Area unit price: '],['报价单分两行','shown as separate quote lines'],['瓷砖材料按“尺寸＋表面”填写 RM/片；铺贴辅料与人工在上方项目行按面积填写，报价单分两行。旧通用片价及旧面积价仅供旧报价沿用。其他规格可分别填写材料、辅料、人工或直接填综合价。逐项点「确认此价格」会立即保存并用于报价；批量修改可点上方「保存」。','Enter tile material rates per piece by size and finish. Enter tiling consumables and labour by area in the project row above; they appear as separate lines in the quotation. Legacy general per-piece and area rates are retained for older quotes only. For other specifications, enter material, consumables and labour separately or enter an all-in rate. Confirming a row saves and applies it immediately; use Save above for batch changes.'],['铺贴辅料／人工按面积填在本行；砖材按下方“尺寸＋表面”每片单独填价。','Enter tiling consumables/labour by area in this row; enter tile material per piece by size and finish below.'],['铺贴辅料／人工按面积填在本行；砖材按下方“尺寸＋表面”每片单独填价','Enter tiling consumables/labour by area in this row; enter tile material per piece by size and finish below.'],['瓷砖材料按“尺寸＋表面”填写 RM/片','Enter tile material rates per piece by size and finish'],[' RM/片；',' RM/piece; '],['㎡（未计损耗）','m² (excluding waste)'],['瓷砖材料按','Tile material rates are entered by'],['片价未填：','Tile rate missing: '],['旧报价按面积材料价','Legacy quotes use an area-based material rate'],['请补录分表面片价','Enter the per-piece rate for each finish'],['请在价目表填写所选表面的 RM/片价格','Enter the RM/piece rate for the selected finish in the price book'],['净面积','Net area'],['按面积计费','charged by area']
  ];
  const tileExtra = [
    ['铺贴辅料／人工按面积填在本行','Enter tiling consumables/labour by area in this row'],['砖材按下方','Enter tile material rates below by'],['每片单独填价','enter a separate rate per piece'],['报价单分两行。','The quotation shows these as separate lines.'],['铺贴辅料／人工按面积填在本行；砖材按下方“尺寸＋表面”每片单独填价','Enter tiling consumables/labour by area in this row; enter tile material rates below by size and finish.'],['片价未填：选此表面时须补价','Tile rate missing: a rate is required when this finish is selected']
  ];
  const formulaTerms = [
    ['地面 + 周长×上翻1尺 + 淋浴区墙 6×6','Floor area + perimeter × 1 ft upstand + shower wall 6 × 6 ft'],['地面 + 周长×上翻1 ft + 淋浴区墙 6×6','Floor area + perimeter × 1 ft upstand + shower wall 6 × 6 ft'],['地面 + 周长×上翻1尺 + 淋浴区墙 6×6 到顶','Floor area + perimeter × 1 ft upstand + shower wall to 6 × 6 ft ceiling'],['地面 + 周长×上翻1 ft + 淋浴区墙 6×6 到顶','Floor area + perimeter × 1 ft upstand + shower wall to 6 × 6 ft ceiling'],['地面 + 全部墙面','Floor area + all wall surfaces'],['各樘窗 宽×高 合计','Total window area (width × height)'],['各樘窗宽×高合计','Total window area (width × height)'],['各樘窗 宽×高','Window width × height'],['各樘窗宽合计','Total window width'],['各樘窗 周长合计','Total window perimeter'],['拆旧窗 = 窗数','Remove old windows = number of windows'],['有吊顶 → 窗帘盒 = 窗宽','With suspended ceiling → curtain pocket = window width'],['周长 × 2 尺宽 L-box','Perimeter × 2 ft-wide L-box'],['两层 = 周长 × 2','Two layers = perimeter × 2'],['= 周长 − 门宽','= perimeter − door width'],['周长 − 门宽','Perimeter − door width'],['= 周长','= perimeter'],['默认 = 周长 × 墙脚 3 尺高','Default = perimeter × 3 ft wall-base height'],['地面找平','Floor levelling'],['地砖面积','floor tile area'],['弧形造型长度','Curved-feature length'],['全天花刷漆','Paint entire ceiling'],['休息平台','Landing'],['墙面上翻','Wall upstand'],['淋浴区墙','Shower wall'],['上翻','upstand'],['地面','floor area'],['墙面','wall area'],['周长','perimeter'],['门宽','door width'],['窗数','number of windows'],['窗宽','window width'],['窗套长度','window-casing length'],['各樘窗','each window'],['宽×高','width × height'],['地面面积','floor area'],['墙砖面积','wall-tile area'],['旧天花面积','existing ceiling area'],['拆除面积','demolition area'],['拆墙面积（长 × 高）','Wall demolition area (length × height)'],['砌墙面积（长 × 高）','New masonry area (length × height)'],['隔墙面积（长 × 高）','Partition wall area (length × height)'],['拆墙面积','Wall demolition area'],['砌墙面积','New masonry area'],['隔墙面积','Partition wall area'],['厨房地面','kitchen floor area'],['操作区','work area'],['点位数','number of points'],['插座/开关点位','socket/switch points'],['灯位','light points'],['水点位','water points'],['立管处数','riser locations'],['每台一条专用回路','one dedicated circuit per unit'],['吊扇台数','number of ceiling fans'],['卫生间必配','required in each bathroom'],['拖把池进水','mop-sink water supply'],['吊柜长度','wall-cabinet length'],['柜内灯带','cabinet LED strip'],['窗洞','window opening'],['台面长度','countertop length'],['房间门数','number of room doors'],['拆旧门','remove old door'],['拆旧窗','remove old window'],['楼梯宽','stair width'],['踏步','stair tread'],['窗帘盒','curtain pocket'],['全天花','entire ceiling'],['长 × 高','length × height'],['签约定金','Contract signing deposit'],['水电隐蔽验收通过','After concealed electrical and plumbing inspection approval'],['泥水瓷砖验收通过','After masonry and tiling inspection approval'],['竣工验收交付','Upon final inspection and handover'],['验收通过','inspection approved']
  ];
  const allTerms = [...pairs, ...catalog, ...exportTerms, ...specTerms, ...specTermsExtra, ...descriptionTerms, ...optionTerms, ...nameTerms, ...tileTerms, ...tileExtra, ...formulaTerms];
  const dict = new Map(allTerms);
  const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patternTerms = [...allTerms.filter(([zh]) => zh.length >= 3), ...optionTerms.filter(([zh]) => zh.length >= 2), ...tileTerms.filter(([zh]) => zh.length >= 2), ...formulaTerms.filter(([zh]) => zh.length >= 3)];
  const pattern = new RegExp(patternTerms.map(([zh]) => escapeRegExp(zh)).sort((a, b) => b.length - a.length).join('|'), 'g');
  const originalText = new WeakMap(), originalAttr = new WeakMap();
  function translate(value) {
    if (!/[\u3400-\u9fff]/.test(value)) return value;
    const exact = dict.get(value.trim());
    if (exact) return value.replace(value.trim(), exact);
    return value.replace(/^(\s*\d+\.\s*)(拆改与现场保护|水电隐蔽|防水|泥水瓷砖 \/ 地面|天花墙面|定制柜与门窗|设备安装与收尾|户外与外围工程|软装)$/, (_, no, label) => no + (dict.get(label) || label))
      .replace(/方案\s*([A-Z])(?![A-Z])/g, 'Plan $1').replace(/第\s*(\d+)\s*樘/g, 'Opening $1').replace(/卧室\s*(\d+)/g, 'Bedroom $1').replace(/卫生间\s*(\d+)/g, 'Bathroom $1')
      .replace(/(\d+)\s*房/g, '$1 bed').replace(/(\d+)\s*卫/g, '$1 bath').replace(/(\d+)\s*楼/g, 'Level $1').replace(/(\d+)\s*间/g, '$1 spaces').replace(/(\d+)\s*项/g, '$1 items').replace(/(\d+)\s*尺/g, '$1 ft')
      .replace(/(\d+)\s*级\s*×\s*宽\s*([\d.]+)\s*(?:尺|ft)/g, '$1 steps × width $2 ft').replace(/(\d+)\s*级/g, '$1 steps').replace(/×\s*宽\s*([\d.]+)\s*(?:尺|ft)/g, '× width $1 ft')
      .replace(/宽\s*([\d.]+)\s*×\s*深\s*([\d.]+)\s*×\s*高\s*([\d.]+)\s*(cm|mm|尺|ft)?/g, (_, w, d, h, unit = '') => `width ${w} × depth ${d} × height ${h}${unit === '尺' ? ' ft' : unit ? ` ${unit}` : ''}`)
      .replace(/宽\s*([\d.]+)\s*×\s*高\s*([\d.]+)/g, 'width $1 × height $2').replace(/宽\s*([\d.]+)\s*×\s*深\s*([\d.]+)/g, 'width $1 × depth $2').replace(/长\s*([\d.]+)\s*×\s*宽\s*([\d.]+)/g, 'length $1 × width $2')
      .replace(/^\s*客户：/, 'Client: ').replace(/^\s*方案：/, 'Plan: ').replace(/^\s*日期：/, 'Date: ')
      .replace(/共管公寓|普通公寓|排屋|半独立式|独立式|联排分层|客厅|餐厅|厨房|书房|阳台/g, match => ({'共管公寓': 'Condominium', '普通公寓': 'Apartment', '排屋': 'Terrace house', '半独立式': 'Semi-detached', '独立式': 'Bungalow', '联排分层': 'Townhouse', '客厅': 'Living room', '餐厅': 'Dining room', '厨房': 'Kitchen', '书房': 'Study', '阳台': 'Balcony'}[match])).replace(/未填写/g, 'Not provided')
      .replace(/砖材规格/g, 'Tile size/finish').replace(/地／墙／门廊通用/g, 'floor/wall/porch').replace(/铺贴辅料／人工另按面积计/g, 'Installation materials and labour priced by area').replace(/未计损耗/g, 'waste excluded').replace(/参考价/g, 'Reference price').replace(/\/片/g, '/piece').replace(/^\s*片\s*$/, 'piece').replace(/平方尺/g, 'sq ft').replace(/平方米/g, 'm²').replace(/\+\s*加一层/g, '+ Add a level')
      .replace(pattern, match => dict.get(match)).replace(/「([^」]+)」/g, (_, label) => `“${dict.get(label) || label}”`).replace(/^\s*已选\s*(\d+) items/, (_, n) => `Selected ${n} items`).replace(/这间完成/g, 'Complete space').replace(/一起选/g, 'Select together').replace(/下一间/g, 'Next space').replace(/(\d+) spaces\b/g, (_, n) => `${n} ${n === '1' ? 'space' : 'spaces'}`)
      .replace(/^\s*长\s*(\d+)/, 'Length $1').replace(/^\s*宽\s*(\d+)/, 'Width $1').replace(/^\s*墙面\s*(\d+)/, 'Wall area $1').replace(/周长\s*(\d+)/g, 'Perimeter $1')
      .replace(/（/g, ' (').replace(/）/g, ')').replace(/，/g, ', ').replace(/。/g, '.').replace(/；/g, '; ').replace(/：/g, ': ').replace(/”(?=[A-Z])/g, '” ').replace(/([A-Za-z])\(/g, '$1 (');
  }
  function auditCatalog() {
    const q = root.QV2;
    if (!q) return [];
    const source = [];
    Object.values(q.PRICE || {}).forEach(item => source.push(item.name, item.desc));
    (q.STAGES || []).forEach(item => source.push(item.name));
    Object.values(q.PACKS || {}).forEach(item => source.push(item.label));
    (q.HOUSE_ITEMS || []).forEach(item => source.push(item.label));
    Object.values(q.SPEC_CATS || {}).forEach(cat => {
      source.push(cat.label);
      Object.values(cat.keys || {}).forEach(key => source.push(key.label, ...(key.opts || [])));
    });
    (q.SETTINGS?.pay || []).forEach(([name]) => source.push(name));
    return [...new Set(source.filter(value => value && /[\u3400-\u9fff]/.test(translate(value))))];
  }
  function apply(roots, lang) {
    for (const rootNode of roots) {
      if (!rootNode) continue;
      const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.nodeValue.trim() || node.parentElement?.closest('script,style,textarea,[contenteditable]')) continue;
        if (!originalText.has(node)) originalText.set(node, node.nodeValue);
        const zh = originalText.get(node);
        node.nodeValue = lang === 'en' ? translate(zh) : zh;
      }
      for (const el of [rootNode, ...rootNode.querySelectorAll('[placeholder],[title],[aria-label]')]) {
        if (!(el instanceof Element)) continue;
        let saved = originalAttr.get(el);
        if (!saved) { saved = {}; for (const name of ['placeholder','title','aria-label']) if (el.hasAttribute(name)) saved[name] = el.getAttribute(name); originalAttr.set(el, saved); }
        for (const [name, zh] of Object.entries(saved)) el.setAttribute(name, lang === 'en' ? translate(zh) : zh);
      }
    }
  }
  root.HOUZY_QUOTE_I18N = { apply, translate, auditCatalog };
  const missing = auditCatalog();
  if (missing.length && root.console?.warn) root.console.warn('[HOUZY Quote] Missing English translations:', missing);
})(window);
