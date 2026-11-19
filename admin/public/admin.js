import { clearDraft, deleteFile, fileSignature, loadDraft, loadFile, saveDraft, saveFile } from '/draft-store.js';
import { errorMessage, postJson, request, uploadImage } from '/upload-request.js';
import { createSiteEditor } from '/site-settings.js';
import { STOCK_PROJECT_TAGS, idsFor } from './project-tags.js';
import { encodeWebImage, encodeThumbnail, imageTargetBytes } from './image-encoding.js';

const $ = selector => document.querySelector(selector);
const form = $('#book-form');
const fields = $('#book-fields');
const publish = $('#publish');
const progress = $('#upload-progress');
const status = $('#form-status');
const error = $('#form-error');
const notice = $('#draft-notice');
const metadataFields = ['title', 'description', 'category', 'title-en', 'description-en', 'category-en', 'year', 'language', 'language-en', 'trim-width', 'trim-height', 'spine-width', 'binding-type', 'page-layout'];
const checkboxFields = ['published', 'back-remove', 'spine-remove'];
const metadataDefaults = { 'binding-type': 'paperback', 'page-layout': 'single', published: true };
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const pageLimit = 1000;
const pdfRoot = '/vendor/pdfjs/';
const fileLabels = { front: '앞표지', back: '뒤표지', spine: '책등', interior: '내지 PDF' };
let pdfLibrary;
let state;
let catalog = [];
let fileMemory = new Map();
let persistence = Promise.resolve();
let pendingFiles = new Set();
let activeController;
let busy = false;
let catalogBusy = false;
let generation = 0;
let previewVersion = 0;
let saveTimer;
let filePersistence = true;
let editorBusy = false;
let siteBusy = false;
let siteEditor;
let projectTags = STOCK_PROJECT_TAGS;
let tagsLoaded = false;
let lastCommittedSite;

function updateTabTitle() {
  const section = $('#site-panel').hidden ? '작업 관리' : '사이트 설정';
  document.title = section + ' · ' + $('.wordmark').textContent;
}

function renderSiteName(site) {
  const name = site.title?.trim() || site.translations?.en?.title?.trim() || 'HOHO WORKS';
  const mark = $('.wordmark');
  mark.textContent = name;
  mark.title = name;
  mark.lang = /\p{Script=Hangul}/u.test(name) ? 'ko' : 'en';
  updateTabTitle();
}

function emptyDraft() {
  return {
    version: 2,
    draftId: crypto.randomUUID(),
    registrationId: crypto.randomUUID(),
    kind: 'book',
    item: null,
    metadata: { ...metadataDefaults },
    files: {},
    images: [],
    galleryImages: [],
    galleryDirty: false,
    tagIds: null,
    tagsTouched: false,
    uploads: {},
    pdf: null,
    commitPayload: null,
  };
}

function persist() {
  state.updated = Date.now();
  const snapshot = structuredClone(state);
  persistence = persistence.catch(() => {}).then(async () => {
    const result = await saveDraft(snapshot);
    if (!result.saved) notice.textContent = '브라우저 저장소를 사용할 수 없습니다. 이 창에서 계속 작업해주세요.';
    else if (!result.filesSupported || !filePersistence) {
      notice.textContent = '진행 상황을 저장했습니다. 다시 접속하면 원본 파일을 재선택해야 할 수 있습니다.';
    }
  });
  return persistence;
}

function readMetadata() {
  for (const id of metadataFields) state.metadata[id] = $('#' + id).value;
  for (const id of checkboxFields) state.metadata[id] = $('#' + id).checked;
  state.kind = $('#kind').value;
  if (tagsLoaded) state.tagIds = [...$('#work-tags').querySelectorAll('input:checked')].map(input => input.value);
}

function writeMetadata() {
  for (const id of metadataFields) $('#' + id).value = state.metadata[id] ?? '';
  for (const id of checkboxFields) $('#' + id).checked = Boolean(state.metadata[id]);
  $('#kind').value = state.kind;
  renderWorkTags();
}

function renderWorkTags() {
  if (!tagsLoaded || !state) return;
  if (!Array.isArray(state.tagIds)) state.tagIds = idsFor(state.item || {}, state.kind, projectTags);
  $('#work-tags').replaceChildren(...projectTags.map(tag => {
    const label = document.createElement('label');
    label.className = 'check-label';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'tagIds';
    input.value = tag.id;
    input.checked = state.tagIds.includes(tag.id);
    label.append(input, document.createTextNode(tag.ko + (tag.en && tag.en !== tag.ko ? ' / ' + tag.en : '')));
    return label;
  }));
}

