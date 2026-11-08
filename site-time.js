/* Sets <html data-time> from Johor Bahru time so the inner pages share the homepage's day/night palette. */
(function () {
  function apply() {
    var d = new Date(), h = new Date(d.getTime() + d.getTimezoneOffset() * 6e4 + 8 * 36e5).getHours();
    document.documentElement.dataset.time = h >= 20 || h < 6 ? 'night' : h >= 17 ? 'evening' : h >= 11 ? 'afternoon' : 'morning';
  }
  apply(); setInterval(apply, 60000);
})();
