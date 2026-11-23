import { titleLanguage } from './title-language.js';
import { setBookMaterial } from './book-material.js';

const hoverDelay = 105;
const revealDelay = 295;
export function createShelf(element, books, { addAssetImage, addCoverArt, select, reducedMotion }) {
  const links = new Map();
  let preview;
  let previewStarted = -Infinity;
  let hoverTimer;
  let selectionTimer;
  let pointer;
  let centerFrame;

  function centerPreview() {
    cancelAnimationFrame(centerFrame);
    centerFrame = requestAnimationFrame(() => {
      if (!preview || !element.clientWidth) return;
      const parts = [...preview.querySelectorAll('.shelf-cover, .shelf-hardware, .shelf-leaves')]
        .map(part => part.getBoundingClientRect()).filter(bounds => bounds.width > 0);
      if (!parts.length) return;
      const left = Math.min(...parts.map(bounds => bounds.left));
      const right = Math.max(...parts.map(bounds => bounds.right));
      const viewport = element.getBoundingClientRect();
      element.scrollLeft += (left + right - viewport.left - viewport.right) / 2;
    });
  }
  const sizeObserver = new ResizeObserver(centerPreview);
  sizeObserver.observe(element);

  function showPreview(link) {
    if (preview === link) return;
    preview?.classList.remove('is-preview');
    link.classList.add('is-preview');
    preview = link;
    previewStarted = performance.now();
    centerPreview();
  }

  function canAnimate() {
    return !reducedMotion.matches && typeof element.animate === 'function';
  }

  function openBook(book, cover) {
    if (element.closest('[hidden]')) return;
    select(book, canAnimate() ? cover.getBoundingClientRect() : null);
  }

  for (const book of books) {
    const link = document.createElement('a');
    const spine = document.createElement('span');
    const cover = document.createElement('span');
    link.className = 'shelf-book';
    link.dataset.book = book.id;
    link.dataset.binding = book.bindingType ?? 'paperback';
    link.href = '#book/' + book.id;
    link.setAttribute('aria-label', book.title);
    link.lang = titleLanguage(book.title);
    if (book.coverRatio) {
      link.setAttribute('data-proportional', '');
      link.style.setProperty('--shelf-book-ratio', book.trimSizeMm ? book.trimSizeMm[0] / book.trimSizeMm[1] : book.coverRatio);
    }
    link.toggleAttribute('data-uploaded', !!book.coverImages);
    spine.className = 'shelf-spine';
    if (book.coverImages?.spine) {
      spine.classList.add('artwork');
      addAssetImage(spine, book.coverImages.spine);
    } else {
      spine.textContent = book.title;
    }
    spine.setAttribute('aria-hidden', 'true');
    cover.className = 'shelf-cover cover-art';
    cover.setAttribute('aria-hidden', 'true');
    addCoverArt(cover, book);
    link.append(spine, cover);
    setBookMaterial(link, book, cover);

    link.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'touch' || selectionTimer !== undefined) return;
      const samePoint = pointer?.x === event.clientX && pointer?.y === event.clientY;
      pointer = { x: event.clientX, y: event.clientY };
      if (samePoint) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => showPreview(link), reducedMotion.matches ? 0 : hoverDelay);
    });
    link.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
    link.addEventListener('focus', () => {
      clearTimeout(hoverTimer);
      showPreview(link);
    });
    link.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      clearTimeout(hoverTimer);
      clearTimeout(selectionTimer);
      selectionTimer = undefined;
      showPreview(link);
      const wait = canAnimate() ? Math.max(0, revealDelay - (performance.now() - previewStarted)) : 0;
      if (!wait) {
        openBook(book, cover);
      } else {
        selectionTimer = setTimeout(() => {
          selectionTimer = undefined;
          openBook(book, cover);
        }, wait);
      }
    });
    element.append(link);
    sizeObserver.observe(link);
    cover.addEventListener('transitionend', centerPreview);
    links.set(book.id, link);
  }

  if (element.firstElementChild) {
    showPreview(element.firstElementChild);
    previewStarted = -Infinity;
  }
  element.addEventListener('pointerleave', () => {
    clearTimeout(hoverTimer);
    pointer = undefined;
  });
  return links;
}
