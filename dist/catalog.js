import { validBookColor, mockupViews } from './book-material.js';
import { resolveMockupDetails } from './mockup-options.js';
import { normalizeBookFormat, validFaceSize } from './book-format.js';
export { trimSize, spineRatio } from './book-material.js';
import { isProjectVideoPath, projectEmbedURL, projectMedia } from './project-media.js';
import { STOCK_PROJECT_TAGS, idsFor } from './project-tags.js';
import { localizedSiteTitles } from './site-title.js';
import { displayText } from './punctuation.js';

const positive = value => Number.isFinite(value) && value > 0;
const assetPath = /^(?:\.\/)?assets\/(books|projects|site)\/(?:[\w-]+\/)+[\w.-]+\.(?:png|jpe?g|webp)$/i;
function asset(value, folder = 'books') {
  if (typeof value !== 'string') return false;
  return assetPath.exec(value)?.[1].toLowerCase() === folder;
}
const bindings = ['paperback', 'hardcover', 'saddle-stitch', 'exposed-sewn', 'spiral', 'ring'];

function englishFields(source) {
  const en = source?.translations?.en;
  return {
    en: {
      title: typeof en?.title === 'string' ? en.title : '',
      category: typeof en?.category === 'string' ? en.category : '',
      language: typeof en?.language === 'string' ? en.language : '',
      description: Array.isArray(en?.description) ? en.description.filter(line => typeof line === 'string') : [],
    },
  };
}

function publishedBook(book) {
  if (!book || book.published === false || typeof book.id !== 'string' || !/^[\w-]+$/.test(book.id)
      || typeof book.title !== 'string' || !book.title.trim()
      || !asset(book.coverImages?.front) || !positive(book.coverRatio) || !positive(book.pageRatio)
      || !Array.isArray(book.pages) || !book.pages.length || !book.pages.every((page, index) =>
        asset(page?.imageSrc) || (book.bookForm === 'cards' && index % 2 === 1 && page?.blank === true))) {
    return null;
  }

  const joinHalves = book.bookForm !== 'cards' && book.joinSplitPages === true && book.pages.length % 2 === 0;
  const pages = [];
  for (let index = 0; index < book.pages.length; index += joinHalves ? 2 : 1) {
    const src = book.pages[index];
    const page = src.blank ? { blank: true } : { imageSrc: src.imageSrc };
    if (!joinHalves && validFaceSize(src.sizeMm)) page.sizeMm = src.sizeMm;
    if (joinHalves) page.rightImageSrc = book.pages[index + 1].imageSrc;
    pages.push(page);
  }
  return {
    type: 'book',
    ...normalizeBookFormat({ ...book, pages, joinSplitPages: false }),
    edgeTreatments: Object.fromEntries(Object.entries(book.edgeTreatments || {}).filter(([face, edge]) =>
      ['fore', 'head', 'tail'].includes(face) && ((edge?.mode === 'solid' && validBookColor(edge.color)) ||
        (edge?.mode === 'scan' && asset(edge.imageSrc))))),
    edgeBands: Array.isArray(book.edgeBands) ? book.edgeBands.filter(band => band && Number.isInteger(band.start) && Number.isInteger(band.end) && validBookColor(band.color)) : [],
    ringPositions: Array.isArray(book.ringPositions) && book.ringPositions.every(n => Number.isFinite(n) && n >= 0 && n <= 100) ? book.ringPositions : undefined,
    translations: englishFields(book),
    id: book.id,
    title: book.title,
    category: typeof book.category === 'string' ? book.category : '',
    tagIds: Array.isArray(book.tagIds) ? book.tagIds.filter(id => typeof id === 'string') : undefined,
    description: Array.isArray(book.description) ? book.description.filter(line => typeof line === 'string') : [],
    year: typeof book.year === 'string' || Number.isFinite(book.year) ? String(book.year) : '',
    language: typeof book.language === 'string' ? book.language : '',
    bindingType: bindings.includes(book.bindingType) ? book.bindingType : 'paperback',
    pageJumpEnabled: book.pageJumpEnabled !== false,
    resumeReadingEnabled: book.resumeReadingEnabled !== false,
    mockupView: Object.hasOwn(mockupViews, book.mockupView) ? book.mockupView : 'spine',
    mockupDetails: resolveMockupDetails(book.mockupDetails),
    caseColor: validBookColor(book.caseColor) ? book.caseColor : undefined,
    paperColor: validBookColor(book.paperColor) ? book.paperColor : undefined,
    trimSizeMm: book.trimSizeMm?.length === 2 && Array.isArray(book.trimSizeMm) && book.trimSizeMm.every(positive)
      ? book.trimSizeMm : undefined,
    spineWidthMm: positive(book.spineWidthMm) ? book.spineWidthMm : undefined,
    coverRatio: book.coverRatio,
    pageRatio: joinHalves ? book.pageRatio * 2 : book.pageRatio,
    ...(['right', 'left'].includes(book.firstPageSide) && { firstPageSide: book.firstPageSide }),
    ...(!joinHalves && book.pdfLayout === 'spread' && { pdfLayout: 'spread' }),
    ...(!joinHalves && book.pdfLayout === 'mixed' && { pdfSheetSides: book.pdfSheetSides }),
    thumbnailSrc: asset(book.thumbnailSrc) ? book.thumbnailSrc : undefined,
    coverImages: {
      front: book.coverImages.front,
      back: asset(book.coverImages.back) ? book.coverImages.back :
        book.bookForm === 'cards' && pages.length % 2 === 0 ? pages.at(-1)?.imageSrc : undefined,
      spine: asset(book.coverImages.spine) ? book.coverImages.spine : undefined,
    },
    galleryImages: Array.isArray(book.galleryImages)
      ? book.galleryImages.filter(image => asset(image?.imageSrc)).map(image => ({
        imageSrc: image.imageSrc,
        alt: typeof image.alt === 'string' ? displayText(image.alt) : '',
      })) : [],
    pages,
  };
}

