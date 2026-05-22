/* houzy-icons.js — HOUZY 线性图标集(Lucide 风格,1.8 描边,currentColor)
   用法:给元素加 data-hz-icon="dashboard",DOMContentLoaded 后自动注入 SVG。 */
(function(){
  var P='stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"';
  window.HZ_ICONS={
    dashboard:'<svg viewBox="0 0 24 24" '+P+'><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>',
    orders:'<svg viewBox="0 0 24 24" '+P+'><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12h6M9 16h6"/></svg>',
    create:'<svg viewBox="0 0 24 24" '+P+'><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/></svg>',
    customers:'<svg viewBox="0 0 24 24" '+P+'><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    pricing:'<svg viewBox="0 0 24 24" '+P+'><path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1.3"/></svg>',
    designers:'<svg viewBox="0 0 24 24" '+P+'><circle cx="13.5" cy="6.5" r=".6"/><circle cx="17.5" cy="10.5" r=".6"/><circle cx="8.5" cy="7.5" r=".6"/><circle cx="6.5" cy="12.5" r=".6"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1a1.6 1.6 0 0 1 1.6-1.6h2c3 0 5.6-2.5 5.6-5.6C22 6 17.5 2 12 2z"/></svg>',
    settle:'<svg viewBox="0 0 24 24" '+P+'><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="5" rx="1"/><rect x="13" y="8" width="3" height="9" rx="1"/></svg>',
    registrations:'<svg viewBox="0 0 24 24" '+P+'><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="m9 14 2 2 4-4"/></svg>',
    users:'<svg viewBox="0 0 24 24" '+P+'><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>',
    logout:'<svg viewBox="0 0 24 24" '+P+'><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    search:'<svg viewBox="0 0 24 24" '+P+'><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    bell:'<svg viewBox="0 0 24 24" '+P+'><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
    plus:'<svg viewBox="0 0 24 24" '+P+'><path d="M12 5v14M5 12h14"/></svg>',
    box:'<svg viewBox="0 0 24 24" '+P+'><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>',
    truck:'<svg viewBox="0 0 24 24" '+P+'><path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/><path d="M14 9h4l3 3v5a1 1 0 0 1-1 1h-1"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
    factory:'<svg viewBox="0 0 24 24" '+P+'><path d="M2 20h20M4 20V9l5 4V9l5 4V9l5 4v7"/></svg>',
  };
  function inject(){
    var els=document.querySelectorAll('[data-hz-icon]');
    for(var i=0;i<els.length;i++){
      var el=els[i], k=el.getAttribute('data-hz-icon');
      if(window.HZ_ICONS[k] && !el.querySelector('svg.hz-ic')){
        el.insertAdjacentHTML('afterbegin', window.HZ_ICONS[k].replace('<svg ','<svg class="hz-ic" '));
      }
    }
  }
  window.hzInjectIcons=inject;
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',inject);
  else inject();
})();
