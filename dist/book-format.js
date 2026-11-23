// Sizes and offsets are millimetres. Leaf numbers are one-based; a leaf owns two faces.
const record = value => value != null && typeof value === 'object' && !Array.isArray(value);
const size = value => Number.isFinite(value) && value > 0 && value <= 5000;
const signed = value => Number.isFinite(value) && Math.abs(value) <= 5000;
const pair = (value, test) => Array.isArray(value) && value.length === 2 && value.every(test);
const aligned = value => ['top', 'center', 'bottom'].includes(value);
const only = (object, allowed) => Object.keys(object).every(key => allowed.includes(key));
const optional = (value, test) => value === undefined || test(value);
export const validFaceSize = value => pair(value, size);

const stockColor = color => typeof color === 'string' && /^#[a-f\d]{6}$/i.test(color);
const validLayers = layers => Array.isArray(layers) && layers.length >= 1 && layers.length <= 16 &&
  layers.every(stockColor);
const validLayerThickness = (values, layers) => Array.isArray(values) && values.length === layers?.length &&
  values.every(mm => Number.isFinite(mm) && mm >= .01 && mm <= 20);

// Ordered from the outer printed surface towards the inside of each cover.
export function validCoverStock(stock) {
  return record(stock) && only(stock, ['layers', 'layerThicknessMm']) &&
    validLayers(stock.layers) && validLayerThickness(stock.layerThicknessMm, stock.layers);
}

export function validSaddleSections(sections, pageCount) {
  if (!Array.isArray(sections) || sections.length < 1 || sections.length > 16 || !Number.isInteger(pageCount)) return false;
  let pages = 0;
  for (const section of sections) {
    if (!record(section) || !only(section, ['pages', 'sizeMm', 'color']) ||
        !Number.isInteger(section.pages) || section.pages < 1 || section.pages > pageCount ||
        !optional(section.sizeMm, validFaceSize) || !optional(section.color, stockColor)) return false;
    pages += section.pages;
  }
  return pages === pageCount;
}

export function validCardStock(stock, cardCount = 500) {
  return record(stock) && only(stock, ['cornerRadiusMm', 'layers', 'layerThicknessMm', 'thumbnailMode', 'thumbnailCard']) &&
    optional(stock.cornerRadiusMm, value => Number.isFinite(value) && value >= 0 && value <= 100) &&
    optional(stock.layers, validLayers) &&
    optional(stock.layerThicknessMm, values => validLayerThickness(values, stock.layers)) &&
    optional(stock.thumbnailMode, mode => mode === 'deck' || mode === 'single') &&
    optional(stock.thumbnailCard, index => Number.isInteger(index) && index >= 1 && index <= cardCount);
}

// A representative image is always a face already in this book. A legacy
// thumbnail keeps its original presentation until an editor chooses a mode.
export function cardThumbnail(book) {
  const stock = book.cardStock ?? {};
  const card = stock.thumbnailCard ?? 1;
  const front = book.pages?.[2 * (card - 1)]?.imageSrc;
  if (!stock.thumbnailMode && book.thumbnailSrc) return { mode: 'single', card, src: book.thumbnailSrc };
  const mode = stock.thumbnailMode ?? 'deck';
  const src = mode === 'single' ? front ?? book.coverImages?.front : book.coverImages?.front ?? front;
  return { mode, card, src };
}

export function leafCountForBook(book) {
  const count = book.pageCount ?? book.pages?.length ?? 0;
  return Math.ceil((book.joinSplitPages ? count / 2 : count) / 2);
}

export function trimSize(book) {
  if (validFaceSize(book.trimSizeMm)) return book.trimSizeMm;
  const ratio = book.coverRatio;
  if (!Number.isFinite(ratio) || ratio <= 0) return [148, 210];
  return ratio >= 1 ? [210, 210 / ratio] : [210 * ratio, 210];
}

