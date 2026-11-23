import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bookLeafGeometry, cardFaces, cardThumbnail, leafCountForBook, leafDimensions, leafGeometry, normalizeBookFormat,
  physicalSpreads, validCardStock, validCoverStock, validLeafLayout, validSaddleSections,
} from '../dist/book-format.js';

test('one leaf owns its front and back even at the first and last spread', () => {
  assert.deepEqual(physicalSpreads(0), []);
  assert.deepEqual(physicalSpreads(3), [{ left: 0, right: 1 }, { left: 2, right: 3 }]);
  assert.deepEqual(physicalSpreads(4), [{ left: 0, right: 1 }, { left: 2, right: 3 }, { left: 4, right: 0 }]);
  assert.equal(leafCountForBook({ pages: [{}, {}, {}] }), 2);
  assert.equal(leafCountForBook({ pageCount: 8, joinSplitPages: true }), 2);
});

test('both signed increments, section steps, individual overrides and placement share one scale', () => {
  const trim = [100, 160];
  const layout = { source: 'custom', firstSizeMm: [60, 110], stepMm: [10, -2], ranges: [
    { from: 2, to: 4, widthMm: 92, heightMm: 80, stepMm: [-3, 8], align: 'bottom', offsetMm: 10 },
    { from: 3, to: 3, widthMm: 150, align: 'center', offsetMm: -60 },
  ] };
  assert.equal(validLeafLayout(layout, 4, trim), true);
  assert.deepEqual(leafDimensions(layout, 1, trim), [60, 110]);
  assert.deepEqual(leafDimensions(layout, 3, trim), [150, 88]);
  const geometry = leafGeometry(layout, 4, trim);
  assert.deepEqual(geometry, {
    width: 150, height: 194, coverTop: 24,
    leaves: [
      { width: 60, height: 110, top: 24 }, { width: 92, height: 80, top: 114 },
      { width: 150, height: 88, top: 0 }, { width: 86, height: 96, top: 98 },
    ],
  });
});

test('a section can reverse one axis and retain the existing slope on the other axis', () => {
  const layout = { firstSizeMm: [100, 80], stepMm: [5, 10], ranges: [
    { from: 2, to: 4, stepMm: [-3, null] }, { from: 3, to: 3, heightMm: 76 },
  ] };
  assert.equal(validLeafLayout(layout, 4), true);
  assert.deepEqual(leafDimensions(layout, 2), [105, 90]);
  assert.deepEqual(leafDimensions(layout, 3), [102, 76]);
  assert.deepEqual(leafDimensions(layout, 4), [99, 110]);
});

test('PDF mode uses a single real trim size for both faces and accepts manual corrections', () => {
  const pages = [{ sizeMm: [50, 80] }, { sizeMm: [100, 100] }, {}, { sizeMm: [70, 85] }];
  const layout = { source: 'pdf', ranges: [{ from: 2, to: 2, heightMm: 82 }] };
  assert.deepEqual(leafDimensions(layout, 1, [100, 160], pages), [50, 80]);
  assert.deepEqual(leafDimensions(layout, 2, [100, 160], pages), [70, 82]);
});

test('out-of-range, malformed or impossible leaf configurations do not reach the renderer', () => {
  for (const layout of [
    { firstSizeMm: [100, '20'] }, { source: 'wrong' }, { align: 'left' },
    { firstSizeMm: [20, 100], stepMm: [-10, 5] },
    { ranges: [{ from: 2, to: 4, widthMm: 30 }] }, { ranges: [{ from: 2, to: 1, heightMm: 10 }] },
    { ranges: [{ from: 2, to: 2, stepMm: [0, Infinity] }] },
  ]) assert.equal(validLeafLayout(layout, 3), false);
  assert.deepEqual(normalizeBookFormat({ pages: [{}], leafLayout: { align: 'right' } }), { bookForm: 'bound' });
});

test('cards retain explicit blank backs and append just the missing final back', () => {
  const pages = [{ imageSrc: 'one' }, { blank: true }, { imageSrc: 'two' }];
  assert.deepEqual(cardFaces(pages), [...pages, { blank: true }]);
  assert.equal(pages.length, 3);
  const both = [{ imageSrc: 'one' }, { blank: true }];
  assert.equal(cardFaces(both), both);
  assert.equal(validCardStock({ cornerRadiusMm: 3, layers: ['#ff8844', '#223344'] }), true);
  assert.equal(validCardStock({ layers: ['#123'] }), false);
  assert.equal(validCardStock({ layers: [] }), false);
  assert.equal(validCardStock({ layers: Array(17).fill('#ffffff') }), false);
});

test('layer measurements match the color sequence; the chosen card must exist', () => {
  const stock = { layers: ['#cceeff', '#336699'], layerThicknessMm: [.1, .45], thumbnailMode: 'single', thumbnailCard: 2 };
  assert.ok(validCardStock(stock, 2));
  for (const invalid of [
    { layerThicknessMm: [.1] }, { layerThicknessMm: [0, .1] }, { layerThicknessMm: [2, 21] },
    { layerThicknessMm: ['.2', .3] }, { thumbnailMode: 'https://example.com' }, { thumbnailCard: 3 },
    { thumbnailCard: 1.5 }, { thumbnailSrc: 'assets/books/other/card.png' },
  ]) assert.equal(validCardStock({ ...stock, ...invalid }, 2), false);
  assert.equal(validCardStock({ layerThicknessMm: [.1] }), false);
});

