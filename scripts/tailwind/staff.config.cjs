// 员工后台（portal/staff.html）的样式：提前生成 portal/staff-tw.css，代替浏览器里现场生成样式的 cdn.tailwindcss.com。
// 改了 staff.html 里的样式名后重新生成：
//   npx tailwindcss@3.4.17 -c scripts/tailwind/staff.config.cjs -i scripts/tailwind/input.css -o portal/staff-tw.css --minify
module.exports = {
  content: [
    './portal/staff.html',
    './portal/staff-i18n-phrases.js',
    './portal/houzy-icons.js',
    './portal/order-pdf.js',
    './portal/order-pdf-company.js',
    './portal/renovation/store-performance.js',
    './portal/renovation/order-list.js',
  ],
  theme: { extend: { colors: { hg: '#153927', gg: '#245640', gd: '#c8a96e', gc: '#fbf8f1' } } },
};