function sizedLeaves(layout, count, trim, pages, startPage = 1, endPage = Infinity) {
  const leaves = Array.from({ length: count }, (_, index) => {
    let base = layout?.firstSizeMm ?? trim;
    if (layout?.source === 'pdf') {
      // At an odd booklet boundary the other face belongs to another trim.
      const front = 2 * index + 2 === startPage ? undefined : pages?.[2 * index]?.sizeMm;
      const back = 2 * index + 1 === endPage ? undefined : pages?.[2 * index + 1]?.sizeMm;
      if (validFaceSize(front)) base = front;
      else if (validFaceSize(back)) base = back;
    }
    return {
      width: base[0] + index * (layout?.stepMm?.[0] ?? 0),
      height: base[1] + index * (layout?.stepMm?.[1] ?? 0),
      align: layout?.align ?? 'top', offset: 0,
    };
  });
  // A section starts from its previously assigned dimensions. A supplied
  // increment replaces that axis's progression, including an explicit zero.
  for (const range of layout?.ranges ?? []) {
    const first = leaves[range.from - 1];
    if (!first) continue;
    const width = range.widthMm ?? first.width;
    const height = range.heightMm ?? first.height;
    for (let i = range.from - 1; i < Math.min(range.to, count); i++) {
      const leaf = leaves[i];
      const distance = i + 1 - range.from;
      if (range.widthMm !== undefined || range.stepMm?.[0] != null) {
        leaf.width = width + distance * (range.stepMm?.[0] ?? 0);
      }
      if (range.heightMm !== undefined || range.stepMm?.[1] != null) {
        leaf.height = height + distance * (range.stepMm?.[1] ?? 0);
      }
      if (range.align) leaf.align = range.align;
      if (range.offsetMm !== undefined) leaf.offset = range.offsetMm;
    }
  }
  return leaves;
}

export function leafDimensions(layout, number, trim = [148, 210], pages) {
  const { width, height } = sizedLeaves(layout, number, trim, pages)[number - 1];
  return [width, height];
}

function alignedTop(leaf, height) {
  const gap = height - leaf.height;
  return leaf.offset + (leaf.align === 'bottom' ? gap : leaf.align === 'center' ? gap / 2 : 0);
}

export function leafGeometry(layout, count, trim = [148, 210], pages) {
  const leaves = sizedLeaves(layout, count, trim, pages).map(leaf => ({
    width: leaf.width, height: leaf.height, top: alignedTop(leaf, trim[1]),
  }));
  let width = trim[0], top = 0, bottom = trim[1];
  for (const leaf of leaves) {
    width = Math.max(width, leaf.width);
    top = Math.min(top, leaf.top);
    bottom = Math.max(bottom, leaf.top + leaf.height);
  }
  for (const leaf of leaves) leaf.top -= top;
  return { width, height: bottom - top, coverTop: 0 - top, leaves };
}

