import { mockupViews, setBookMaterial, trimSize } from './vendor/mockup/book-material.js';

export function createMockupPreview(host) {
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <link rel="stylesheet" href="/vendor/mockup/style.css">
    <link rel="stylesheet" href="/mockup-preview.css">
    <div class="stage" data-uploaded data-proportional>
      <div class="model-frame"><div class="book-model" data-book="preview">
        <div class="face front cover-art"></div>
        <div class="face back"></div><div class="face spine"></div>
        <div class="face fore"></div><div class="face head"></div><div class="face tail"></div>
        <div class="case-board front-board"><i class="board-head"></i><i class="board-tail"></i></div>
        <div class="case-board back-board"><i class="board-head"></i><i class="board-tail"></i></div>
      </div></div>
    </div>`;
  const stage = root.querySelector('.stage');
  const model = root.querySelector('.book-model');
  const front = model.querySelector('.front');
  const sources = new Map();
  let currentBook;

  function updateMaterial() {
    const cover = front.querySelector('img');
    const coverRatio = cover?.naturalHeight ? cover.naturalWidth / cover.naturalHeight : currentBook.coverRatio;
    const book = { ...currentBook, coverRatio };
    const [width, height] = trimSize(book);
    stage.style.setProperty('--book-ratio', width / height);
    setBookMaterial(model, book, front);
  }

  function updateFace(name, source, title) {
    const face = model.querySelector('.' + name);
    const previous = sources.get(name);
    if (previous?.source !== source) {
      if (previous?.blobURL) URL.revokeObjectURL(previous.blobURL);
      face.replaceChildren();
      sources.delete(name);
      face.classList.toggle('artwork', Boolean(source));
      if (source) {
        const image = document.createElement('img');
        const blobURL = source instanceof Blob ? URL.createObjectURL(source) : null;
        image.src = blobURL || source;
        image.alt = '';
        image.className = 'asset-image';
        if (name === 'front') image.addEventListener('load', updateMaterial, { once: true });
        face.append(image);
        sources.set(name, { source, blobURL });
      }
    }
    if (source) return;
    let label = face.querySelector('span');
    if (!label) {
      label = document.createElement('span');
      if (name !== 'spine') label.className = 'back-title';
      face.append(label);
    }
    label.textContent = title;
  }

  return function render(book) {
    currentBook = book;
    stage.dataset.binding = book.bindingType;
    for (const name of ['front', 'back', 'spine']) updateFace(name, book.coverImages[name], book.title);
    const angle = mockupViews[book.mockupView] || mockupViews.spine;
    model.style.setProperty('--rx', angle.x + 'deg');
    model.style.setProperty('--ry', angle.y + 'deg');
    updateMaterial();
  };
}
