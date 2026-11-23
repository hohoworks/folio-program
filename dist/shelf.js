import { titleLanguage } from './title-language.js';
import { setBookMaterial, trimSize } from './book-material.js';

const hoverDelay = 135;
const turnDuration = 460;
export function createShelf(element, books, { addAssetImage, addCoverArt, select, onPreview, reducedMotion }) {
  const links = new Map();
  let tallestCover = 1;
  let widestPaint = 1;
  let tallestPaint = 1;
  let preview;
  let previewStarted = -Infinity;
  let hoverTimer;
  let pressed;
  let hoverAnchor;
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
      preview?.removeAttribute('aria-current');
      link.classList.add('is-preview');
      link.setAttribute('aria-current', 'true');
      preview = link;
      previewStarted = performance.now();
      fitRibbon();
      onPreview(link.dataset.book);
    }
    centerPreview();
  }

  function canAnimate() {
    return !reducedMotion.matches && typeof element.animate === 'function';
  }

  function resetHover() {
    clearTimeout(hoverTimer);
    hoverLink = undefined;
    hoverAnchor = undefined;
    pointer = undefined;
  }

  function activate(link, open) {
    if (!link || element.closest('[hidden]')) return;
    resetHover();
    showPreview(link);
    if (open) {
      const book = books[Number(link.dataset.shelfIndex)];
      const cover = link.querySelector('.shelf-cover');
      select(book, canAnimate() ? cover.getBoundingClientRect() : null);
    }
  }

  // Divide gaps by distance to the painted books. Paper-thin spines can be
  // selected from either side without enlarging them or covering a neighbour.
  function hitBook(x, y, slop) {
    let nearest;
    let distance = slop;
    for (const link of links.values()) {
      const r = link.getBoundingClientRect();
      if (y < r.top - 2 || y > r.bottom + 2) continue;
      const d = Math.max(r.left - x, x - r.right, 0);
      if (d === 0) return link;
      if (d <= distance) { distance = d; nearest = link; }
    }
    return nearest;
  }

  function holdsPointer(x, y) {
    const turning = performance.now() - previewStarted < turnDuration + 180;
    return hoverAnchor && Math.hypot(x - hoverAnchor.x, y - hoverAnchor.y) < (turning ? 10 : 4);
  }

  for (const [index, book] of books.entries()) {
    const link = document.createElement('a');
    const spine = document.createElement('span');
    const cover = document.createElement('span');
    link.className = 'shelf-book';
    link.dataset.book = book.id;
    link.dataset.shelfIndex = index;
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
      // Pointer focus happens between down and up. A book must not move away
      // before that gesture has actually selected it.
      if (pressed && !pressed.released) return;
      resetHover();
      showPreview(link);
    });
    if (!preview) {
      preview = link;
      link.classList.add('is-preview');
      link.setAttribute('aria-current', 'true');
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
  if (preview) onPreview(preview.dataset.book);

  element.addEventListener('pointermove', event => {
    const x = event.clientX, y = event.clientY;
    if (pressed && !pressed.released && event.pointerType === 'mouse' && !event.buttons) pressed = undefined;
    if (pressed && !pressed.released) {
      if (Math.hypot(x - pressed.x, y - pressed.y) > 8) pressed.dragged = true;
      return;
    }
    if (event.pointerType === 'touch' || event.buttons) return;
    if (pointer && pointer.x === x && pointer.y === y) return;
    pointer = { x, y };
    if (holdsPointer(x, y)) return;
    hoverAnchor = undefined;
    const link = hitBook(x, y, 8);
    if (hoverLink === link) return;
    clearTimeout(hoverTimer);
    hoverLink = link;
    if (link && link !== preview) hoverTimer = setTimeout(() => {
      hoverAnchor = { ...pointer, automatic: true };
      showPreview(link);
    }, hoverDelay);
  });
  element.addEventListener('pointerleave', resetHover);
  element.addEventListener('pointerdown', event => {
    const touch = event.pointerType === 'touch';
    const hit = hitBook(event.clientX, event.clientY, touch ? 16 : 8);
    // The original spine may already have slid away from a stationary pointer.
    // Keep its identity even if a neighbour now sits underneath.
    const held = !touch && holdsPointer(event.clientX, event.clientY);
    const link = held ? preview : hit;
    const unfolding = held && hoverAnchor.automatic && (hit !== preview || performance.now() - previewStarted < turnDuration);
    pressed = { id: event.pointerId, link, open: link === preview && !unfolding, x: event.clientX, y: event.clientY };
    resetHover();
    followPreview = false;
    previousFrame = 0;
  });
  window.addEventListener('pointerup', event => {
    if (pressed?.id === event.pointerId) pressed.released = true;
  });
  element.addEventListener('pointercancel', () => { pressed = undefined; });
  element.addEventListener('click', event => {
    const start = event.detail ? pressed : undefined;
    pressed = undefined;
    if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const link = start ? start.link : event.target.closest('.shelf-book');
    if (!link && !start) return;
    event.preventDefault();
    if (start?.dragged) return;
    activate(link, start ? start.open : true);
    if (start && !start.open && event.pointerType !== 'touch') {
      pointer = hoverAnchor = { x: start.x, y: start.y };
    }
  });
  element.addEventListener('wheel', () => {
    resetHover();
    if (pressed) pressed.dragged = true;
    followPreview = false;
    previousFrame = 0;
  }, { passive: true });
  return {
    links,
    pick(id) { const link = links.get(id); activate(link, link === preview); },
    step(direction) { const link = direction < 0 ? preview?.previousElementSibling : preview?.nextElementSibling; activate(link, false); },
  };
}
