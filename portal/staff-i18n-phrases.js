// 店员后台的界面文字翻译(补 STAFF_I18N 没覆盖到的硬编码中文)。
// 每项: 简体原文 → [繁体, English, Bahasa Melayu, ไทย]
// EXACT: 整段文字完全一致才替换(整句、带标点的句子)。
// WORDS: 纯中文词组,前后不能紧挨其他汉字,所以客户姓名等数据里的单个字不会被误换。
(function () {
  const EXACT = {
    '无滞销品（60 天内有动销）': ['無滯銷品（60 天內有動銷）', 'No slow-moving stock (all sold within 60 days)', 'Tiada stok lembap (semua terjual dalam 60 hari)', 'ไม่มีสินค้าค้างสต็อก (ขายได้ภายใน 60 วัน)'],
    '📦 库存滞销 TOP（60 天未动）': ['📦 庫存滯銷 TOP（60 天未動）', '📦 Slow-moving stock TOP (60 days idle)', '📦 Stok lembap TOP (60 hari tiada jualan)', '📦 สินค้าค้างสต็อก TOP (ไม่เคลื่อนไหว 60 วัน)'],
    '💰 本月收款（商品 + 整装）': ['💰 本月收款（商品 + 整裝）', '💰 Collected this month (goods + renovation)', '💰 Kutipan bulan ini (barangan + ubah suai)', '💰 ยอดรับเงินเดือนนี้ (สินค้า + รีโนเวท)'],
    '门店业绩暂时无法读取，请刷新重试。': ['門店業績暫時無法讀取，請刷新重試。', 'Store performance is unavailable right now. Please refresh and try again.', 'Prestasi kedai tidak dapat dibaca buat masa ini. Sila muat semula.', 'ไม่สามารถอ่านผลงานสาขาได้ในขณะนี้ กรุณารีเฟรชแล้วลองใหม่'],
  };
  const WORDS = {
    // 侧边栏
    '主面板': ['主面板', 'Main', 'Utama', 'หน้าหลัก'],
    '总览': ['總覽', 'Overview', 'Ringkasan', 'ภาพรวม'],
    '订单管理': ['訂單管理', 'Orders', 'Pesanan', 'คำสั่งซื้อ'],
    '新建订单': ['新建訂單', 'New Order', 'Pesanan Baru', 'สร้างคำสั่งซื้อ'],
    '客户管理': ['客戶管理', 'Customers', 'Pelanggan', 'ลูกค้า'],
    '需求雷达': ['需求雷達', 'Lead Radar', 'Radar Prospek', 'เรดาร์ลูกค้า'],
    '经营': ['經營', 'Business', 'Perniagaan', 'ธุรกิจ'],
    '商品价目': ['商品價目', 'Price List', 'Senarai Harga', 'ราคาสินค้า'],
    '合作设计师': ['合作設計師', 'Partner Designers', 'Pereka Rakan', 'นักออกแบบพันธมิตร'],
    '设计师对账': ['設計師對賬', 'Designer Settlement', 'Penyelesaian Pereka', 'กระทบยอดนักออกแบบ'],
    '经营报表': ['經營報表', 'Reports', 'Laporan', 'รายงาน'],
    '管理': ['管理', 'Admin', 'Pentadbiran', 'จัดการ'],
    '注册审核': ['註冊審核', 'Registrations', 'Pendaftaran', 'อนุมัติการสมัคร'],
    '用户管理': ['用戶管理', 'Users', 'Pengguna', 'ผู้ใช้'],
    '店员后台': ['店員後台', 'Staff Portal', 'Portal Kakitangan', 'ระบบพนักงาน'],
    '整装订单': ['整裝訂單', 'Renovation Orders', 'Pesanan Ubah Suai', 'งานรีโนเวท'],
    // 角色
    '店员': ['店員', 'Staff', 'Kakitangan', 'พนักงาน'],
    '仓库管理员': ['倉庫管理員', 'Warehouse', 'Gudang', 'คลังสินค้า'],
    '店长': ['店長', 'Store Manager', 'Pengurus Kedai', 'ผู้จัดการสาขา'],
    '区域负责人': ['區域負責人', 'Regional Manager', 'Pengurus Wilayah', 'ผู้จัดการภูมิภาค'],
    '总经理': ['總經理', 'General Manager', 'Pengurus Besar', 'ผู้จัดการทั่วไป'],
    '超级管理员': ['超級管理員', 'Super Admin', 'Pentadbir Super', 'ผู้ดูแลสูงสุด'],
    '管理员': ['管理員', 'Admin', 'Pentadbir', 'ผู้ดูแลระบบ'],
    // 总览
    '早安': ['早安', 'Good morning', 'Selamat pagi', 'สวัสดีตอนเช้า'],
    '午安': ['午安', 'Good afternoon', 'Selamat tengah hari', 'สวัสดีตอนกลางวัน'],
    '下午好': ['下午好', 'Good afternoon', 'Selamat petang', 'สวัสดีตอนบ่าย'],
    '晚上好': ['晚上好', 'Good evening', 'Selamat malam', 'สวัสดีตอนเย็น'],
    '我的订单': ['我的訂單', 'My orders', 'Pesanan saya', 'คำสั่งซื้อของฉัน'],
    '我的净收款': ['我的淨收款', 'My net collected', 'Kutipan bersih saya', 'รับสุทธิของฉัน'],
    '本店订单': ['本店訂單', 'Store orders', 'Pesanan kedai', 'คำสั่งซื้อสาขา'],
    '本店净收款': ['本店淨收款', 'Store net collected', 'Kutipan bersih kedai', 'รับสุทธิสาขา'],
    '本区域订单': ['本區域訂單', 'Region orders', 'Pesanan wilayah', 'คำสั่งซื้อภูมิภาค'],
    '本区域净收款': ['本區域淨收款', 'Region net collected', 'Kutipan bersih wilayah', 'รับสุทธิภูมิภาค'],
    '全公司订单': ['全公司訂單', 'Company orders', 'Pesanan syarikat', 'คำสั่งซื้อทั้งบริษัท'],
    '全公司净收款': ['全公司淨收款', 'Company net collected', 'Kutipan bersih syarikat', 'รับสุทธิทั้งบริษัท'],
    '我的': ['我的', 'My', 'Saya', 'ของฉัน'],
    '全公司': ['全公司', 'Company', 'Syarikat', 'ทั้งบริษัท'],
    '本区域': ['本區域', 'Region', 'Wilayah', 'ภูมิภาค'],
    '本店': ['本店', 'Store', 'Kedai', 'สาขา'],
    '本月': ['本月', 'This month', 'Bulan ini', 'เดือนนี้'],
    '本季': ['本季', 'This quarter', 'Suku ini', 'ไตรมาสนี้'],
    '本年': ['本年', 'This year', 'Tahun ini', 'ปีนี้'],
    '全部': ['全部', 'All', 'Semua', 'ทั้งหมด'],
    '范围': ['範圍', 'Scope', 'Skop', 'ขอบเขต'],
    '订单': ['訂單', 'Orders', 'Pesanan', 'คำสั่งซื้อ'],
    '进行中': ['進行中', 'In progress', 'Dalam proses', 'กำลังดำเนินการ'],
    '已完成': ['已完成', 'Completed', 'Selesai', 'เสร็จสิ้น'],
    '质保': ['質保', 'Warranty', 'Waranti', 'รับประกัน'],
    '读取中': ['讀取中', 'Loading', 'Memuatkan', 'กำลังโหลด'],
    '加载中': ['載入中', 'Loading', 'Memuatkan', 'กำลังโหลด'],
    '普通销售订单': ['普通銷售訂單', 'Sales order', 'Pesanan jualan', 'คำสั่งขาย'],
    '本月经营仪表板': ['本月經營儀表板', 'Monthly business dashboard', 'Papan pemuka perniagaan bulanan', 'แดชบอร์ดธุรกิจรายเดือน'],
    '加载月度仪表板': ['載入月度儀表板', 'Loading monthly dashboard', 'Memuatkan papan pemuka bulanan', 'กำลังโหลดแดชบอร์ดรายเดือน'],
    '对比上月': ['對比上月', 'vs last month', 'berbanding bulan lalu', 'เทียบเดือนก่อน'],
    '新增': ['新增', 'New', 'Baharu', 'ใหม่'],
    '持平': ['持平', 'Flat', 'Sama', 'คงที่'],
    '现金': ['現金', 'Cash', 'Tunai', 'เงินสด'],
    '银行转账': ['銀行轉賬', 'Bank transfer', 'Pindahan bank', 'โอนผ่านธนาคาร'],
    '信用卡': ['信用卡', 'Credit card', 'Kad kredit', 'บัตรเครดิต'],
    '转账': ['轉賬', 'Transfer', 'Pindahan', 'โอนเงิน'],
    '其他': ['其他', 'Other', 'Lain-lain', 'อื่นๆ'],
    '本月暂无收款': ['本月暫無收款', 'No payments this month', 'Tiada bayaran bulan ini', 'ยังไม่มีการรับเงินเดือนนี้'],
    '整装': ['整裝', 'Renovation', 'Ubah suai', 'รีโนเวท'],
    '橱柜': ['櫥櫃', 'Cabinets', 'Kabinet', 'ตู้ครัว'],
    '卫浴': ['衛浴', 'Bathroom', 'Bilik mandi', 'ห้องน้ำ'],
    '衣柜': ['衣櫃', 'Wardrobes', 'Almari', 'ตู้เสื้อผ้า'],
    '瓷砖': ['瓷磚', 'Tiles', 'Jubin', 'กระเบื้อง'],
    '地板': ['地板', 'Flooring', 'Lantai', 'พื้น'],
    '门窗': ['門窗', 'Doors & windows', 'Pintu & tingkap', 'ประตูหน้าต่าง'],
    '本月暂无品类数据': ['本月暫無品類數據', 'No category data this month', 'Tiada data kategori bulan ini', 'ยังไม่มีข้อมูลหมวดหมู่เดือนนี้'],
    '单': ['單', ' orders', ' pesanan', ' รายการ'],
    '本月暂无员工业绩': ['本月暫無員工業績', 'No staff sales this month', 'Tiada jualan kakitangan bulan ini', 'ยังไม่มียอดขายพนักงานเดือนนี้'],
    '商品订单': ['商品訂單', 'Goods orders', 'Pesanan barangan', 'คำสั่งซื้อสินค้า'],
    '订单数': ['訂單數', 'Orders', 'Pesanan', 'จำนวนคำสั่งซื้อ'],
    '含整装': ['含整裝', 'incl. renovation', 'termasuk ubah suai', 'รวมรีโนเวท'],
    '客户数': ['客戶數', 'Customers', 'Pelanggan', 'จำนวนลูกค้า'],
    '客单价': ['客單價', 'Avg. order value', 'Purata nilai pesanan', 'ยอดเฉลี่ยต่อคำสั่ง'],
    '客户': ['客戶', 'Customers', 'Pelanggan', 'ลูกค้า'],
    '品类销售占比': ['品類銷售佔比', 'Sales by category', 'Jualan mengikut kategori', 'สัดส่วนยอดขายตามหมวด'],
    '本月按': ['本月按', 'This month:', 'Bulan ini:', 'เดือนนี้:'],
    '分布': ['分佈', 'in total', 'jumlah', 'รวม'],
    '新客': ['新客', 'New', 'Baharu', 'ลูกค้าใหม่'],
    '复购': ['復購', 'Returning', 'Berulang', 'ลูกค้าเก่า'],
    '人': ['人', '', ' orang', ' คน'],
    '本月暂无客户': ['本月暫無客戶', 'No customers this month', 'Tiada pelanggan bulan ini', 'ยังไม่มีลูกค้าเดือนนี้'],
    '员工业绩': ['員工業績', 'Staff sales', 'Jualan kakitangan', 'ยอดขายพนักงาน'],
    '与上月对比': ['與上月對比', 'Compared with last month', 'Berbanding bulan lalu', 'เทียบกับเดือนก่อน'],
    '本月收款': ['本月收款', 'Collected this month', 'Kutipan bulan ini', 'รับเงินเดือนนี้'],
    '上月': ['上月', 'Last month', 'Bulan lalu', 'เดือนก่อน'],
    '本月订单': ['本月訂單', 'Orders this month', 'Pesanan bulan ini', 'คำสั่งซื้อเดือนนี้'],
    '本月客户': ['本月客戶', 'Customers this month', 'Pelanggan bulan ini', 'ลูกค้าเดือนนี้'],
    '查看全部': ['查看全部', 'View all', 'Lihat semua', 'ดูทั้งหมด'],
    '最近订单': ['最近訂單', 'Recent orders', 'Pesanan terkini', 'คำสั่งซื้อล่าสุด'],
    // 门店业绩
    '商品': ['商品', 'Goods', 'Barangan', 'สินค้า'],
    '其中历史已付标记': ['其中歷史已付標記', 'incl. legacy "paid" marks', 'termasuk tanda "dibayar" lama', 'รวมสถานะ "ชำระแล้ว" เดิม'],
    '正在汇总商品及整装收退款': ['正在匯總商品及整裝收退款', 'Totalling goods and renovation receipts and refunds', 'Menjumlahkan kutipan dan bayaran balik', 'กำลังรวมยอดรับและคืนเงิน'],
    '门店业绩净收款': ['門店業績淨收款', 'Store net collected', 'Kutipan bersih kedai', 'ยอดรับสุทธิของสาขา'],
    '商品净收款': ['商品淨收款', 'Goods net collected', 'Kutipan bersih barangan', 'ยอดรับสุทธิสินค้า'],
    '整装净收款': ['整裝淨收款', 'Renovation net collected', 'Kutipan bersih ubah suai', 'ยอดรับสุทธิรีโนเวท'],
    '商品金额中含历史': ['商品金額中含歷史', 'Goods amount includes legacy', 'Jumlah barangan termasuk', 'ยอดสินค้ารวมรายการเดิม'],
    '已付': ['已付', 'paid', 'dibayar', 'ชำระแล้ว'],
    '标记': ['標記', 'marks', 'tanda', 'สถานะ'],
    '尚未补录收款流水': ['尚未補錄收款流水', 'without payment records yet', 'belum ada rekod bayaran', 'ยังไม่ได้บันทึกการรับเงิน'],
    '按开单日期列示': ['按開單日期列示', 'listed by order date', 'disenarai ikut tarikh pesanan', 'แสดงตามวันที่เปิดบิล'],
    '补录后不再重复计入': ['補錄後不再重複計入', 'not double-counted once recorded', 'tidak dikira dua kali selepas direkod', 'ไม่นับซ้ำหลังบันทึก'],
    '待核对现金': ['待核對現金', 'Cash to verify', 'Tunai belum disahkan', 'เงินสดรอตรวจสอบ'],
    '未计入业绩': ['未計入業績', 'not counted', 'tidak dikira', 'ยังไม่นับยอด'],
    '已取消商品订单收款': ['已取消商品訂單收款', 'Payments on cancelled goods orders', 'Bayaran pesanan barangan dibatalkan', 'เงินรับของคำสั่งที่ยกเลิก'],
    '请核对是否已退款': ['請核對是否已退款', 'check whether refunded', 'semak sama ada sudah dipulangkan', 'ตรวจสอบว่าคืนเงินแล้วหรือไม่'],
    '包含原商品订单的历史': ['包含原商品訂單的歷史', 'Includes legacy goods orders', 'Termasuk pesanan barangan lama', 'รวมคำสั่งซื้อสินค้าเดิม'],
    '单独列示': ['單獨列示', 'shown separately', 'ditunjuk berasingan', 'แสดงแยก'],
    '门店': ['門店', 'Store', 'Kedai', 'สาขา'],
    '币种': ['幣種', 'Currency', 'Mata wang', 'สกุลเงิน'],
    '其中历史标记': ['其中歷史標記', 'incl. legacy marks', 'termasuk tanda lama', 'รวมสถานะเดิม'],
    '整装收款': ['整裝收款', 'Renovation received', 'Kutipan ubah suai', 'รับเงินรีโนเวท'],
    '整装退款': ['整裝退款', 'Renovation refunds', 'Bayaran balik ubah suai', 'คืนเงินรีโนเวท'],
    '合计净收款': ['合計淨收款', 'Total net collected', 'Jumlah kutipan bersih', 'รวมรับสุทธิ'],
    '已取消订单收款': ['已取消訂單收款', 'Cancelled-order payments', 'Bayaran pesanan dibatalkan', 'เงินรับคำสั่งที่ยกเลิก'],
    '待核对退款': ['待核對退款', 'Refunds to verify', 'Bayaran balik belum disahkan', 'คืนเงินรอตรวจสอบ'],
    '本期暂无业绩记录': ['本期暫無業績記錄', 'No sales recorded in this period', 'Tiada rekod jualan dalam tempoh ini', 'ยังไม่มียอดในช่วงนี้'],
    '按马来西亚日期统计已确认收款': ['按馬來西亞日期統計已確認收款', 'Confirmed payments by Malaysia date', 'Bayaran disahkan ikut tarikh Malaysia', 'รับเงินที่ยืนยันแล้วตามวันที่มาเลเซีย'],
    '退款扣减业绩': ['退款扣減業績', 'refunds are deducted', 'bayaran balik ditolak', 'หักยอดคืนเงิน'],
    '已取消商品订单的收款': ['已取消商品訂單的收款', 'payments on cancelled goods orders', 'bayaran pesanan barangan dibatalkan', 'เงินรับของคำสั่งที่ยกเลิก'],
    '合同付款计划及未签新增单不计入': ['合同付款計劃及未簽新增單不計入', 'payment schedules and unsigned additions are excluded', 'jadual bayaran dan tambahan belum ditandatangani tidak dikira', 'ไม่รวมแผนชำระและงานเพิ่มที่ยังไม่เซ็น'],
    '不同币种分开统计': ['不同幣種分開統計', 'currencies are counted separately', 'mata wang dikira berasingan', 'แยกตามสกุลเงิน'],
    '未做汇率换算': ['未做匯率換算', 'no exchange-rate conversion', 'tiada pertukaran kadar', 'ไม่แปลงอัตราแลกเปลี่ยน'],
    '税务与提成仍由各自报表核算': ['稅務與提成仍由各自報表核算', 'tax and commission stay in their own reports', 'cukai dan komisen dalam laporan masing-masing', 'ภาษีและค่าคอมมิชชันคิดในรายงานของตน'],
    '导出门店业绩': ['導出門店業績', 'Export store performance', 'Eksport prestasi kedai', 'ส่งออกผลงานสาขา'],
    '门店业绩': ['門店業績', 'Store performance', 'Prestasi kedai', 'ผลงานสาขา'],
  };

  const LANG_COL = { 'zh-TW': 0, en: 1, ms: 2, th: 3 };
  const CJK = '\\u4e00-\\u9fff';
  const wordKeys = Object.keys(WORDS).sort((a, b) => b.length - a.length);
  const wordRe = new RegExp(`(?<![${CJK}])(${wordKeys.join('|')})(?![${CJK}])`, 'g');
  const SKIP = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE']);
  const original = new WeakMap();
  let lang = 'zh-CN';

  function translate(text) {
    const col = LANG_COL[lang];
    if (col === undefined || !/[一-鿿]/.test(text)) return text;
    const trimmed = text.trim();
    if (EXACT[trimmed]) return text.replace(trimmed, EXACT[trimmed][col]);
    return text.replace(wordRe, w => WORDS[w][col]);
  }

  function skipped(el) {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      if (SKIP.has(e.tagName) || e.getAttribute('translate') === 'no' || e.isContentEditable) return true;
    }
    return false;
  }

  // 记住每段文字的中文原文;切回简体时还原,页面重新渲染时以新内容为原文
  const written = new WeakMap();

  function doText(node) {
    if (!node.parentElement || node.parentElement.tagName === 'TEXTAREA' || skipped(node.parentElement)) return;
    if (!original.has(node) || written.get(node) !== node.nodeValue) original.set(node, node.nodeValue);
    const next = translate(original.get(node));
    if (node.nodeValue !== next) node.nodeValue = next;
    written.set(node, next);
  }

  function doAttrs(el) {
    for (const attr of ['placeholder', 'title']) {
      if (!el.hasAttribute(attr)) continue;
      const key = 'i18nOrig' + attr, seen = 'i18nSeen' + attr;
      if (el.dataset[key] === undefined || el.dataset[seen] !== el.getAttribute(attr)) el.dataset[key] = el.getAttribute(attr);
      const next = translate(el.dataset[key]);
      if (el.getAttribute(attr) !== next) el.setAttribute(attr, next);
      el.dataset[seen] = next;
    }
  }

  function doNode(node) {
    if (node.nodeType === 3) return doText(node);
    if (node.nodeType !== 1 || skipped(node)) return;
    doAttrs(node);
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: n => n.nodeType === 1 && (SKIP.has(n.tagName) || n.getAttribute('translate') === 'no')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === 3) doText(n); else doAttrs(n);
    }
  }

  // 自己改的文字也会触发观察器,处理完立刻丢掉这些记录
  const observer = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'characterData') doText(r.target);
      else r.addedNodes.forEach(doNode);
    }
    observer.takeRecords();
  });

  window.StaffPhrases = {
    apply(next) {
      lang = next || 'zh-CN';
      doNode(document.body);
      observer.takeRecords();
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    },
    translate: text => translate(text),
  };
})();
