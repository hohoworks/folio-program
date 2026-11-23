import { loadCatalog, readerSpreads, trimSize } from './catalog.js';
import { setBookMaterial, mockupViews } from './book-material.js';
import { createCurl, createCardTurn } from './curl.js';
import { cardFaces, cardThumbnail, leafGeometry, physicalSpreads } from './book-format.js';
import { createMobileReader } from './mobile-reader.js';
import { addReaderWire } from './book-surfaces.js';
import { createShelf } from './shelf.js';
import { titleLanguage, alignDetailTitle } from './title-language.js';
import { DEFAULT_SITE_TITLE, localizedSiteTitles } from './site-title.js';
import { projectVideoPlayer } from './project-media.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const orbit = $('orbit');
const model = $('book-model');
const modelFrame = $('model-frame');
const modelShadow = stage.querySelector('.model-shadow');
const container = $('current-page');
const pageArea = $('page-area');
const previousButton = $('prev');
const nextButton = $('next');
const positionDisplay = $('position');
const jumpForm = $('page-jump');
const jumpInput = $('page-number');
const pageError = $('page-error');
const cardSide = document.createElement('select');
cardSide.id = 'card-side';
for (const value of ['front', 'back']) cardSide.add(new Option('', value));
jumpInput.after(cardSide);
cardSide.hidden = true;
const readButton = $('read-book');
const resumeButton = $('resume-book');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const shelf = $('shelf');
const library = $('library');
const viewer = $('book-viewer');
const heading = $('book-title');
const libraryBack = $('library-back');
const bookIndex = $('book-index');
const description = $('book-description');
const metadata = $('book-metadata');
const projectViewer = $('project-viewer');
const projectsView = $('projects');
const projectList = $('project-list');
const aboutView = $('about');
const contactView = $('contact');
const mobile = createMobileReader(document.querySelector('.reader-window'), updateNavigation);
const initialRotation = mockupViews.spine;
const languageStorageKey = 'folio-language';
const messages = {
  ko: {
    home: '홈', menu: '주 메뉴', read: '읽기', startOver: '처음부터 읽기', pageNumber: '이동할 쪽수', jump: '이동', cover: '표지',
    previous: '← 이전', next: '다음 →', previousPage: '이전 쪽', nextPage: '다음 쪽',
    previousSpread: '이전 펼침면', nextSpread: '다음 펼침면', backCover: '표지로 돌아가기',
    backShelf: '← 책장', backProject: '← 목록으로 돌아가기', viewer: '책 뷰어', coverView: '3D 표지',
    bookNavigation: '책 탐색', projectNavigation: '작업 탐색', contact: '연락처', email: '이메일', instagram: '인스타그램',
    emptyProjects: '아직 공개된 작업이 없습니다.', emptyBooks: '아직 공개된 책이 없습니다.',
    unavailable: '목록을 불러올 수 없습니다. 새로고침해 주세요.',
    emptyContact: '연락처가 아직 등록되지 않았습니다.',
    about: '소개', project: '작업', bookshelf: '책장', category: '분류', year: '연도', all: '전체',
    noMatches: '조건에 맞는 작업이 없습니다.', workTags: '분류와 연도',
    video: '영상', website: '웹사이트', openWebsite: '새 창에서 열기',
  },
  en: {
    home: 'Home', menu: 'Main navigation', read: 'Read', startOver: 'Read from the start', pageNumber: 'Page number', jump: 'Go', cover: 'Cover',
    previous: '← Previous', next: 'Next →', previousPage: 'Previous page', nextPage: 'Next page',
    previousSpread: 'Previous spread', nextSpread: 'Next spread', backCover: 'Back to cover',
    backShelf: '← Book shelf', backProject: '← Back to projects', viewer: 'Book viewer', coverView: '3D cover',
    bookNavigation: 'Book navigation', projectNavigation: 'Project navigation', contact: 'Contact', email: 'Email', instagram: 'Instagram',
    emptyProjects: 'No published projects yet.', emptyBooks: 'No published books yet.',
    unavailable: 'The collection could not be loaded. Please refresh the page.',
    emptyContact: 'Contact details have not been added yet.',
    about: 'About', project: 'Project', bookshelf: 'Book shelf', category: 'Category', year: 'Year', all: 'All',
    noMatches: 'No projects match these filters.', workTags: 'Categories and year',
    video: 'Video', website: 'Website', openWebsite: 'Open in a new tab',
  },
};
let locale = document.documentElement.lang;

function t(key) {
  return messages[locale][key];
}

function translated(value, fallback) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function itemCopy(entry) {
  const en = locale === 'en' ? entry.translations?.en : undefined;
  const paragraphs = en?.description?.filter(line => line.trim());
  return {
    title: translated(en?.title, entry.title),
    category: translated(en?.category, entry.category),
    language: translated(en?.language, entry.language),
    description: paragraphs?.length ? paragraphs : entry.description,
  };
}

function isCards() { return activeBook?.bookForm === 'cards'; }

function cardLabel(face) {
  const number = Math.ceil(face / 2);
  return locale === 'en' ? 'Card ' + number + (face % 2 ? ' front' : ' back') : number + '번 카드 ' + (face % 2 ? '앞면' : '뒷면');
}

function pageLabel(index) {
  if (isCards()) return cardLabel(Number(index));
  return locale === 'en' ? 'Page ' + index : index + '쪽';
}

function scanLabel(index) {
  const blank = pages[index - 1]?.blank;
  return pageLabel(index) + (blank ? (locale === 'en' ? ', blank' : ', 빈 면') : '');
}

function pageCount(count) {
  return locale === 'en' ? count + (count === 1 ? ' page' : ' pages') : count + '쪽';
}

let activeBook;
let activeRoute;
let pages = [];
let spreads = [];
let geometry;
let rememberedPage = 0;

let position = 0;
let spread;
let rotation = { ...initialRotation };
let orbitGesture;
let coverArrival;
let turn;
let gesture;

