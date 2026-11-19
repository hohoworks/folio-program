// Resolve the language before the browser paints the published site name.
(() => {
  let locale = new URL(location.href).searchParams.get('lang');
  if (locale !== 'en' && locale !== 'ko') {
    try { locale = localStorage.getItem('folio-language'); } catch { /* Storage is optional. */ }
  }
  document.documentElement.lang = locale === 'en' ? 'en' : 'ko';
  if (locale === 'en') {
    document.title = document.querySelector('title').dataset.en || 'Portfolio';
  }
})();
