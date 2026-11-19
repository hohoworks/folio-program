// Resolve the language before the browser paints the published site name.
(() => {
  let locale = new URL(location.href).searchParams.get('lang');
  if (locale !== 'en' && locale !== 'ko') {
    try { locale = localStorage.getItem('folio-language'); } catch { /* Storage is optional. */ }
  }
  document.documentElement.lang = locale === 'en' ? 'en' : 'ko';
  if (locale !== 'en') return;
  const title = document.querySelector('title');
  const primaryName = title.textContent;
  const englishName = title.dataset.en;
  document.title = englishName || 'Portfolio';
  if (!englishName || englishName === primaryName) return;

  // The head runs before the link is parsed. Select its language before its first paint.
  const observer = new MutationObserver(() => {
    const link = document.querySelector('.wordmark');
    if (!link || link.textContent !== primaryName) return;
    observer.disconnect();
    link.dataset.ko = primaryName;
    link.textContent = englishName;
    link.lang = link.dataset.enLang;
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener('DOMContentLoaded', () => observer.disconnect(), { once: true });
})();