export function readerSpreads(book) {
  const sides = book.pdfSheetSides;
  const mixed = Array.isArray(sides) && sides.every(count => count === 1 || count === 2) &&
    sides.reduce((sum, count) => sum + count, 0) === book.pages.length;
  const spreads = [];
  let page = 1;
  if (!mixed && book.pdfLayout !== 'spread' && book.firstPageSide === 'right' && book.pages.length > 0) {
    spreads.push({ left: 0, right: 1 });
    page = 2;
  }
  const oddSoloOnRight = mixed && (sides[0] === 2 || book.firstPageSide !== 'left');
  while (page <= book.pages.length) {
    const count = mixed ? sides[spreads.length] : Math.min(2, book.pages.length - page + 1);
    if (count === 2) spreads.push({ left: page, right: page + 1 });
    else if (mixed && (page % 2 === 1) === oddSoloOnRight) spreads.push({ left: 0, right: page });
    else spreads.push({ left: page, right: 0 });
    page += count;
  }
  return spreads;
}

function publishedProject(project) {
  if (!project || project.published === false || typeof project.id !== 'string' || !/^[\w-]+$/.test(project.id)
      || typeof project.title !== 'string' || !project.title.trim()) return null;
  const media = [];
  for (const entry of projectMedia(project)) {
    const type = entry?.type;
    const meta = {
      alt: typeof entry?.alt === 'string' ? displayText(entry.alt) : '',
      ...(positive(entry?.ratio) ? { ratio: entry.ratio } : {}),
    };
    if (type === 'image' && asset(entry.imageSrc, 'projects')) media.push({ type, imageSrc: entry.imageSrc, ...meta });
    else if (type === 'video' && isProjectVideoPath(entry.videoSrc)) media.push({ type, videoSrc: entry.videoSrc, ...meta });
    else if (type === 'embed') {
      const url = projectEmbedURL(entry.url);
      if (!url) return null;
      media.push({ type, url, ...meta });
    } else return null;
  }
  if (!media.length) return null;
  return {
    type: 'project',
    translations: englishFields(project),
    id: project.id,
    thumbnailSrc: asset(project.thumbnailSrc, 'projects') ? project.thumbnailSrc : undefined,
    title: project.title,
    category: typeof project.category === 'string' ? project.category : '',
    tagIds: Array.isArray(project.tagIds) ? project.tagIds.filter(id => typeof id === 'string') : undefined,
    description: Array.isArray(project.description) ? project.description.filter(line => typeof line === 'string') : [],
    year: typeof project.year === 'string' || Number.isFinite(project.year) ? String(project.year) : '',
    media,
    images: media.filter(entry => entry.type === 'image').map(({ type, ...image }) => image),
  };
}