function appendText(parent, tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function assetURL(path) {
  return new URL(path, import.meta.url).href;
}

function addAssetImage(parent, path, { lazy = false, alt = '', fallback } = {}) {
  const image = document.createElement('img');
  image.className = 'asset-image';
  if (fallback && fallback !== path) {
    image.addEventListener('error', () => { image.src = assetURL(fallback); }, { once: true });
  }
  image.alt = alt;
  image.draggable = false;
  if (lazy) image.loading = 'lazy';
  image.src = assetURL(path);
  parent.append(image);
  return image;
}

function preloadSpread(index) {
  const pair = spreads[index - 1];
  if (!activeBook.coverImages || !pair) return;
  for (const page of [pair.left, pair.right]) {
    if (!page) continue;
    for (const src of scanImages(pages[page - 1])) {
      const image = new Image();
      image.fetchPriority = 'low';
      image.src = assetURL(src);
    }
  }
}

function scanImages(page) {
  if (!page?.imageSrc) return [];
  return page.rightImageSrc ? [page.imageSrc, page.rightImageSrc] : [page.imageSrc];
}

let primedBook;
function prepareFirstSpread() {
  if (!activeBook?.coverImages || primedBook === activeBook || navigator.connection?.saveData) return;
  primedBook = activeBook;
  preloadSpread(1);
}

function createPage(index) {
  const data = pages[index - 1];
  if (!data) {
    const blank = document.createElement('div');
    blank.className = 'paper';
    blank.setAttribute('aria-hidden', 'true');
    return blank;
  }
  const page = document.createElement('article');
  page.tabIndex = -1;
  page.dataset.page = index;
  if (activeBook.coverImages) {
    page.className = 'paper paper-scan';
    page.setAttribute('aria-label', scanLabel(index));
    if (data.rightImageSrc) page.classList.add('joined-scan');
    for (const src of scanImages(data)) addAssetImage(page, src);
    return page;
  }
  page.className = 'paper ' + (data.image ? 'photo' : 'text');
  page.lang = 'en';
  page.setAttribute('aria-label', `Page ${index}, ${data.title}`);

  if (data.image) {
    const figure = document.createElement('figure');
    const image = document.createElement('img');
    image.src = assetURL(data.imageSrc ?? activeBook.image);
    image.alt = 'Evergreen ridges fading into early morning fog';
    image.style.objectPosition = data.imagePosition ?? 'center';
    image.draggable = false;
    figure.append(image);
    if (data.caption) appendText(figure, 'figcaption', 'paper-caption', data.caption);
    page.append(figure);
  }

  const body = document.createElement('div');
  body.className = 'paper-body';
  appendText(body, 'p', 'paper-eyebrow', data.eyebrow);
  appendText(body, 'h2', '', data.title);
  if (data.subtitle) appendText(body, 'p', 'paper-subtitle', data.subtitle);
  if (data.paragraphs.length) {
    const prose = document.createElement('div');
    prose.className = 'paper-prose';
    for (const paragraph of data.paragraphs) appendText(prose, 'p', '', paragraph);
    body.append(prose);
  }
  if (data.quote) appendText(body, 'blockquote', '', data.quote);
  page.append(body);
  appendText(page, 'span', 'paper-number', String(index).padStart(2, '0')).setAttribute('aria-hidden', 'true');
  return page;
}

function formatPage(index) {
  return String(index).padStart(2, '0');
}

function spreadLabel(index) {
  const { left, right } = spreads[index - 1];
  return left && right ? `${formatPage(left)}–${formatPage(right)}` : formatPage(left || right);
}

function applyLeafSize(element, leaf) {
  element.style.setProperty('--leaf-width', (50 * leaf.width / geometry.width) + '%');
  element.style.setProperty('--leaf-height', (100 * leaf.height / geometry.height) + '%');
  element.style.setProperty('--leaf-top', (100 * leaf.top / geometry.height) + '%');
}

function pageStack(side, face) {
  const first = createPage(face);
  first.classList.add('paper-' + side);
  if (!face) return { first, layers: [] };
  applyLeafSize(first, geometry.leaves[Math.ceil(face / 2) - 1]);
  const layers = [first];
  const step = side === 'right' ? 2 : -2;
  // Every sheet touches the spine. Skip entirely hidden faces, keeping the
  // actual scans on exposed steps even when leaf widths and heights alternate.
  const visible = [geometry.leaves[Math.ceil(face / 2) - 1]];
  for (let next = face + step; next >= 1 && next <= pages.length; next += step) {
    const leaf = geometry.leaves[Math.ceil(next / 2) - 1];
    if (visible.some(above => above.width >= leaf.width && above.top <= leaf.top &&
        above.top + above.height >= leaf.top + leaf.height)) continue;
    const under = createPage(next);
    under.classList.add('paper-' + side, 'under-leaf');
    under.inert = true;
    under.setAttribute('aria-hidden', 'true');
    under.removeAttribute('tabindex');
    applyLeafSize(under, leaf);
    layers.push(under);
    visible.push(leaf);
  }
  layers.reverse();
  return { first, layers };
}

function createSpread(index) {
  const element = document.createElement('div');
  const pair = spreads[index - 1];
  let left, right;
  if (isCards()) {
    left = createPage(pair.left);
    left.classList.add('card-face');
    element.append(left);
  } else if (geometry) {
    const leftStack = pageStack('left', pair.left);
    const rightStack = pageStack('right', pair.right);
    left = leftStack.first;
    right = rightStack.first;
    element.append(...leftStack.layers, ...rightStack.layers);
  } else {
    left = createPage(pair.left);
    right = createPage(pair.right);
    left.classList.add('paper-left');
    right.classList.add('paper-right');
    element.append(left, right);
  }
  element.className = 'spread';
  element.tabIndex = -1;
  element.setAttribute('role', 'group');
  element.dataset.first = pair.left || pair.right;
  element.dataset.spreadIndex = index;
  element.setAttribute('aria-label', pageLabel(spreadLabel(index)));
  addReaderWire(element, activeBook, pair, geometry);
  return { element, left, right };
}

function targetFor(direction) {
  if (direction !== -1 && direction !== 1) return -1;
  return position + direction;
}

function clearTurn() {
  if (!turn) return;
  mobile.stopFollowing();
  turn.curl.remove();
  turn.preview?.element.remove();
  for (const page of turn.covered) page.style.opacity = '';
  stage.removeAttribute('data-turning');
  turn = undefined;
}

function canPan(direction) {
  if (isCards() || !mobile.active || position === 0) return false;
  const pair = spreads[position - 1];
  return Boolean(pair.left && pair.right) && (direction === 1 ? mobile.pageSide === 'left' : mobile.pageSide === 'right');
}

function firstVisibleSide(index, forward) {
  const pair = spreads[index - 1];
  if (!pair || !pair.right) return 'left';
  if (!pair.left) return 'right';
  return forward ? 'left' : 'right';
}

function bookmarkKey(book) {
  return 'hoho-reader:' + book.id;
}

function readBookmark(book) {
  if (book.resumeReadingEnabled === false) return 0;
  try {
    const saved = JSON.parse(localStorage.getItem(bookmarkKey(book)));
    const leaf = pages[saved?.page - 1];
    if (Number.isInteger(saved?.page) && leaf && saved.total === pages.length &&
        (saved.form ?? 'bound') === (book.bookForm ?? 'bound') &&
        saved.image === leaf.imageSrc && saved.rightImage === leaf.rightImageSrc &&
        (book.bookForm !== 'cards' || saved.cardFront === pages[2 * Math.floor((saved.page - 1) / 2)]?.imageSrc)) return saved.page;
  } catch { /* Reading works when storage is unavailable. */ }
  return 0;
}

function rememberLeaf() {
  if (!position || activeBook.resumeReadingEnabled === false) return;
  const page = spreads[position - 1][mobile.pageSide];
  if (rememberedPage === page) return;
  rememberedPage = page;
  const leaf = pages[page - 1];
  try {
    localStorage.setItem(bookmarkKey(activeBook), JSON.stringify({
      page, total: pages.length, image: leaf.imageSrc, rightImage: leaf.rightImageSrc, form: activeBook.bookForm ?? 'bound',
      ...(isCards() && { cardFront: pages[2 * Math.floor((page - 1) / 2)].imageSrc }),
    }));
  } catch { /* Keep the reading position for this visit. */ }
}

function updateNavigation() {
  if (!activeBook) return;
  const cover = position === 0;
  const firstPage = position === 1 && !canPan(-1);
  const cards = isCards();
  previousButton.hidden = cover;
  previousButton.textContent = firstPage ? '← ' + t('cover') : t('previous');
  previousButton.setAttribute('aria-label', firstPage ? t('backCover') : cards ? (locale === 'en' ? 'Previous card face' : '이전 카드 면') : t(mobile.active ? 'previousPage' : 'previousSpread'));
  nextButton.disabled = !cover && !canPan(1) && targetFor(1) > spreads.length;
  nextButton.textContent = t('next');
  nextButton.setAttribute('aria-label', cards ? (locale === 'en' ? 'Next card face' : '다음 카드 면') : t(mobile.active ? 'nextPage' : 'nextSpread'));
  let label = t('cover');
  if (!cover) label = cards ? cardLabel(position) : mobile.active ? formatPage(spreads[position - 1][mobile.pageSide]) : spreadLabel(position);
  positionDisplay.firstElementChild.textContent = label;
  const editable = !cover && activeBook.pageJumpEnabled !== false;
  positionDisplay.classList.toggle('sr-only', editable);
  jumpForm.hidden = !editable;
  cardSide.hidden = !cards;
  const total = cards ? pages.length / 2 : pages.length;
  positionDisplay.lastElementChild.textContent = '/ ' + total;
  $('page-total').textContent = '/ ' + total;
  jumpInput.labels[0].textContent = cards ? (locale === 'en' ? 'Card number' : '이동할 카드 번호') : t('pageNumber');
  if (cards) {
    cardSide.setAttribute('aria-label', locale === 'en' ? 'Card face' : '카드 면');
    cardSide.options[0].textContent = locale === 'en' ? 'Front' : '앞면';
    cardSide.options[1].textContent = locale === 'en' ? 'Back' : '뒷면';
    if (!cover) cardSide.value = position % 2 ? 'front' : 'back';
  }
  if (editable && document.activeElement !== jumpInput) jumpInput.value = cards ? String(Math.ceil(position / 2)) : formatPage(spreads[position - 1][mobile.pageSide]);
  if (cover) {
    resumeButton.hidden = rememberedPage < 2;
    resumeButton.textContent = cards ? (locale === 'en' ? 'Resume at ' + cardLabel(rememberedPage) : cardLabel(rememberedPage) + '부터 이어 읽기') : locale === 'en' ? 'Resume at page ' + rememberedPage : rememberedPage + '쪽부터 이어 읽기';
    readButton.firstChild.textContent = t(resumeButton.hidden ? 'read' : 'startOver') + ' ';
  }
  $('turn-prev').hidden = cover;
  $('turn-next').hidden = nextButton.disabled;
}

function syncReaderViewport() {
  const viewport = window.visualViewport;
  if (!viewport || viewer.hidden || viewer.dataset.mode !== 'read') return;
  const zoomed = viewport.scale > 1.01;
  pageArea.toggleAttribute('data-zoomed', zoomed);
  // Keep the page and its controls above the phone keyboard, including while it closes.
  if (!zoomed && viewport.height < window.innerHeight - 1) {
    viewer.style.setProperty('--reader-viewport-height', viewport.height + 'px');
  } else if (!zoomed) {
    viewer.style.removeProperty('--reader-viewport-height');
  }
}
window.visualViewport?.addEventListener('resize', syncReaderViewport);

function goTo(index, { focus = false, side } = {}) {
  clearTurn();
  gesture = undefined;
  if (!Number.isInteger(index) || index < 0 || index > spreads.length) return;
  if (index === position && !side) return;
  clearJumpError();
  stopCoverArrival();
  const active = document.activeElement;
  const focusPage = focus || container.contains(active);
  const arrivingSide = side ?? firstVisibleSide(index, index >= position || !mobile.active);
  const changedSpread = index !== position;
  position = index;
  const cover = index === 0;

  stage.dataset.mode = viewer.dataset.mode = cover ? 'cover' : 'read';
  $('cover-view').hidden = !cover;
  $('reading-view').hidden = cover;
  if (cover) viewer.style.removeProperty('--reader-viewport-height');
  else syncReaderViewport();

  if (changedSpread) {
    spread = cover ? undefined : createSpread(index);
    container.replaceChildren(...(spread ? [spread.element] : []));
    if (!cover) {
      preloadSpread(index + 1);
      preloadSpread(index - 1);
    }
  }
  mobile.move(arrivingSide, { animate: false });
  rememberLeaf();
  if (side) jumpInput.value = isCards() ? String(Math.ceil(index / 2)) : formatPage(spreads[index - 1][side]);
  updateNavigation();
  if (focusPage || (cover && active === previousButton) || (nextButton.disabled && active === nextButton)) {
    (cover ? orbit : spread.element).focus({ preventScroll: true });
  }
}

function coverLeaf() {
  const front = model.querySelector('.front').cloneNode(true);
  front.classList.remove('face', 'front');
  front.classList.add('paper', 'cover-leaf');
  front.dataset.book = activeBook.id;
  return front;
}

function startTurn(index, corner = .86, opening = false) {
  const forward = opening || index > position;
  const cover = opening || index === 0;
  const preview = cover ? null : createSpread(index);
  const focus = container.contains(document.activeElement);
  if (isCards()) {
    const curl = createCardTurn(spread.left, preview?.left, container, {
      direction: forward ? 1 : -1,
      flip: Math.ceil(index / 2) === Math.ceil(position / 2),
    });
    const covered = [spread.left];
    spread.left.style.opacity = '0';
    turn = { index, forward, opening, covered, curl, corner, progress: 0, offsetY: 0, focus };
    stage.dataset.turning = '';
    return turn;
  }
  const lower = forward ? spread : preview;
  const higher = forward ? preview : spread;
  const front = cover ? coverLeaf() : lower.right;
  const back = cover ? spread.left : higher.left;
  const covered = cover ? [spread.left] : [lower.right, higher.left];

  if (preview) {
    preview.element.inert = true;
    preview.element.setAttribute('aria-hidden', 'true');
    container.prepend(preview.element);
  }
  for (const page of covered) page.style.opacity = '0';
  const turningFace = spreads[(forward ? position : index) - 1]?.right;
  const physicalLeaf = geometry?.leaves[Math.ceil(turningFace / 2) - 1];
  const curl = createCurl(front, back, container, { cover, physicalLeaf, geometry });
  turn = { index, forward, opening, preview, covered, curl, corner, progress: 0, offsetY: 0, focus };
  stage.dataset.turning = '';
  return turn;
}

function drawTurn(current, progress, offsetY = current.offsetY) {
  current.progress = progress;
  current.offsetY = offsetY;
  current.curl.draw(isCards() || current.forward ? progress : 1 - progress, current.corner, offsetY);
}

function easeInOut(progress) {
  return progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}

function settleTurn(current, commit) {
  const from = current.progress;
  const to = commit ? 1 : 0;
  const arrivingSide = commit && !isCards() && mobile.active && !current.opening && current.index > 0
    ? firstVisibleSide(current.index, current.forward)
    : null;
  const duration = (current.opening ? 800 : 640) * Math.max(arrivingSide ? .57 : .37, Math.abs(to - from));
  const cameraStart = from >= .5 ? 0 : .46;
  let started;

  function frame(time) {
    if (turn !== current) return;
    started ??= time;
    const elapsed = Math.min(1, (time - started) / duration);
    drawTurn(current, from + (to - from) * easeInOut(elapsed));
    if (arrivingSide && elapsed >= cameraStart) {
      mobile.follow(arrivingSide, easeInOut((elapsed - cameraStart) / (1 - cameraStart)));
    }
    if (elapsed < 1) {
      requestAnimationFrame(frame);
    } else if (commit && !current.opening) {
      if (arrivingSide && mobile.active) mobile.move(arrivingSide, { animate: false });
      goTo(current.index, { focus: current.focus });
    } else {
      clearTurn();
      if (current.focus && spread) spread.element.focus({ preventScroll: true });
    }
  }
  requestAnimationFrame(frame);
}

function openBook(index) {
  goTo(index, { focus: true });
  if (reducedMotion.matches || isCards() || geometry) return;
  const current = startTurn(index, .82, true);
  drawTurn(current, 0);
  settleTurn(current, true);
}

function step(direction) {
  if (!activeBook || turn || mobile.moving) return;
  if (canPan(direction)) {
    const moveFocus = document.activeElement === nextButton;
    mobile.move(direction === 1 ? 'right' : 'left');
    clearJumpError();
    rememberLeaf();
    updateNavigation();
    if (moveFocus && nextButton.disabled) spread.element.focus({ preventScroll: true });
    return;
  }
  const index = targetFor(direction);
  if (index < 0 || index > spreads.length) return;
  if (position === 0) {
    openBook(index);
  } else if (reducedMotion.matches || ((isCards() || geometry) && index === 0)) {
    goTo(index);
  } else {
    const current = startTurn(index);
    drawTurn(current, 0);
    settleTurn(current, true);
  }
}

function clearJumpError() {
  pageError.textContent = '';
  jumpInput.removeAttribute('aria-invalid');
  jumpInput.setAttribute('aria-describedby', 'page-total');
}

function jumpToPage(page) {
  const index = spreads.findIndex(pair => pair.left === page || pair.right === page);
  if (index < 0) return;
  const side = spreads[index].right === page ? 'right' : 'left';
  goTo(index + 1, { side, focus: true });
}

jumpForm.addEventListener('submit', event => {
  event.preventDefault();
  if (jumpForm.hidden) return;
  const value = jumpInput.value.trim().replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xFF10));
  const page = Number(value);
  const total = isCards() ? pages.length / 2 : pages.length;
  if (!/^\d+$/.test(value) || page < 1 || page > total) {
    pageError.textContent = locale === 'en' ? 'Enter a page from 1 to ' + pages.length + '.' : '1부터 ' + pages.length + ' 사이의 쪽수를 입력하세요.';
    if (isCards()) pageError.textContent = locale === 'en' ? 'Enter a card number from 1 to ' + total + '.' : '1부터 ' + total + ' 사이의 카드 번호를 입력하세요.';
    jumpInput.setAttribute('aria-invalid', 'true');
    jumpInput.setAttribute('aria-describedby', 'page-total page-error');
    jumpInput.focus();
    jumpInput.select();
    return;
  }
  jumpToPage(isCards() ? 2 * page - (cardSide.value === 'front' ? 1 : 0) : page);
});
jumpInput.addEventListener('focus', () => jumpInput.select());
jumpInput.addEventListener('input', clearJumpError);
resumeButton.addEventListener('click', () => jumpToPage(rememberedPage));
readButton.addEventListener('pointerenter', prepareFirstSpread);
readButton.addEventListener('focus', prepareFirstSpread);
readButton.addEventListener('click', () => step(1));
previousButton.addEventListener('click', () => step(-1));
nextButton.addEventListener('click', () => step(1));

