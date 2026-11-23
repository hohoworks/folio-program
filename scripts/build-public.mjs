import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { catalogAssets, checkSite } from './check-site.mjs';
import { titleLanguage } from '../dist/title-language.js';
import { localizedSiteTitles, migrateStarterSite } from '../dist/site-title.js';

const program = [
  'index.html', '404.html', '_headers', 'assets/folio.svg', 'assets/sewn-signatures.webp', 'style.css', 'mobile-reader.css', 'web-fonts.js',
  'viewer.js', 'catalog.js', 'shelf.js', 'book-material.js', 'mockup-options.js', 'project-tags.js', 'project-media.js', 'title-language.js', 'site-language.js', 'site-title.js', 'curl.js', 'mobile-reader.js',
  'punctuation.js', 'book-format.js', 'book-surfaces.js', 'book-surfaces.css', 'assets/fonts/hoho-punctuation.woff2', 'assets/fonts/OFL.txt',
];
const demoProgram = ['library.js', 'book.js', 'demo-projects.js'];
const programPaths = new Set([...program, ...demoProgram, ...catalogAssets({ books: [], demo: true })]);
// Paths relative to the program repository's dist directory. No user catalogue or uploads.
export const programDistributionFiles = Object.freeze([...programPaths]);

function visitorFields({ revision, lastMutationId, ...fields }) {
  return fields;
}

function publishedItems(items) {
  if (!Array.isArray(items)) throw new Error('작업 목록 형식을 확인해주세요.');
  return items.filter(item => {
    if (!item || (item.published !== undefined && typeof item.published !== 'boolean')) {
      throw new Error('작업의 공개 설정을 확인해주세요.');
    }
    return item.published !== false;
  }).map(visitorFields);
}

