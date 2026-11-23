import { lstat, readdir, readFile } from 'node:fs/promises';
import { demoProjects } from '../dist/demo-projects.js';
import { isProjectVideoPath, projectEmbedURL, projectMedia } from '../dist/project-media.js';
import { STOCK_PROJECT_TAGS } from '../dist/project-tags.js';

export function catalogAssets(catalog) {
  const images = new Set();
  function requireImage(path, owner) {
    if (typeof path !== 'string' || !/^(?:\.\/)?assets\/(?:books|projects|site)\/(?:[\w-]+\/)+[\w.-]+\.(?:png|jpe?g|webp)$/i.test(path)) {
      throw new Error('이미지 경로 형식을 확인해주세요. ' + owner);
    }
    images.add(path.replace(/^\.\//, ''));
  }
  if (!Array.isArray(catalog.books) || (catalog.projects != null && !Array.isArray(catalog.projects))) {
    throw new Error('책과 작업 목록 형식을 확인해주세요.');
  }
  const entries = [...catalog.books, ...(catalog.projects || [])];
  const tags = catalog.site?.projectTags === undefined ? STOCK_PROJECT_TAGS : catalog.site.projectTags;
  if (!Array.isArray(tags) || tags.length > 100) throw new Error('프로젝트 태그 목록을 확인해주세요.');
  const tagIds = new Set();
  for (const tag of tags) {
    if (!tag || typeof tag.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(tag.id) ||
        tagIds.has(tag.id) || typeof tag.ko !== 'string' || !tag.ko.trim() || tag.ko.length > 80 ||
        (tag.en != null && (typeof tag.en !== 'string' || tag.en.length > 80))) {
      throw new Error('프로젝트 태그 이름과 ID를 확인해주세요.');
    }
    tagIds.add(tag.id);
  }
  const ids = new Set();
  for (const item of entries) {
    if (!item || typeof item.id !== 'string' || !/^[\w-]+$/.test(item.id) || ids.has(item.id) ||
        typeof item.title !== 'string' || !item.title.trim()) {
      throw new Error('작업 ID와 제목을 확인해주세요.');
    }
    ids.add(item.id);
    if (item.thumbnailSrc !== undefined) requireImage(item.thumbnailSrc, item.title);
    if (item.tagIds !== undefined && (!Array.isArray(item.tagIds) ||
        item.tagIds.some(id => !tagIds.has(id)) || new Set(item.tagIds).size !== item.tagIds.length)) {
      throw new Error('작업에 지정된 태그를 확인해주세요. ' + item.title);
    }
  }
  for (const book of catalog.books) {
    requireImage(book.coverImages?.front, book.title);
    if (book.coverImages.back) requireImage(book.coverImages.back, book.title);
    if (book.coverImages.spine) requireImage(book.coverImages.spine, book.title);
    if (!Array.isArray(book.pages) || !book.pages.length) throw new Error('내지가 비어 있습니다. ' + book.title);
    if (book.firstPageSide != null && !['left', 'right'].includes(book.firstPageSide)) throw new Error('첫 페이지 위치를 확인해주세요. ' + book.title);
    if (book.joinSplitPages === true && book.pages.length % 2) throw new Error('반쪽 이미지를 합치려면 짝이 모두 있어야 합니다. ' + book.title);
    for (const [index, page] of book.pages.entries()) {
      if (book.bookForm === 'cards' && index % 2 === 1 && page?.blank === true && !page.imageSrc) continue;
      requireImage(page?.imageSrc, book.title);
    }
    for (const edge of Object.values(book.edgeTreatments || {})) {
      if (edge?.mode === 'scan') requireImage(edge.imageSrc, book.title);
    }
    if (book.galleryImages != null && !Array.isArray(book.galleryImages)) throw new Error('책의 프로젝트 이미지 목록을 확인해주세요. ' + book.title);
    for (const picture of book.galleryImages || []) requireImage(picture?.imageSrc, book.title);
  }
  if (catalog.site != null) {
    const { site } = catalog;
    if (!site || typeof site !== 'object' || typeof site.title !== 'string' ||
        (site.about != null && (typeof site.about !== 'object' || typeof site.about.text !== 'string')) ||
        (site.contact != null && (typeof site.contact !== 'object' || !Array.isArray(site.contact.links)))) {
      throw new Error('사이트 소개와 연락처 형식을 확인해주세요.');
    }
    if (site.about?.imageSrc) requireImage(site.about.imageSrc, 'About');
    for (const link of site.contact?.links || []) {
      let url;
      try { url = new URL(link.url); } catch { throw new Error('Contact 링크 주소를 확인해주세요.'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
          typeof link.label !== 'string' || !link.label.trim()) {
        throw new Error('Contact 링크 이름과 주소를 확인해주세요.');
      }
    }
  }
  for (const project of catalog.projects || []) {
    const media = projectMedia(project);
    if (!media.length) throw new Error('작업 미디어가 비어 있습니다. ' + project.title);
    for (const entry of media) {
      if (entry?.type === 'image' && /^(?:\.\/)?assets\/projects\//.test(entry.imageSrc)) requireImage(entry.imageSrc, project.title);
      else if (entry?.type === 'video' && isProjectVideoPath(entry.videoSrc)) images.add(entry.videoSrc.replace(/^\.\//, ''));
      else if (entry?.type !== 'embed' || !projectEmbedURL(entry.url)) throw new Error('프로젝트 미디어 형식을 확인해주세요. ' + project.title);
    }
  }
  if (catalog.order != null && (!Array.isArray(catalog.order) || catalog.order.length !== ids.size ||
      new Set(catalog.order).size !== ids.size || !catalog.order.every(id => ids.has(id)))) {
    throw new Error('공개 순서와 작업 목록이 일치하는지 확인해주세요.');
  }

  if (catalog.demo === true && entries.length === 0) {
    images.add('assets/forest.jpg');
    images.add('assets/forest-cover.webp');
    for (const project of demoProjects) {
      images.add(project.thumbnailSrc);
      for (const image of project.images) images.add(image.imageSrc);
    }
  }
  return images;
}

export async function checkSite(root) {
  const maxFiles = 20000;
  const maxFileBytes = 25 * 1024 * 1024;
  const files = new Set();
  let totalBytes = 0;

  async function inspectDirectory(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix + entry.name;
      const url = new URL(entry.name, directory);
      if (entry.isSymbolicLink()) throw new Error('심볼릭 링크 파일은 게시할 수 없습니다. ' + relative);
      if (entry.isDirectory()) {
        await inspectDirectory(new URL(entry.name + '/', directory), relative + '/');
        continue;
      }
      if (!entry.isFile()) throw new Error('일반 파일만 게시할 수 있습니다. ' + relative);
      const { size } = await lstat(url);
      if (size > maxFileBytes) throw new Error('파일 하나는 25 MiB 이하여야 합니다. ' + relative);
      if (/^(?:\.env|\.dev\.vars)|\.(?:pem|key)$/i.test(entry.name)) {
        throw new Error('공개 폴더의 비밀 설정 파일을 확인해주세요. ' + relative);
      }
      files.add(relative);
      totalBytes += size;
    }
  }
  await inspectDirectory(root);
  for (const path of ['index.html', '404.html', '_headers', 'assets/folio.svg']) {
    if (!files.has(path)) throw new Error('공개 사이트에 필요한 파일이 없습니다. ' + path);
  }
  if (files.size > maxFiles) throw new Error('Cloudflare Pages 무료 플랜의 파일 20,000개 한도를 넘었습니다.');
  const catalog = JSON.parse(await readFile(new URL('catalog.json', root), 'utf8'));
  for (const path of catalogAssets(catalog)) {
    if (!files.has(path)) throw new Error('이미지 파일이 없습니다. ' + path);
  }
  return { files: files.size, totalBytes };
}

if (import.meta.main) {
  const { files, totalBytes } = await checkSite(new URL('../dist/', import.meta.url));
  console.log('작업 원본 검사 완료 · ' + files + '개 파일 · ' + (totalBytes / 1048576).toFixed(1) + ' MiB');
}