// Place the contact shadow under the lowest projected corner as the book turns.
function positionBookShadow() {
  const width = model.offsetWidth;
  const height = model.offsetHeight;
  if (!width || !height) return;
  const depth = Math.max(1.5, Math.min(80, width * (Number(model.style.getPropertyValue('--spine-ratio')) || .025)));
  const matrix = new DOMMatrix().rotateAxisAngle(1, 0, 0, rotation.x)
    .rotateAxisAngle(0, 1, 0, rotation.y).rotateAxisAngle(0, 0, 1, -5);
  const corners = [];
  for (const x of [-width / 2, width / 2]) {
    for (const y of [-height / 2, height / 2]) {
      for (const z of [-depth / 2, depth / 2]) {
        const point = matrix.transformPoint({ x, y, z });
        const perspective = 1300 / (1300 - point.z);
        corners.push({ x: point.x * perspective, y: point.y * perspective });
      }
    }
  }
  corners.sort((a, b) => b.y - a.y);
  const lowest = corners[0];
  const touching = corners.filter(point => lowest.y - point.y < 1.5);
  const contactX = touching.reduce((sum, point) => sum + point.x, 0) / touching.length;
  const screenX = corners.map(point => point.x);
  modelShadow.style.setProperty('--contact-x', contactX + 'px');
  modelShadow.style.setProperty('--contact-y', lowest.y + 'px');
  modelShadow.style.setProperty('--footprint', (Math.max(...screenX) - Math.min(...screenX)) + 'px');
}

