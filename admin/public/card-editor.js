import { bindMediaOrder } from './media-order.js';
import { pdfFaceSize } from './pdf-layout.js';
import { fileSignature } from './draft-store.js';

const $ = id => document.getElementById(id);
const accept = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
const limit = 500;

export function cardsFromPages(pages = []) {
  const cards = [];
  for (let index = 0; index < pages.length; index += 2) {
    const front = pages[index], back = pages[index + 1];
    cards.push({ id: crypto.randomUUID(), front, back: back?.blank ? null : back || null });
  }
  return cards;
}

export function createCardEditor({ getState, localFile, setFile, checkImage, trackTask, changed, previewPath,
  loadPDF, renderPDFPage, uploadFileAsset, uploadBlob, persist, onProgress, onPreview }) {
  const list = $('card-list');
  const loaded = new Map();
  const thumbnails = new Map();
  let draft;
  let previewQueue = Promise.resolve();
  let renderId = 0;
  const cards = () => getState().cards;
  function pdfFor(key) {
    if (!loaded.has(key)) {
      const file = localFile(key);
      if (!file) throw new Error('카드를 추가한 원본 PDF를 다시 선택해주세요.');
      loaded.set(key, loadPDF(file).catch(error => { loaded.delete(key); throw error; }));
    }
    return loaded.get(key);
  }
  function resetPreview() {
    renderId++;
    for (const pdf of loaded.values()) pdf.then(doc => doc.loadingTask.destroy()).catch(() => {});
    loaded.clear();
    thumbnails.clear();
  }
  function coverPreview(side) {
    const face = (side === 'front' ? cards()?.[0] : cards()?.at(-1))?.[side];
    if (face?.imageSrc) return previewPath(face.imageSrc);
    if (face?.fileKey) return localFile(face.fileKey);
    return face?.pdfKey ? thumbnails.get(face.pdfKey + ':' + face.page) : undefined;
  }
  function verifyCount(extra) {
    if (cards().length + extra > limit) throw new Error('카드는 최대 500장까지 등록할 수 있습니다.');
  }
  function edited() {
    changed();
    render();
  }
  function selectedCard() {
    return $('card-thumbnail-mode').value === 'single' ? cards()[$('card-thumbnail-card').valueAsNumber - 1] : undefined;
  }
  function updateOrder(selected) {
    if (selected) $('card-thumbnail-card').value = Math.max(1, cards().indexOf(selected) + 1);
    edited();
  }
  function markThumbnail() {
    const selected = selectedCard();
    for (const row of list.children) {
      row.querySelector('.card-number').textContent = '카드 ' + row.dataset.number + (row.dataset.mediaId === selected?.id ? ' · 대표 앞면' : '');
    }
  }
  $('card-thumbnail-mode').addEventListener('input', markThumbnail);
  $('card-thumbnail-card').addEventListener('input', markThumbnail);
  function move(from, to) {
    if (to < 0 || to >= cards().length || from === to || from < 0 || list.closest('fieldset').matches(':disabled')) return;
    const selected = selectedCard();
    const [entry] = cards().splice(from, 1);
    cards().splice(to, 0, entry);
    updateOrder(selected);
    list.children[to]?.querySelector('.media-handle')?.focus({ preventScroll: true });
    $('card-notice').textContent = (to + 1) + '번째 카드로 이동했습니다.';
  }
  bindMediaOrder(list, move);
  function button(text, label, action, disabled = false) {
    const el = document.createElement('button');
    Object.assign(el, { type: 'button', className: 'text-button', textContent: text, disabled });
    el.setAttribute('aria-label', label);
    el.addEventListener('click', action);
    return el;
  }
  function pick(id, work) {
    $(id).addEventListener('change', event => {
      const files = [...event.target.files];
      event.target.value = '';
      if (files.length) trackTask(work(files));
    });
  }
  pick('card-images', async files => {
    verifyCount(files.length);
    files.forEach(checkImage);
    for (const file of files) {
      const fileKey = 'card:' + crypto.randomUUID();
      await setFile(fileKey, file);
      cards().push({ id: crypto.randomUUID(), front: { fileKey }, back: null });
      await persist();
    }
    edited();
  });
  pick('card-pdf', async ([file]) => {
    const frontsOnly = $('card-pdf-layout').value === 'fronts';
    const pdf = await loadPDF(file);
    const key = 'card-pdf:' + crypto.randomUUID();
    try {
      if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1) throw new Error('PDF에 페이지가 없습니다.');
      verifyCount(frontsOnly ? pdf.numPages : Math.ceil(pdf.numPages / 2));
      await setFile(key, file);
      loaded.set(key, Promise.resolve(pdf));
      for (let n = 1; n <= pdf.numPages; n += frontsOnly ? 1 : 2) {
        cards().push({ id: crypto.randomUUID(), front: { pdfKey: key, page: n },
          back: !frontsOnly && n < pdf.numPages ? { pdfKey: key, page: n + 1 } : null });
      }
      edited();
      $('card-notice').textContent = file.name + ' · PDF ' + pdf.numPages + '쪽을 추가했습니다.';
    } finally {
      if (!loaded.has(key)) await pdf.loadingTask.destroy().catch(() => {});
    }
  });
  async function previewPdf(face) {
    const key = face.pdfKey + ':' + face.page;
    if (thumbnails.has(key)) return thumbnails.get(key);
    const pdf = await pdfFor(face.pdfKey);
    const page = await pdf.getPage(face.page);
    let blob;
    try { ({ blob } = await renderPDFPage(page, 1, 0, 240)); }
    finally { page.cleanup(); }
    if (thumbnails.size >= 120) thumbnails.delete(thumbnails.keys().next().value);
    thumbnails.set(key, blob);
    return blob;
  }
  const pendingPreviews = new WeakMap();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      observer.unobserve(entry.target);
      const job = pendingPreviews.get(entry.target);
      if (job) previewQueue = previewQueue.then(job).catch(() => {});
    }
  }, { rootMargin: '200px' });
  function faceField(entry, side, index) {
    const face = entry[side], caption = side === 'front' ? '앞면' : '뒷면';
    const group = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = caption;
    group.append(legend);
    const preview = document.createElement('div');
    preview.className = 'card-face-preview';
    const source = face?.fileKey ? localFile(face.fileKey) : face?.imageSrc ? previewPath(face.imageSrc) : null;
    function showImage(value) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = typeof value === 'string' ? value : URL.createObjectURL(value);
      preview.replaceChildren(img);
    }
    if (source) showImage(source);
    else if (face?.pdfKey) {
      preview.textContent = 'PDF ' + face.page + '쪽';
      if (localFile(face.pdfKey)) {
        const id = renderId;
        const deckCover = (index === 0 && side === 'front') || (index === cards().length - 1 && side === 'back');
        const load = async () => {
          if (id !== renderId) return;
          const blob = await previewPdf(face);
          if (id !== renderId) return;
          showImage(blob);
          if (deckCover) onPreview();
        };
        if (deckCover) previewQueue = previewQueue.then(load).catch(() => {});
        else {
          pendingPreviews.set(preview, load);
          observer.observe(preview);
        }
      }
    } else preview.textContent = face ? '원본 재선택' : '빈 뒷면';
    group.append(preview);
    const label = document.createElement('label');
    label.textContent = face ? '이미지 교체' : '이미지 추가';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.setAttribute('aria-label', (index + 1) + '번째 카드 ' + caption + ' 이미지');
    input.addEventListener('change', () => {
      const [file] = input.files;
      if (!file) return;
      trackTask((async () => {
        checkImage(file);
        const fileKey = 'card:' + crypto.randomUUID();
        await setFile(fileKey, file);
        entry[side] = { fileKey };
        edited();
      })());
    });
    label.append(input);
    group.append(label);
    if (face?.pdfKey && !localFile(face.pdfKey) && !getState().uploads[face.pdfKey + ':' + face.page]) {
      const retryLabel = document.createElement('label');
      retryLabel.textContent = getState().files[face.pdfKey]?.name + ' 다시 연결';
      const retry = document.createElement('input');
      retry.type = 'file';
      retry.accept = 'application/pdf,.pdf';
      retry.addEventListener('change', () => {
        const [file] = retry.files;
        if (!file) return;
        trackTask((async () => {
          if (await fileSignature(file) !== getState().files[face.pdfKey]?.signature) throw new Error('카드에 사용한 같은 PDF 파일을 선택해주세요.');
          await setFile(face.pdfKey, file);
          edited();
        })());
      });
      retryLabel.append(retry);
      group.append(retryLabel);
    }
    if (side === 'back' && face) group.append(button('뒷면 비우기', '뒷면 비우기', () => { entry.back = null; edited(); }));
    return group;
  }
  function render() {
    observer.disconnect();
    if (draft !== getState().draftId) { resetPreview(); draft = getState().draftId; }
    renderId++;
    for (const img of list.querySelectorAll('img')) if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    list.replaceChildren();
    if (getState().metadata['book-form-type'] !== 'cards') return;
    cards().forEach((entry, index) => {
      const row = document.createElement('li');
      row.dataset.mediaId = entry.id;
      row.dataset.number = index + 1;
      const caption = document.createElement('strong');
      caption.className = 'card-number';
      const tools = document.createElement('div');
      tools.className = 'item-actions';
      const handle = button('↕', '카드 ' + (index + 1) + ' 순서 변경', () => {});
      handle.classList.add('media-handle');
      tools.append(handle, caption, button('위로', '카드 위로', () => move(index, index - 1), index === 0),
        button('아래로', '카드 아래로', () => move(index, index + 1), index === cards().length - 1),
        button('삭제', '카드 ' + (index + 1) + ' 삭제', () => {
          const selected = selectedCard();
          cards().splice(index, 1);
          updateOrder(selected);
        }));
      row.append(tools, faceField(entry, 'front', index), faceField(entry, 'back', index));
      list.append(row);
    });
    markThumbnail();
  }

  async function prepare(signal) {
    const entries = cards();
    if (!entries.length || entries.length > limit) throw new Error('카드를 1~500장 추가해주세요.');
    async function uploadFace(face) {
      signal.throwIfAborted();
      if (!face) return null;
      if (face.imageSrc) return { imageSrc: face.imageSrc, ...(face.sizeMm && { sizeMm: face.sizeMm }), ...(face.ratio && { ratio: face.ratio }) };
      let saved;
      if (face.pdfKey) {
        const key = face.pdfKey + ':' + face.page;
        saved = getState().uploads[key];
        if (!saved) {
          const pdf = await pdfFor(face.pdfKey);
          const page = await pdf.getPage(face.page);
          try {
            const { blob, ratio } = await renderPDFPage(page, 1, 0, 2000);
            saved = { asset: await uploadBlob(blob, signal), ratio, sizeMm: pdfFaceSize(page.getViewport({ scale: 1 }), 1) };
            getState().uploads[key] = saved;
            await persist();
          } finally { page.cleanup(); }
        }
      } else saved = await uploadFileAsset(face.fileKey, '카드 이미지', signal);
      return { sha: saved.asset.sha, ext: saved.asset.ext, ratio: saved.ratio, ...(saved.sizeMm && { sizeMm: saved.sizeMm }) };
    }
    const result = [];
    for (const [index, entry] of entries.entries()) {
      onProgress(entries.length + 1, index, '카드 저장 중 · ' + (index + 1) + ' / ' + entries.length + '장');
      result.push({ front: await uploadFace(entry.front), back: await uploadFace(entry.back) });
    }
    return result;
  }
  return { render, coverPreview, prepare };
}