test('bound covers preserve the exact ply sequence and measurements without changing legacy card stock', () => {
  const stock = { layers: ['#dd4433', '#ffeedc', '#224466'], layerThicknessMm: [.25, .73, .32] };
  assert.equal(validCoverStock(stock), true);
  assert.deepEqual(normalizeBookFormat({ coverStock: stock }), { bookForm: 'bound', coverStock: stock });
  for (const invalid of [
    null, {}, { layers: stock.layers }, { ...stock, layers: [] }, { ...stock, layers: ['#fee'] },
    { ...stock, layerThicknessMm: [.25, .73] }, { ...stock, layerThicknessMm: [0, 1, 2] },
    { ...stock, layerThicknessMm: [.25, .73, 20.01] }, { ...stock, thumbnailMode: 'deck' },
    { layers: Array(17).fill('#ffeecc'), layerThicknessMm: Array(17).fill(.1) },
  ]) {
    assert.equal(validCoverStock(invalid), false);
    assert.deepEqual(normalizeBookFormat({ coverStock: invalid }), { bookForm: 'bound' });
  }
  const legacy = { layers: ['#331122', '#eeeeee'] };
  assert.deepEqual(normalizeBookFormat({ bookForm: 'cards', cardStock: legacy, coverStock: stock }),
    { bookForm: 'cards', cardStock: legacy });
});

test('ordered saddle booklets account for every printed face, including odd sections and repaired split pages', () => {
  const sections = [{ pages: 1, sizeMm: [100, 164], color: '#117766' }, { pages: 3 }];
  const book = { bindingType: 'saddle-stitch', pages: Array(8).fill({}), joinSplitPages: true, saddleSections: sections };
  assert.ok(validSaddleSections(sections, 4));
  assert.ok(validSaddleSections([{ pages: 4 }], 4));
  assert.deepEqual(normalizeBookFormat(book).saddleSections, sections);
  for (const invalid of [[], [{ pages: 0 }, { pages: 4 }], [{ pages: 1.5 }, { pages: 2.5 }],
    [{ pages: 3 }], [{ pages: 5 }], [{ pages: 4, color: '#ccc' }], [{ pages: 4, sizeMm: [10, 0] }],
    [{ pages: 4, src: 'image' }], Array(17).fill({ pages: 1 })]) {
    assert.equal(validSaddleSections(invalid, 4), false);
  }
  assert.equal(normalizeBookFormat({ ...book, joinSplitPages: false }).saddleSections, undefined);
  assert.equal(normalizeBookFormat({ ...book, bindingType: 'paperback' }).saddleSections, undefined);
  assert.equal(normalizeBookFormat({ ...book, bookForm: 'cards' }).saddleSections, undefined);
});

test('odd booklet boundaries keep each face, centre each cut and enclose both faces on the physical leaf', () => {
  const book = { bindingType: 'saddle-stitch', trimSizeMm: [100, 160], pageCount: 4,
    saddleSections: [{ pages: 1, sizeMm: [80, 80], color: '#aa1133' }, { pages: 3, sizeMm: [120, 200] }] };
  const g = bookLeafGeometry(book);
  assert.deepEqual([g.width, g.height, g.coverTop], [120, 200, 20]);
  assert.deepEqual(g.sections.map(s => [s.startPage, s.endPage, s.top]), [[1, 1, 60], [2, 4, 0]]);
  assert.deepEqual(g.faces[0], { width: 80, height: 80, top: 60, sectionIndex: 0, color: '#aa1133' });
  assert.deepEqual(g.faces[1], { width: 120, height: 200, top: 0, sectionIndex: 1 });
  assert.deepEqual(g.leaves[0], { ...g.faces[0], width: 120, height: 200, top: 0 });
  const stepped = bookLeafGeometry({ ...book, leafLayout: { stepMm: [-1, -2], ranges: [
    { from: 2, to: 2, widthMm: 70, align: 'bottom', offsetMm: 2 },
  ] } });
  assert.deepEqual(stepped.faces[3], { width: 70, height: 198, top: 4, sectionIndex: 1 });
  assert.equal(stepped.height, 202);
  const pdf = bookLeafGeometry({ ...book, leafLayout: { source: 'pdf' } },
    [{ sizeMm: [70, 75] }, { sizeMm: [110, 194] }, { sizeMm: [72, 80] }, {}]);
  assert.deepEqual(pdf.faces.map(face => face.width), [70, 110, 72, 72]);
  assert.equal(bookLeafGeometry({ ...book, saddleSections: undefined }), undefined);
  const legacy = bookLeafGeometry({ ...book, saddleSections: undefined, leafLayout: { stepMm: [3, 2] } });
  assert.deepEqual(legacy.leaves, leafGeometry({ stepMm: [3, 2] }, 2, [100, 160]).leaves);
  assert.deepEqual(legacy.faces.map(face => face.width), [100, 100, 103, 103]);
  assert.equal(bookLeafGeometry({ ...book, bookForm: 'cards' }), undefined);
  assert.equal(bookLeafGeometry({ ...book, saddleSections: [{ pages: 4, sizeMm: [10, 80] }],
    leafLayout: { stepMm: [-15, 0] } }), undefined);
});

test('a deck uses its cover, a chosen card uses its front, a legacy thumbnail is preserved', () => {
  const book = { pages: [{ imageSrc: 'first' }, { blank: true }, { imageSrc: 'second' }],
    coverImages: { front: 'cover' }, thumbnailSrc: 'legacy' };
  assert.deepEqual(cardThumbnail(book), { mode: 'single', card: 1, src: 'legacy' });
  assert.equal(cardThumbnail({ ...book, thumbnailSrc: undefined }).src, 'cover');
  assert.deepEqual(cardThumbnail({ ...book, cardStock: { thumbnailMode: 'single', thumbnailCard: 2 } }),
    { mode: 'single', card: 2, src: 'second' });
  assert.equal(cardThumbnail({ ...book, cardStock: { thumbnailMode: 'deck', thumbnailCard: 2 } }).src, 'cover');
});