function updateView() {
  if (!state) return;
  const isBook = state.kind === 'book';
  $('#book-specific').hidden = !isBook;
  $('#book-specific').disabled = !isBook;
  $('#project-specific').hidden = false;
  $('#project-specific').disabled = false;
  $('#project-heading').textContent = isBook ? '프로젝트 이미지 · 선택' : '프로젝트 이미지';
  $('#gallery-help').textContent = isBook
    ? '책의 앞표지와 함께 프로젝트에서 보여줄 추가 이미지를 등록할 수 있습니다.'
    : '프로젝트에서 보여줄 이미지를 순서대로 추가해주세요.';
  $('#book-previews').hidden = !isBook;
  $('#kind').disabled = Boolean(state.item) || pendingFiles.size > 0;
  $('#editor-heading').textContent = state.item ? '작업 수정' : '작업 추가';
  $('#back-remove-row').hidden = !state.item?.coverImages?.back;
  $('#spine-remove-row').hidden = !state.item?.coverImages?.spine;
  $('#preview-binding').textContent = ' · ' + $('#binding-type').selectedOptions[0].textContent;
  const bindingHelp = {
    'saddle-stitch': '중철은 접힌 부분이 얇게 표시됩니다. 책등 이미지는 선택 사항입니다.',
    'exposed-sewn': '책등 이미지를 비워두면 노출된 실과 종이 결이 표시됩니다.',
  };
  $('#binding-help').textContent = bindingHelp[$('#binding-type').value] || '책등 이미지가 없으면 제본 방식에 맞춰 책등을 표시합니다.';
  fields.disabled = busy || editorBusy || siteBusy || Boolean(state.commitPayload);
  publish.disabled = !tagsLoaded || busy || editorBusy || siteBusy || catalogBusy || pendingFiles.size > 0;
  publish.textContent = state.commitPayload ? '저장 확인 →' : state.pdf?.pages.length ? '이어서 저장 →' : '저장 →';
  $('#pause').hidden = !busy;
  $('#cancel-upload').hidden = !busy;
  $('#logout').disabled = busy || siteBusy || editorBusy;
  $('#new-item').disabled = busy || siteBusy || editorBusy || pendingFiles.size > 0;
  $('#refresh-catalogue').disabled = busy || siteBusy || editorBusy || catalogBusy;
  for (const id of ['nav-work', 'nav-site']) $('#' + id).disabled = busy || siteBusy || editorBusy || pendingFiles.size > 0;
  for (const key of Object.keys(fileLabels)) updateFileState(key);
}

function previewPath(path) {
  return '/api/preview?path=' + encodeURIComponent(path);
}

function showPreview(image, source, placeholderText) {
  const placeholder = image.previousElementSibling;
  if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src);
  if (source) image.src = typeof source === 'string' ? source : URL.createObjectURL(source);
  else image.removeAttribute('src');
  image.hidden = !source;
  placeholder.hidden = Boolean(source);
  if (!source) placeholder.textContent = placeholderText;
}

function updateFileState(key) {
  const element = $('#' + key + '-state');
  const descriptor = state.files[key];
  const existing = key === 'interior' ? state.item?.pages?.length : state.item?.coverImages?.[key];
  if (descriptor) {
    const available = fileMemory.has(key);
    element.textContent = descriptor.name + (available ? ' · 선택됨' : ' · 같은 파일을 다시 선택해주세요.');
  } else {
    element.textContent = existing ? '기존 파일 유지 · 교체할 때 선택해주세요.' : '';
  }
}

function getFile(key) {
  const file = fileMemory.get(key);
  if (!file) throw new Error((fileLabels[key] || '이미지') + ' 원본을 다시 선택해주세요. 저장한 진행 상황에서 이어갑니다.');
  return file;
}

async function setFile(key, file) {
  const currentGeneration = generation;
  const signature = await fileSignature(file);
  if (currentGeneration !== generation) return;
  const previous = state.files[key];
  if (previous && previous.signature !== signature && !fileMemory.has(key) &&
      !window.confirm('저장된 원본과 다른 파일입니다. 이 파일의 업로드 진행 상황을 비우고 교체할까요?')) {
    return;
  }
  if (previous?.signature !== signature) {
    delete state.uploads[key];
    if (key === 'interior') state.pdf = null;
    state.commitPayload = null;
    state.registrationId = crypto.randomUUID();
  }
  const storageKey = state.draftId + ':' + key;
  state.files[key] = {
    storageKey, signature, name: file.name, size: file.size,
    type: file.type, lastModified: file.lastModified,
  };
  if (key === 'back' || key === 'spine') {
    state.metadata[key + '-remove'] = false;
    $('#' + key + '-remove').checked = false;
  }
  fileMemory.set(key, file);
  filePersistence = await saveFile(storageKey, file) && filePersistence;
  await persist();
}

function trackFileTask(task) {
  pendingFiles.add(task);
  updateView();
  task.catch(cause => { error.textContent = errorMessage(cause); }).finally(() => {
    pendingFiles.delete(task);
    updateView();
  });
}

for (const key of Object.keys(fileLabels)) {
  $('#' + key).addEventListener('change', () => {
    const file = $('#' + key).files[0];
    if (!file) return;
    error.textContent = '';
    trackFileTask(setFile(key, file).then(() => updateBookPreviews()));
  });
}

form.addEventListener('input', event => {
  if (event.target.type === 'file' || event.target.closest('#project-image-list')) return;
  readMetadata();
  if (event.target.name === 'tagIds') state.tagsTouched = true;
  state.registrationId = crypto.randomUUID();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 250);
});

