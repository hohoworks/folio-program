import { loadCatalog, spineRatio, trimSize } from './catalog.js';
import { createCurl } from './curl.js';
import { createMobileReader } from './mobile-reader.js';
import { createShelf } from './shelf.js';
import { titleLanguage, alignDetailTitle } from './title-language.js';
import { DEFAULT_SITE_TITLE, localizedSiteTitles } from './site-title.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const orbit = $('orbit');
const model = $('book-model');
const modelFrame = $('model-frame');
const container = $('current-page');
const pageArea = $('page-area');
const previousButton = $('prev');
const nextButton = $('next');
const positionDisplay = $('position');
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
const initialRotation = { x: 9, y: -24 };
const languageStorageKey = 'folio-language';
const messages = {
  ko: {
    home: '홈', menu: '주 메뉴', read: '읽기', cover: '표지',
    previous: '← 이전', next: '다음 →', previousPage: '이전 쪽', nextPage: '다음 쪽',
    previousSpread: '이전 펼침면', nextSpread: '다음 펼침면', backCover: '표지로 돌아가기',
    backShelf: '← 책장', backProject: '← 목록으로 돌아가기', viewer: '책 뷰어', coverView: '3D 표지',
    bookNavigation: '책 탐색', projectNavigation: '작업 탐색', contact: '연락처', email: '이메일', instagram: '인스타그램',
    emptyProjects: '아직 공개된 작업이 없습니다.', emptyBooks: '아직 공개된 책이 없습니다.',
    unavailable: '목록을 불러올 수 없습니다. 새로고침해 주세요.',
    emptyContact: '연락처가 아직 등록되지 않았습니다.',
    about: '소개', project: '작업', bookshelf: '책장', category: '분류', year: '연도', all: '전체',
    noMatches: '조건에 맞는 작업이 없습니다.', workTags: '분류와 연도',
  },
  en: {
    home: 'Home', menu: 'Main navigation', read: 'Read', cover: 'Cover',
    previous: '← Previous', next: 'Next →', previousPage: 'Previous page', nextPage: 'Next page',
    previousSpread: 'Previous spread', nextSpread: 'Next spread', backCover: 'Back to cover',
    backShelf: '← Book shelf', backProject: '← Back to projects', viewer: 'Book viewer', coverView: '3D cover',
    bookNavigation: 'Book navigation', projectNavigation: 'Project navigation', contact: 'Contact', email: 'Email', instagram: 'Instagram',
    emptyProjects: 'No published projects yet.', emptyBooks: 'No published books yet.',
    unavailable: 'The collection could not be loaded. Please refresh the page.',
    emptyContact: 'Contact details have not been added yet.',
    about: 'About', project: 'Project', bookshelf: 'Book shelf', category: 'Category', year: 'Year', all: 'All',
    noMatches: 'No projects match these filters.', workTags: 'Categories and year',
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

function pageLabel(index) {
  return locale === 'en' ? 'Page ' + index : index + '쪽';
}

function pageCount(count) {
  return locale === 'en' ? count + (count === 1 ? ' page' : ' pages') : count + '쪽';
}

let activeBook;
let activeRoute;
let pages = [];

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
  if (!activeBook.coverImages || index < 1) return;
  for (const page of pages.slice(index - 1, index + 1)) {
    const image = new Image();
    image.fetchPriority = 'low';
    image.src = assetURL(page.imageSrc);
  }
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
  if (activeBook.coverImages) {
    page.className = 'paper paper-scan';
    page.dataset.page = index;
    page.setAttribute('aria-label', pageLabel(index));
    addAssetImage(page, data.imageSrc);
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

function spreadLabel(first) {
  const last = Math.min(first + 1, pages.length);
  return first === last ? formatPage(first) : `${formatPage(first)}–${formatPage(last)}`;
}

function createSpread(index) {
  const element = document.createElement('div');
  const left = createPage(index);
  const right = createPage(index + 1);
  element.className = 'spread';
  element.tabIndex = -1;
  element.setAttribute('role', 'group');
  element.dataset.first = index;
  element.setAttribute('aria-label', pageLabel(spreadLabel(index)));
  left.classList.add('paper-left');
  right.classList.add('paper-right');
  element.append(left, right);
  return { element, left, right };
}

function targetFor(direction) {
  if (direction !== -1 && direction !== 1) return -1;
  if (position === 0) return direction === 1 ? 1 : -1;
  if (position === 1 && direction === -1) return 0;
  return position + direction * 2;
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
  if (!mobile.active || position === 0) return false;
  return direction === 1
    ? mobile.pageSide === 'left' && position + 1 <= pages.length
    : direction === -1 && mobile.pageSide === 'right';
}

function updateNavigation() {
  if (!activeBook) return;
  const cover = position === 0;
  const onLeft = !mobile.active || mobile.pageSide === 'left';
  const firstPage = position === 1 && onLeft;
  previousButton.hidden = cover;
  previousButton.textContent = firstPage ? '← ' + t('cover') : t('previous');
  previousButton.setAttribute('aria-label', firstPage ? t('backCover') : t(mobile.active ? 'previousPage' : 'previousSpread'));
  nextButton.disabled = !cover && !canPan(1) && targetFor(1) > pages.length;
  nextButton.textContent = t('next');
  nextButton.setAttribute('aria-label', t(mobile.active ? 'nextPage' : 'nextSpread'));
  const label = mobile.active ? formatPage(position + (onLeft ? 0 : 1)) : spreadLabel(position);
  positionDisplay.firstElementChild.textContent = cover ? t('cover') : label;
  $('turn-prev').hidden = cover;
  $('turn-next').hidden = nextButton.disabled;
}

function goTo(index, { focus = false } = {}) {
  clearTurn();
  gesture = undefined;
  if (!Number.isInteger(index) || index < 0 || index > pages.length) return;
  if (index === position) return;
  stopCoverArrival();
  const active = document.activeElement;
  const focusPage = focus || container.contains(active);
  const arrivingSide = mobile.active && index > 0 && index < position ? 'right' : 'left';
  position = index;
  const cover = index === 0;

  stage.dataset.mode = viewer.dataset.mode = cover ? 'cover' : 'read';
  $('cover-view').hidden = !cover;
  $('reading-view').hidden = cover;

  spread = cover ? undefined : createSpread(index);
  container.replaceChildren(...(spread ? [spread.element] : []));
  if (!cover) {
    preloadSpread(index + 2);
    if (index > 1) preloadSpread(index - 2);
  }
  mobile.move(arrivingSide, { animate: false });
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
  const curl = createCurl(front, back, container, { cover });
  turn = { index, forward, opening, preview, covered, curl, corner, progress: 0, offsetY: 0, focus };
  stage.dataset.turning = '';
  return turn;
}

function drawTurn(current, progress, offsetY = current.offsetY) {
  current.progress = progress;
  current.offsetY = offsetY;
  current.curl.draw(current.forward ? progress : 1 - progress, current.corner, offsetY);
}

function easeInOut(progress) {
  return progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}

function settleTurn(current, commit) {
  const from = current.progress;
  const to = commit ? 1 : 0;
  const arrivingSide = commit && mobile.active && !current.opening && current.index > 0
    ? current.forward ? 'left' : 'right'
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
  if (reducedMotion.matches) return;
  const current = startTurn(index, .82, true);
  drawTurn(current, 0);
  settleTurn(current, true);
}

function step(direction) {
  if (!activeBook || turn || mobile.moving) return;
  if (canPan(direction)) {
    const moveFocus = document.activeElement === nextButton;
    mobile.move(direction === 1 ? 'right' : 'left');
    updateNavigation();
    if (moveFocus && nextButton.disabled) spread.element.focus({ preventScroll: true });
    return;
  }
  const index = targetFor(direction);
  if (index < 0 || index > pages.length) return;
  if (position === 0) {
    openBook(index);
  } else if (reducedMotion.matches) {
    goTo(index);
  } else {
    const current = startTurn(index);
    drawTurn(current, 0);
    settleTurn(current, true);
  }
}

const readButton = $('read-book');
readButton.addEventListener('pointerenter', prepareFirstSpread);
readButton.addEventListener('focus', prepareFirstSpread);
readButton.addEventListener('click', () => step(1));
previousButton.addEventListener('click', () => step(-1));
nextButton.addEventListener('click', () => step(1));

function setRotation(x, y) {
  rotation = { x: Math.min(77, Math.max(-77, x)), y };
  model.style.setProperty('--rx', `${rotation.x}deg`);
  model.style.setProperty('--ry', `${rotation.y}deg`);
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
  if (turn || gesture || mobile.moving || !event.isPrimary || event.button !== 0) return;
  const box = pageArea.getBoundingClientRect();
  const edge = event.target.closest('.drag-zone');
  if (event.pointerType === 'mouse' && !edge && !mobile.active) return;
  const direction = edge && !mobile.active ? Number(edge.dataset.direction) : 0;
  gesture = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    width: box.width / 2,
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
  if (index < 0 || index > pages.length || reducedMotion.matches) return;
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
    addCoverArt: (cover, book) => addCoverArt(cover, book, book.thumbnailSrc),
    reducedMotion,
    select(book, source) {
      enterBook(book, '#bookshelf', source);
    },
  });
  const largestTrimSide = Math.max(210, ...books.flatMap(trimSize));
  for (const book of books) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = '#book/' + book.id;
    link.className = 'index-link';
    link.dataset.book = book.id;
    const [width, height] = trimSize(book);
    link.style.setProperty('--index-cover-width', width / largestTrimSide);
    link.style.setProperty('--index-cover-ratio', width + ' / ' + height);
    link.addEventListener('click', event => {
      if (!plainClick(event)) return;
      event.preventDefault();
      bookLinks.get(book.id).click();
    });
    const jacket = appendText(link, 'span', 'index-jacket cover-art', '');
    jacket.setAttribute('aria-hidden', 'true');
    addCoverArt(jacket, book, book.thumbnailSrc);
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
  const images = entry.type === 'book'
    ? [...(entry.coverImages ? [{ imageSrc: entry.coverImages.front, alt: content.title + ' ' + t('cover') }] : []), ...(entry.galleryImages ?? [])]
    : entry.images;
  for (const [index, image] of images.entries()) {
    const figure = document.createElement('figure');
    const element = addAssetImage(figure, image.imageSrc, { lazy: index > 0, alt: image.alt });
    if (entry.type === 'book' && entry.coverImages && index === 0) element.setAttribute('data-cover-alt', '');
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
  const ratio = isBook ? entry.coverRatio : entry.images[0].ratio;
  // Printed books use their trim width. Other formats share a similar visual area.
  function sizePreview(aspect) {
    const widthFactor = isBook ? trimSize(entry)[0] / 220 : Math.sqrt(aspect);
    link.style.setProperty('--project-ratio', aspect);
    link.style.setProperty('--preview-width-factor', widthFactor);
  }
  sizePreview(ratio || 1);
  if (entry.type === 'book' && !entry.coverImages) {
    const cover = appendText(picture, 'span', 'cover-art', '');
    cover.dataset.book = entry.id;
    cover.setAttribute('aria-hidden', 'true');
    addCoverArt(cover, entry);
  } else {
    const fullImage = isBook ? entry.coverImages.front : entry.images[0].imageSrc;
    const image = addAssetImage(picture, entry.thumbnailSrc || fullImage, { lazy: index > 2, fallback: fullImage });
    image.decoding = 'async';
    if (!ratio) {
      image.addEventListener('load', () => sizePreview(image.naturalWidth / image.naturalHeight), { once: true });
    }
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
    metadata.append(' · ');
  }
  metadata.append([pageCount(book.pages.length), language].filter(Boolean).join(' · '));
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
  const toggle = $('language-toggle');
  toggle.dataset.locale = locale === 'ko' ? 'en' : 'ko';
  $('language-name').textContent = locale === 'ko' ? '(ENG)' : '(한글)';
  toggle.lang = locale === 'ko' ? 'en' : 'ko';
  toggle.setAttribute('aria-label', locale === 'ko' ? 'Switch to English' : '한국어로 전환');
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
  $('read-book').firstChild.textContent = t('read') + ' ';
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
  for (const page of container.querySelectorAll('[data-page]')) page.setAttribute('aria-label', pageLabel(page.dataset.page));
  for (const spread of container.querySelectorAll('[data-first]')) spread.setAttribute('aria-label', pageLabel(spreadLabel(Number(spread.dataset.first))));
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

$('language-switch').addEventListener('click', event => {
  const button = event.target.closest('button[data-locale]');
  if (button) chooseLocale(button.dataset.locale);
});

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
  pages = book.pages;
  mobile.reset();
  updateBookText(book);
  model.dataset.book = book.id;
  stage.dataset.book = book.id;
  stage.dataset.binding = book.bindingType ?? 'paperback';
  stage.toggleAttribute('data-proportional', !!book.coverRatio);
  stage.toggleAttribute('data-uploaded', !!book.coverImages);
  stage.style.setProperty('--book-ratio', book.coverRatio ?? '');
  stage.style.setProperty('--spread-ratio', book.pageRatio ? 2 * book.pageRatio : '');
  model.style.setProperty('--spine-ratio', spineRatio(book));
  addCoverArt(model.querySelector('.front'), book);
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
  orbit.setAttribute('aria-label', itemCopy(book).title + ' ' + t('coverView'));
  model.classList.add('resetting');
  setRotation(initialRotation.x, initialRotation.y);
  requestAnimationFrame(() => model.classList.remove('resetting'));
  positionDisplay.lastElementChild.textContent = `/ ${pages.length}`;
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