// Each face belongs to one booklet. Keep each booklet centred on the common
// spine; ranges, steps and PDF measurements retain their original millimetres.
export function bookLeafGeometry(book, pages = book.pages, pageCount = book.pageCount ?? pages?.length ?? 0) {
  if (book.bookForm === 'cards' || !Number.isInteger(pageCount) || pageCount < 1) return undefined;
  const trim = trimSize(book);
  const count = Math.ceil(pageCount / 2);
  const layout = book.leafLayout;
  if (book.bindingType !== 'saddle-stitch' || !validSaddleSections(book.saddleSections, pageCount)) {
    if (!layout) return undefined;
    const geometry = leafGeometry(layout, count, trim, pages);
    return { ...geometry, faces: Array.from({ length: pageCount }, (_, i) => geometry.leaves[Math.floor(i / 2)]) };
  }
  const faces = [], sections = [];
  let top = 0, bottom = trim[1], width = trim[0];
  function include(shape) {
    top = Math.min(top, shape.top);
    bottom = Math.max(bottom, shape.top + shape.height);
    width = Math.max(width, shape.width);
  }
  for (const [sectionIndex, section] of book.saddleSections.entries()) {
    const cut = section.sizeMm ?? trim;
    const startPage = faces.length + 1, endPage = faces.length + section.pages;
    const booklet = { startPage, endPage, width: cut[0], height: cut[1], top: (trim[1] - cut[1]) / 2,
      ...(section.color && { color: section.color }) };
    sections.push(booklet);
    include(booklet);
    const sizes = layout && sizedLeaves(layout, count, cut, pages, startPage, endPage);
    for (let page = startPage; page <= endPage; page++) {
      const leaf = sizes?.[Math.floor((page - 1) / 2)];
      const face = { width: leaf?.width ?? cut[0], height: leaf?.height ?? cut[1],
        top: booklet.top + (leaf ? alignedTop(leaf, cut[1]) : 0), sectionIndex,
        ...(section.color && { color: section.color }) };
      if (!size(face.width) || !size(face.height)) return undefined;
      faces.push(face);
      include(face);
    }
  }
  for (const shape of [...sections, ...faces]) shape.top -= top;
  const leaves = [];
  for (let i = 0; i < faces.length; i += 2) {
    const front = faces[i], back = faces[i + 1];
    if (!back || back.sectionIndex === front.sectionIndex) {
      leaves.push(front);
    } else {
      const y = Math.min(front.top, back.top);
      leaves.push({ ...front, width: Math.max(front.width, back.width), top: y,
        height: Math.max(front.top + front.height, back.top + back.height) - y });
    }
  }
  return { width, height: bottom - top, coverTop: 0 - top, sections, leaves, faces };
}

export function validLeafLayout(layout, count, trim = [148, 210], pages) {
  if (!record(layout) || !Number.isInteger(count) || count < 1 ||
      !only(layout, ['source', 'firstSizeMm', 'stepMm', 'align', 'ranges']) ||
      !optional(layout.source, value => ['custom', 'pdf'].includes(value)) ||
      !optional(layout.firstSizeMm, validFaceSize) || !optional(layout.stepMm, value => pair(value, signed)) ||
      !optional(layout.align, aligned)) return false;
  if (layout.ranges !== undefined && (!Array.isArray(layout.ranges) || layout.ranges.length > 1000)) return false;
  for (const range of layout.ranges ?? []) {
    if (!record(range) || !only(range, ['from', 'to', 'widthMm', 'heightMm', 'stepMm', 'align', 'offsetMm']) ||
        !Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 1 ||
        range.to < range.from || range.to > count ||
        !optional(range.widthMm, size) || !optional(range.heightMm, size) ||
        !optional(range.stepMm, value => pair(value, delta => delta === null || signed(delta))) ||
        !optional(range.align, aligned) || !optional(range.offsetMm, signed)) return false;
  }
  return sizedLeaves(layout, count, trim, pages).every(leaf => size(leaf.width) && size(leaf.height));
}

export function normalizeBookFormat(book) {
  const fields = { bookForm: book.bookForm === 'cards' ? 'cards' : 'bound' };
  if (fields.bookForm === 'bound' && validCoverStock(book.coverStock)) fields.coverStock = book.coverStock;
  const pageCount = (book.pages?.length ?? book.pageCount ?? 0) / (book.joinSplitPages ? 2 : 1);
  if (fields.bookForm === 'bound' && book.bindingType === 'saddle-stitch' && validSaddleSections(book.saddleSections, pageCount)) {
    fields.saddleSections = book.saddleSections;
  }
  if (validCardStock(book.cardStock, leafCountForBook(book))) fields.cardStock = book.cardStock;
  if (validLeafLayout(book.leafLayout, leafCountForBook(book), trimSize(book), book.pages)) fields.leafLayout = book.leafLayout;
  return fields;
}

export function cardFaces(pages) {
  return pages.length % 2 ? [...pages, { blank: true }] : pages;
}

export function physicalSpreads(faceCount) {
  const spreads = [];
  for (let left = 0; left <= faceCount && faceCount; left += 2) {
    spreads.push({ left, right: left < faceCount ? left + 1 : 0 });
  }
  return spreads;
}