form.addEventListener('change', event => {
  if (event.target.type === 'file' || event.target.closest('#project-image-list')) return;
  readMetadata();
  if (event.target.id === 'kind' && !state.item && !state.tagsTouched) {
    state.tagIds = idsFor({}, state.kind, projectTags);
    renderWorkTags();
  }
  if (event.target.id === 'page-layout') state.pdf = null;
  updateView();
  persist();
  if (event.target.id === 'kind') renderProjectImages();
  if (event.target.id === 'page-layout' || event.target.id === 'kind') updateBookPreviews();
});
function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

async function readCover(file, label) {
  if (!imageTypes.has(file.type) &&
      (file.type || !/\.(?:jpe?g|png|webp)$/i.test(file.name))) {
    throw new Error(label + '는 PNG, JPG, WebP 파일로 선택해주세요.');
  }
  const source = URL.createObjectURL(file);
  const image = new Image();
  image.src = source;
  try {
    await image.decode();
    return image;
  } catch {
    throw new Error(label + ' 이미지를 열 수 없습니다.');
  } finally {
    URL.revokeObjectURL(source);
  }
}

async function convertCover(file, label, thumbnail = false) {
  const image = await readCover(file, label);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const ratio = width / height;
  const scale = Math.min(1, 2200 / Math.max(width, height));
  let blob = file;
  if (scale < 1 || file.size > imageTargetBytes || !imageTypes.has(file.type)) {
    const canvas = createCanvas(width * scale, height * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    try {
      blob = await encodeWebImage(canvas);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  const preview = thumbnail ? await encodeThumbnail(image, blob).catch(() => null) : null;
  return { blob, ratio, thumbnail: preview };
}

async function loadPDF(file) {
  if (!pdfLibrary) {
    pdfLibrary = await import(pdfRoot + 'pdf.mjs');
    pdfLibrary.GlobalWorkerOptions.workerSrc = pdfRoot + 'pdf.worker.mjs';
  }
  const task = pdfLibrary.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: pdfRoot + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: pdfRoot + 'standard_fonts/',
    wasmUrl: pdfRoot + 'wasm/',
    iccUrl: pdfRoot + 'iccs/',
    isEvalSupported: false,
    disableWorkerRendering: true,
  });
  try {
    return await task.promise;
  } catch (cause) {
    await task.destroy().catch(() => {});
    const message = cause.name === 'PasswordException'
      ? '암호를 해제한 PDF를 선택해주세요.'
      : 'PDF를 열 수 없습니다. 파일을 확인해주세요.';
    throw new Error(message, { cause });
  }
}

async function renderPDFPage(page, pagesPerSheet, side, maxSize) {
  const bounds = page.getViewport({ scale: 1 });
  const ratio = bounds.width / pagesPerSheet / bounds.height;
  const scale = maxSize / Math.max(bounds.width / pagesPerSheet, bounds.height);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(viewport.width / pagesPerSheet, viewport.height);
  try {
    await page.render({
      canvas,
      canvasContext: canvas.getContext('2d', { alpha: false }),
      viewport,
      transform: side ? [1, 0, 0, 1, -viewport.width / pagesPerSheet, 0] : undefined,
      background: '#fff',
    }).promise;
    return { blob: await encodeWebImage(canvas), ratio };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}


async function updateBookPreviews() {
  const version = ++previewVersion;
  const cover = $('#cover-preview');
  const pdfImage = $('#pdf-preview');
  const count = $('#preview-page-count');
  const coverFile = fileMemory.get('front');
  const savedFront = !state.files.front && state.item?.coverImages?.front;
  showPreview(cover, savedFront ? previewPath(savedFront) : null, state.files.front ? '앞표지 원본을 다시 선택해주세요.' : '앞표지를 선택해주세요.');
  if (coverFile) {
    try {
      const { blob } = await convertCover(coverFile, '앞표지');
      if (version === previewVersion) showPreview(cover, blob);
    } catch (cause) {
      if (version === previewVersion) showPreview(cover, null, errorMessage(cause));
    }
  }
  if (version !== previewVersion) return;
  const firstPage = !state.files.interior && state.item?.pages?.[0]?.imageSrc;
  showPreview(pdfImage, firstPage ? previewPath(firstPage) : null, state.files.interior ? '내지 PDF 원본을 다시 선택해주세요.' : '내지 PDF를 선택해주세요.');
  count.textContent = state.item?.pages?.length ? ' · 총 ' + state.item.pages.length + '쪽' : '';
  const file = fileMemory.get('interior');
  if (!file) return;
  showPreview(pdfImage, null, 'PDF 미리보기 만드는 중…');
  let pdf;
  try {
    pdf = await loadPDF(file);
    if (version !== previewVersion) return;
    const pagesPerSheet = state.metadata['page-layout'] === 'spread' ? 2 : 1;
    const page = await pdf.getPage(1);
    const { blob } = await renderPDFPage(page, pagesPerSheet, 0, 480);
    if (version === previewVersion) {
      showPreview(pdfImage, blob);
      count.textContent = ' · 총 ' + pdf.numPages * pagesPerSheet + '쪽';
    }
  } catch (cause) {
    if (version === previewVersion) showPreview(pdfImage, null, errorMessage(cause));
  } finally {
    if (pdf) await pdf.loadingTask.destroy().catch(() => {});
  }
}

function createButton(text, label, action, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-button';
  button.textContent = text;
  button.setAttribute('aria-label', label);
  button.disabled = disabled;
  button.addEventListener('click', action);
  return button;
}

function currentImages() {
  return state.kind === 'book' ? state.galleryImages : state.images;
}

function markImagesChanged() {
  state.registrationId = crypto.randomUUID();
  if (state.kind === 'book') state.galleryDirty = true;
}

function renderProjectImages() {
  const list = $('#project-image-list');
  for (const image of list.querySelectorAll('img')) {
    if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src);
  }
  const images = currentImages();
  list.replaceChildren(...images.map((image, index) => {
    const item = document.createElement('li');
    const preview = document.createElement('img');
    const file = image.fileKey && fileMemory.get(image.fileKey);
    preview.alt = image.alt || '프로젝트 이미지 ' + (index + 1);
    if (file) preview.src = URL.createObjectURL(file);
    else if (image.imageSrc) preview.src = previewPath(image.imageSrc);
    else preview.alt = '이미지 원본을 다시 선택해주세요.';
    const content = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = '이미지 설명';
    const alt = document.createElement('input');
    alt.type = 'text';
    alt.maxLength = 500;
    alt.value = image.alt || '';
    alt.addEventListener('input', () => {
      image.alt = alt.value;
      markImagesChanged();
      persist();
    });
    label.append(alt);
    content.append(label);
    if (image.fileKey && !file) {
      const retry = document.createElement('input');
      retry.type = 'file';
      retry.accept = 'image/png,image/jpeg,image/webp';
      retry.setAttribute('aria-label', '이미지 ' + (index + 1) + ' 원본 재선택');
      retry.addEventListener('change', () => {
        const replacement = retry.files[0];
        if (!replacement) return;
        trackFileTask(setFile(image.fileKey, replacement).then(renderProjectImages));
      });
      content.append(retry);
    }
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    actions.append(
      createButton('↑', '이미지 앞으로', () => moveProjectImage(index, -1), index === 0),
      createButton('↓', '이미지 뒤로', () => moveProjectImage(index, 1), index === images.length - 1),
      createButton('제거', '이미지 ' + (index + 1) + ' 제거', async () => {
        images.splice(index, 1);
        if (image.fileKey) {
          const descriptor = state.files[image.fileKey];
          fileMemory.delete(image.fileKey);
          delete state.files[image.fileKey];
          delete state.uploads[image.fileKey];
          if (descriptor) await deleteFile(descriptor.storageKey);
        }
        markImagesChanged();
        await persist();
        renderProjectImages();
      }),
    );
    item.append(preview, content, actions);
    return item;
  }));
}

function moveProjectImage(index, delta) {
  const images = currentImages();
  const [image] = images.splice(index, 1);
  images.splice(index + delta, 0, image);
  markImagesChanged();
  persist();
  renderProjectImages();
}

$('#project-images').addEventListener('change', () => {
  const files = [...$('#project-images').files];
  if (!files.length) return;
  const task = (async () => {
    for (const file of files) {
      const fileKey = 'project:' + crypto.randomUUID();
      await setFile(fileKey, file);
      currentImages().push({ id: crypto.randomUUID(), fileKey, alt: '' });
      markImagesChanged();
      await persist();
    }
    $('#project-images').value = '';
    renderProjectImages();
  })();
  trackFileTask(task);
});

function changeProgress(maximum, completed, message) {
  progress.max = maximum;
  progress.value = completed;
  progress.hidden = false;
  status.textContent = message;
}

function waitingMessage(seconds, rateLimited) {
  status.textContent = rateLimited
    ? '잠시 요청이 많습니다. ' + seconds + '초 후 이어서 저장합니다.'
    : '연결을 다시 시도합니다. ' + seconds + '초';
}

function checkpointStop(signal) {
  signal.throwIfAborted();
}

async function uploadFileAsset(key, label, signal, thumbnail = false) {
  let saved = state.uploads[key];
  const signature = state.files[key]?.signature;
  if (saved?.signature !== signature) saved = undefined;
  if (saved && (!thumbnail || saved.thumbnailReady)) return saved;
  if (saved && thumbnail && !fileMemory.has(key)) {
    saved.thumbnailAsset = null;
    saved.thumbnailReady = true;
    await persist();
    checkpointStop(signal);
    return saved;
  }
  checkpointStop(signal);
  const converted = await convertCover(getFile(key), label, thumbnail);
  if (!saved) {
    const asset = await uploadImage(converted.blob, signal, waitingMessage);
    saved = { asset, ratio: converted.ratio, signature };
    state.uploads[key] = saved;
    if (thumbnail) {
      await persist();
      checkpointStop(signal);
    }
  }
  if (thumbnail && !saved.thumbnailReady) {
    try {
      saved.thumbnailAsset = converted.thumbnail
        ? await uploadImage(converted.thumbnail, signal, waitingMessage) : null;
    } catch {
      checkpointStop(signal);
      saved.thumbnailAsset = null;
    }
    saved.thumbnailReady = true;
  }
  await persist();
  checkpointStop(signal);
  return saved;
}

function commonPayload() {
  const meta = state.metadata;
  return {
    registrationId: state.registrationId,
    ...(state.item ? { id: state.item.id, baseRevision: state.item.revision ?? null } : {}),
    title: meta.title.trim(),
    category: meta.category?.trim() || '',
    description: meta.description?.trim() || '',
    year: meta.year?.trim() || '',
    published: Boolean(meta.published),
    tagIds: (state.tagIds || []).filter(id => projectTags.some(tag => tag.id === id)),
    translations: {
      en: {
        title: meta['title-en']?.trim() || '',
        description: meta['description-en']?.trim() || '',
        category: meta['category-en']?.trim() || '',
        ...(state.kind === 'book' ? { language: meta['language-en']?.trim() || '' } : {}),
      },
    },
  };
}

async function prepareBook(signal) {
  const meta = state.metadata;
  if (Boolean(meta['trim-width']) !== Boolean(meta['trim-height'])) {
    throw new Error('재단 가로와 세로를 함께 입력해주세요.');
  }
  if (!state.item && !state.files.front) throw new Error('앞표지를 선택해주세요.');
  if (!state.item && !state.files.interior) throw new Error('내지 PDF를 선택해주세요.');
  const assets = {};
  for (const key of ['front', 'back', 'spine']) {
    if (meta[key + '-remove'] && key !== 'front') {
      assets[key] = null;
    } else if (state.files[key]) {
      status.textContent = fileLabels[key] + ' 저장 중…';
      const uploaded = await uploadFileAsset(key, fileLabels[key], signal, key === 'front');
      assets[key] = uploaded.asset;
      if (key === 'front') assets.thumbnail = uploaded.thumbnailAsset;
    }
  }
  let pdf;
  try {
    if (state.files.interior) {
      const signature = state.files.interior.signature;
      const pageLayout = meta['page-layout'];
      if (state.pdf?.signature !== signature || state.pdf.layout !== pageLayout) {
        state.pdf = { signature, layout: pageLayout, pages: [], ratio: null, total: null };
        await persist();
      }
      if (!state.pdf.total || state.pdf.pages.length < state.pdf.total) {
        status.textContent = 'PDF 확인 중…';
        pdf = await loadPDF(getFile('interior'));
        const pagesPerSheet = pageLayout === 'spread' ? 2 : 1;
        state.pdf.total = pdf.numPages * pagesPerSheet;
        if (state.pdf.total > pageLimit) throw new Error('내지는 ' + pageLimit + '쪽까지 등록할 수 있습니다.');
        await persist();
        while (state.pdf.pages.length < state.pdf.total) {
          checkpointStop(signal);
          const sheet = Math.floor(state.pdf.pages.length / pagesPerSheet) + 1;
          const page = await pdf.getPage(sheet);
          try {
            for (let side = state.pdf.pages.length % pagesPerSheet; side < pagesPerSheet; side++) {
              checkpointStop(signal);
              const current = state.pdf.pages.length + 1;
              changeProgress(state.pdf.total + 1, current - 1, '내지 저장 중 · ' + current + ' / ' + state.pdf.total + '쪽');
              const { blob, ratio } = await renderPDFPage(page, pagesPerSheet, side, 2000);
              const asset = await uploadImage(blob, signal, waitingMessage);
              state.pdf.pages.push(asset);
              state.pdf.ratio ??= ratio;
              await persist();
            }
          } finally {
            page.cleanup();
          }
        }
      }
      assets.pages = state.pdf.pages;
    }
  } finally {
    if (pdf) await pdf.loadingTask.destroy().catch(() => {});
  }
  checkpointStop(signal);
  const trimSizeMm = meta['trim-width'] ? [Number(meta['trim-width']), Number(meta['trim-height'])] : null;
  const spineRatio = state.uploads.spine?.ratio;
  const inferredSpineWidth = trimSizeMm && spineRatio ? trimSizeMm[1] * spineRatio : undefined;
  if (state.galleryDirty) assets.galleryImages = await prepareImages(signal, state.galleryImages);
  return {
    ...commonPayload(),
    language: meta.language?.trim() || '',
    bindingType: meta['binding-type'],
    trimSizeMm,
    spineWidthMm: meta['spine-width'] ? Number(meta['spine-width']) : inferredSpineWidth ?? null,
    pageRatio: state.pdf?.ratio ?? state.item?.pageRatio,
    coverRatio: state.uploads.front?.ratio ?? state.item?.coverRatio,
    assets,
  };
}

async function prepareProject(signal) {
  if (!state.images.length) throw new Error('프로젝트 이미지를 한 장 이상 추가해주세요.');
  const images = await prepareImages(signal, state.images, true);
  const first = state.images[0];
  const uploaded = first.fileKey && state.uploads[first.fileKey];
  const assets = { images };
  if (uploaded?.thumbnailReady) assets.thumbnail = uploaded.thumbnailAsset;
  return { ...commonPayload(), assets };
}

async function prepareImages(signal, entries, thumbnail = false) {
  if (entries.length > pageLimit) throw new Error('프로젝트 이미지는 1,000장까지 등록할 수 있습니다.');
  const images = [];
  for (let index = 0; index < entries.length; index++) {
    checkpointStop(signal);
    const image = entries[index];
    changeProgress(entries.length + 1, index, '이미지 저장 중 · ' + (index + 1) + ' / ' + entries.length);
    if (image.imageSrc) {
      images.push({
        imageSrc: image.imageSrc, alt: image.alt || '',
        ...(Number.isFinite(image.ratio) && image.ratio > 0 ? { ratio: image.ratio } : {}),
      });
    } else {
      const file = await uploadFileAsset(image.fileKey, '프로젝트 이미지', signal, thumbnail && index === 0);
      images.push({ ...file.asset, ratio: file.ratio || file.asset.ratio, alt: image.alt || '' });
    }
  }
  return images;
}

async function saveItem() {
  error.textContent = '';
  status.textContent = '저장 준비 중…';
  $('#relogin').hidden = true;
  busy = true;
  activeController = new AbortController();
  const signal = activeController.signal;
  readMetadata();
  clearTimeout(saveTimer);
  updateView();
  try {
    if (!state.metadata.title?.trim()) throw new Error('제목을 입력해주세요.');
    await persist();
    if (!state.commitPayload) {
      state.commitPayload = state.kind === 'book' ? await prepareBook(signal) : await prepareProject(signal);
      await persist();
    }
    checkpointStop(signal);
    status.textContent = '작업 저장 중…';
    const path = state.kind === 'book' ? '/api/books' : '/api/projects';
    await postJson(path, state.commitPayload, signal, waitingMessage);
    await clearEditor();
    changeProgress(1, 1, '작업을 저장했습니다.');
    await refreshCatalogue();
  } catch (cause) {
    if ([400, 409, 413, 415, 422].includes(cause.status)) {
      state.commitPayload = null;
      state.registrationId = crypto.randomUUID();
    }
    await persist();
    if (signal.aborted) {
      status.textContent = signal.reason?.message || '일시 정지했습니다. 이어서 저장할 수 있습니다.';
    } else {
      error.textContent = errorMessage(cause);
      status.textContent = state.commitPayload ? '저장 확인을 누르면 같은 요청을 다시 확인합니다.' : '';
      if (cause.status === 409) {
        status.textContent = '목록에서 최신 작업을 다시 열어 수정해주세요. 현재 입력은 임시 저장했습니다.';
        await refreshCatalogue();
      }
      $('#relogin').hidden = cause.status !== 401;
    }
  } finally {
    busy = false;
    activeController = null;
    updateView();
    renderCatalogue();
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  if (state && !publish.disabled) saveItem();
});

$('#pause').addEventListener('click', () => activeController?.abort(new Error('일시 정지했습니다. 이어서 저장할 수 있습니다.')));
$('#cancel-upload').addEventListener('click', () => activeController?.abort(new Error('작업을 중단하고 임시 저장했습니다. 이어서 저장할 수 있습니다.')));

async function clearEditor() {
  generation++;
  previewVersion++;
  clearTimeout(saveTimer);
  await persistence.catch(() => {});
  await clearDraft();
  state = emptyDraft();
  fileMemory.clear();
  filePersistence = true;
  form.reset();
  writeMetadata();
  updateView();
  renderProjectImages();
  updateBookPreviews();
  notice.textContent = '';
  error.textContent = '';
  progress.hidden = true;
}

function hasWorkDraft() {
  return state.item || state.kind !== 'book' || state.tagsTouched || !state.metadata.published ||
    Object.keys(state.files).length || metadataFields.some(id =>
      (state.metadata[id] ?? '') !== (metadataDefaults[id] ?? ''));
}

function focusEditor() {
  $('#title').focus({ preventScroll: true });
  $('#editor-heading').scrollIntoView({ block: 'start' });
}

async function editItem(item) {
  if (busy || siteBusy || editorBusy || catalogBusy || pendingFiles.size) return;
  if (hasWorkDraft() && !window.confirm('현재 임시 작업을 비우고 “' + item.title + '”을 수정할까요?')) return;
  editorBusy = true;
  updateView();
  renderCatalogue();
  try {
    await clearEditor();
    state.kind = item.kind;
    state.item = structuredClone(item);
    state.tagIds = idsFor(item, item.kind, projectTags);
    state.metadata = {
      title: item.title,
      description: Array.isArray(item.description) ? item.description.join('\n\n') : item.description || '',
      category: item.category || '',
      year: item.year || '',
      published: item.published !== false,
      language: item.language || '',
      'title-en': item.translations?.en?.title || '',
      'description-en': Array.isArray(item.translations?.en?.description)
        ? item.translations.en.description.join('\n\n') : item.translations?.en?.description || '',
      'category-en': item.translations?.en?.category || '',
      'language-en': item.translations?.en?.language || '',
      'trim-width': item.trimSizeMm?.[0] || '',
      'trim-height': item.trimSizeMm?.[1] || '',
      'spine-width': item.spineWidthMm || '',
      'binding-type': item.bindingType || 'paperback',
      'page-layout': 'single',
    };
    state.images = (item.images || []).map(image => ({ ...image, id: crypto.randomUUID() }));
    state.galleryImages = (item.galleryImages || []).map(image => ({ ...image, id: crypto.randomUUID() }));
    writeMetadata();
    await persist();
    renderProjectImages();
    updateBookPreviews();
  } finally {
    editorBusy = false;
    updateView();
    renderCatalogue();
  }
  focusEditor();
}

$('#new-item').addEventListener('click', async () => {
  if (busy || siteBusy || editorBusy || pendingFiles.size) return;
  if (hasWorkDraft() && !window.confirm('임시 작업을 비우고 새로 작성할까요?')) return;
  editorBusy = true;
  updateView();
  try {
    await clearEditor();
  } finally {
    editorBusy = false;
    updateView();
    renderCatalogue();
  }
  focusEditor();
});

async function refreshCatalogue() {
  if (catalogBusy) return false;
  const committedAtStart = lastCommittedSite;
  const message = $('#catalogue-status');
  catalogBusy = true;
  siteEditor?.setLoadState(true);
  updateView();
  try {
    const data = await request('/api/catalog', {
      onResponse(response) {
        $('#storage-location').hidden = response.headers.get('X-Folio-Storage') !== 'local';
      },
    });
    const items = [
      ...(data.books || []).map(book => ({ ...book, kind: 'book' })),
      ...(data.projects || []).map(project => ({ ...project, kind: 'project' })),
    ];
    const positions = new Map((data.order || []).map((id, index) => [id, index]));
    // An earlier catalogue request can finish after a successful settings save.
    const site = committedAtStart === lastCommittedSite ? data.site || {} : lastCommittedSite;
    projectTags = Array.isArray(site.projectTags) ? site.projectTags : STOCK_PROJECT_TAGS;
    tagsLoaded = true;
    catalog = items.sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
    renderSiteName(site);
    siteEditor?.setSite(site, items);
    renderWorkTags();
    renderFilterOptions();
    message.textContent = catalog.length ? '' : '등록된 작업이 없습니다.';
    $('#relogin').hidden = true;
    siteEditor?.setLoadState(false);
    return true;
  } catch (cause) {
    siteEditor?.setLoadState(false, cause);
    message.textContent = errorMessage(cause);
    $('#relogin').hidden = cause.status !== 401;
    return false;
  } finally {
    catalogBusy = false;
    updateView();
    renderCatalogue();
  }
}

function renderFilterOptions() {
  for (const [id, entries, placeholder] of [
    ['catalog-tag', projectTags.map(tag => [tag.id, tag.ko]), '모든 태그'],
    ['catalog-year', [...new Set(catalog.map(item => String(item.year ?? '')).filter(Boolean))]
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map(year => [year, year]), '모든 연도'],
  ]) {
    const select = $('#' + id);
    const selected = select.value;
    select.replaceChildren(...[['', placeholder], ...entries].map(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      return option;
    }));
    select.value = entries.some(([value]) => value === selected) ? selected : '';
  }
}

