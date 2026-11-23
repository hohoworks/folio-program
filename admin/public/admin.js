import { createMockupPreview } from './mockup-preview.js';
import { createMockupControls } from './mockup-controls.js';
import { clearDraft, deleteFile, fileSignature, loadDraft, loadFile, saveDraft, saveFile } from '/draft-store.js';
import { errorMessage, postJson, request, uploadAsset } from '/upload-request.js';
import { createSiteEditor } from '/site-settings.js';
import { STOCK_PROJECT_TAGS, idsFor } from './project-tags.js';
import { encodeWebImage, encodeThumbnail, imageTargetBytes } from './image-encoding.js';
import { bindMediaOrder } from './media-order.js';
import { MAX_PROJECT_VIDEO_BYTES, projectEmbedURL, projectVideoPlayer } from './project-media.js';
import { planPdfPages, remainingPdfPages, sidesByShape, pdfFaceSize } from './pdf-layout.js';

import { createConstructionEditor, cutFaces, materialPayload, resolvedLeafLayout } from './book-construction.js';
import { createCardEditor, cardsFromPages } from './card-editor.js';
import { trimSize } from './vendor/mockup/book-material.js';

const $ = selector => document.querySelector(selector);
const form = $('#book-form');
const fields = $('#book-fields');
const editorTabs = [...$('#editor-tabs').querySelectorAll('[role="tab"]')];
const publish = $('#publish');
const progress = $('#upload-progress');
const status = $('#form-status');
const error = $('#form-error');
const notice = $('#draft-notice');
const metadataFields = ['book-form-type', 'title', 'description', 'category', 'title-en', 'description-en', 'category-en', 'year', 'language', 'language-en', 'trim-width', 'trim-height', 'spine-width', 'binding-type', 'page-layout', 'first-page-side', 'mockup-view', 'case-color', 'paper-color'];
const checkboxFields = ['published', 'back-remove', 'spine-remove', 'join-split', 'auto-case-color', 'auto-paper-color', 'page-jump', 'resume-reading'];
const metadataDefaults = {
  'book-form-type': 'bound', 'binding-type': 'paperback', 'page-layout': 'auto', published: true,
  'mockup-view': 'spine', 'case-color': '#b3a897', 'paper-color': '#efede4',
  'auto-case-color': true, 'auto-paper-color': true, 'page-jump': true, 'resume-reading': true,
};
const renderMockup = createMockupPreview($('#mockup-preview'));
const mockupPanel = $('#mockup-details');
const mockupControls = createMockupControls(mockupPanel);
const construction = createConstructionEditor();
let previewPageCount;
let previewFaceSizes;
let cardCoverPreview;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxProjectMedia = 1000;
const imageAccept = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
const videoAccept = 'video/mp4,video/webm,.mp4,.webm';
const mediaNames = { image: '이미지', video: '영상', embed: '영상·웹 링크' };
const pdfLayoutLabels = { single: '낱장', spread: '펼침면', mixed: '낱장·펼침면 혼합' };
const pdfRoot = '/vendor/pdfjs/';
const fileLabels = { ...Object.fromEntries(Object.entries(cutFaces).map(([face, name]) => ['edge-' + face, name + ' 단면'])), front: '앞표지', back: '뒤표지', spine: '책등', interior: '내지 PDF' };
let pdfLibrary;
let state;
let catalog = [];
let fileMemory = new Map();
let persistence = Promise.resolve();
let pendingFiles = new Set();
const latestSelection = new Map();
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

const cardEditor = createCardEditor({
  getState: () => state, localFile: key => fileMemory.get(key), setFile, checkImage: file => checkGalleryFile(file, 'image'),
  trackTask: trackFileTask, previewPath, loadPDF, renderPDFPage, uploadFileAsset, persist, onProgress: changeProgress,
  uploadBlob: (blob, signal) => uploadAsset(blob, signal, waitingMessage),
  onPreview: updateMockup,
  changed() {
    state.registrationId = crypto.randomUUID();
    updateView();
    persist();
  },
});