new ResizeObserver(positionBookShadow).observe(model);

function setRotation(x, y) {
  rotation = { x: Math.min(77, Math.max(-77, x)), y };
  model.style.setProperty('--rx', `${rotation.x}deg`);
  model.style.setProperty('--ry', `${rotation.y}deg`);
  const pitch = rotation.x * Math.PI / 180;
  const yaw = rotation.y * Math.PI / 180;
  const light = .6 * Math.cos(yaw) * Math.cos(pitch) - .5 * Math.sin(yaw);
  model.style.setProperty('--front-shade', Math.max(0, (.55 - light) * .12));
  model.style.setProperty('--back-shade', Math.max(0, (.55 + light) * .12));
  positionBookShadow();
}

orbit.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || orbitGesture) return;
  orbitGesture = { id: event.pointerId, ...rotation, startX: event.clientX, startY: event.clientY };
  orbit.setPointerCapture(event.pointerId);
  orbit.classList.add('dragging');
});
orbit.addEventListener('pointermove', (event) => {
  if (orbitGesture?.id !== event.pointerId) return;
  setRotation(
    orbitGesture.x - (event.clientY - orbitGesture.startY) * .36,
    orbitGesture.y + (event.clientX - orbitGesture.startX) * .55,
  );
});
orbit.addEventListener('lostpointercapture', (event) => {
  if (orbitGesture?.id !== event.pointerId) return;
  orbitGesture = undefined;
  orbit.classList.remove('dragging');
});

orbit.addEventListener('keydown', (event) => {
  const directions = { ArrowLeft: [0, -15], ArrowRight: [0, 15], ArrowUp: [-12, 0], ArrowDown: [12, 0] };
  const movement = directions[event.key];
  if (!movement) return;
  event.preventDefault();
  setRotation(rotation.x + movement[0], rotation.y + movement[1]);
});

pageArea.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'touch' && !event.isPrimary && gesture) {
    // Release a partial drag when a second finger begins a pinch.
    gesture = undefined;
    clearTurn();
  }
  if (event.pointerType === 'touch' && pageArea.hasAttribute('data-zoomed')) return;
  if (turn || gesture || mobile.moving || !event.isPrimary || event.button !== 0) return;
  const box = pageArea.getBoundingClientRect();
  const edge = event.target.closest('.drag-zone');
  if (event.pointerType === 'mouse' && !edge && !mobile.active && !isCards() && !geometry) return;
  const direction = edge && !mobile.active ? Number(edge.dataset.direction) : 0;
  gesture = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    width: isCards() ? box.width : box.width / 2,
    corner: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    direction,
    started: performance.now(),
  };
  pageArea.setPointerCapture(event.pointerId);
});

pageArea.addEventListener('pointermove', (event) => {
  if (gesture?.id !== event.pointerId) return;
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  if (!gesture.direction) {
    if (Math.abs(dx) < 9 || Math.abs(dx) < Math.abs(dy)) return;
    gesture.direction = dx < 0 ? 1 : -1;
  }
  if (canPan(gesture.direction)) return;
  const index = targetFor(gesture.direction);
  if (index < 0 || index > spreads.length || reducedMotion.matches || (index === 0 && (geometry || isCards()))) return;
  const pull = -dx * gesture.direction;
  if (!turn && pull < 2) return;
  if (!turn) startTurn(index, gesture.corner);
  const distance = Math.max(0, Math.min(1.9, pull / gesture.width));
  const progress = Math.acos(1 - distance) / Math.PI;
  drawTurn(turn, progress, dy);
});

function endGesture(event, canceled) {
  if (gesture?.id !== event.pointerId) return;
  const current = gesture;
  gesture = undefined;
  const dx = event.clientX - current.x;
  const dy = event.clientY - current.y;
  const distance = -dx * current.direction;
  const fast = performance.now() - current.started < 260;
  const commit = !canceled && (distance > current.width * .26 || (fast && distance > 38 && distance > Math.abs(dy)));
  if (turn) settleTurn(turn, commit);
  else if (commit) step(current.direction);
}

pageArea.addEventListener('pointerup', (event) => endGesture(event, false));
pageArea.addEventListener('lostpointercapture', (event) => endGesture(event, true));

document.addEventListener('keydown', (event) => {
  if (!activeBook || event.defaultPrevented) return;
  if (event.target === jumpInput || event.target === cardSide) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    step(event.key === 'ArrowRight' ? 1 : -1);
  }
});
document.addEventListener('contextmenu', event => event.preventDefault());

function addCoverArt(cover, book, imageSrc = book.coverImages?.front) {
  cover.replaceChildren();
  cover.classList.toggle('artwork', !!book.coverImages);
  if (book.coverImages) {
    addAssetImage(cover, imageSrc, { fallback: book.coverImages.front });
    return;
  }
  if (book.id === 'quiet-hours') appendText(cover, 'span', 'cover-top', 'THE');
  const lines = book.coverTitle;
  const title = appendText(cover, 'span', 'cover-display', '');
  title.lang = titleLanguage(lines.join(' '));
  title.style.setProperty('--cover-lines', lines.length);
  if (title.lang === 'ko') {
    const maxLineLength = Math.max(lines.length * 2, ...lines.map(line => [...line.normalize('NFC')].length));
    title.style.setProperty('--cover-title-length', maxLineLength);
  }
  lines.forEach((line, index) => {
    appendText(title, index ? 'i' : 'span', '', line);
  });
  appendText(cover, 'span', 'cover-sub', book.coverLabel);
  appendText(cover, 'span', 'cover-bottom', DEFAULT_SITE_TITLE);
}

function addCardThumbnail(parent, book, lazy = false) {
  const { mode, src } = cardThumbnail(book);
  const layers = mode === 'deck' ? Math.min(3, Math.ceil(book.pages.length / 2) - 1) : 0;
  const [width, height] = trimSize(book);
  const radius = Math.min(book.cardStock?.cornerRadiusMm ?? 0, width / 2, height / 2);
  const stack = appendText(parent, 'span', 'card-thumbnail', '');
  stack.dataset.mode = mode;
  stack.style.setProperty('--shown-layers', layers);
  stack.style.setProperty('--card-radius', (100 * radius / width) + '% / ' + (100 * radius / height) + '%');
  stack.style.setProperty('--card-edge', book.cardStock?.layers?.at(-1) ?? book.paperColor ?? '#efede5');
  stack.setAttribute('aria-hidden', 'true');
  for (let layer = layers; layer >= 0; layer--) {
    const sheet = appendText(stack, 'span', 'card-thumbnail-sheet', '');
    sheet.style.setProperty('--layer', layer);
    if (!layer) {
      const image = addAssetImage(sheet, src, { lazy, fallback: book.coverImages.front });
      image.decoding = 'async';
    }
  }
}