function renderCatalogue() {
  const list = $('#published-books');
  const search = $('#catalog-search').value.trim().toLocaleLowerCase();
  const kind = $('#catalog-kind').value;
  const tagId = $('#catalog-tag').value;
  const year = $('#catalog-year').value;
  const filtered = catalog.filter(item => (!kind || item.kind === kind) &&
    (!tagId || idsFor(item, item.kind, projectTags).includes(tagId)) && (!year || String(item.year ?? '') === year) &&
    [item.title, item.category, item.translations?.en?.title, item.translations?.en?.category, item.year]
      .some(value => String(value || '').toLocaleLowerCase().includes(search)));
  $('#catalogue-count').textContent = '전체 ' + catalog.length + '개 · 공개 ' + catalog.filter(item => item.published !== false).length +
    '개' + (search || kind || tagId || year ? ' · 검색 결과 ' + filtered.length + '개' : '');
  list.replaceChildren(...filtered.map(item => {
    const index = catalog.indexOf(item);
    const row = document.createElement('li');
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'catalogue-title';
    title.textContent = item.title;
    title.disabled = busy || siteBusy || editorBusy || catalogBusy;
    title.addEventListener('click', () => editItem(item));
    const metadata = document.createElement('span');
    metadata.className = 'catalogue-meta';
    const labels = idsFor(item, item.kind, projectTags).map(id => projectTags.find(tag => tag.id === id)?.ko).filter(Boolean);
    metadata.textContent = [item.kind === 'book' ? '책' : '프로젝트', item.year, item.published === false ? '비공개' : '공개', labels.join(', ')].filter(Boolean).join(' · ');
    const content = document.createElement('div');
    content.append(title, metadata);
    const thumbnailPath = item.thumbnailSrc || (item.kind === 'book' ? item.coverImages?.front : item.images?.[0]?.imageSrc);
    const thumbnail = document.createElement(thumbnailPath ? 'img' : 'span');
    thumbnail.className = 'catalogue-thumbnail';
    if (thumbnailPath) {
      thumbnail.alt = '';
      thumbnail.loading = 'lazy';
      thumbnail.src = previewPath(thumbnailPath);
    }
    row.append(thumbnail);
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    actions.append(
      createButton('↑', item.title + ' 위로', () => moveItem(index, -1), busy || siteBusy || editorBusy || catalogBusy || index === 0),
      createButton('↓', item.title + ' 아래로', () => moveItem(index, 1), busy || siteBusy || editorBusy || catalogBusy || index === catalog.length - 1),
      createButton('수정', item.title + ' 수정', () => editItem(item), busy || siteBusy || editorBusy || catalogBusy),
      createButton('삭제', item.title + ' 삭제', () => deleteItem(item), busy || siteBusy || editorBusy || catalogBusy),
    );
    row.append(content, actions);
    return row;
  }));
}

