import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBookFormat } from '../dist/book-format.js';
import { spineRatio } from '../dist/book-material.js';

const coverStock = { layers: ['#b13a48', '#273d72', '#e0aa52'], layerThicknessMm: [.24, .55, .83] };
const bound = ['paperback', 'hardcover', 'saddle-stitch', 'exposed-sewn', 'spiral', 'ring'];
const trimSizeMm = [125, 175];
const depth = book => spineRatio({ trimSizeMm, ...book }) * trimSizeMm[0];

test('the shelf shows at least four millimetres while the detailed model uses measured or inferred depth', () => {
  const cases = [
    { bindingType: 'saddle-stitch', pageCount: 20, expected: 1 },
    { bindingType: 'saddle-stitch', spineWidthMm: 2.5, expected: 2.5 },
    { bindingType: 'paperback', spineWidthMm: 4, expected: 4 },
    { bindingType: 'hardcover', spineWidthMm: 22, expected: 22 },
    { bindingType: 'spiral', spineWidthMm: 1.5, expected: 1.5 },
    { bookForm: 'cards', spineWidthMm: .6, expected: .6 },
  ];
  for (const { expected, ...format } of cases) {
    for (const width of [55, 148, 210]) {
      const book = Object.freeze({ ...format, trimSizeMm: [width, 190] });
      assert.equal(spineRatio(book, { shelf: true }), Math.max(4, expected) / width);
      assert.equal(spineRatio(book), expected / width);
    }
  }
});

test('each bound construction fits both measured covers before allocating room for the sheets', () => {
  for (const bindingType of bound) {
    const item = { bindingType, coverStock, pageCount: 24 };
    assert.deepEqual(normalizeBookFormat(item).coverStock, coverStock);
    assert.ok(depth(item) >= 2 * 1.62 + 1.2 - 1e-10);
    assert.ok(Math.abs(depth({ ...item, spineWidthMm: 1 }) - 3.34) < 1e-10);
    assert.equal(depth({ ...item, spineWidthMm: 8 }), 8);
    assert.equal(depth({ bindingType, spineWidthMm: 1 }), 1);
  }
});

test('card ply measurements affect the individual cards independently of bound cover options', () => {
  const item = { bookForm: 'cards', coverStock, pageCount: 8, cardStock: { layers: ['#ffffff', '#820042'], layerThicknessMm: [.4, .2] } };
  assert.equal(normalizeBookFormat(item).coverStock, undefined);
  assert.ok(Math.abs(depth(item) - 2.4) < 1e-10);
});
