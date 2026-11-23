import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cardFaces, cardThumbnail, leafCountForBook, leafDimensions, leafGeometry, normalizeBookFormat,
  physicalSpreads, validCardStock, validLeafLayout,
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

test('a deck uses its cover, a chosen card uses its front, a legacy thumbnail is preserved', () => {
  const book = { pages: [{ imageSrc: 'first' }, { blank: true }, { imageSrc: 'second' }],
    coverImages: { front: 'cover' }, thumbnailSrc: 'legacy' };
  assert.deepEqual(cardThumbnail(book), { mode: 'single', card: 1, src: 'legacy' });
  assert.equal(cardThumbnail({ ...book, thumbnailSrc: undefined }).src, 'cover');
  assert.deepEqual(cardThumbnail({ ...book, cardStock: { thumbnailMode: 'single', thumbnailCard: 2 } }),
    { mode: 'single', card: 2, src: 'second' });
  assert.equal(cardThumbnail({ ...book, cardStock: { thumbnailMode: 'deck', thumbnailCard: 2 } }).src, 'cover');
});