function addShelfThumbnail(cover, book) {
  if (book.bookForm === 'cards') addCardThumbnail(cover, book);
  else addCoverArt(cover, book, book.thumbnailSrc);
}

function stopCoverArrival() {
  coverArrival?.cancel();
  coverArrival = undefined;
  stage.removeAttribute('data-arriving');
}

function animateCoverArrival(source) {
  if (!source?.height || source.right <= 0 || source.left >= innerWidth || source.bottom <= 0 || source.top >= innerHeight) return;
  const target = model.getBoundingClientRect();
  const deltaX = source.x + source.width / 2 - (target.x + target.width / 2);
  const deltaY = source.y + source.height / 2 - (target.y + target.height / 2);
  const scale = source.height / target.height;
  stage.setAttribute('data-arriving', '');
  const animation = modelFrame.animate([
    { transform: `translate(${deltaX}px, ${deltaY}px) scale(${scale})` },
    { transform: 'translate(0, 0) scale(1)' },
  ], { duration: 920, easing: 'cubic-bezier(.22,.67,.22,1)' });
  coverArrival = animation;
  animation.onfinish = () => {
    if (coverArrival === animation) stopCoverArrival();
  };
}

const { books, entries, site, unavailable } = await loadCatalog();
const wordmark = document.querySelector('.wordmark');
const publishedTitle = wordmark.dataset.ko || wordmark.querySelector('[data-wordmark-locale="ko"]')?.textContent
  || wordmark.textContent || DEFAULT_SITE_TITLE;
const siteTitles = unavailable ? {
  ko: publishedTitle,
  en: document.querySelector('title').dataset.en || publishedTitle,
} : localizedSiteTitles(site);
const projectMenu = $('project-menu');
const projectCards = new Map();
if (new URL(location.href).searchParams.has('sort')) {
  const url = new URL(location.href);
  url.searchParams.delete('sort');
  history.replaceState(history.state, '', url);
}
const compareYears = new Intl.Collator('en', { numeric: true }).compare;
const archiveYears = [...new Set(entries.map(entry => entry.year).filter(Boolean))]
  .sort((a, b) => compareYears(b, a));
if (locale === 'en' && !new URL(location.href).searchParams.has('lang')) {
  const url = new URL(location.href);
  url.searchParams.set('lang', locale);
  history.replaceState(history.state, '', url);
}
let bookLinks;
const indexLinks = new Map();

function setShelfLabels(book, title) {
  const indexLink = indexLinks.get(book.id);
  indexLink.setAttribute('aria-label', title);
  indexLink.title = title;
  indexLink.lang = titleLanguage(title);
  indexLink.querySelector('.index-title').textContent = title;
  const shelfLink = bookLinks.get(book.id);
  shelfLink.setAttribute('aria-label', title);
  shelfLink.lang = titleLanguage(title);
  shelfLink.querySelector('.shelf-spine').lang = titleLanguage(book.title);
}

function renderShelf() {
  if (bookLinks) return;
  bookLinks = createShelf(shelf, books, {
    addAssetImage,
    addCoverArt: addShelfThumbnail,
    reducedMotion,
    select(book, source) {
      enterBook(book, '#bookshelf', source);
    },
  });
  const indexSizes = books.map(trimSize);
  bookIndex.style.setProperty('--tallest-cover-mm', Math.max(1, ...indexSizes.map(size => size[1])));
  bookIndex.style.setProperty('--widest-cover-mm', Math.max(1, ...indexSizes.map(size => size[0])));
  for (const book of books) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = '#book/' + book.id;
    link.className = 'index-link';
    link.dataset.book = book.id;
    const [width, height] = trimSize(book);
    link.style.setProperty('--trim-width-mm', width);
    link.style.setProperty('--index-cover-ratio', width + ' / ' + height);
    link.addEventListener('click', event => {
      if (!plainClick(event)) return;
      event.preventDefault();
      bookLinks.get(book.id).click();
    });
    const jacket = appendText(link, 'span', 'index-jacket cover-art', '');
    jacket.setAttribute('aria-hidden', 'true');
    addShelfThumbnail(jacket, book);
    appendText(link, 'span', 'index-title', '');
    indexLinks.set(book.id, link);
    setShelfLabels(book, itemCopy(book).title);
    item.append(link);
    bookIndex.append(item);
  }
}

