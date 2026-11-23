import { titleLanguage } from './title-language.js';
import { setBookMaterial, trimSize } from './book-material.js';

const hoverDelay = 105;
const revealDelay = 420;
export function createShelf(element, books, { addAssetImage, addCoverArt, select, reducedMotion }) {
  const links = new Map();
  let tallestCover = 1;
  let widestPaint = 1;
  let tallestPaint = 1;
  let preview;
  let previewStarted = -Infinity;
  let hoverTimer;
  let selectionTimer;
  let pointer;
  let hoverLink;
  let centerFrame = 0;
  let previousFrame = 0;
  let followPreview = true;
  let firstCenter = true;
  let viewportWidth = 0;

  function centerPreview() {
    if (followPreview && !centerFrame) centerFrame = requestAnimationFrame(alignPreview);
  }

  function fitRibbon() {
    const ribbon = preview?.querySelector('.book-ribbon');
    element.style.setProperty('--ribbon-clearance', (ribbon ? ribbon.offsetHeight + 2 : 0) + 'px');
  }

  function alignPreview(now) {
    centerFrame = 0;
    if (!preview || !element.clientWidth || !followPreview) return;
    fitRibbon();
    const parts = [...preview.querySelectorAll('.shelf-cover, .shelf-hardware, .shelf-leaves')]
      .map(part => part.getBoundingClientRect()).filter(bounds => bounds.width > 0);
    if (!parts.length) return;
    const left = Math.min(...parts.map(bounds => bounds.left));
    const right = Math.max(...parts.map(bounds => bounds.right));
    const viewport = element.getBoundingClientRect();
    const distance = (left + right - viewport.left - viewport.right) / 2;
    const elapsed = previousFrame ? Math.min(now - previousFrame, 32) : 16;
    const smooth = !firstCenter && canAnimate() && Math.abs(distance) > 2;
    const before = element.scrollLeft;
    const step = smooth ? Math.sign(distance) * Math.max(1, Math.abs(distance) * (1 - Math.exp(-elapsed / 75))) : distance;
    element.scrollLeft += step;
    firstCenter = false;
    previousFrame = now;
    if (smooth && element.scrollLeft !== before) centerPreview();
    else previousFrame = 0;
  }
  const sizeObserver = new ResizeObserver(() => {
    // A manual pan keeps its position until the user selects a book or resizes.
    if (element.clientWidth !== viewportWidth) {
      viewportWidth = element.clientWidth;
      followPreview = true;
    }
    centerPreview();
  });
  sizeObserver.observe(element);

  function showPreview(link) {
    followPreview = true;
    if (preview !== link) {
      preview?.classList.remove('is-preview');
      link.classList.add('is-preview');
      preview = link;
      previewStarted = performance.now();
      fitRibbon();
    }
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
    const [width, height] = trimSize(book);
    if (book.trimSizeMm || book.coverRatio) {
      link.setAttribute('data-proportional', '');
      link.style.setProperty('--trim-height-mm', height);
      link.style.setProperty('--shelf-book-ratio', width / height);
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
    if (link.hasAttribute('data-proportional')) {
      const profile = link.querySelector('.shelf-wire-spine')?.viewBox.baseVal;
      const paintRatio = Number(link.style.getPropertyValue('--shelf-paint-ratio')) || width / height;
      const paintHeight = Number(link.style.getPropertyValue('--shelf-painted-height')) || 1;
      tallestCover = Math.max(tallestCover, height);
      widestPaint = Math.max(widestPaint, height * paintRatio, profile?.width || 0);
      tallestPaint = Math.max(tallestPaint, height * paintHeight, profile?.height || 0);
    }

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
    if (!preview) {
      preview = link;
      link.classList.add('is-preview');
    }
    element.append(link);
    sizeObserver.observe(link);
    cover.addEventListener('transitionend', centerPreview);
    links.set(book.id, link);
  }

  // All measured books share one pixel-per-millimetre scale, including in a narrow gallery.
  element.style.setProperty('--tallest-cover-mm', tallestCover);
  element.style.setProperty('--widest-paint-mm', widestPaint);
  element.style.setProperty('--tallest-paint-mm', tallestPaint);
  fitRibbon();
  centerPreview();
  // Scrolling and opening books move links under a stationary pointer. Only
  // actual pointer movement should start a different preview.
  element.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || selectionTimer !== undefined) return;
    if (pointer && pointer.x === event.clientX && pointer.y === event.clientY) return;
    pointer = { x: event.clientX, y: event.clientY };
    const link = event.target.closest('.shelf-book');
    if (hoverLink === link) return;
    hoverLink = link;
    clearTimeout(hoverTimer);
    if (link && link !== preview) hoverTimer = setTimeout(() => showPreview(link), reducedMotion.matches ? 0 : hoverDelay);
  });
  element.addEventListener('pointerleave', () => {
    clearTimeout(hoverTimer);
    hoverLink = undefined;
    pointer = undefined;
  });
  function stopFollowing() {
    clearTimeout(hoverTimer);
    followPreview = false;
    previousFrame = 0;
  }
  element.addEventListener('wheel', stopFollowing, { passive: true });
  element.addEventListener('pointerdown', stopFollowing, { passive: true });
  return links;
}