function contactURL(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function publicLink(link) {
  const url = contactURL(link?.url);
  const label = typeof link?.label === 'string' ? link.label.trim() : '';
  if (!url || !label) return null;
  if (/^(www\.)?instagram\.com$/.test(url.hostname) && !url.port) {
    const handle = /^\/([a-z\d_](?:[a-z\d._]{0,28}[a-z\d_])?)\/?$/i.exec(url.pathname)?.[1];
    if (handle && !handle.includes('..') &&
        (/^(instagram|인스타그램)$/i.test(label) || label.toLowerCase() === '@' + handle.toLowerCase())) {
      return { kind: 'instagram', label: '@' + handle, url: url.href };
    }
  }
  return { label: displayText(label), url: url.href };
}

function siteSettings(site) {
  const text = value => typeof value === 'string' ? displayText(value) : '';
  const englishAboutText = text(site?.translations?.en?.about?.text);
  const links = Array.isArray(site?.contact?.links) ? site.contact.links : [];
  const tagSource = Array.isArray(site?.projectTags) ? site.projectTags : STOCK_PROJECT_TAGS;
  const tags = new Map();
  for (const tag of tagSource) {
    if (typeof tag?.id !== 'string' || !/^[\w-]+$/.test(tag.id) || tags.has(tag.id)) continue;
    const ko = text(tag.ko).trim();
    const en = text(tag.en).trim();
    if (ko || en) tags.set(tag.id, { id: tag.id, ko: ko || en, en: en || ko });
  }
  return {
    title: localizedSiteTitles(site).ko,
    projectTags: [...tags.values()],
    about: {
      heading: text(site?.about?.heading).trim() || 'About',
      text: text(site?.about?.text) || '책과 디자인 작업을 모아 둔 포트폴리오입니다.',
      imageSrc: asset(site?.about?.imageSrc, 'site') ? site.about.imageSrc : '',
    },
    contact: {
      text: text(site?.contact?.text),
      email: typeof site?.contact?.email === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(site.contact.email) ? site.contact.email : '',
      links: links.map(publicLink).filter(Boolean),
    },
    translations: {
      en: {
        title: text(site?.translations?.en?.title),
        about: {
          heading: text(site?.translations?.en?.about?.heading).trim() || 'About',
          text: englishAboutText.trim()
            ? englishAboutText
            : text(site?.about?.text).trim() ? '' : 'A portfolio of books and design work.',
        },
        contact: { text: text(site?.translations?.en?.contact?.text) },
      },
    },
  };
}

function displayFields(entry) {
  const fields = { ...entry };
  for (const key of ['title', 'category', 'language']) {
    if (typeof entry[key] === 'string') fields[key] = displayText(entry[key]);
  }
  if (Array.isArray(entry.description)) fields.description = entry.description.map(displayText);
  return fields;
}

function orderedCatalog(bookEntries, projects = [], order = [], site) {
  const settings = siteSettings(site);
  const entries = [...bookEntries, ...projects].map(entry => ({
    ...displayFields(entry),
    ...(entry.translations?.en && { translations: { ...entry.translations, en: displayFields(entry.translations.en) } }),
    tagIds: idsFor(entry, entry.type, settings.projectTags),
  }));
  const byID = new Map(entries.map(entry => [entry.id, entry]));
  const ordered = [];
  for (const id of [...order, ...byID.keys()]) {
    const entry = byID.get(id);
    if (!entry) continue;
    ordered.push(entry);
    byID.delete(id);
  }
  return {
    site: settings,
    entries: ordered,
    books: ordered.filter(entry => entry.type === 'book'),
    projects: ordered.filter(entry => entry.type === 'project'),
  };
}

async function demoCatalog(site) {
  const [{ books }, { demoProjects, demoOrder }] = await Promise.all([
    import('./library.js'), import('./demo-projects.js'),
  ]);
  const catalog = orderedCatalog(books.map(book => ({ ...book, type: 'book' })), demoProjects.map(project => ({ ...project, media: projectMedia(project) })), demoOrder, site);
  const demoBooks = new Map(catalog.books.map(book => [book.id, book]));
  catalog.books = books.map(book => demoBooks.get(book.id));
  return catalog;
}

export async function loadCatalog() {
  try {
    const response = await fetch(new URL('./catalog.json', import.meta.url), { cache: 'no-cache' });
    if (response.ok) {
      const catalog = await response.json();
      if (Array.isArray(catalog?.books) || Array.isArray(catalog?.projects)) {
        const bookEntries = Array.isArray(catalog.books) ? catalog.books : [];
        const projectEntries = Array.isArray(catalog.projects) ? catalog.projects : [];
        if (catalog.demo === true && !bookEntries.length && !projectEntries.length) return await demoCatalog(catalog.site);
        return orderedCatalog(
          bookEntries.map(publishedBook).filter(Boolean),
          projectEntries.map(publishedProject).filter(Boolean),
          Array.isArray(catalog.order) ? catalog.order : [],
          catalog.site,
        );
      }
    }
  } catch {
    // The viewer can still offer navigation and a localized retry hint.
  }
  return { ...orderedCatalog([]), unavailable: true };
}

export async function loadBooks() {
  return (await loadCatalog()).books;
}