function plainClick(event) {
  return !event.defaultPrevented && event.button === 0
    && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

function tagLabel(tag) {
  return locale === 'en' ? tag.en : tag.ko;
}

function archiveState(url = new URL(location.href)) {
  const tag = url.searchParams.get('tag') || '';
  const year = url.searchParams.get('year') || '';
  return {
    tag: site.projectTags.some(item => item.id === tag) ? tag : '',
    year: archiveYears.includes(year) ? year : '',
  };
}

function archiveURL(changes = {}, origin = location.href) {
  const url = new URL(origin, location.href);
  const state = { ...archiveState(url), ...changes };
  for (const key of ['tag', 'year']) {
    if (state[key]) url.searchParams.set(key, state[key]);
    else url.searchParams.delete(key);
  }
  url.searchParams.delete('sort');
  url.searchParams.set('lang', locale);
  url.hash = '#project';
  return url;
}

function relativeURL(url) {
  return url.pathname + url.search + url.hash;
}

function entryURL(entry) {
  const url = archiveURL();
  url.hash = (entry.type === 'book' ? '#book/' : '#project/') + entry.id;
  return relativeURL(url);
}

function archiveReturn(value) {
  try {
    const url = new URL(value || '#project', location.href);
    if (url.origin === location.origin && url.pathname === location.pathname && url.hash === '#project') {
      return relativeURL(archiveURL({}, url));
    }
  } catch {
    // A direct detail link returns to the current archive selection.
  }
  return relativeURL(archiveURL());
}

function updateReturnLinks() {
  projectMenu.href = relativeURL(archiveURL({ tag: '', year: '' }));
  wordmark.href = projectMenu.href;
  $('project-back').href = archiveReturn(history.state?.folioReturn);
  $('project-back').textContent = t('backProject');
  let returnTo = '#bookshelf';
  try {
    const url = new URL(history.state?.folioReturn || '#bookshelf', location.href);
    if (url.origin === location.origin && url.pathname === location.pathname && url.hash === '#project') {
      returnTo = archiveReturn(history.state.folioReturn);
    }
  } catch {
    // Directly opened books return to the shelf.
  }
  libraryBack.href = returnTo;
  libraryBack.textContent = returnTo === '#bookshelf' ? t('backShelf') : t('backProject');
}

function changeArchive(changes) {
  const stayInArchive = routeFromHash().page === 'project';
  history.pushState({}, '', archiveURL(changes));
  showRoute(!stayInArchive);
}

function workTags(parent, entry) {
  parent.replaceChildren();
  parent.setAttribute('aria-label', t('workTags'));
  for (const tag of site.projectTags.filter(item => entry.tagIds.includes(item.id))) {
    const id = tag.id;
    const link = appendText(parent, 'a', 'work-tag', tagLabel(tag));
    link.dataset.tag = id;
    link.href = archiveURL({ tag: id, year: '' });
    link.addEventListener('click', event => {
      if (!plainClick(event)) return;
      event.preventDefault();
      changeArchive({ tag: id, year: '' });
    });
  }
  if (entry.year) {
    const link = appendText(parent, 'a', 'work-tag', entry.year);
    link.dataset.year = entry.year;
    link.setAttribute('aria-label', t('year') + ' ' + entry.year);
    link.href = archiveURL({ tag: '', year: entry.year });
    link.addEventListener('click', event => {
      if (!plainClick(event)) return;
      event.preventDefault();
      changeArchive({ tag: '', year: entry.year });
    });
  }
  parent.hidden = !parent.children.length;
}

function filteredArchive(state) {
  return entries.filter(entry => (!state.tag || entry.tagIds.includes(state.tag)) && (!state.year || entry.year === state.year));
}

function updateArchiveControls() {
  const state = archiveState();
  $('project-category-label').textContent = t('category');
  for (const option of $('project-category').options) {
    const tag = site.projectTags.find(item => item.id === option.value);
    option.textContent = tag ? tagLabel(tag) : t('all');
  }
  $('project-category').value = state.tag;
  $('project-year-label').textContent = t('year');
  $('project-year').firstElementChild.textContent = t('all');
  $('project-year').value = state.year;

}

function renderProjectIndex() {
  const visible = filteredArchive(archiveState());
  const cards = visible.map((entry, index) => {
    if (!projectCards.has(entry.id)) projectCards.set(entry.id, createProjectCard(entry, index));
    const card = projectCards.get(entry.id);
    card.href = entryURL(entry);
    return card;
  });
  projectList.replaceChildren(...cards);
  $('projects-empty').hidden = visible.length > 0;
  $('projects-empty').textContent = unavailable ? t('unavailable') : t(entries.length ? 'noMatches' : 'emptyProjects');
  $('project-status').textContent = locale === 'en'
    ? visible.length + (visible.length === 1 ? ' project' : ' projects')
    : visible.length + '개 작업';
  updateArchiveControls();
}

for (const id of ['', ...site.projectTags.map(tag => tag.id)]) {
  const option = appendText($('project-category'), 'option', '', '');
  option.value = id;
}
$('project-category').disabled = !site.projectTags.length;
$('project-category').addEventListener('change', event => changeArchive({ tag: event.target.value }));
for (const value of ['', ...archiveYears]) {
  const option = appendText($('project-year'), 'option', '', value);
  option.value = value;
}
$('project-year').disabled = !archiveYears.length;
$('project-year').addEventListener('change', event => changeArchive({ year: event.target.value }));

for (const link of [$('project-back'), libraryBack]) {
  link.addEventListener('click', event => {
    if (!plainClick(event)) return;
    event.preventDefault();
    history.pushState({}, '', link.href);
    showRoute(true);
  });
}
function showAllProjects(event) {
  if (!plainClick(event)) return;
  event.preventDefault();
  const url = archiveURL({ tag: '', year: '' });
  if (url.href !== location.href) history.pushState({}, '', url);
  showRoute(true);
  window.scrollTo(0, 0);
}
projectMenu.addEventListener('click', showAllProjects);
wordmark.addEventListener('click', showAllProjects);

function enterBook(book, returnTo, source) {
  history.pushState({ folioReturn: returnTo }, '', '#book/' + book.id);
  showRoute(true);
  if (!reducedMotion.matches) animateCoverArrival(source);
}

function labelProjectPlayer(figure, item, index, title) {
  const provider = figure.dataset.videoProvider;
  const label = item.alt || title + ' · ' + (provider || t(item.type === 'video' ? 'video' : 'website')) + ' ' + (index + 1);
  if (item.type === 'video') {
    figure.querySelector('video').setAttribute('aria-label', label);
  } else {
    figure.querySelector('iframe').title = label;
    const link = figure.querySelector('a');
    const action = provider ? (locale === 'en' ? 'Watch on ' + provider : provider + '에서 보기') : t('openWebsite');
    link.textContent = action + ' ↗';
    link.setAttribute('aria-label', label + ' · ' + action);
  }
}

function addProjectPlayer(figure, item, index, title) {
  figure.dataset.playerIndex = index;
  if (item.ratio) figure.style.setProperty('--media-ratio', item.ratio);
  if (item.type === 'video') {
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = index === 0 ? 'metadata' : 'none';
    video.src = assetURL(item.videoSrc);
    figure.append(video);
  } else {
    const player = projectVideoPlayer(item.url);
    const frame = document.createElement('iframe');
    if (player) {
      figure.dataset.videoProvider = player.provider;
      frame.sandbox.add('allow-presentation');
      frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
    }
    frame.sandbox.add('allow-scripts');
    // Cross-origin apps may load modules and fetch their own resources.
    if (new URL(item.url).origin !== location.origin) frame.sandbox.add('allow-same-origin');
    frame.allowFullscreen = true;
    frame.loading = 'lazy';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.src = player?.src || item.url;
    figure.append(frame);
    const caption = document.createElement('figcaption');
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    caption.append(link);
    figure.append(caption);
  }
  labelProjectPlayer(figure, item, index, title);
}

function portfolioRow(entry) {
  const content = itemCopy(entry);
  const row = document.createElement('article');
  row.className = 'editorial-row portfolio-entry';
  row.dataset.entry = entry.id;
  const pictures = appendText(row, 'div', 'editorial-images', '');
  if (entry.type === 'book' && !entry.coverImages) {
    const cover = appendText(pictures, 'div', 'editorial-cover cover-art', '');
    cover.dataset.book = entry.id;
    cover.setAttribute('aria-label', content.title + ' ' + t('cover'));
    addCoverArt(cover, entry);
  }
  const media = entry.type === 'book'
    ? [...(entry.coverImages ? [{ imageSrc: entry.coverImages.front, alt: content.title + ' ' + t('cover') }] : []), ...(entry.galleryImages ?? [])]
    : entry.media ?? entry.images;
  for (const [index, item] of media.entries()) {
    const figure = document.createElement('figure');
    if (item.type === 'video' || item.type === 'embed') {
      addProjectPlayer(figure, item, index, content.title);
    } else {
      const image = addAssetImage(figure, item.imageSrc, { lazy: index > 0, alt: item.alt });
      if (entry.type === 'book' && entry.coverImages && index === 0) image.setAttribute('data-cover-alt', '');
    }
    pictures.append(figure);
  }
  const information = appendText(row, 'div', 'editorial-information', '');
  const copy = appendText(information, 'div', 'editorial-copy', '');
  const title = appendText(copy, 'h1', '', content.title);
  title.lang = titleLanguage(content.title);
  title.id = 'project-title';
  title.tabIndex = -1;
  workTags(appendText(copy, 'nav', 'work-tags', ''), entry);
  appendText(copy, 'p', 'editorial-metadata', content.category).lang = titleLanguage(content.category);
  appendText(copy, 'div', 'editorial-description', content.description.join('\n\n')).lang = titleLanguage(content.description.join(' '));
  if (entry.type === 'book') {
    const read = appendText(copy, 'a', 'read-book project-read', t('read') + ' →');
    read.href = '#book/' + entry.id;
    read.addEventListener('click', event => {
      if (!plainClick(event)) return;
      event.preventDefault();
      enterBook(entry, '#project/' + entry.id);
    });
  }
  return row;
}

function createProjectCard(entry, index) {
  const content = itemCopy(entry);
  const link = document.createElement('a');
  link.className = 'project-card';
  link.href = entryURL(entry);
  link.dataset.entry = entry.id;
  link.setAttribute('aria-label', content.title);
  link.lang = titleLanguage(content.title);
  const picture = appendText(link, 'span', 'project-visual', '');
  const isBook = entry.type === 'book';
  const firstImage = entry.images?.[0];
  const isCardBook = entry.bookForm === 'cards';
  const [trimWidth, trimHeight] = isCardBook ? trimSize(entry) : [0, 0];
  const ratio = isCardBook ? trimWidth / trimHeight : isBook ? entry.coverRatio : firstImage?.ratio;
  // Printed books use their trim width. Other formats share a similar visual area.
  function sizePreview(aspect) {
    const widthFactor = isBook ? trimSize(entry)[0] / 220 : Math.sqrt(aspect);
    link.style.setProperty('--project-ratio', aspect);
    link.style.setProperty('--preview-width-factor', widthFactor);
  }
  sizePreview(ratio || 1);
  if (isCardBook) {
    addCardThumbnail(picture, entry, index > 2);
  } else if (entry.type === 'book' && !entry.coverImages) {
    const cover = appendText(picture, 'span', 'cover-art', '');
    cover.dataset.book = entry.id;
    cover.setAttribute('aria-hidden', 'true');
    addCoverArt(cover, entry);
  } else if (isBook || entry.thumbnailSrc || firstImage) {
    const fullImage = isBook ? entry.coverImages.front : firstImage?.imageSrc;
    const image = addAssetImage(picture, entry.thumbnailSrc || fullImage, { lazy: index > 2, fallback: fullImage });
    image.decoding = 'async';
    if (!ratio) {
      image.addEventListener('load', () => sizePreview(image.naturalWidth / image.naturalHeight), { once: true });
    }
  } else {
    link.dataset.textPreview = '';
  }
  const overlay = appendText(picture, 'span', 'project-card-hover', '');
  overlay.setAttribute('aria-hidden', 'true');
  appendText(overlay, 'span', 'project-card-title', content.title);
  appendText(link, 'span', 'project-card-caption', content.title);
  if (entry.type === 'book') {
    link.addEventListener('click', event => {
      if (!plainClick(event)) return;
      event.preventDefault();
      const box = picture.getBoundingClientRect();
      const ratio = entry.coverRatio ?? .738;
      const width = Math.min(box.width, box.height * ratio);
      const height = width / ratio;
      const x = box.x + (box.width - width) / 2;
      const y = box.y + (box.height - height) / 2;
      enterBook(entry, relativeURL(archiveURL()), { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height });
    });
  } else {
    link.addEventListener('click', event => {
      if (!plainClick(event)) return;
      event.preventDefault();
      history.pushState({ folioReturn: relativeURL(archiveURL()) }, '', entryURL(entry));
      showRoute(true);
    });
  }
  return link;
}
$('library-empty').hidden = books.length > 0;
$('shelf-gallery').hidden = !books.length;
library.querySelector('.library-layout').toggleAttribute('data-empty', !books.length);

const aboutHeading = $('about-title');
aboutHeading.textContent = site.about.heading;
aboutHeading.lang = titleLanguage(site.about.heading);
$('about-text').textContent = site.about.text;
$('about-text').lang = titleLanguage(site.about.text);
const englishAbout = site.translations.en.about;
$('about-en-text').textContent = translated(englishAbout.text, site.about.text);
$('about-en-text').lang = titleLanguage($('about-en-text').textContent);
if (site.about.imageSrc) {
  $('about-visual').hidden = false;
  addAssetImage($('about-visual'), site.about.imageSrc, { alt: site.about.heading, lazy: true });
}
function renderContactNote(element, text) {
  let cursor = 0;
  // Match the whole username candidate before validating it. Email addresses stay plain text.
  const mentions = /(?:^|[\s([{「『“‘：:,，;；])@([\w.]+)(?![\w.@-])/gu;
  for (const match of text.matchAll(mentions)) {
    const handle = match[1].replace(/\.$/, '');
    if (handle.length > 30 || !/^\w+(?:\.\w+)*$/.test(handle)) continue;
    const start = match.index + match[0].indexOf('@');
    element.append(text.slice(cursor, start));
    const link = appendText(element, 'a', '', '@' + handle);
    link.href = 'https://www.instagram.com/' + handle + '/';
    cursor = start + 1 + handle.length;
  }
  element.append(text.slice(cursor));
}

const contactLayout = contactView.querySelector('.contact-layout');
for (const [id, text] of [['contact-text', site.contact.text], ['contact-en-text', site.translations.en.contact.text]]) {
  const note = $(id);
  if (text.trim()) renderContactNote(note, text);
  else note.parentElement.remove();
}
contactLayout.hidden = !contactLayout.childElementCount;
const contactLinks = $('contact-links');
function addContactLink(text, href, kind) {
  let parent = contactLinks;
  if (kind) {
    parent = appendText(contactLinks, 'div', 'contact-item', '');
    const label = appendText(parent, 'span', 'contact-label', t(kind));
    label.dataset.contactLabel = kind;
  }
  appendText(parent, 'a', '', text).href = href;
}

if (site.contact.email) {
  addContactLink(site.contact.email, 'mailto:' + encodeURIComponent(site.contact.email).replace('%40', '@'), 'email');
}
for (const link of site.contact.links) {
  addContactLink(link.label, link.url, link.kind);
}
const hasContactLinks = contactLinks.childElementCount > 0;
$('contact-empty').hidden = !contactLayout.hidden || hasContactLinks;
$('contact-details').hidden = !hasContactLinks && !contactLayout.hidden;

function updateDocumentTitle() {
  const route = routeFromHash();
  const labels = { project: '', about: t('about'), bookshelf: t('bookshelf'), contact: t('contact') };
  const title = route.entry ? itemCopy(route.entry).title : labels[route.page];
  document.title = title ? title + ' · ' + siteTitles[locale] : siteTitles[locale];
}

function updateProjectText(entry) {
  const row = $('project-detail-content').querySelector('.portfolio-entry');
  if (!row || row.dataset.entry !== entry.id) return;
  const content = itemCopy(entry);
  const title = row.querySelector('h1');
  title.textContent = content.title;
  title.lang = titleLanguage(content.title);
  workTags(row.querySelector('.work-tags'), entry);
  const category = row.querySelector('.editorial-metadata');
  category.textContent = content.category;
  category.lang = titleLanguage(content.category);
  const prose = row.querySelector('.editorial-description');
  prose.textContent = content.description.join('\n\n');
  prose.lang = titleLanguage(prose.textContent);
  const read = row.querySelector('.project-read');
  if (read) read.textContent = t('read') + ' →';
  const cover = row.querySelector('[data-cover-alt]');
  if (cover) cover.alt = content.title + ' ' + t('cover');
  for (const figure of row.querySelectorAll('[data-player-index]')) {
    const index = Number(figure.dataset.playerIndex);
    labelProjectPlayer(figure, entry.media[index], index, content.title);
  }
  alignDetailTitle();
}

function updateBookText(book) {
  const content = itemCopy(book);
  heading.textContent = content.title;
  heading.lang = titleLanguage(content.title);
  const language = book.coverImages ? content.language : locale === 'en' ? 'English' : '영어';
  workTags($('book-tags'), book);
  metadata.replaceChildren();
  if (content.category) {
    appendText(metadata, 'span', 'work-category', content.category).lang = titleLanguage(content.category);
    metadata.append(', ');
  }
  const count = Math.ceil(book.pages.length / 2);
  const extent = book.bookForm === 'cards' ? (locale === 'en' ? count + (count === 1 ? ' card' : ' cards') : '카드 ' + count + '장') : pageCount(book.pages.length);
  metadata.append([extent, language].filter(Boolean).join(', '));
  description.textContent = book.coverImages ? content.description.join('\n\n') : content.description[0];
  description.lang = titleLanguage(description.textContent);
  orbit.setAttribute('aria-label', content.title + ' ' + t('coverView'));
  alignDetailTitle();
}

function refreshLocale() {
  document.documentElement.lang = locale;
  wordmark.textContent = siteTitles[locale];
  wordmark.lang = titleLanguage(siteTitles[locale]);
  wordmark.setAttribute('aria-label', siteTitles[locale] + ' ' + t('home'));
  document.querySelector('.site-menu').setAttribute('aria-label', t('menu'));
  for (const link of document.querySelectorAll('.site-menu a')) {
    link.textContent = t(link.hash.slice(1));
    link.lang = locale;
  }
  $('projects-title').textContent = t('project');
  $('projects-title').lang = locale;
  $('library-title').textContent = t('bookshelf');
  $('library-title').lang = locale;
  const aboutLayout = aboutView.querySelector('.about-layout');
  aboutLayout.prepend(aboutLayout.querySelector('.intro-column[lang="' + locale + '"]'));
  aboutHeading.textContent = locale === 'en' ? translated(englishAbout.heading, 'About') : site.about.heading;
  aboutHeading.lang = titleLanguage(aboutHeading.textContent);
  $('library-empty').textContent = t(unavailable ? 'unavailable' : 'emptyBooks');
  $('contact-empty').textContent = t('emptyContact');
  $('contact-title').textContent = t('contact');
  $('contact-title').lang = locale;
  const firstContactColumn = contactLayout.querySelector('.intro-column[lang="' + locale + '"]');
  if (firstContactColumn) contactLayout.prepend(firstContactColumn);
  for (const label of contactLinks.querySelectorAll('[data-contact-label]')) {
    label.textContent = t(label.dataset.contactLabel);
  }
  updateReturnLinks();
  stage.setAttribute('aria-label', t('viewer'));
  for (const navigation of viewer.querySelectorAll('nav')) navigation.setAttribute('aria-label', t('bookNavigation'));
  projectViewer.querySelector('nav').setAttribute('aria-label', t('projectNavigation'));
  jumpInput.labels[0].textContent = t('pageNumber');
  $('jump-submit').textContent = t('jump');
  clearJumpError();
  for (const entry of entries) {
    const thumbnail = projectCards.get(entry.id);
    const onShelf = bookLinks && entry.type === 'book';
    if (!thumbnail && !onShelf) continue;
    const content = itemCopy(entry);
    if (thumbnail) {
      thumbnail.setAttribute('aria-label', content.title);
      thumbnail.lang = titleLanguage(content.title);
      thumbnail.href = entryURL(entry);
      thumbnail.querySelector('.project-card-caption').textContent = content.title;
      thumbnail.querySelector('.project-card-title').textContent = content.title;
    }
    if (onShelf) setShelfLabels(entry, content.title);
  }
  const route = routeFromHash();
  if (activeRoute && route.page === 'project') renderProjectIndex();
  if (route.page === 'detail') updateProjectText(route.entry);
  if (activeBook) updateBookText(activeBook);
  for (const page of container.querySelectorAll('[data-page]')) page.setAttribute('aria-label', scanLabel(page.dataset.page));
  for (const spread of container.querySelectorAll('[data-spread-index]')) spread.setAttribute('aria-label', pageLabel(spreadLabel(Number(spread.dataset.spreadIndex))));
  updateNavigation();
  updateDocumentTitle();
}

function chooseLocale(next, { updateURL = true, save = true } = {}) {
  if (next !== 'en' && next !== 'ko') return;
  locale = next;
  if (save) {
    try { localStorage.setItem(languageStorageKey, locale); } catch { /* The current choice still applies. */ }
  }
  if (updateURL) {
    const url = new URL(location.href);
    url.searchParams.set('lang', locale);
    history.replaceState(history.state, '', url);
  }
  refreshLocale();
}

$('language-toggle').addEventListener('click', () => chooseLocale(locale === 'ko' ? 'en' : 'ko'));

function routeFromHash() {
  const hash = location.hash.slice(1);
  if (['about', 'project', 'bookshelf', 'contact'].includes(hash)) return { page: hash };
  const [prefix, id, extra] = hash.split('/');
  const entry = entries.find(item => item.id === (id ?? hash));
  if (!extra && entry) {
    if (prefix === 'project') return { page: entry.type === 'book' ? 'book' : 'detail', entry, legacyProjectBook: entry.type === 'book' };
    if (prefix === 'book' && entry.type === 'book') return { page: 'book', entry };
    if (!id) return { page: entry.type === 'book' ? 'book' : 'detail', entry };
  }
  return { page: 'project' };
}

function showBook(book, moveFocus) {
  const cards = book.bookForm === 'cards';
  pages = cards ? cardFaces(book.pages) : book.pages;
  geometry = !cards && book.leafLayout ? leafGeometry(book.leafLayout, Math.ceil(pages.length / 2), trimSize(book), pages) : undefined;
  if (cards) spreads = pages.map((_, index) => ({ left: index + 1, right: 0 }));
  else spreads = geometry ? physicalSpreads(pages.length) : readerSpreads(book);
  stage.dataset.readerForm = cards ? 'cards' : 'bound';
  viewer.dataset.readerForm = stage.dataset.readerForm;
  stage.toggleAttribute('data-leaf-layout', !!geometry);
  rememberedPage = readBookmark(book);
  mobile.reset();
  updateBookText(book);
  model.dataset.book = book.id;
  stage.dataset.book = book.id;
  stage.dataset.binding = book.bindingType ?? 'paperback';
  stage.toggleAttribute('data-proportional', !!book.coverRatio);
  stage.toggleAttribute('data-uploaded', !!book.coverImages);
  stage.style.setProperty('--book-ratio', book.trimSizeMm ? book.trimSizeMm[0] / book.trimSizeMm[1] : book.coverRatio ?? '');
  const [width, height] = trimSize(book);
  const radius = Math.min(book.cardStock?.cornerRadiusMm ?? 0, width / 2, height / 2);
  stage.style.setProperty('--card-radius', (100 * radius / width) + '% / ' + (100 * radius / height) + '%');
  const ratio = cards ? width / height : geometry ? 2 * geometry.width / geometry.height : book.pageRatio ? 2 * book.pageRatio : '';
  stage.style.setProperty('--spread-ratio', ratio);
  const front = model.querySelector('.front');
  addCoverArt(front, book);
  const back = model.querySelector('.back');
  const spine = model.querySelector('.spine');
  back.replaceChildren();
  spine.replaceChildren();
  back.classList.toggle('artwork', !!book.coverImages?.back);
  spine.classList.toggle('artwork', !!book.coverImages?.spine);
  if (book.coverImages?.back) {
    addAssetImage(back, book.coverImages.back);
  } else {
    appendText(back, 'span', 'back-title', book.title).lang = titleLanguage(book.title);
    if (!book.coverImages) {
      appendText(back, 'span', 'back-copy', book.coverCopy);
      appendText(back, 'span', 'cover-bottom', DEFAULT_SITE_TITLE);
    }
  }
  if (book.coverImages?.spine) {
    addAssetImage(spine, book.coverImages.spine);
  } else {
    appendText(spine, 'span', '', book.title).lang = titleLanguage(book.title);
  }
  setBookMaterial(model, book, front);
  orbit.setAttribute('aria-label', itemCopy(book).title + ' ' + t('coverView'));
  model.classList.add('resetting');
  const angle = mockupViews[book.mockupView] ?? initialRotation;
  setRotation(angle.x, angle.y);
  requestAnimationFrame(() => model.classList.remove('resetting'));
  updateNavigation();
  if (moveFocus) heading.focus({ preventScroll: true });
}

function showRoute(moveFocus) {
  const route = routeFromHash();
  if (route.legacyProjectBook) {
    const url = new URL(location.href);
    url.hash = '#book/' + route.entry.id;
    history.replaceState({ ...history.state, folioReturn: relativeURL(archiveURL()) }, '', url);
  }
  const key = route.page + ':' + (route.entry?.id ?? '') + (route.page === 'project' ? ':' + JSON.stringify(archiveState()) : '');
  if (key === activeRoute) return;
  if (route.page !== 'detail' && activeRoute?.startsWith('detail:')) {
    // Release playing videos and embedded documents as soon as the visitor leaves the project.
    $('project-detail-content').replaceChildren();
  }
  stopCoverArrival();
  if (activeBook) goTo(0);
  activeBook = route.page === 'book' ? route.entry : undefined;
  activeRoute = key;
  const views = { project: projectsView, about: aboutView, bookshelf: library, contact: contactView, detail: projectViewer, book: viewer };
  for (const [page, section] of Object.entries(views)) section.hidden = page !== route.page;
  const menu = route.page === 'book' ? 'bookshelf' : route.page === 'detail' ? 'project' : route.page;
  for (const link of document.querySelectorAll('.site-menu a')) {
    if (link.hash === '#' + menu) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  updateDocumentTitle();
  updateReturnLinks();
  if (moveFocus) window.scrollTo(0, 0);
  if (route.page === 'book') {
    showBook(route.entry, moveFocus);
  } else if (route.page === 'detail') {
    $('project-detail-content').replaceChildren(portfolioRow(route.entry));
    alignDetailTitle();
    if (moveFocus) $('project-title').focus({ preventScroll: true });
  } else {
    if (route.page === 'project') renderProjectIndex();
    if (route.page === 'bookshelf') renderShelf();
    if (moveFocus) {
      const headings = { project: $('projects-title'), about: aboutHeading, bookshelf: $('library-title'), contact: $('contact-title') };
      headings[route.page].focus({ preventScroll: true });
    }
  }
}

refreshLocale();
showRoute(false);
function locationChanged() {
  const requested = new URL(location.href).searchParams.get('lang');
  if ((requested === 'en' || requested === 'ko') && requested !== locale) chooseLocale(requested, { updateURL: false, save: false });
  showRoute(true);
}
window.addEventListener('hashchange', locationChanged);
window.addEventListener('popstate', locationChanged);