// Keep title brackets an explicit editorial choice, including when wrapping selected text.
for (const field of document.querySelectorAll('.language-fields textarea, .language-fields input[type="text"]')) {
  const label = field.labels[0];
  const row = document.createElement('div');
  row.className = 'editorial-field';
  const insert = document.createElement('button');
  insert.type = 'button';
  insert.className = 'insert-title-brackets';
  insert.textContent = '〈 〉';
  insert.title = '제목 괄호 넣기';
  insert.setAttribute('aria-label', label.firstChild.textContent.trim() + '에 제목 괄호 넣기');
  label.before(row);
  row.append(label, field, insert);
  field.addEventListener('focus', updateAvailability);
  field.addEventListener('input', updateAvailability);
  function updateAvailability() {
    insert.disabled = field.maxLength >= 0 && field.value.length + 2 > field.maxLength;
  }
  insert.addEventListener('click', () => {
    const start = field.selectionStart;
    const end = field.selectionEnd;
    field.setRangeText('〈' + field.value.slice(start, end) + '〉', start, end, 'end');
    field.focus();
    field.setSelectionRange(start + 1, end + 1);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

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
    cards: [],
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
  state.metadata.mockupDetails = mockupControls.read();
  state.metadata.construction = construction.read();
  state.kind = $('#kind').value;
  if (tagsLoaded) state.tagIds = [...$('#work-tags').querySelectorAll('input:checked')].map(input => input.value);
}

function writeMetadata() {
  for (const id of metadataFields) $('#' + id).value = state.metadata[id] ?? '';
  for (const id of checkboxFields) $('#' + id).checked = Boolean(state.metadata[id]);
  mockupControls.write(state.metadata.mockupDetails);
  construction.write(state.metadata.construction);
  cardEditor.render();
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

function bookPreferences(item) {
  return {
    mockupDetails: item?.mockupDetails,
    'book-form-type': item?.bookForm || 'bound',
    construction: item && {
      edgeTreatments: item.edgeTreatments, edgeBands: item.edgeBands, ringPositions: item.ringPositions,
      leafLayout: item.leafLayout, cardStock: item.cardStock,
    } || undefined,
    'mockup-view': item?.mockupView ?? 'spine',
    'case-color': item?.caseColor ?? metadataDefaults['case-color'],
    'paper-color': item?.paperColor ?? metadataDefaults['paper-color'],
    'auto-case-color': !item?.caseColor, 'auto-paper-color': !item?.paperColor,
    'page-jump': item?.pageJumpEnabled !== false, 'resume-reading': item?.resumeReadingEnabled !== false,
  };
}

function updateMockup() {
  if (state.kind !== 'book') return;
  const meta = state.metadata;
  const coverImages = {};
  for (const name of ['front', 'back', 'spine']) {
    const saved = state.item?.coverImages?.[name];
    if (!meta[name + '-remove']) coverImages[name] = fileMemory.get(name) ??
      (!state.files[name] && saved ? previewPath(saved) : undefined);
  }
  const cards = meta['book-form-type'] === 'cards';
  const autoCover = !state.files.front && state.item?.bookForm === 'cards' && state.item.coverImages?.front === state.item.pages?.[0]?.imageSrc;
  if (cards && (autoCover || !coverImages.front)) coverImages.front = cardEditor.coverPreview('front');
  if (cards && !coverImages.back) coverImages.back = cardEditor.coverPreview('back');
  if (cards && cardCoverPreview !== (coverImages.front || null)) {
    cardCoverPreview = coverImages.front || null;
    showPreview($('#cover-preview'), cardCoverPreview, '첫 카드 앞면 또는 앞표지를 선택해주세요.');
  }
  if (!cards) cardCoverPreview = undefined;
  const width = Number(meta['trim-width']), height = Number(meta['trim-height']);
  const count = state.item?.pages?.length || 0;
  const pageCount = cards ? state.cards.length * 2 : state.files.interior ? previewPageCount ?? 0 : meta['join-split'] ? Math.ceil(count / 2) : count;
  const options = meta.construction || {};
  const edgeTreatments = {};
  for (const [face, edge] of Object.entries(options.edgeTreatments || {})) {
    if (edge.mode !== 'scan') { edgeTreatments[face] = edge; continue; }
    const key = 'edge-' + face;
    const current = state.item?.edgeTreatments?.[face]?.imageSrc;
    edgeTreatments[face] = { ...edge, imageSrc: fileMemory.get(key) || (!state.files[key] && current ? previewPath(current) : '') };
  }
  const positions = options.ringPositions;
  const pages = state.files.interior ? previewFaceSizes || state.pdf?.pages : state.item?.pages;
  const book = {
    title: meta.title || '', coverImages, bindingType: meta['binding-type'], mockupView: meta['mockup-view'],
    bookForm: cards ? 'cards' : 'bound', cardStock: cards ? options.cardStock : undefined,
    ringPositions: typeof positions === 'string' && positions.trim() ? positions.trim().split(/[\s,]+/).map(Number) : Array.isArray(positions) ? positions : undefined,
    edgeBands: options.edgeBands, edgeTreatments, leafLayout: cards ? undefined : options.leafLayout,
    mockupDetails: meta.mockupDetails, pages: pages || [], pageCount,
    trimSizeMm: width > 0 && height > 0 ? [width, height] : undefined,
    coverRatio: state.uploads.front?.ratio ?? state.item?.coverRatio,
    spineWidthMm: Number(meta['spine-width']) > 0 ? Number(meta['spine-width']) : undefined,
    caseColor: meta['auto-case-color'] ? null : meta['case-color'],
    paperColor: meta['auto-paper-color'] ? null : meta['paper-color'],
  };
  book.leafLayout = resolvedLeafLayout(book.leafLayout, trimSize(book));
  construction.renderLeafPreview(book.leafLayout, Math.ceil(pageCount / 2), trimSize(book), book.pages);
  renderMockup(book);
}

function selectEditorTab(tab) {
  const book = state.kind === 'book';
  const mockup = book && tab === 'mockup';
  state.editorTab = mockup ? 'mockup' : 'info';
  $('#editor-tabs').hidden = !book;
  $('#editor-info').hidden = mockup;
  $('#editor-info').setAttribute('role', book ? 'tabpanel' : 'group');
  $('#editor-info').setAttribute('aria-labelledby', book ? 'editor-tab-info' : 'editor-heading');
  $('#editor-mockup').hidden = !mockup;
  $('#mockup-fields').disabled = !book;
  for (const button of editorTabs) {
    const selected = button.id === 'editor-tab-' + state.editorTab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
}

for (const [index, button] of editorTabs.entries()) {
  button.addEventListener('click', () => {
    selectEditorTab(button === editorTabs[0] ? 'info' : 'mockup');
    persist();
  });
  button.addEventListener('keydown', event => {
    const next = { ArrowLeft: 1 - index, ArrowRight: 1 - index, Home: 0, End: 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    editorTabs[next].click();
    editorTabs[next].focus();
  });
}

// Reveal the first invalid input before the browser focuses it, including collapsed options.
form.addEventListener('invalid', event => {
  if (form.querySelector('input:invalid, select:invalid, textarea:invalid') !== event.target) return;
  selectEditorTab(event.target.closest('#editor-mockup') ? 'mockup' : 'info');
  for (let details = event.target.closest('details'); details; details = details.parentElement.closest('details')) details.open = true;
}, true);

function updateView() {
  if (!state) return;
  const isBook = state.kind === 'book';
  selectEditorTab(state.editorTab);
  $('#book-specific').hidden = !isBook;
  $('#book-specific').disabled = !isBook;
  $('#project-specific').hidden = false;
  $('#project-specific').disabled = pendingFiles.size > 0;
  $('#project-heading').textContent = isBook ? '프로젝트 이미지 · 선택' : '프로젝트 미디어';
  $('#project-files-label').textContent = isBook ? '이미지 추가' : '이미지·영상 추가';
  $('#project-images').accept = isBook ? imageAccept : imageAccept + ',' + videoAccept;
  $('#project-embed-tools').hidden = isBook;
  $('#gallery-help').textContent = isBook
    ? '책의 앞표지와 함께 프로젝트에서 보여줄 추가 이미지를 등록할 수 있습니다.'
    : '이미지, MP4·WebM 영상(파일당 ' + MAX_PROJECT_VIDEO_BYTES / (1024 * 1024) + ' MiB까지), 웹페이지를 함께 배치할 수 있습니다. 손잡이를 끌거나 위·아래 버튼으로 순서를 바꾸세요.';
  $('#book-previews').hidden = !isBook;
  $('#case-color').disabled = state.metadata['auto-case-color'];
  $('#paper-color').disabled = state.metadata['auto-paper-color'];
  const cards = state.metadata['book-form-type'] === 'cards';
  construction.update(cards);
  $('#card-editor').disabled = !cards || pendingFiles.size > 0;
  $('#book-form-type').disabled = pendingFiles.size > 0;
  mockupControls.update(cards ? '' : state.metadata['binding-type']);
  updateMockup();
  $('#kind').disabled = Boolean(state.item) || pendingFiles.size > 0;
  $('#editor-heading').textContent = state.item ? '작업 수정' : '작업 추가';
  $('#back-remove-row').hidden = !state.item?.coverImages?.back;
  $('#spine-remove-row').hidden = !state.item?.coverImages?.spine;
  $('#preview-binding').textContent = ' · ' + (cards ? '낱장 카드' : $('#binding-type').selectedOptions[0].textContent);
  $('#pdf-preview-stage').closest('figure').hidden = cards;
  const bindingHelp = {
    'saddle-stitch': '중철은 접힌 부분이 얇게 표시됩니다. 책등 이미지는 선택 사항입니다.',
    'exposed-sewn': '책등 이미지를 비워두면 노출된 실과 종이 결이 표시됩니다.',
  };
  $('#binding-help').textContent = bindingHelp[$('#binding-type').value] || '책등 이미지가 없으면 제본 방식에 맞춰 책등을 표시합니다.';
  const existingInterior = state.item?.pages?.length && !state.files.interior;
  $('#page-layout').disabled = Boolean(existingInterior);
  $('#page-layout-help').textContent = existingInterior
    ? '기존 내지 · ' + (pdfLayoutLabels[state.item.pdfLayout] || '원본 구성 기록 없음') + '. PDF를 교체하면 구성을 다시 선택할 수 있습니다.'
    : '자동 인식은 재단 크기 또는 앞표지 비율을 기준으로 각 페이지를 확인합니다. 펼침면은 왼쪽, 오른쪽 순으로 저장합니다.';
  $('#join-split-row').hidden = !existingInterior || state.item.pages.length % 2 !== 0 ||
    Boolean(state.item.pdfLayout && state.item.pdfLayout !== 'spread' && !state.item.joinSplitPages);
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
  const existing = key.startsWith('edge-') ? state.item?.edgeTreatments?.[key.slice(5)]?.imageSrc : key === 'interior' ? state.item?.pages?.length : state.item?.coverImages?.[key];
  if (descriptor) {
    const available = fileMemory.has(key);
    element.textContent = descriptor.name + (available ? ' · 선택됨' : ' · 같은 파일을 다시 선택해주세요.');
  } else {
    element.textContent = existing ? '기존 파일 유지 · 교체할 때 선택해주세요.' : '';
  }
}

function getFile(key) {
  const file = fileMemory.get(key);
  if (!file) throw new Error((fileLabels[key] || '미디어') + ' 원본을 다시 선택해주세요. 저장한 진행 상황에서 이어갑니다.');
  return file;
}

async function setFile(key, file) {
  const currentGeneration = generation;
  const selection = Symbol();
  latestSelection.set(key, selection);
  const signature = await fileSignature(file);
  if (currentGeneration !== generation || latestSelection.get(key) !== selection) return;
  latestSelection.delete(key);
  const previous = state.files[key];
  if (previous && previous.signature !== signature && !fileMemory.has(key) &&
      !window.confirm('저장된 원본과 다른 파일입니다. 이 파일의 업로드 진행 상황을 비우고 교체할까요?')) {
    return;
  }
  if (previous?.signature !== signature) {
    delete state.uploads[key];
    if (key === 'interior') {
      state.pdf = null;
      if (state.item && !previous) {
        $('#page-layout').value = state.metadata['page-layout'] = 'auto';
      }
      state.metadata['join-split'] = $('#join-split').checked = false;
    }
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
    trackFileTask((async () => {
      if (key.startsWith('edge-')) checkGalleryFile(file, 'image');
      await setFile(key, file);
      if (key.startsWith('edge-')) updateMockup();
      else await updateBookPreviews();
    })());
  });
}

form.addEventListener('input', event => {
  if (event.target.type === 'file' || event.target.closest('#project-specific')) return;
  readMetadata();
  if (event.target.closest('#edge-options, #leaf-options, #card-stock') || mockupPanel.contains(event.target) || ['title', 'trim-width', 'trim-height', 'spine-width', 'case-color', 'paper-color'].includes(event.target.id)) updateMockup();
  if (event.target.name === 'tagIds') state.tagsTouched = true;
  state.registrationId = crypto.randomUUID();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 250);
});

form.addEventListener('change', event => {
  if (event.target.type === 'file' || event.target.closest('#project-specific')) return;
  readMetadata();
  if (event.target.id === 'kind' && !state.item && !state.tagsTouched) {
    state.tagIds = idsFor({}, state.kind, projectTags);
    renderWorkTags();
  }
  if (event.target.id === 'page-layout') state.pdf = null;
  if (event.target.id === 'binding-type' && ['spiral', 'ring'].includes(event.target.value)) mockupPanel.open = true;
  if (event.target.id === 'book-form-type') {
    if (state.metadata['book-form-type'] === 'cards' && state.item?.bookForm !== 'cards' &&
        !state.cardsInitialized && !state.files.interior && !state.item?.joinSplitPages) {
      state.cards = cardsFromPages(state.item?.pages);
    }
    state.cardsInitialized = true;
    cardEditor.render();
  }
  state.registrationId = crypto.randomUUID();
  updateView();
  persist();
  if (event.target.id === 'kind') renderProjectImages();
  if (['page-layout', 'kind', 'join-split', 'trim-width', 'trim-height', 'leaf-source', 'book-form-type'].includes(event.target.id)) updateBookPreviews();
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

function referencePageRatio(coverRatio) {
  const width = Number(state.metadata['trim-width']);
  const height = Number(state.metadata['trim-height']);
  return width > 0 && height > 0 ? width / height : coverRatio;
}

async function updateBookPreviews() {
  const version = ++previewVersion;
  if (state.metadata['book-form-type'] === 'cards') {
    cardCoverPreview = undefined;
    updateMockup();
    return;
  }
  previewPageCount = undefined;
  previewFaceSizes = undefined;
  const cover = $('#cover-preview');
  const pdfImage = $('#pdf-preview');
  const count = $('#preview-page-count');
  const coverFile = fileMemory.get('front');
  let coverRatio = state.files.front ? state.uploads.front?.ratio : state.item?.coverRatio;
  const savedFront = !state.files.front && state.item?.coverImages?.front;
  showPreview(cover, savedFront ? previewPath(savedFront) : null, state.files.front ? '앞표지 원본을 다시 선택해주세요.' : '앞표지를 선택해주세요.');
  if (coverFile) {
    try {
      const { blob, ratio } = await convertCover(coverFile, '앞표지');
      coverRatio = ratio;
      if (version === previewVersion) showPreview(cover, blob);
    } catch (cause) {
      if (version === previewVersion) showPreview(cover, null, errorMessage(cause));
    }
  }
  if (version !== previewVersion) return;
  const firstPage = !state.files.interior && state.item?.pages?.[0]?.imageSrc;
  showPreview(pdfImage, firstPage ? previewPath(firstPage) : null, state.files.interior ? '내지 PDF 원본을 다시 선택해주세요.' : '내지 PDF를 선택해주세요.');
  const joined = Boolean(firstPage && state.metadata['join-split'] && state.item.pages.length % 2 === 0);
  $('#pdf-preview-stage').classList.toggle('joined', joined);
  const right = $('#pdf-preview-right');
  right.hidden = !joined;
  if (joined) right.src = previewPath(state.item.pages[1].imageSrc);
  else right.removeAttribute('src');
  count.textContent = firstPage ? joined
    ? ' · 저장 이미지 ' + state.item.pages.length + '장 → 공개 내지 ' + state.item.pages.length / 2 + '쪽'
    : ' · 공개 내지 ' + state.item.pages.length + '쪽' : '';
  const file = fileMemory.get('interior');
  if (!file) return;
  showPreview(pdfImage, null, 'PDF 미리보기 만드는 중…');
  let pdf;
  try {
    pdf = await loadPDF(file);
    if (version !== previewVersion) return;
    const mode = state.metadata['page-layout'];
    const ratio = referencePageRatio(coverRatio);
    const plan = await planPdfPages(pdf, mode, ratio, () => {
      if (version !== previewVersion) throw new Error('미리보기가 변경되었습니다.');
    }, state.metadata.construction?.leafLayout?.source === 'pdf');
    const page = await pdf.getPage(1);
    const { blob } = await renderPDFPage(page, plan.sheets[0], 0, 480);
    if (version === previewVersion) {
      previewPageCount = plan.total;
      previewFaceSizes = plan.faceSizes?.map(sizeMm => ({ sizeMm }));
      updateMockup();
      showPreview(pdfImage, blob);
      count.textContent = ' · ' + pdfLayoutLabels[plan.layout] + ' · PDF ' + pdf.numPages + '페이지 → 내지 ' + plan.total + '쪽';
      if (mode !== 'auto') {
        const suggested = sidesByShape(page.getViewport({ scale: 1 }), ratio);
        if (suggested && suggested !== plan.sheets[0]) {
          count.textContent += suggested === 1
            ? ' · 첫 페이지는 낱장 비율입니다. 지금 선택하면 가운데가 잘립니다.'
            : ' · 첫 페이지는 펼침면 비율입니다. 지금 선택하면 좌우가 한 쪽으로 저장됩니다.';
        }
      }
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
  if (action) button.addEventListener('click', action);
  return button;
}

function currentImages() {
  return state.kind === 'book' ? state.galleryImages : state.images;
}

function markImagesChanged() {
  state.registrationId = crypto.randomUUID();
  if (state.kind === 'book') state.galleryDirty = true;
}

function entryType(entry) {
  return entry.type || 'image';
}

function updateMedia(entry, field, value) {
  entry[field] = value;
  markImagesChanged();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 150);
}

function mediaField(entry, field, caption) {
  const label = document.createElement('label');
  label.textContent = caption;
  const input = document.createElement('input');
  const address = field === 'url';
  input.type = address ? 'url' : 'text';
  input.required = address;
  input.maxLength = address ? 2048 : 500;
  if (address) input.placeholder = 'https://';
  input.value = entry[field] || '';
  input.addEventListener('input', () => {
    updateMedia(entry, field, input.value);
    if (address) {
      input.setCustomValidity(input.value && !projectEmbedURL(input.value) ? '올바른 HTTPS 주소를 입력해주세요.' : '');
      input.closest('li').querySelector('.media-placeholder').textContent = projectVideoPlayer(input.value)?.provider || '웹페이지';
    }
  });
  label.append(input);
  return label;
}

function videoMime(file) {
  if (['video/mp4', 'video/webm'].includes(file.type)) return file.type;
  if (file.type && file.type !== 'application/octet-stream') return '';
  if (/\.mp4$/i.test(file.name)) return 'video/mp4';
  if (/\.webm$/i.test(file.name)) return 'video/webm';
  return '';
}

function checkGalleryFile(file, type) {
  if (type === 'video') {
    if (!videoMime(file)) throw new Error('MP4 또는 WebM 영상을 선택해주세요.');
    if (!file.size) throw new Error('선택한 영상 파일이 비어 있습니다.');
    if (file.size > MAX_PROJECT_VIDEO_BYTES) throw new Error('영상 파일은 ' + MAX_PROJECT_VIDEO_BYTES / (1024 * 1024) + ' MiB까지 올릴 수 있습니다. 큰 영상은 ‘영상·웹 링크 추가’에 YouTube 또는 Vimeo 공유 링크를 넣어주세요.');
  } else if (!imageTypes.has(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
    throw new Error('JPG·PNG·WebP 이미지를 선택해주세요.');
  }
}

function filePreview(entry, file, type) {
  const source = entry.imageSrc || entry.videoSrc;
  if (type === 'embed' || (!file && !source)) {
    const text = document.createElement('span');
    text.className = 'media-placeholder';
    text.textContent = type === 'embed' ? projectVideoPlayer(entry.url)?.provider || '웹페이지'
      : state.uploads[entry.fileKey] ? '업로드 완료' : '원본 재선택';
    return text;
  }
  const preview = document.createElement(type === 'video' ? 'video' : 'img');
  if (type === 'video') {
    preview.controls = true;
    preview.preload = file ? 'metadata' : 'none';
    preview.playsInline = true;
    preview.addEventListener('loadedmetadata', () => {
      if (file && preview.videoWidth && preview.videoHeight) entry.ratio = preview.videoWidth / preview.videoHeight;
    });
  } else {
    preview.alt = entry.alt || '';
    preview.loading = 'lazy';
  }
  preview.src = file ? URL.createObjectURL(file) : previewPath(source);
  return preview;
}

function retryFile(entry, name, index) {
  const retry = document.createElement('input');
  const type = entryType(entry);
  retry.type = 'file';
  retry.accept = type === 'video' ? videoAccept : imageAccept;
  retry.setAttribute('aria-label', name + ' ' + (index + 1) + ' 원본 재선택');
  retry.addEventListener('change', () => {
    const file = retry.files[0];
    if (!file) return;
    trackFileTask((async () => {
      checkGalleryFile(file, type);
      await setFile(entry.fileKey, file);
      renderProjectImages();
    })());
  });
  return retry;
}

function renderProjectImages() {
  const list = $('#project-image-list');
  for (const preview of list.querySelectorAll('img, video')) {
    if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
  }
  const entries = currentImages();
  const insertion = $('#media-insertion');
  const selected = insertion.value;
  insertion.replaceChildren(new Option('맨 뒤', 'end'));
  if (entries.length) insertion.add(new Option('맨 앞', 'start'));
  list.replaceChildren(...entries.map((entry, index) => {
    const type = entryType(entry);
    const name = mediaNames[type];
    const item = document.createElement('li');
    item.dataset.mediaId = entry.id;
    const file = entry.fileKey && fileMemory.get(entry.fileKey);
    const content = document.createElement('div');
    const rowName = document.createElement('strong');
    const title = file?.name || state.files[entry.fileKey]?.name;
    rowName.textContent = (index + 1) + '. ' + name + (title ? ' · ' + title : '');
    content.append(rowName);
    if (index < entries.length - 1) insertion.add(new Option((index + 1) + '번 ' + name + ' 뒤', entry.id));
    if (type === 'embed') content.append(mediaField(entry, 'url', '영상·웹 주소'));
    content.append(mediaField(entry, 'alt', type === 'image' ? '이미지 설명' : name + ' 제목'));
    if (entry.fileKey && !file && !state.uploads[entry.fileKey]) content.append(retryFile(entry, name, index));
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    const handle = createButton('↕ 끌기', name + ' ' + (index + 1) + ' 순서 조정', null, entries.length < 2);
    handle.classList.add('media-handle');
    handle.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown');
    handle.title = '끌거나 위·아래 방향키로 이동';
    actions.append(handle,
      createButton('↑ 위로', name + ' 앞으로', () => moveProjectMedia(index, index - 1), index === 0),
      createButton('↓ 아래로', name + ' 뒤로', () => moveProjectMedia(index, index + 1), index === entries.length - 1),
      createButton('제거', name + ' ' + (index + 1) + ' 제거', async () => {
        entries.splice(index, 1);
        const descriptor = state.files[entry.fileKey];
        if (entry.fileKey) {
          fileMemory.delete(entry.fileKey);
          delete state.files[entry.fileKey];
          delete state.uploads[entry.fileKey];
        }
        markImagesChanged();
        renderProjectImages();
        await persist();
        if (descriptor) await deleteFile(descriptor.storageKey);
      }),
    );
    item.append(filePreview(entry, file, type), content, actions);
    return item;
  }));
  insertion.value = selected;
  if (!insertion.value) insertion.value = 'end';
}

function moveProjectMedia(from, to) {
  const entries = currentImages();
  if (from < 0 || to < 0 || to >= entries.length || to === from || fields.disabled) return;
  const list = $('#project-image-list');
  const focused = document.activeElement;
  const focusedRow = list.contains(focused) ? focused.closest('li') : null;
  const focusIndex = focusedRow ? [...focusedRow.querySelectorAll('button, input')].indexOf(focused) : -1;
  const caret = focused instanceof HTMLInputElement && focused.selectionStart !== null
    ? [focused.selectionStart, focused.selectionEnd] : null;
  const [entry] = entries.splice(from, 1);
  entries.splice(to, 0, entry);
  markImagesChanged();
  renderProjectImages();
  $('#media-order-notice').textContent = mediaNames[entryType(entry)] + ' 항목을 ' + (to + 1) + '번째로 이동했습니다.';
  if (focusIndex >= 0) {
    const row = [...list.children].find(item => item.dataset.mediaId === focusedRow.dataset.mediaId);
    const control = row.querySelectorAll('button, input')[focusIndex];
    const target = control.disabled ? row.querySelector('.media-handle') : control;
    target.focus({ preventScroll: true });
    if (caret) target.setSelectionRange(...caret);
  }
  persist();
}

bindMediaOrder($('#project-image-list'), moveProjectMedia);

function insertionIndex(entries) {
  const position = $('#media-insertion').value;
  if (position === 'start') return 0;
  const previous = entries.findIndex(entry => entry.id === position);
  return previous < 0 ? entries.length : previous + 1;
}

$('#project-images').addEventListener('change', () => {
  const input = $('#project-images');
  const files = [...input.files];
  input.value = '';
  if (!files.length) return;
  const entries = currentImages();
  let index = insertionIndex(entries);
  const isBook = state.kind === 'book';
  error.textContent = '';
  const task = (async () => {
    if (entries.length + files.length > maxProjectMedia) throw new Error('미디어는 1,000개까지 추가할 수 있습니다.');
    const items = files.map(file => {
      const type = !isBook && videoMime(file) ? 'video' : 'image';
      checkGalleryFile(file, type);
      return { file, type };
    });
    for (const { file, type } of items) {
      const fileKey = 'project:' + crypto.randomUUID();
      await setFile(fileKey, file);
      entries.splice(index++, 0, { id: crypto.randomUUID(), type, fileKey, alt: '' });
      markImagesChanged();
      await persist();
    }
    $('#media-insertion').value = 'end';
    renderProjectImages();
  })();
  trackFileTask(task);
});

$('#add-project-embed').addEventListener('click', () => {
  if (state.kind !== 'project') return;
  const entries = currentImages();
  if (entries.length >= maxProjectMedia) {
    error.textContent = '미디어는 1,000개까지 추가할 수 있습니다.';
    return;
  }
  const index = insertionIndex(entries);
  entries.splice(index, 0, { id: crypto.randomUUID(), type: 'embed', url: '', alt: '' });
  $('#media-insertion').value = 'end';
  markImagesChanged();
  renderProjectImages();
  $('#project-image-list').children[index].querySelector('input[type="url"]').focus();
  persist();
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
    const asset = await uploadAsset(converted.blob, signal, waitingMessage);
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
        ? await uploadAsset(converted.thumbnail, signal, waitingMessage) : null;
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
  const cards = meta['book-form-type'] === 'cards';
  if (!cards && !state.item && !state.files.front) throw new Error('앞표지를 선택해주세요.');
  if (!cards && !state.item && !state.files.interior) throw new Error('내지 PDF를 선택해주세요.');
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
  for (const [face, cut] of Object.entries(meta.construction.edgeTreatments)) {
    if (cut.mode !== 'scan') continue;
    const key = 'edge-' + face;
    if (state.files[key]) {
      const uploaded = await uploadFileAsset(key, fileLabels[key], signal);
      (assets.edgeScans ||= {})[face] = uploaded.asset;
    } else if (!state.item?.edgeTreatments?.[face]?.imageSrc) throw new Error(cutFaces[face] + ' 단면 이미지를 선택해주세요.');
  }
  let pdf;
  try {
    if (cards) assets.cards = await cardEditor.prepare(signal);
    else if (state.files.interior) {
      const signature = state.files.interior.signature;
      const pageLayout = meta['page-layout'];
      const reference = pageLayout === 'auto' ? referencePageRatio(state.uploads.front?.ratio ?? state.item?.coverRatio) : undefined;
      if (state.pdf?.signature !== signature || state.pdf.layout !== pageLayout || state.pdf.reference !== reference) {
        state.pdf = { signature, layout: pageLayout, reference, pages: [], ratio: null, total: null };
        await persist();
      }
      if (!state.pdf.total || state.pdf.pages.length < state.pdf.total) {
        status.textContent = 'PDF 확인 중…';
        pdf = await loadPDF(getFile('interior'));
        const plan = state.pdf.plan ?? await planPdfPages(pdf, pageLayout, reference, () => checkpointStop(signal));
        state.pdf.plan = plan;
        state.pdf.total = plan.total;
        await persist();
        for (const sheet of remainingPdfPages(plan.sheets, state.pdf.pages.length)) {
          checkpointStop(signal);
          const page = await pdf.getPage(sheet.number);
          try {
            for (let side = sheet.startSide; side < sheet.count; side++) {
              checkpointStop(signal);
              const current = state.pdf.pages.length + 1;
              changeProgress(state.pdf.total + 1, current - 1, '내지 저장 중 · ' + current + ' / ' + state.pdf.total + '쪽');
              const { blob, ratio } = await renderPDFPage(page, sheet.count, side, 2000);
              const asset = await uploadAsset(blob, signal, waitingMessage);
              const sizeMm = pdfFaceSize(page.getViewport({ scale: 1 }), sheet.count);
              state.pdf.pages.push({ ...asset, ...(sizeMm && { sizeMm }) });
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
  if (state.galleryDirty) assets.galleryImages = await prepareMedia(signal, state.galleryImages, false);
  return {
    ...commonPayload(),
    language: meta.language?.trim() || '',
    ...materialPayload(meta, cards ? assets.cards.length * 2 : assets.pages?.length ?? (state.item?.pages?.length || 0) / (meta['join-split'] ? 2 : 1),
      trimSize({ trimSizeMm, coverRatio: state.uploads.front?.ratio ?? state.item?.coverRatio }), assets.pages || state.item?.pages),
    bindingType: meta['binding-type'], mockupView: meta['mockup-view'],
    mockupDetails: meta.mockupDetails,
    caseColor: meta['auto-case-color'] ? null : meta['case-color'],
    paperColor: meta['auto-paper-color'] ? null : meta['paper-color'],
    pageJumpEnabled: meta['page-jump'], resumeReadingEnabled: meta['resume-reading'],
    firstPageSide: meta['first-page-side'] || null,
    ...(!cards && (assets.pages ? { pdfLayout: state.pdf.plan?.layout ?? state.pdf.layout } : { joinSplitPages: Boolean(meta['join-split']) })),
    ...(assets.pages && state.pdf.plan?.layout === 'mixed' && { pdfSheetSides: state.pdf.plan.sheets }),
    trimSizeMm,
    spineWidthMm: meta['spine-width'] ? Number(meta['spine-width']) : inferredSpineWidth ?? null,
    pageRatio: (cards ? assets.cards[0]?.front?.ratio : state.pdf?.ratio) ?? state.item?.pageRatio,
    coverRatio: state.uploads.front?.ratio ?? state.item?.coverRatio ?? assets.cards?.[0]?.front?.ratio,
    assets,
  };
}

async function prepareVideo(entry, signal) {
  if (entry.videoSrc) return { videoSrc: entry.videoSrc };
  const key = entry.fileKey;
  const signature = state.files[key]?.signature;
  let saved = state.uploads[key];
  if (!saved || saved.signature !== signature) {
    const file = getFile(key);
    checkGalleryFile(file, 'video');
    const mime = videoMime(file);
    const blob = file.type === mime ? file : file.slice(0, file.size, mime);
    const asset = await uploadAsset(blob, signal, waitingMessage);
    state.uploads[key] = saved = { asset, signature };
    await persist();
    checkpointStop(signal);
  }
  return { sha: saved.asset.sha, ext: saved.asset.ext };
}

async function prepareMedia(signal, entries, project) {
  if (entries.length > maxProjectMedia) throw new Error('미디어는 1,000개까지 등록할 수 있습니다.');
  const firstImage = project && entries.find(entry => entryType(entry) === 'image');
  const result = [];
  for (const [index, entry] of entries.entries()) {
    checkpointStop(signal);
    const type = entryType(entry);
    const alt = entry.alt || '';
    let ratio = entry.ratio;
    let asset;
    changeProgress(entries.length + 1, index, mediaNames[type] + ' 저장 중 · ' + (index + 1) + ' / ' + entries.length);
    if (type === 'embed') {
      const url = projectEmbedURL(entry.url);
      if (!url) throw new Error((index + 1) + '번째 링크에 올바른 HTTPS 주소를 입력해주세요.');
      asset = { url };
    } else if (type === 'video') {
      asset = await prepareVideo(entry, signal);
      ratio = entry.ratio;
    } else if (entry.imageSrc) {
      asset = { imageSrc: entry.imageSrc };
    } else {
      const saved = await uploadFileAsset(entry.fileKey, '프로젝트 이미지', signal, entry === firstImage);
      asset = { sha: saved.asset.sha, ext: saved.asset.ext };
      ratio = saved.ratio;
    }
    result.push({ ...(project ? { type } : {}), ...asset, alt, ...(Number.isFinite(ratio) && ratio > 0 ? { ratio } : {}) });
  }
  return result;
}

async function prepareProject(signal) {
  if (!state.images.length) throw new Error('프로젝트에 이미지, 영상 또는 웹페이지를 한 개 이상 추가해주세요.');
  const assets = { media: await prepareMedia(signal, state.images, true) };
  const firstImage = state.images.find(entry => entryType(entry) === 'image');
  const thumbnail = firstImage?.fileKey && state.uploads[firstImage.fileKey];
  if (thumbnail?.thumbnailReady) assets.thumbnail = thumbnail.thumbnailAsset;
  return { ...commonPayload(), assets };
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
  previewFaceSizes = undefined;
  previewPageCount = undefined;
  writeMetadata();
  updateView();
  renderProjectImages();
  updateBookPreviews();
  notice.textContent = '';
  error.textContent = '';
  progress.hidden = true;
}

function hasWorkDraft() {
  const options = state.metadata.construction;
  return state.item || state.kind !== 'book' || state.tagsTouched || state.cards.length ||
    options && (Object.keys(options.edgeTreatments || {}).length || options.edgeBands?.length || options.leafLayout || options.ringPositions) ||
    mockupControls.hasChanges(state.metadata.mockupDetails) ||
    checkboxFields.some(id => Boolean(state.metadata[id]) !== Boolean(metadataDefaults[id])) ||
    Object.keys(state.files).length || metadataFields.some(id =>
      (state.metadata[id] ?? '') !== (metadataDefaults[id] ?? ''));
}

function focusEditor() {
  const target = state.editorTab === 'mockup' ? $('#editor-tab-mockup') : $('#title');
  target.focus({ preventScroll: true });
  $('#editor-heading').scrollIntoView({ block: 'start' });
}

async function editItem(item, tab = 'info') {
  if (busy || siteBusy || editorBusy || catalogBusy || pendingFiles.size) return;
  if (tab === 'mockup' && state.item?.id === item.id) {
    selectEditorTab(tab);
    focusEditor();
    await persist();
    return;
  }
  if (hasWorkDraft() && !window.confirm('현재 임시 작업을 비우고 “' + item.title + '”을 수정할까요?')) return;
  editorBusy = true;
  updateView();
  renderCatalogue();
  try {
    await clearEditor();
    state.kind = item.kind;
    state.item = structuredClone(item);
    state.editorTab = tab;
    state.tagIds = idsFor(item, item.kind, projectTags);
    state.metadata = {
      ...bookPreferences(item),
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
      'page-layout': ['single', 'spread'].includes(item.pdfLayout) ? item.pdfLayout : 'auto',
      'first-page-side': item.firstPageSide ?? '',
      'join-split': item.joinSplitPages === true,
    };
    state.cards = item.bookForm === 'cards' ? cardsFromPages(item.pages) : [];
    state.images = (item.media ?? item.images ?? []).map(entry => ({ ...entry, id: crypto.randomUUID() }));
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
    const thumbnailPath = item.thumbnailSrc || (item.kind === 'book' ? item.coverImages?.front : (item.media ?? item.images)?.find(entry => entry.imageSrc)?.imageSrc);
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
    );
    if (item.kind === 'book') actions.append(createButton('목업 조정', item.title + ' 목업 조정', () => editItem(item, 'mockup'), title.disabled));
    actions.append(createButton('삭제', item.title + ' 삭제', () => deleteItem(item), title.disabled));
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
  state.cards ??= state.item?.bookForm === 'cards' ? cardsFromPages(state.item.pages) : [];
  state.galleryImages ||= [];
  state.galleryDirty ||= false;
  state.metadata = { ...bookPreferences(state.item), ...state.metadata };
  state.metadata['first-page-side'] ??= state.item?.firstPageSide ?? '';
  state.metadata['join-split'] ??= !state.files.interior && state.item?.joinSplitPages === true;
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
    notice.textContent = '임시 작업을 불러왔습니다.' + (completed ? ' 저장된 ' + completed + '개 파일부터 이어갈 수 있습니다.' : '');
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