async function moveItem(index, delta) {
  if (busy || siteBusy || editorBusy || catalogBusy) return;
  const ordered = [...catalog];
  const [item] = ordered.splice(index, 1);
  ordered.splice(index + delta, 0, item);
  await mutateCatalog('/api/order', { order: ordered.map(entry => entry.id), baseOrder: catalog.map(entry => entry.id) });
}

async function deleteItem(item) {
  if (busy || siteBusy || editorBusy || catalogBusy || !window.confirm('“' + item.title + '”을 삭제할까요? 공개 페이지에서도 제거됩니다.')) return;
  const removed = await mutateCatalog('/api/delete', {
    id: item.id, kind: item.kind, baseRevision: item.revision ?? null,
  });
  if (removed && state.item?.id === item.id) await clearEditor();
}

async function mutateCatalog(path, payload) {
  catalogBusy = true;
  error.textContent = '';
  updateView();
  renderCatalogue();
  let success = false;
  try {
    await postJson(path, payload, undefined, waitingMessage);
    success = true;
  } catch (cause) {
    error.textContent = errorMessage(cause);
    $('#relogin').hidden = cause.status !== 401;
  } finally {
    catalogBusy = false;
    await refreshCatalogue();
  }
  return success;
}

$('#refresh-catalogue').addEventListener('click', refreshCatalogue);
$('#catalog-search').addEventListener('input', renderCatalogue);
$('#catalog-kind').addEventListener('change', renderCatalogue);
$('#catalog-tag').addEventListener('change', renderCatalogue);
$('#catalog-year').addEventListener('change', renderCatalogue);
async function persistEditors() {
  readMetadata();
  await Promise.all([persist(), siteEditor?.persist()]);
}

