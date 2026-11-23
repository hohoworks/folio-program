import test from 'node:test';
import assert from 'node:assert/strict';
import { addReaderWire, bandStops, scanWindow, wireGeometry } from '../dist/book-surfaces.js';
import { physicalSpreads } from '../dist/book-format.js';
import { resolveMockupDetails } from '../dist/mockup-options.js';
import { spineRatio } from '../dist/book-material.js';

test('edge bands use inclusive page numbers front to back and crop at each physical slab', () => {
  const bands = [{start:33,end:48,color:'#aabbcc'}, {start:1,end:8,color:'#bbccdd'}];
  assert.match(bandStops(bands,64), /^#bbccdd 0% 12.5%/);
  assert.match(bandStops(bands,64), /#aabbcc 50% 75%/);
  assert.equal(bandStops(bands,64,.5,.75), '#aabbcc 0% 100%');
  assert.equal(bandStops(bands,64,.75,1), '');
  const overlap = [{start:1,end:64,color:'#110000'}, {start:17,end:32,color:'#221100'}];
  assert.equal(bandStops(overlap,64), '#110000 0% 25%, #221100 25% 50%, #110000 50% 100%');
  assert.deepEqual(scanWindow('fore',.25,.5), [25,0,25,100]);
  assert.deepEqual(scanWindow('head',.25,.5), [0,50,100,25]);
  assert.deepEqual(scanWindow('tail',.25,.5), [0,25,100,25]);
});

test('successive turns share an endpoint along each supported binding edge', () => {
  for (const ringPlacement of ['left','right','top','bottom']) {
    const details = resolveMockupDetails({ringCount:9, ringDiameterMm:18, ringPlacement});
    const {rings,holes} = wireGeometry('spiral', details, null, [120,180], 8);
    assert.equal(rings.length, 9);
    assert.equal(holes.length, 18);
    for (let i = 1; i < rings.length; i++) {
      assert.ok(Math.hypot(...rings[i][0].xyz.map((n,a) => n - rings[i-1].at(-1).xyz[a])) < 1e-9);
    }
  }
});

test('independent rings close at their supplied positions and use the specified diameter', () => {
  const details = resolveMockupDetails({ringCount:2, ringDiameterMm:30, ringPlacement:'top'});
  const {rings} = wireGeometry('ring', details, [10,75], [200,150], 8);
  for (const [i, center] of [20,150].entries()) {
    const loop = rings[i];
    assert.equal(loop[0].xyz[0], center);
    assert.ok(Math.hypot(...loop[0].xyz.map((n,a) => n - loop.at(-1).xyz[a])) < 1e-9);
    const ys = loop.map(point => point.xyz[1]);
    assert.equal(Math.max(...ys) - Math.min(...ys), 30);
  }
});

// Collect exactly the paths added by the normal reader entry point. The document
// fixture is installed only for this synchronous render.
function readWire(book, pair) {
  const paths = {};
  const spread = {
    append() {},
    querySelectorAll(selector) {
      const number = selector.includes('paper-left') ? pair.left : pair.right;
      return number ? [{ dataset: { page: number } }] : [];
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = { createElementNS() {
    return {
      dataset: {}, style: { setProperty() {} },
      setAttribute(name, value) { this[name] = value; },
      append(child) { paths[child.class] = child.d; },
    };
  } };
  try {
    addReaderWire(spread, book, pair);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  }
  return paths;
}

test('the reader threads one coil through every punched face, including single-sided spreads', () => {
  for (const ringPlacement of ['left', 'right', 'top', 'bottom']) {
    const book = { bindingType: 'spiral', trimSizeMm: [120, 180], mockupDetails: { ringPlacement, ringCount: 9 } };
    for (const pair of physicalSpreads(4)) {
      const sheetCount = Number(!!pair.left) + Number(!!pair.right);
      const paths = readWire(book, pair);
      const wire = paths['reader-wire-stroke'];
      const holes = [...paths['reader-wire-holes'].matchAll(/M([-\d.]+) ([-\d.]+)a([\d.]+)/g)];
      assert.equal(holes.length, 9 * sheetCount);
      const coils = ['top', 'bottom'].includes(ringPlacement) ? sheetCount : 1;
      assert.equal(wire.match(/M/g).length, coils, 'one uninterrupted wire per exposed binding edge');
      const endpoints = [...wire.matchAll(/[MCL]([^MCLZ]+)/g)].map(match => match[1].trim().split(/\s+/).slice(-2).map(Number));
      for (const [, left, y, radius] of holes) {
        assert.ok(endpoints.some(([px, py]) => Math.abs(px - Number(left) - Number(radius)) < .00002 && py === Number(y)),
          'the same wire must pass through each punched hole');
      }
    }
  }
});

test('each reader O-ring closes on its own pair of holes and keeps custom spacing', () => {
  const book = { bindingType: 'ring', trimSizeMm: [120, 180], ringPositions: [10, 45, 82], mockupDetails: { ringCount: 3 } };
  for (const pair of physicalSpreads(4)) {
    const paths = readWire(book, pair);
    const rings = paths['reader-wire-stroke'].match(/M[^M]+/g);
    assert.equal(rings.length, 3);
    rings.forEach((ring, index) => {
      assert.equal(ring.at(-1), 'Z');
      const station = 180 * book.ringPositions[index] / 100;
      const coordinates = ring.match(/-?\d+(?:\.\d+)?/g).map(Number);
      assert.ok(coordinates.filter((_, i) => i % 2).every(y => Math.abs(y - station) < 8),
        'an independent ring cannot bridge two stations');
    });
  }
});

test('card deck thickness respects the layer count and an explicit measured stack', () => {
  const card = {bookForm:'cards',trimSizeMm:[100,150],pageCount:7};
  assert.ok(spineRatio({...card,cardStock:{layers:['#ffffff','#ac1234']}}) > spineRatio(card));
  assert.equal(spineRatio({...card,spineWidthMm:6}), .06);
  assert.equal(spineRatio({trimSizeMm:[100,150],pageCount:16,bindingType:'paperback'}), .035);
});

test('measured plies set the automatic stack depth and respect an explicit measured stack', () => {
  const deck = { bookForm: 'cards', pageCount: 8, trimSizeMm: [100,150],
    cardStock: { layers: ['#cccccc','#eeeeee'], layerThicknessMm: [.25,.75] } };
  assert.equal(spineRatio(deck), .04);
  assert.equal(spineRatio({ ...deck, spineWidthMm: 6 }), .06);
});