function publicCatalog(source) {
  const books = publishedItems(source.books);
  const projects = publishedItems(source.projects ?? []);
  const ids = new Set([...books, ...projects].map(item => item.id));
  return {
    demo: source.demo === true && !source.books.length && !source.projects?.length,
    ...(source.site && { site: visitorFields(migrateStarterSite(source.site)) }),
    books, projects,
    ...(source.order != null && { order: source.order.filter(id => ids.has(id)) }),
  };
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function renderSiteTitle(html, site) {
  const { ko, en } = localizedSiteTitles(site);
  const koText = escapeHtml(ko);
  const enText = escapeHtml(en);
  const wordmark = `<a href="#project" class="wordmark" lang="${titleLanguage(ko)}" data-en-lang="${titleLanguage(en)}">${koText}</a>`;
  return html.replace('<title>포트폴리오</title>', () => `<title data-en="${enText}">${koText}</title>`)
    .replace('<a href="#project" class="wordmark" aria-label="홈"></a>', () => wordmark);
}

function contains(parent, path) {
  const suffix = relative(parent, path);
  return suffix !== '..' && !suffix.startsWith('..' + sep) && !isAbsolute(suffix);
}

// The HTML and its module imports must start using a new URL together on each code change.
async function versionClientAssets(directory, paths) {
  const assets = paths.filter(path => /\.(?:css|js)$/.test(path));
  const sources = new Map(await Promise.all([...assets, 'index.html', '404.html'].map(async path =>
    [path, await readFile(join(directory, path), 'utf8')])));
  const hash = createHash('sha256');
  for (const path of assets) {
    hash.update(path).update('\0').update(sources.get(path)).update('\0');
  }
  const version = hash.digest('hex').slice(0, 16);
  const htmlAsset = /(\b(?:src|href)=)(["'])((?:\.\/|\/)([\w-]+\.(?:js|css)))\2/g;
  const moduleImport = /(\b(?:from\s+|import\s*(?:\(\s*)?))(["'])(\.\/([\w-]+\.js))\2/g;
  for (const [path, source] of sources) {
    if (path.endsWith('.css')) continue;
    const reference = path.endsWith('.html') ? htmlAsset : moduleImport;
    const updated = source.replace(reference, (match, prefix, quote, url, file) =>
      sources.has(file) ? prefix + quote + url + '?v=' + version + quote : match);
    if (updated !== source) await writeFile(join(directory, path), updated);
  }
}

async function sourceDirectory(path) {
  if (!isAbsolute(path) || !(await lstat(path)).isDirectory()) throw new Error('원본 폴더의 절대 경로를 확인해주세요.');
  return realpath(path);
}

async function statIfPresent(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

// Resolve symlinked parents and the actual case of existing path components.
async function canonicalPath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return join(await canonicalPath(dirname(path)), basename(path));
  }
}

// Content is read from a single checkout. An absent file must fail the build, even if
// a file with the same name exists in the program checkout or the previous release.
export async function buildPublic(projectRoot, { contentDir, outputDir } = {}) {
  const root = await realpath(projectRoot);
  const programDir = await sourceDirectory(join(root, 'dist'));
  const content = contentDir === undefined ? programDir : await sourceDirectory(contentDir);
  const destination = outputDir ?? join(root, 'public-site');
  if (!isAbsolute(destination)) throw new Error('공개 폴더에는 절대 경로를 지정해주세요.');
  const existing = await statIfPresent(destination);
  if (existing && !existing.isDirectory()) throw new Error('공개 폴더는 일반 디렉터리로 지정해주세요.');
  const output = await canonicalPath(destination);
  const parent = dirname(output);
  if ([programDir, content].some(source => contains(output, source) || contains(source, output))) {
    throw new Error('공개 폴더는 프로그램과 작품 원본 폴더 밖에 지정해주세요.');
  }
  const catalogPath = join(content, 'catalog.json');
  if (await realpath(catalogPath) !== catalogPath || !(await lstat(catalogPath)).isFile()) {
    throw new Error('작업 목록 파일 경로를 확인해주세요.');
  }
  const catalog = publicCatalog(JSON.parse(await readFile(catalogPath, 'utf8')));
  const paths = [...program, ...(catalog.demo ? demoProgram : []), ...catalogAssets(catalog)];
  await mkdir(parent, { recursive: true });
  const work = await mkdtemp(join(parent, '.folio-build-'));
  const staging = join(work, 'new');
  const previous = join(work, 'previous');
  await mkdir(staging);
  let movedPrevious = false;
  try {
    // Limit simultaneous disk reads when a catalogue contains thousands of book pages.
    for (let start = 0; start < paths.length; start += 16) {
      const copies = await Promise.allSettled(paths.slice(start, start + 16).map(async path => {
        const input = join(programPaths.has(path) ? programDir : content, path);
        if (await realpath(input) !== input || !(await lstat(input)).isFile()) {
          throw new Error('일반 파일만 게시할 수 있습니다. ' + path);
        }
        const target = join(staging, path);
        await mkdir(dirname(target), { recursive: true });
        if (path === 'index.html') {
          const html = await readFile(input, 'utf8');
          await writeFile(target, renderSiteTitle(html, catalog.site));
        } else {
          await copyFile(input, target);
        }
      }));
      for (const copy of copies) if (copy.status === 'rejected') throw copy.reason;
    }
    await versionClientAssets(staging, paths);
    await writeFile(join(staging, 'catalog.json'), JSON.stringify(catalog));
    const result = await checkSite(pathToFileURL(staging + sep));
    const old = await statIfPresent(output);
    if (old) {
      if (!old.isDirectory() || !(await lstat(join(output, 'catalog.json'))).isFile() ||
          !(await lstat(join(output, '_headers'))).isFile()) throw new Error('public-site 폴더의 내용을 확인해주세요.');
      await rename(output, previous);
      movedPrevious = true;
    }
    await rename(staging, output);
    movedPrevious = false;
    return result;
  } finally {
    if (movedPrevious) await rename(previous, output);
    await rm(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  const outputDir = process.env.FOLIO_PUBLIC_OUTPUT ?? join(projectRoot, 'public-site');
  const { files, totalBytes } = await buildPublic(projectRoot, { contentDir: process.env.FOLIO_CONTENT_DIR, outputDir });
  console.log('공개 배포 준비 완료 · ' + basename(outputDir) + ' · 파일 ' + files + '개 · ' + (totalBytes / 1048576).toFixed(2) + ' MiB');
}
