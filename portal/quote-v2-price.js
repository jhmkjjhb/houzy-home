// 新版报价器参考价：由 portal/quote.html 的 PRICE / STAGES 生成，价格改动请两边同步（旧版下线后只保留这里）。
(function(root){
  root.QV2_PRICE = {"setout":{"stage":"prep","name":"开工放线定位","unit":"项","mat":0,"aux":0,"lab":150,"waste":0,"desc":"按设计图现场弹出墙体、门洞、柜体、水电点位位置线，与客户现场确认后开工"},
    "protect":{"stage":"prep","name":"成品及公共区域保护（地面/电梯/走廊）","unit":"平方尺","mat":0,"aux":0,"lab":0,"waste":0,"unpriced":true,"desc":"室内地面铺保护膜+夹板，门框、窗框、电梯、走廊贴保护，完工后撤除"},
    "permit":{"stage":"prep","name":"物业装修申请代办","unit":"项","mat":0,"aux":0,"lab":150,"waste":0,"desc":"代办管理处装修申请及工人出入证；装修押金由客户直接交物业，不含在本报价内，完工后物业退还"},
    "demo_piece":{"stage":"prep","name":"拆除旧柜/旧洁具/旧门窗","unit":"件","mat":0,"aux":0,"lab":35,"waste":0,"desc":"人工拆除，可回收件交还客户，其余随建筑垃圾清运"},
    "demo_floor":{"stage":"prep","name":"铲除旧地砖（含旧找平层）","unit":"平方尺","mat":0,"aux":0,"lab":1.5,"waste":0,"desc":"电镐铲除至结构层，清理基层，渣土装袋"},
    "demo_ceiling":{"stage":"prep","name":"拆除旧天花","unit":"平方尺","mat":0,"aux":0,"lab":1.2,"waste":0,"desc":"拆除旧吊顶板及龙骨，检查原有电线，渣土装袋"},
    "demo_skin":{"stage":"prep","name":"铲除旧墙面批灰/油漆","unit":"平方尺","mat":0,"aux":0,"lab":0.6,"waste":0,"desc":"铲除起皮、空鼓、发霉的旧批灰层至基层，便于重新批灰"},
    "demo_wall_tile":{"stage":"prep","name":"铲除旧墙砖（含粘结层）","unit":"平方尺","mat":0,"aux":0,"lab":1.5,"waste":0,"desc":"电镐铲除旧墙砖及粘结层至基层，渣土装袋；参考价同铲旧地砖，待公司核定"},
    "demo_wall":{"stage":"prep","name":"砸墙/拆隔断墙","unit":"平方尺","mat":0,"aux":0,"lab":1.8,"waste":0,"desc":"按放线位置切割后拆除，断口修整，不得损伤相邻墙体及楼板"},
    "build_wall":{"stage":"prep","name":"新砌隔断墙（双面批荡）","unit":"平方尺","mat":3,"aux":0.5,"lab":2.5,"waste":5,"desc":"砖墙砌筑，每隔约 2 尺加拉结筋并与原墙植筋连接，双面水泥砂浆批荡"},
    "door_open":{"stage":"prep","name":"门洞改造（封旧门洞/开新门洞）","unit":"个","mat":30,"aux":10,"lab":60,"waste":0,"desc":"开洞处加过梁；封洞处砌砖并与原墙拉结，双面批荡"},
    "struct":{"stage":"prep","name":"承重墙开洞加固","unit":"处","mat":400,"aux":100,"lab":800,"waste":0,"desc":"按结构工程师图纸施工，加钢梁或钢筋混凝土加固，工程师现场验收"},
    "reno_permit":{"stage":"prep","name":"改建申请（市政局 Majlis 装修/改建准证）","unit":"项","mat":0,"aux":0,"lab":0,"waste":0,"desc":"准备图纸及文件，向地方市政局申请装修/改建准证；准证批准前不动工相关项目","unpriced":true},
    "engineer":{"stage":"prep","name":"结构工程师审图签字","unit":"项","mat":0,"aux":0,"lab":1500,"waste":0,"desc":"持证结构工程师出具加固方案、签字盖章，并到现场验收"},
    "bath_drop":{"stage":"prep","name":"卫生间降板/二次排水处理","unit":"平方尺","mat":5,"aux":3,"lab":12,"waste":0,"desc":"移位后重新找坡排水，二次排水层+防水加强，确保排水通畅不积水"},
    "carry_up":{"stage":"prep","name":"材料搬运上楼（2楼及以上）","unit":"平方尺","mat":0,"aux":0,"lab":0.3,"waste":0,"desc":"无电梯人工搬运材料上楼及垃圾下楼"},
    "scaffold":{"stage":"prep","name":"挑空/高天花脚手架（高空作业）","unit":"处","mat":0,"aux":200,"lab":600,"waste":0,"desc":"搭设/拆除脚手架，高空作业做好安全防护"},
    "waste_out":{"stage":"prep","name":"建筑垃圾清运","unit":"车次","mat":0,"aux":0,"lab":350,"waste":0,"desc":"垃圾装袋，运至合法垃圾场，含车费及人工"},
    "wire":{"stage":"mep","name":"电路开槽穿管布线","unit":"个点位","mat":20,"aux":15,"lab":25,"waste":0,"desc":"墙面切槽，阻燃 PVC 线管，插座 2.5mm²、照明 1.5mm² 电线（示范规格），接线盒预埋，完工出具线路走向图"},
    "circuit":{"stage":"mep","name":"专用回路（空调/热水器等大功率电器）","unit":"回路","mat":60,"aux":20,"lab":60,"waste":0,"desc":"从配电箱单独拉线，4mm² 电线+独立断路器，避免跳闸"},
    "db_box":{"stage":"mep","name":"配电箱更换（主开关+漏电保护 RCCB）","unit":"个","mat":450,"aux":50,"lab":250,"waste":0,"desc":"更换新配电箱，含主开关、漏电保护器、各回路断路器，逐个标注回路名称"},
    "net":{"stage":"mep","name":"网络/电视线预埋","unit":"个点位","mat":12,"aux":8,"lab":20,"waste":0,"desc":"Cat6 网线/电视线穿管暗装，集中到弱电箱或路由器位置"},
    "water_pt":{"stage":"mep","name":"给排水管改造","unit":"个点位","mat":30,"aux":15,"lab":35,"waste":0,"desc":"冷热水 PPR 管、排水 PVC 管（示范规格），墙内开槽暗装，热水管包保温"},
    "pipe_test":{"stage":"mep","name":"水管打压测试","unit":"项","mat":0,"aux":0,"lab":80,"waste":0,"desc":"给水管按 1.5 倍工作压力保压 30 分钟不掉压，拍照留档后才能封槽"},
    "aircon_pipe":{"stage":"mep","name":"空调铜管+排水管预埋","unit":"台","mat":140,"aux":40,"lab":120,"waste":0,"desc":"铜管包保温棉，冷凝水管按坡度接至排水点，预留室外机位置"},
    "gas":{"stage":"mep","name":"燃气管道改造","unit":"项","mat":250,"aux":50,"lab":400,"waste":0,"desc":"由持证燃气技工施工，完工做气密性测试"},
    "wp":{"stage":"wp","name":"防水涂刷（地面满涂+墙面上翻）","unit":"平方尺","mat":2.5,"aux":1,"lab":2.2,"waste":5,"desc":"基层清理→刷界面剂→防水涂料两遍（地面满涂，墙面上翻 1 尺，淋浴区上翻 6 尺）→阴角、管根加贴网格布"},
    "flood_test":{"stage":"wp","name":"闭水试验（48 小时）","unit":"次","mat":0,"aux":0,"lab":50,"waste":0,"desc":"防水干透后蓄水约 2 寸高，48 小时后检查楼下无渗漏，客户签字确认后才能贴砖"},
    "slope":{"stage":"wp","name":"地面找坡（往地漏方向）","unit":"平方尺","mat":0,"aux":1.5,"lab":2,"waste":0,"desc":"水泥砂浆找坡，坡度约 1%，坡向地漏，淋浴区不积水"},
    "screed":{"stage":"tile","name":"地面水泥砂浆找平","unit":"平方尺","mat":0,"aux":1.2,"lab":1.3,"waste":0,"desc":"1:3 水泥砂浆找平，平整度误差 ≤3mm/2m"},
    "floor_tile":{"stage":"tile","name":"地砖铺贴","unit":"平方尺","mat":3.8,"aux":1,"lab":2.3,"waste":8,"desc":"瓷砖按客户选定款式（示范价按 600×600 抛釉砖）；水泥砂浆+瓷砖胶铺贴，十字卡留缝 2mm，空鼓率 ≤5%"},
    "wall_tile":{"stage":"tile","name":"墙砖铺贴","unit":"平方尺","mat":3.8,"aux":1,"lab":2.5,"waste":8,"desc":"墙面拉毛/界面剂处理，瓷砖胶薄贴，阳角 45° 倒角或加收边条"},
    "laminate":{"stage":"tile","name":"SPC 石塑地板铺装","unit":"平方尺","mat":5.5,"aux":0.5,"lab":1.5,"waste":5,"desc":"铺防潮膜，悬浮式安装，四周留 8-10mm 伸缩缝，踢脚线压边"},
    "skirting":{"stage":"tile","name":"踢脚线","unit":"延尺","mat":2,"aux":0.5,"lab":1.5,"waste":5,"desc":"与地面同色系踢脚线，结构胶+钢钉固定，接口 45° 拼接"},
    "grout":{"stage":"tile","name":"瓷砖美缝","unit":"平方尺","mat":0.5,"aux":0.3,"lab":0.7,"waste":0,"desc":"清缝后打环氧美缝剂，颜色客户选定"},
    "threshold":{"stage":"tile","name":"门槛石/挡水条","unit":"条","mat":50,"aux":10,"lab":30,"waste":0,"desc":"人造石门槛石，卫生间门口做挡水坎，防止水外流"},
    "window_sill":{"stage":"tile","name":"窗台石","unit":"延尺","mat":18,"aux":3,"lab":8,"waste":0,"desc":"人造石窗台板，外沿倒圆角，底部打胶防水"},
    "pipe_box":{"stage":"tile","name":"下水管包封（含隔音棉）","unit":"处","mat":40,"aux":30,"lab":80,"waste":0,"desc":"立管外包隔音棉，龙骨+水泥板包封后贴砖，预留检修口"},
    "drain":{"stage":"tile","name":"防臭地漏","unit":"个","mat":30,"aux":5,"lab":15,"waste":0,"desc":"不锈钢防臭地漏（示范价），装在找坡最低点"},
    "stair_tread":{"stage":"tile","name":"楼梯踏步砖（含防滑条）","unit":"级","mat":35,"aux":10,"lab":35,"waste":0,"desc":"踏步砖+踢面砖，前沿加防滑条，逐级水平校正"},
    "porch_tile":{"stage":"tile","name":"门廊/车库户外防滑砖","unit":"平方尺","mat":4,"aux":1.2,"lab":2.5,"waste":8,"desc":"户外防滑砖，按约 1% 坡度找坡到排水沟"},
    "plaster_ceiling":{"stage":"ceil","name":"石膏板吊顶","unit":"平方尺","mat":3,"aux":1,"lab":3.5,"waste":5,"desc":"轻钢龙骨+9mm 石膏板（厨卫用防潮板），接缝贴网格带，预留检修口"},
    "ceiling_step":{"stage":"ceil","name":"天花叠级/灯槽","unit":"延尺","mat":5,"aux":3,"lab":6,"waste":0,"desc":"按设计图做叠级造型及暗藏灯槽，灯槽内预留灯带电源"},
    "skim":{"stage":"ceil","name":"墙面批灰找平","unit":"平方尺","mat":0,"aux":0.6,"lab":0.8,"waste":5,"desc":"满批腻子两遍，打磨平整，阴阳角顺直"},
    "paint_wall":{"stage":"ceil","name":"墙面乳胶漆（一底两面）","unit":"平方尺","mat":0.6,"aux":0.2,"lab":0.6,"waste":5,"desc":"抗碱底漆一遍+乳胶面漆两遍，品牌色号客户选定（示范价按中档漆）"},
    "paint_ceiling":{"stage":"ceil","name":"天花乳胶漆","unit":"平方尺","mat":0.6,"aux":0.2,"lab":0.7,"waste":5,"desc":"底漆一遍+天花专用白漆两遍"},
    "ext_paint":{"stage":"ceil","name":"外墙防水漆","unit":"平方尺","mat":0.9,"aux":0.3,"lab":0.8,"waste":5,"desc":"外墙高压清洗、修补裂缝，外墙底漆+弹性防水面漆两遍；高处搭架另计"},
    "cab_low":{"stage":"custom","name":"橱柜 · 地柜","unit":"延尺","mat":100,"aux":16,"lab":30,"waste":0,"desc":"防潮板柜体（示范规格），阻尼铰链、抽屉滑轨，踢脚板防水"},
    "cab_up":{"stage":"custom","name":"橱柜 · 吊柜","unit":"延尺","mat":80,"aux":11,"lab":24,"waste":0,"desc":"柜体与墙体膨胀螺栓固定，柜门阻尼铰链"},
    "counter":{"stage":"custom","name":"石英石台面","unit":"延尺","mat":75,"aux":7,"lab":12,"waste":0,"desc":"石英石台面（示范价），前沿倒角，水槽台下安装，接缝打胶"},
    "wardrobe":{"stage":"custom","name":"衣柜定制","unit":"延尺","mat":50,"aux":5,"lab":15,"waste":0,"desc":"到顶衣柜，含挂衣杆、层板、抽屉，板材及门板款式客户选定"},
    "shoe_cab":{"stage":"custom","name":"鞋柜","unit":"延尺","mat":60,"aux":8,"lab":15,"waste":0,"desc":"到顶或半高鞋柜，斜层板/平层板，预留换鞋凳位置"},
    "tv_cab":{"stage":"custom","name":"电视柜/电视背景墙","unit":"延尺","mat":55,"aux":8,"lab":15,"waste":0,"desc":"按设计图制作，预留电视、机顶盒线路孔位"},
    "door":{"stage":"custom","name":"室内门（含门套、锁、合页）","unit":"樘","mat":400,"aux":50,"lab":80,"waste":0,"desc":"实木复合门+门套，静音门锁，三片合页，门吸"},
    "balc_seal":{"stage":"custom","name":"阳台封窗","unit":"延尺","mat":50,"aux":10,"lab":20,"waste":0,"desc":"铝合金窗框+钢化玻璃，打胶防水（需先获物业同意）"},
    "stair_rail":{"stage":"custom","name":"楼梯扶手/栏杆","unit":"延尺","mat":75,"aux":15,"lab":30,"waste":0,"desc":"扶手高度约 3 尺，栏杆间距 ≤4 寸，与踏步牢固连接"},
    "grille":{"stage":"custom","name":"防盗铁花（窗/门）","unit":"平方尺","mat":10,"aux":2,"lab":4,"waste":0,"desc":"镀锌方管铁花，防锈底漆+面漆，膨胀螺栓固定"},
    "panel":{"stage":"equip","name":"开关插座面板安装","unit":"个","mat":10,"aux":2,"lab":5,"waste":0,"desc":"面板品牌客户选定（示范价按中档），安装后逐个通电测试"},
    "light":{"stage":"equip","name":"基础灯具供应+安装","unit":"个","mat":40,"aux":5,"lab":20,"waste":0,"desc":"LED 筒灯/吸顶灯（示范价），色温客户选定；装饰吊灯另计"},
    "led_strip":{"stage":"equip","name":"天花灯带（含变压器）","unit":"延尺","mat":6,"aux":1,"lab":3,"waste":0,"desc":"灯槽内 LED 灯带，每约 15 尺配一个变压器，色温客户选定"},
    "exhaust":{"stage":"equip","name":"排气扇","unit":"个","mat":90,"aux":10,"lab":40,"waste":0,"desc":"吊顶式或墙式排气扇，风管接到外墙或管井"},
    "bath_acc":{"stage":"equip","name":"卫浴五金挂件套（毛巾架/纸巾架/挂钩）","unit":"套","mat":150,"aux":0,"lab":40,"waste":0,"desc":"不锈钢五金件，打孔后硅胶密封防渗水"},
    "mirror":{"stage":"equip","name":"浴室镜/镜柜","unit":"个","mat":180,"aux":0,"lab":30,"waste":0,"desc":"防雾浴室镜或镜柜，尺寸配合浴室柜宽度"},
    "toilet":{"stage":"equip","name":"马桶","unit":"套","mat":260,"aux":20,"lab":40,"waste":0,"desc":"马桶（示范价），法兰密封圈安装，底部打胶，试水无渗漏"},
    "vanity":{"stage":"equip","name":"浴室柜（含台盆、龙头）","unit":"套","mat":350,"aux":30,"lab":50,"waste":0,"desc":"防水柜体+台盆+龙头，下水加防臭存水弯"},
    "shower":{"stage":"equip","name":"花洒/淋浴龙头","unit":"套","mat":200,"aux":20,"lab":30,"waste":0,"desc":"冷热水混水花洒，安装高度按客户身高确认"},
    "screen":{"stage":"equip","name":"淋浴玻璃隔断","unit":"套","mat":600,"aux":50,"lab":100,"waste":0,"desc":"8mm 钢化玻璃，不锈钢五金，底部挡水条，打胶防水"},
    "heater":{"stage":"equip","name":"热水器安装","unit":"台","mat":320,"aux":30,"lab":60,"waste":0,"desc":"即热/储水式热水器（示范价），接专用回路及漏电保护"},
    "sink":{"stage":"equip","name":"厨房水槽+龙头","unit":"套","mat":230,"aux":20,"lab":40,"waste":0,"desc":"不锈钢水槽台下安装，冷热水龙头，下水防臭"},
    "hood":{"stage":"equip","name":"烟机灶具安装（电器客户自购）","unit":"套","mat":0,"aux":20,"lab":100,"waste":0,"desc":"安装烟机、灶具，烟管接至外墙，燃气接口测漏"},
    "rack":{"stage":"equip","name":"晾衣架","unit":"套","mat":170,"aux":10,"lab":60,"waste":0,"desc":"手摇/电动晾衣架，膨胀螺栓固定于天花"},
    "stair_light":{"stage":"equip","name":"楼梯灯+上下双控开关","unit":"套","mat":70,"aux":10,"lab":40,"waste":0,"desc":"楼上、楼下各一个开关，都能控制楼梯灯"},
    "clean":{"stage":"equip","name":"开荒清洁","unit":"平方尺","mat":0,"aux":0.1,"lab":0.4,"waste":0,"desc":"完工后全屋开荒保洁：玻璃、瓷砖、柜内、地面清洁，达到可入住状态"},
    "fan_point":{"stage":"mep","name":"吊扇线路+加固吊点","unit":"个","mat":15,"aux":15,"lab":40,"waste":0,"desc":"预留吊扇专用线路及调速开关位，天花内加固吊钩，可承重吊扇"},
    "cctv":{"stage":"mep","name":"CCTV 监控摄像头（含布线+主机分摊）","unit":"个","mat":180,"aux":40,"lab":80,"waste":0,"desc":"室外防水摄像头，网线/电源线穿管，接入录像主机，手机可远程查看（示范规格）"},
    "doorbell":{"stage":"mep","name":"可视门铃/对讲","unit":"套","mat":350,"aux":30,"lab":80,"waste":0,"desc":"门口机+室内机，布线穿管，调试通话及开锁"},
    "three_phase":{"stage":"mep","name":"单相电改三相电（含 TNB 申请）","unit":"项","mat":0,"aux":0,"lab":0,"waste":0,"desc":"持牌电工出图并向 TNB 申请改三相供电，更换三相电表箱及主开关，各回路按三相平衡分配；以 TNB 批准为准","unpriced":true},
    "main_pipe":{"stage":"mep","name":"进户主水管更换（水表至屋内）","unit":"延尺","mat":0,"aux":0,"lab":0,"waste":0,"desc":"拆除旧镀锌管，由水表后更换为 PPR/PVC 主水管并接入屋内总阀，完工后打压测试","unpriced":true},
    "water_filter":{"stage":"mep","name":"全屋净水器（户外总过滤器）","unit":"套","mat":0,"aux":0,"lab":0,"waste":0,"desc":"主水管入户处安装总过滤器（型号客户选定），含旁通阀及冲洗排水，接驳后检查无渗漏","unpriced":true},
    "sewer":{"stage":"mep","name":"排污管/化粪池接驳","unit":"项","mat":0,"aux":0,"lab":0,"waste":0,"desc":"卫生间移位或扩建时新做排污管，按坡度接入原有排污井或化粪池，完工后通水测试","unpriced":true},
    "garden_light":{"stage":"mep","name":"户外灯/庭院灯点位","unit":"个点位","mat":0,"aux":0,"lab":0,"waste":0,"desc":"户外防水线管及防水接线盒，独立开关或定时控制，灯具款式另选","unpriced":true},
    "downpipe":{"stage":"mep","name":"雨水管（落水管）更换","unit":"延尺","mat":0,"aux":0,"lab":0,"waste":0,"desc":"拆除旧落水管，更换 PVC/铝合金落水管及固定卡，接入户外排水沟","unpriced":true},
    "big_tile_extra":{"stage":"tile","name":"大板砖/岩板铺贴加价","unit":"平方尺","mat":0,"aux":0.5,"lab":2,"waste":0,"desc":"900×1800 及以上大板：需吸盘搬运、背涂、找平系统，铺贴人工另加"},
    "laundry_cab":{"stage":"custom","name":"洗衣柜（洗衣机上方/旁边）","unit":"延尺","mat":55,"aux":8,"lab":15,"waste":0,"desc":"防潮板柜体，预留洗衣机、烘干机位置及水电"},
    "sideboard":{"stage":"custom","name":"餐边柜","unit":"延尺","mat":60,"aux":8,"lab":15,"waste":0,"desc":"上下柜或到顶柜，中段可做开放台面放电器"},
    "headboard":{"stage":"custom","name":"床头背景墙","unit":"延尺","mat":45,"aux":8,"lab":15,"waste":0,"desc":"按设计图做软包/木饰面/灯槽造型，预留床头插座开关"},
    "bookcase":{"stage":"custom","name":"书柜/储物柜","unit":"延尺","mat":55,"aux":8,"lab":15,"waste":0,"desc":"到顶柜体，层板可调，门板款式客户选定"},
    "cab_basket":{"stage":"custom","name":"碗碟拉篮（地柜抽拉）","unit":"套","mat":180,"aux":0,"lab":20,"waste":0,"desc":"不锈钢碗碟拉篮，阻尼滑轨"},
    "main_door":{"stage":"custom","name":"大门更换（含门框、锁）","unit":"樘","mat":1200,"aux":100,"lab":200,"waste":0,"desc":"防盗/实木大门，含门框、门锁、门吸，门框与墙体打胶"},
    "window_new":{"stage":"custom","name":"铝合金窗更换","unit":"平方尺","mat":25,"aux":3,"lab":6,"waste":0,"desc":"拆旧窗后安装铝合金窗框+玻璃（规格客户选定），外框打胶防水"},
    "fly_screen":{"stage":"custom","name":"纱窗","unit":"平方尺","mat":6,"aux":1,"lab":2,"waste":0,"desc":"隐形/推拉纱窗，配合窗户尺寸定做"},
    "cornice":{"stage":"ceil","name":"石膏线","unit":"延尺","mat":3,"aux":1,"lab":3,"waste":0,"desc":"沿天花与墙面交角安装石膏线，接缝批平后刷漆"},
    "curtain_box":{"stage":"ceil","name":"窗帘盒（暗藏轨道位）","unit":"延尺","mat":4,"aux":1,"lab":5,"waste":0,"desc":"吊顶内预留窗帘盒，宽约 6 寸，可装双轨"},
    "wallpaper":{"stage":"ceil","name":"墙纸（代替乳胶漆）","unit":"平方尺","mat":2.5,"aux":0.3,"lab":1.2,"waste":10,"desc":"墙面批灰后刷基膜，专用胶粘贴，对花拼缝（款式客户选定）"},
    "art_paint":{"stage":"ceil","name":"艺术漆（代替乳胶漆）","unit":"平方尺","mat":3.5,"aux":0.3,"lab":2.5,"waste":5,"desc":"底漆+艺术漆多遍施工，纹理样板客户确认后施工"},
    "ceiling_fan":{"stage":"equip","name":"吊扇安装（吊扇客户自购或另计）","unit":"台","mat":0,"aux":10,"lab":60,"waste":0,"desc":"安装吊扇及调速开关，检查平衡无晃动"},
    "extension":{"stage":"outdoor","name":"厨房/后院扩建（地基+砌墙+屋顶）","unit":"平方尺","mat":45,"aux":10,"lab":35,"waste":0,"desc":"按批准图纸施工：地基、砖墙、屋顶（金属板或瓦）、新旧屋面接缝防水；水电瓷砖另按各项计"},
    "ext_permit":{"stage":"outdoor","name":"扩建图纸及市政局（Majlis）申请","unit":"项","mat":0,"aux":0,"lab":1800,"waste":0,"desc":"绘制扩建图纸并向地方市政局申请批准；未批准前不得动工"},
    "awning":{"stage":"outdoor","name":"顶棚（雨棚 / 阳光棚 / 阳光房顶）","unit":"平方尺","mat":18,"aux":3,"lab":6,"waste":0,"desc":"钢结构框架+防锈漆，顶面阳光板/金属板（规格客户选定），排水槽引水"},
    "fence":{"stage":"outdoor","name":"围墙/栏杆","unit":"延尺","mat":60,"aux":10,"lab":30,"waste":0,"desc":"砖墙或铁栏杆围墙（款式客户选定），基础与原地面连接"},
    "autogate":{"stage":"outdoor","name":"自动大门（Autogate）","unit":"套","mat":2200,"aux":200,"lab":600,"waste":0,"desc":"平开/推拉自动门电机+遥控器，含门体改装及布线，后备电池"},
    "drain_ch":{"stage":"outdoor","name":"户外排水沟","unit":"延尺","mat":15,"aux":5,"lab":15,"waste":0,"desc":"混凝土排水沟+盖板，按坡度接至公共排水"},
    "roof_fix":{"stage":"outdoor","name":"屋顶补漏","unit":"处","mat":150,"aux":50,"lab":250,"waste":0,"desc":"上屋顶检查漏点，更换破损瓦片/补防水，完工后淋水测试"},
    "water_pump":{"stage":"outdoor","name":"水泵/水箱","unit":"套","mat":800,"aux":100,"lab":250,"waste":0,"desc":"增压水泵或屋顶水箱安装，接主水管，含浮球阀"},
    "curtain":{"stage":"soft","name":"窗帘（含轨道/罗马杆安装）","unit":"延尺","mat":40,"aux":5,"lab":15,"waste":0,"desc":"布帘+纱帘双层，面料客户选定，按窗宽 2 倍打褶"},
    "decor":{"stage":"soft","name":"基础软装配饰包（靠垫/花艺/摆件）","unit":"项","mat":800,"aux":0,"lab":0,"waste":0,"desc":"按设计风格搭配基础软装配饰"}};
  root.QV2_PRICE.desk = {"stage":"custom","name":"定制书桌／工作台","unit":"延尺","mat":0,"aux":0,"lab":0,"waste":0,"unpriced":true,"desc":"按客户确认的材质、尺寸、承重及走线要求制作"};
  // 新版：定制柜按正面面积（宽×高，平方尺）计价，单价待公司核定；橱柜地柜/吊柜和台面仍按延尺
  // 橱柜功能五金：单价待公司按品牌（如 Higold/Blum/国产）核定
  [['hw_spice', '调味拉篮（窄柜）', '套', '150–200mm 窄柜不锈钢调味拉篮，阻尼滑轨'], ['hw_corner', '转角拉篮（小怪物/飞碟）', '套', '转角地柜联动拉篮，充分利用转角空间'],
   ['hw_tall', '高身柜拉篮（储物高柜）', '套', '高柜多层联动拉篮'], ['hw_lift', '吊柜升降拉篮', '套', '吊柜内下拉式升降拉篮，方便够取'], ['hw_rack', '吊柜碗碟沥水架', '套', '吊柜内不锈钢碗碟沥水架，带接水盘'],
   ['hw_bin', '水槽柜垃圾桶拉出', '套', '水槽下拉出式分类垃圾桶'], ['hw_cutlery', '抽屉刀叉餐具分隔盘', '个', '按抽屉宽度配置'], ['hw_rice', '米箱', '个', '嵌入式米箱（出米口/抽拉式）'],
   ['hw_flap', '吊柜上翻门支撑（气撑/上翻器）', '套', '吊柜上翻门气撑或上翻器，含安装'],
   ['whw_pants', '衣柜抽拉裤架', '个', '阻尼滑轨抽拉裤架'], ['whw_basket', '衣柜抽拉衣物拉篮', '个', '阻尼滑轨拉篮'], ['whw_lift', '衣柜下拉升降衣架', '个', '高位下拉式挂衣架'],
   ['whw_mirror', '衣柜内旋转/推拉镜', '个', '柜内隐藏式穿衣镜'], ['whw_jewel', '衣柜首饰/领带格抽屉', '个', '绒布分格抽屉'], ['whw_shoe', '衣柜抽拉鞋架', '个', '柜内抽拉鞋架'], ['whw_safe', '衣柜保险箱位（含加固）', '个', '预留保险箱位并加固底板，保险箱另购']].forEach(([code, name, unit, desc]) => {
    root.QV2_PRICE[code] = { stage: 'custom', name, unit, mat: 0, aux: 0, lab: 0, waste: 0, unpriced: true, desc };
  });
  root.QV2_PRICE.altar_cab = {"stage":"custom","name":"神龛/神台柜定制","unit":"平方尺","mat":0,"aux":0,"lab":0,"waste":0,"desc":"按客户确认的款式和尺寸定做（神台、地主位、下柜抽屉/柜门），神台灯要预留电源插座"};
  ['wardrobe', 'tv_cab', 'shoe_cab', 'altar_cab', 'sideboard', 'bookcase', 'laundry_cab', 'headboard'].forEach(c => Object.assign(root.QV2_PRICE[c], { unit: '平方尺', mat: 0, aux: 0, lab: 0, unpriced: true }));
  Object.assign(root.QV2_PRICE.desk, { unit: '项' });
  [['shower_tray', '成品淋浴盘', '个', '亚克力/石材成品淋浴盘，按淋浴区尺寸订做，含下水'], ['screen_l', '淋浴玻璃隔断（L 型）', '套', '两面钢化玻璃转角，不锈钢五金，底部挡水，打胶防水'],
   ['screen_diamond', '淋浴玻璃隔断（钻石型）', '套', '钻石形钢化玻璃，不锈钢五金，底部挡水，打胶防水'], ['curtain_rod', '浴帘杆 + 浴帘', '套', '不做玻璃隔断时使用']].forEach(([code, name, unit, desc]) => {
    root.QV2_PRICE[code] = { stage: 'equip', name, unit, mat: 0, aux: 0, lab: 0, waste: 0, unpriced: true, desc };
  });
  root.QV2_PRICE.niche = { stage: 'tile', name: '淋浴区墙内壁龛', unit: '个', mat: 0, aux: 0, lab: 0, waste: 0, unpriced: true, desc: '开墙槽做壁龛，内部防水后贴砖，阳角收边' };
  root.QV2_PRICE.tile_border = { stage: 'tile', name: '腰线/花砖', unit: '延尺', mat: 0, aux: 0, lab: 0, waste: 0, unpriced: true, desc: '墙砖中间加一道腰线或花砖，按长度计' };
  [['stair_wood', '实木楼梯踏板（含踢面）', '级', 'tile', '实木踏板外挂包覆原踏步，含踢面板，打磨上漆'], ['stair_wood_land', '休息平台实木地板', '平方尺', 'tile', '与踏板同木种'],
   ['stair_stone', '石材楼梯踏步（含踢面）', '级', 'tile', '石材踏步+踢面，前沿倒边'], ['stair_stone_land', '休息平台石材', '平方尺', 'tile', '与踏步同石材'],
   ['stair_paint', '楼梯踏步打磨油漆', '级', 'ceil', '原踏步打磨、补缝、上漆'], ['stair_paint_area', '休息平台打磨油漆', '平方尺', 'ceil', '与踏步同油漆'],
   ['rail_glass', '钢化玻璃栏板 + 木扶手', '延尺', 'custom', '10–12 mm 钢化夹胶玻璃，不锈钢夹具'], ['rail_iron', '铁艺栏杆', '延尺', 'custom', '铁艺花式栏杆，防锈底漆+面漆'],
   ['rail_wood', '实木栏杆 + 扶手', '延尺', 'custom', '实木立柱、栏杆、扶手，上漆'], ['rail_black', '黑色方管栏杆（现代简约）', '延尺', 'custom', '方管焊接，烤漆'],
   ['rail_alu', '铝合金栏杆', '延尺', 'custom', '铝合金型材，免维护'],
   ['stair_steplight', '嵌墙踏步灯', '个', 'equip', '墙面预埋底盒，嵌入式 LED 踏步灯'], ['stair_steplight_sensor', '人体感应踏步灯', '个', 'equip', '感应自动亮灭']].forEach(([code, name, unit, stage, desc]) => {
    root.QV2_PRICE[code] = { stage, name, unit, mat: 0, aux: 0, lab: 0, waste: 0, unpriced: true, desc };
  });
  root.QV2_PRICE.sunroom_wall = { stage: 'outdoor', name: '阳光房玻璃围合', unit: '平方尺', mat: 0, aux: 0, lab: 0, waste: 0, unpriced: true, desc: '铝合金框+钢化玻璃围合，含门窗五金，打胶防水；需先获物业/市政同意' };
  [['termite', '白蚁防治（地面/墙脚药剂处理）', '平方尺', '地面及墙脚注药或打孔灌药，出具保用书'], ['roro_bin', '大垃圾箱租用（RORO bin）', '个', '含运送、更换及运往合法垃圾场'], ['car_insurance', '工程保险（Contractor All Risk）', '项', '工程期间第三者责任及工程一切险']].forEach(([code, name, unit, desc]) => {
    root.QV2_PRICE[code] = { stage: 'prep', name, unit, mat: 0, aux: 0, lab: 0, waste: 0, unpriced: true, desc };
  });
  [['ceil_slat', '木纹格栅天花', '平方尺', '格栅+龙骨安装，间距按设计'], ['ceil_alu', '铝扣板天花', '平方尺', '轻钢龙骨+铝扣板，防潮易拆，适合厨卫'],
   ['ceil_curve', '弧形造型天花', '延尺', '按设计做弧形/曲线造型，接缝批平']].forEach(([code, name, unit, desc]) => {
    root.QV2_PRICE[code] = { stage: 'ceil', name, unit, mat: 0, aux: 0, lab: 0, waste: 0, unpriced: true, desc };
  });
  // 软装：价格按「中档」登记；没给价之前待定价
  [['sf_sofa', '沙发', '套'], ['sf_coffee', '茶几', '张'], ['sf_side', '边几', '张'], ['sf_rug', '地毯', '张'], ['sf_pendant', '装饰吊灯', '盏'], ['sf_art', '挂画', '幅'],
   ['sf_fan', '吊扇（产品）', '台'], ['sf_dining', '餐桌椅', '套'], ['sf_bed', '床架 + 床垫', '套'], ['sf_night', '床头柜', '个'], ['sf_dresser', '梳妆台', '张'],
   ['sf_bedding', '床品', '套'], ['sf_lamp', '落地灯/台灯', '盏'], ['sf_desk', '书桌椅', '套'], ['sf_shelf', '成品书架', '个'], ['sf_outdoor', '户外桌椅', '套'],
   ['sf_umbrella', '遮阳伞', '把'], ['sf_plant', '绿植', '盆']].forEach(([code, name, unit]) => {
    root.QV2_PRICE[code] = { stage: 'soft', name, unit, mat: 0, aux: 0, lab: 0, waste: 0, unpriced: true, desc: '成品软装，款式按客户确认的风格和档次，含送货安装' };
  });
  // 强化复合木地板：原来和 SPC 共用一个价，先沿用同价，公司按实际改
  root.QV2_PRICE.wood_floor = { ...root.QV2_PRICE.laminate, name: '强化复合木地板铺装', desc: '铺防潮膜，悬浮式安装，四周留 8-10mm 伸缩缝，踢脚线压边；档次在「④ 选材」定' };
  root.QV2_PRICE.vanity_custom = { stage: 'custom', name: '定制浴室柜（含台面、台盆、龙头）', unit: '延尺', mat: 0, aux: 0, lab: 0, waste: 0, unpriced: true, desc: '按现场尺寸定做，防水柜体，下水加防臭存水弯' };
  // 小件定制（凳子、桌子等）按项，名称和单价由员工逐项填写
  root.QV2_PRICE.custom_item = { stage: 'custom', name: '定制小件', unit: '项', mat: 0, aux: 0, lab: 0, waste: 0 };
  // 选材价差：键为「类别.选项.值」，内容为各项目在标准价上的加减（RM/单位）。公司核定后在这里登记。
  // 例：'tile.floorSize.600×1200 mm': { floor_tile: { mat: 2, lab: 0.5 } }
  root.QV2_OPTION_PRICES = {};
  root.QV2_STAGES = [{"id":"prep","no":1,"name":"拆改与现场保护"},{"id":"mep","no":2,"name":"水电隐蔽"},{"id":"wp","no":3,"name":"防水"},{"id":"tile","no":4,"name":"泥水瓷砖 / 地面"},{"id":"ceil","no":5,"name":"天花墙面"},{"id":"custom","no":6,"name":"定制柜与门窗"},{"id":"equip","no":7,"name":"设备安装与收尾"},{"id":"outdoor","no":8,"name":"户外与外围工程"},{"id":"soft","no":9,"name":"软装"}];
  // ---------- 参考价（公司还没核定的项目先有个价，报价单和价目表都标「参考价」）----------
  // 来源：2025-2026 新山 / 马来西亚公开报价（Qanvast、RenovationKL、承包商报价、家具店）取中间偏下，含工含料卖价。公司核定后在价目表里改掉即可。
  const REF_ITEMS = {
    protect: 0.5, reno_permit: 1500, wardrobe: 95, shoe_cab: 100, tv_cab: 80, three_phase: 2500, main_pipe: 25, water_filter: 1800, sewer: 1500,
    garden_light: 150, downpipe: 18, laundry_cab: 90, sideboard: 95, headboard: 60, bookcase: 85, desk: 1200,
    hw_spice: 280, hw_corner: 1200, hw_tall: 1500, hw_lift: 900, hw_rack: 250, hw_bin: 250, hw_cutlery: 80, hw_rice: 280, hw_flap: 120,
    whw_pants: 220, whw_basket: 200, whw_lift: 450, whw_mirror: 350, whw_jewel: 280, whw_shoe: 200, whw_safe: 250,
    altar_cab: 120, shower_tray: 650, screen_l: 1500, screen_diamond: 2000, curtain_rod: 150, niche: 350, tile_border: 20,
    stair_wood: 300, stair_wood_land: 35, stair_stone: 220, stair_stone_land: 30, stair_paint: 60, stair_paint_area: 6,
    rail_glass: 280, rail_iron: 180, rail_wood: 250, rail_black: 150, rail_alu: 160, stair_steplight: 120, stair_steplight_sensor: 160,
    sunroom_wall: 45, termite: 1.2, roro_bin: 450, car_insurance: 600, ceil_slat: 28, ceil_alu: 12, ceil_curve: 25,
    sf_sofa: 3500, sf_coffee: 800, sf_side: 350, sf_rug: 600, sf_pendant: 600, sf_art: 250, sf_fan: 650, sf_dining: 3000, sf_bed: 3500,
    sf_night: 350, sf_dresser: 900, sf_bedding: 450, sf_lamp: 300, sf_desk: 1000, sf_shelf: 500, sf_outdoor: 1800, sf_umbrella: 600, sf_plant: 120,
    vanity_custom: 450
  };
  Object.entries(REF_ITEMS).forEach(([code, v]) => {
    const p = root.QV2_PRICE[code]; if (!p || !p.unpriced) return;
    Object.assign(p, { mat: 0, aux: 0, lab: v, waste: 0, ref: true }); delete p.unpriced;
  });
  // 选材参考价差：比标准规格贵（+）/便宜（−）百分之几，按当时的标准价算，所以标准价改了会跟着变。公司填了具体价差就用公司的。
  // 瓷砖尺寸不放参考价差：砖材按片价，大砖铺贴另有「大板铺贴加价」
  root.QV2_OPTION_REF = {
    'tile.woodGrade.加厚 8 mm': 20, 'tile.woodGrade.多层实木复合': 80,
    'wall.brand.Dulux': 5, 'wall.brand.Jotun': 10, 'wall.base.新墙满批': 60, 'wall.base.铲除旧漆重做': 100,
    'ceiling.board.普通石膏板': 0, 'ceiling.board.防潮石膏板': 10, 'ceiling.board.硅酸钙板': 25,
    'ceiling.slat.WPC 木塑格栅': 15, 'ceiling.slat.实木格栅': 60, 'ceiling.alu.300×600 mm': 5, 'ceiling.alu.条形扣板': 15,
    'cabinet.body.防潮颗粒板': -15, 'cabinet.body.铝合金': 25, 'cabinet.door.PET': 10, 'cabinet.door.烤漆': 30, 'cabinet.door.木皮': 40,
    'cabinet.hardware.Blum': 20, 'cabinet.hardware.Hettich': 15, 'cabinet.hardware.悍高（HIGOLD）': 8, 'cabinet.hardware.DTC（东泰）': 5, 'cabinet.light.感应灯带': 10,
    'cabinet.counter.岩板': 40, 'cabinet.counter.花岗岩': -10,
    'vanity.body.铝合金': 15, 'vanity.body.防潮多层实木板': 20, 'vanity.top.石英石台面 + 台下盆': 40, 'vanity.top.岩板台面 + 台下盆': 60, 'vanity.mirror.LED 智能镜': 150, 'vanity.mirror.镜柜': 120,
    'stairs.wood.柚木': 60, 'stairs.wood.橡木': 30, 'stairs.wood.实木复合': -20, 'stairs.stone.大理石': 40, 'stairs.stone.水磨石': 10,
    'stairs.paint.地坪漆': 20, 'stairs.paint.彩色水泥漆': 0, 'stairs.nosing.开防滑槽': 0, 'stairs.nosing.不做': -10,
    'canopy.roof.夹胶钢化玻璃': 80, 'canopy.roof.铝合金隔热板（三明治板）': 25, 'canopy.roof.金属浪板（Metal Deck）': -30, 'canopy.roof.铝合金百叶（可调）': 150,
    'canopy.frame.铝合金': 10, 'canopy.frame.不锈钢': 40, 'canopy.wall.铝合金折叠门': 20, 'canopy.wall.固定玻璃 + 部分推拉': 0, 'canopy.wall.无框玻璃': 30,
    'canopy.glass.8 mm 钢化透明': 10, 'canopy.glass.夹胶玻璃': 30, 'canopy.glass.隔热 Low-E 玻璃': 50, 'canopy.glass.茶色/灰色钢化玻璃': 5,
    'soft.grade.经济': -40, 'soft.grade.高档': 80,
    'shower.glass.10 mm 钢化透明': 20, 'shower.glass.8 mm 钢化磨砂': 10, 'shower.glass.8 mm 长虹玻璃': 15, 'shower.frame.哑黑': 10, 'shower.frame.枪灰': 10, 'shower.frame.拉丝金': 20,
    'lighting.grade.防眩筒灯+射灯': 30
  };
  // 瓷砖每片参考价（RM/片，卖价，不含铺贴）：新山建材店常见中档价，按普通亮面定基价，其他表面按系数加。公司填了片价就用公司的。
  root.QV2_TILE_PIECE_REF = (() => {
    const base = { '300×600 mm': 5.5, '600×600 mm': 11, '800×800 mm': 30, '600×1200 mm': 38, '750×1500 mm': 75, '1200×1200 mm': 110, '900×1800 mm': 120 };
    const k = { '普通亮面': 1, '亮光': 1.05, '哑光': 1, '柔光': 1.1, '防滑': 1.05, '质感': 1.15, '质感亮面': 1.2, '质感哑面': 1.2 };
    const out = {};
    Object.entries(base).forEach(([size, b]) => Object.entries(k).forEach(([f, x]) => { out[`tile.size.${size}.${f}`] = Math.round(b * x * 2) / 2; }));
    return out;
  })();
  if (typeof module !== "undefined") module.exports = { PRICE: root.QV2_PRICE, STAGES: root.QV2_STAGES, OPTION_PRICES: root.QV2_OPTION_PRICES, OPTION_REF: root.QV2_OPTION_REF, TILE_PIECE_REF: root.QV2_TILE_PIECE_REF };
})(typeof window !== "undefined" ? window : globalThis);