for (const link of document.querySelectorAll('#relogin, #site-relogin, #site-load-login')) {
  link.addEventListener('click', async event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    await persistEditors();
    history.replaceState(null, '', link.href);
    window.location.reload();
  });
}

$('#logout').addEventListener('click', async () => {
  if (busy || siteBusy || editorBusy) return;
  await persistEditors();
  try {
    await request('/api/logout', { method: 'POST' });
    window.location.reload();
  } catch (cause) {
    error.textContent = errorMessage(cause);
  }
});

async function initialize() {
  const saved = await loadDraft();
  state = saved?.version === 2 ? saved : emptyDraft();
  state.galleryImages ||= [];
  state.galleryDirty ||= false;
  const english = state.item?.translations?.en || {};
  state.metadata['title-en'] ??= english.title || '';
  state.metadata['description-en'] ??= Array.isArray(english.description) ? english.description.join('\n\n') : english.description || '';
  state.metadata['category-en'] ??= english.category || '';
  state.metadata['language-en'] ??= english.language || '';
  siteEditor = await createSiteEditor({
    onSaved: refreshCatalogue,
    onCommitted(site) {
      lastCommittedSite = site;
      renderSiteName(site);
    },
    onBusy(value) {
      siteBusy = value;
      updateView();
      renderCatalogue();
    },
  });
  for (const [key, descriptor] of Object.entries(state.files)) {
    const file = await loadFile(descriptor.storageKey);
    if (file) fileMemory.set(key, file);
  }
  writeMetadata();
  updateView();
  renderProjectImages();
  if (saved?.version === 2) {
    const completed = state.pdf?.pages.length || Object.keys(state.uploads).length;
    notice.textContent = '임시 작업을 불러왔습니다.' + (completed ? ' 저장된 ' + completed + '개 이미지부터 이어갈 수 있습니다.' : '');
    if (state.commitPayload) status.textContent = '이전 저장 결과를 확인해주세요. 저장 확인을 누르면 같은 요청을 이어갑니다.';
  }
  await switchSection(location.hash === '#settings' ? 'site' : 'work');
  await Promise.all([updateBookPreviews(), refreshCatalogue()]);
}

async function switchSection(section) {
  if (!state || busy || siteBusy || editorBusy || pendingFiles.size) return;
  readMetadata();
  const site = section === 'site';
  $('#work-panel').hidden = site;
  $('#site-panel').hidden = !site;
  updateTabTitle();
  $('#nav-work').toggleAttribute('aria-current', !site);
  $('#nav-site').toggleAttribute('aria-current', site);
  if (!site) $('#nav-work').setAttribute('aria-current', 'page');
  if (site) $('#nav-site').setAttribute('aria-current', 'page');
  history.replaceState(null, '', site ? '#settings' : location.pathname);
  await Promise.all([persist(), siteEditor?.persist()]);
}

$('#nav-work').addEventListener('click', () => switchSection('work'));
$('#nav-site').addEventListener('click', () => switchSection('site'));

initialize().catch(cause => { error.textContent = errorMessage(cause); });
