export function titleLanguage(text) {
  return /\p{Script=Hangul}/u.test(text) ? 'ko' : 'en';
}

let metrics;
let frame = 0;

function leftBearing(element) {
  const firstLetter = [...element.textContent.trimStart()][0];
  if (!firstLetter) return 0;
  const style = getComputedStyle(element);
  metrics.font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(' ');
  return metrics.measureText(firstLetter).actualBoundingBoxLeft || 0;
}

export function alignDetailTitle() {
  if (!metrics) {
    metrics = document.createElement('canvas').getContext('2d');
    if (!metrics) return;
    window.addEventListener('resize', alignDetailTitle, { passive: true });
    document.fonts?.addEventListener('loadingdone', alignDetailTitle);
  }
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const column = document.querySelector('#book-viewer:not([hidden]) .book-detail, #project-viewer:not([hidden]) .editorial-copy');
    if (!column) return;
    const title = column.querySelector('h1');
    const body = column.querySelector('.book-description, .editorial-description');
    const reference = body?.textContent.trim() ? body : column.querySelector('.work-tag');
    // Equal box origins still leave different ink insets for a large C and a small 비.
    const shift = leftBearing(title) - (reference ? leftBearing(reference) : 0);
    title.style.setProperty('--title-ink-shift', shift + 'px');
  });
}
