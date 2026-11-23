// Sizes and offsets are millimetres. Leaf numbers are one-based; a leaf owns two faces.
const record = value => value != null && typeof value === 'object' && !Array.isArray(value);
const size = value => Number.isFinite(value) && value > 0 && value <= 5000;
const signed = value => Number.isFinite(value) && Math.abs(value) <= 5000;
const pair = (value, test) => Array.isArray(value) && value.length === 2 && value.every(test);
const aligned = value => ['top', 'center', 'bottom'].includes(value);
const only = (object, allowed) => Object.keys(object).every(key => allowed.includes(key));
const optional = (value, test) => value === undefined || test(value);
export const validFaceSize = value => pair(value, size);

export function validCardStock(stock) {
  return record(stock) && only(stock, ['cornerRadiusMm', 'layers']) &&
    optional(stock.cornerRadiusMm, value => Number.isFinite(value) && value >= 0 && value <= 100) &&
    optional(stock.layers, layers => Array.isArray(layers) && layers.length >= 1 && layers.length <= 16 &&
      layers.every(color => typeof color === 'string' && /^#[a-f\d]{6}$/i.test(color)));
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

function sizedLeaves(layout, count, trim, pages) {
  const leaves = Array.from({ length: count }, (_, index) => {
    let base = layout?.firstSizeMm ?? trim;
    if (layout?.source === 'pdf') {
      const front = pages?.[2 * index]?.sizeMm;
      const back = pages?.[2 * index + 1]?.sizeMm;
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

export function leafGeometry(layout, count, trim = [148, 210], pages) {
  const leaves = sizedLeaves(layout, count, trim, pages).map(({ width, height, align, offset }) => {
    const gap = trim[1] - height;
    const top = offset + (align === 'bottom' ? gap : align === 'center' ? gap / 2 : 0);
    return { width, height, top };
  });
  let width = trim[0], top = 0, bottom = trim[1];
  for (const leaf of leaves) {
    width = Math.max(width, leaf.width);
    top = Math.min(top, leaf.top);
    bottom = Math.max(bottom, leaf.top + leaf.height);
  }
  for (const leaf of leaves) leaf.top -= top;
  return { width, height: bottom - top, coverTop: 0 - top, leaves };
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
  if (validCardStock(book.cardStock)) fields.cardStock = book.cardStock;
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
