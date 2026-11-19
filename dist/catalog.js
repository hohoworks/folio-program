import { STOCK_PROJECT_TAGS, idsFor } from './project-tags.js';
import { localizedSiteTitles } from './site-title.js';

const positive = value => Number.isFinite(value) && value > 0;
const assetPath = /^(?:\.\/)?assets\/(books|projects|site)\/(?:[\w-]+\/)+[\w.-]+\.(?:png|jpe?g|webp)$/i;
function asset(value, folder = 'books') {
  if (typeof value !== 'string') return false;
  return assetPath.exec(value)?.[1].toLowerCase() === folder;
}
const bindings = ['paperback', 'hardcover', 'saddle-stitch', 'exposed-sewn'];

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

export function trimSize(book) {
  if (book.trimSizeMm) return book.trimSizeMm;
  const ratio = book.coverRatio;
  if (!ratio) return [148, 210];
  return ratio >= 1 ? [210, 210 / ratio] : [210 * ratio, 210];
}

export function spineRatio(book) {
  const paperWidth = book.pages.length * .1;
  let estimate = Math.max(3.5, paperWidth + .5);
  switch (book.bindingType) {
    case 'hardcover': estimate = Math.max(5, paperWidth + 4.5); break;
    case 'saddle-stitch': estimate = Math.min(4, Math.max(1, paperWidth)); break;
    case 'exposed-sewn': estimate = Math.max(3, paperWidth); break;
  }
  return (book.spineWidthMm ?? estimate) / trimSize(book)[0];
}

function publishedBook(book) {
  if (!book || book.published === false || typeof book.id !== 'string' || !/^[\w-]+$/.test(book.id)
      || typeof book.title !== 'string' || !book.title.trim()
      || !asset(book.coverImages?.front) || !positive(book.coverRatio) || !positive(book.pageRatio)
      || !Array.isArray(book.pages) || !book.pages.length || !book.pages.every(page => asset(page?.imageSrc))) {
    return null;
  }

  return {
    type: 'book',
    translations: englishFields(book),
    id: book.id,
    title: book.title,
    category: typeof book.category === 'string' ? book.category : '',
    tagIds: Array.isArray(book.tagIds) ? book.tagIds.filter(id => typeof id === 'string') : undefined,
    description: Array.isArray(book.description) ? book.description.filter(line => typeof line === 'string') : [],
    year: typeof book.year === 'string' || Number.isFinite(book.year) ? String(book.year) : '',
    language: typeof book.language === 'string' ? book.language : '',
    bindingType: bindings.includes(book.bindingType) ? book.bindingType : 'paperback',
    trimSizeMm: book.trimSizeMm?.length === 2 && Array.isArray(book.trimSizeMm) && book.trimSizeMm.every(positive)
      ? book.trimSizeMm : undefined,
    spineWidthMm: positive(book.spineWidthMm) ? book.spineWidthMm : undefined,
    coverRatio: book.coverRatio,
    pageRatio: book.pageRatio,
    thumbnailSrc: asset(book.thumbnailSrc) ? book.thumbnailSrc : undefined,
    coverImages: {
      front: book.coverImages.front,
      back: asset(book.coverImages.back) ? book.coverImages.back : undefined,
      spine: asset(book.coverImages.spine) ? book.coverImages.spine : undefined,
    },
    galleryImages: Array.isArray(book.galleryImages)
      ? book.galleryImages.filter(image => asset(image?.imageSrc)).map(image => ({
        imageSrc: image.imageSrc,
        alt: typeof image.alt === 'string' ? image.alt : '',
      })) : [],
    pages: book.pages,
  };
}

function publishedProject(project) {
  if (!project || project.published === false || typeof project.id !== 'string' || !/^[\w-]+$/.test(project.id)
      || typeof project.title !== 'string' || !project.title.trim()
      || !Array.isArray(project.images) || !project.images.length
      || !project.images.every(image => asset(image?.imageSrc, 'projects'))) {
    return null;
  }
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
    images: project.images.map(image => ({
      imageSrc: image.imageSrc,
      alt: typeof image.alt === 'string' ? image.alt : '',
      ...(positive(image.ratio) ? { ratio: image.ratio } : {}),
    })),
  };
}

function contactURL(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function publicLink(link) {
  const url = contactURL(link?.url);
  let label = typeof link?.label === 'string' ? link.label.trim() : '';
  if (!url || !label) return null;
  if (/^(instagram|인스타그램)$/i.test(label)) {
    const profile = new URL(url);
    const handle = /^\/([a-z\d_](?:[a-z\d._]{0,28}[a-z\d_])?)\/?$/i.exec(profile.pathname)?.[1];
    if (handle && !handle.includes('..') && !profile.port && /^(www\.)?instagram\.com$/.test(profile.hostname)) {
      label = '@' + handle;
    }
  }
  return { label, url };
}

function siteSettings(site) {
  const text = value => typeof value === 'string' ? value : '';
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
      email: /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(text(site?.contact?.email)) ? site.contact.email : '',
      links: links.map(publicLink).filter(Boolean),
    },
    translations: {
      en: {
        title: text(site?.translations?.en?.title),
        about: {
          heading: text(site?.translations?.en?.about?.heading).trim() || 'About',
          text: text(site?.translations?.en?.about?.text).trim()
            ? site.translations.en.about.text
            : text(site?.about?.text).trim() ? '' : 'A portfolio of books and design work.',
        },
        contact: { text: text(site?.translations?.en?.contact?.text) },
      },
    },
  };
}

function orderedCatalog(bookEntries, projects = [], order = [], site) {
  const settings = siteSettings(site);
  const entries = [...bookEntries, ...projects].map(entry => ({
    ...entry, tagIds: idsFor(entry, entry.type, settings.projectTags),
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
  const catalog = orderedCatalog(books.map(book => ({ ...book, type: 'book' })), demoProjects, demoOrder, site);
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
