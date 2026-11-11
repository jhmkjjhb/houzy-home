/* The inner pages use the homepage's five languages and its saved choice ('houzy-lang'),
   so a language picked on any page carries over to the others. site-chrome.js draws the picker. */
window.HOUZY_LANGS = [['en', 'English', 'EN'], ['zh-CN', '简体中文', '简'], ['zh-TW', '繁體中文', '繁'], ['ms', 'Bahasa Melayu', 'BM'], ['th', 'ไทย', 'ไทย']];
window.houzyLang = function () {
  var v;
  // 'houzy-partner-language' is the older inner-page key (zh/en only); read it once for visitors who set it before.
  try { v = localStorage.getItem('houzy-lang') || { zh: 'zh-CN', en: 'en' }[localStorage.getItem('houzy-partner-language')]; } catch (e) {}
  return HOUZY_LANGS.some(function (l) { return l[0] === v; }) ? v : 'en';
};
