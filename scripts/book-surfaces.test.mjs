import test from 'node:test';
import assert from 'node:assert/strict';
import { addReaderWire, bandStops, coverPunchLayout, modelWireCurves, scanWindow, wireGeometry, workWireProjection } from '../dist/book-surfaces.js';
import { bookLeafGeometry, physicalSpreads } from '../dist/book-format.js';
import { addReaderSaddle } from '../dist/saddle-material.js';
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

test('spiral gauge changes the tube and drill clearance without moving the coil or holes', () => {
  for (const ringPlacement of ['left', 'top', 'right', 'bottom']) {
    const book = { bindingType: 'spiral', trimSizeMm: [210, 148], mockupDetails: {
      ringCount: 19, ringDiameterMm: 30, ringPlacement,
    } };
    const geometry = () => wireGeometry('spiral', resolveMockupDetails(book.mockupDetails), null, book.trimSizeMm, 22);
    const automatic = geometry();
    assert.equal(automatic.wire, 1.7);
    book.mockupDetails.wireDiameterMm = null;
    assert.deepEqual(geometry(), automatic);
    for (const mm of [.4, 2.5, 5]) {
      book.mockupDetails.wireDiameterMm = mm;
      const coil = geometry();
      assert.equal(coil.wire, mm);
      assert.deepEqual(coil.rings, automatic.rings);
      assert.deepEqual(coil.centers, automatic.centers);
      assert.ok(coil.radius > mm / 2 && coil.radius <= coil.pitch / 2);
      assert.equal(workWireProjection(book, 22).wire, mm);
    }
  }
});

test('impossible spiral gauges leave clearance for the paper and neighbouring turns; O-rings retain their gauge', () => {
  const book = { bindingType: 'spiral', trimSizeMm: [36, 60], mockupDetails: {
    ringCount: 60, ringDiameterMm: 4, wireDiameterMm: 5,
  } };
  const g = coverPunchLayout(book);
  assert.equal(g.wire, .65);
  assert.ok(g.radius * 2 < g.pitch && g.radius < g.reach);
  book.bindingType = 'ring';
  const before = workWireProjection(book, 12);
  delete book.mockupDetails.wireDiameterMm;
  assert.deepEqual(workWireProjection(book, 12), before);
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

test('the spiral tips terminate at the binding surface, clear of the visible head and tail cuts', () => {
  for (const side of ['left', 'right', 'top', 'bottom']) {
    for (const depth of [.5, 22, 65]) {
      const g = wireGeometry('spiral', {ringPlacement:side, ringCount:19, ringDiameterMm:30}, null, [210,148], depth, 48);
      const [coil] = modelWireCurves(g, 'spiral');
      for (const [x, y, z] of [coil[0], coil.at(-1)]) {
        const along = side === 'left' || side === 'right' ? y : x;
        const inset = {left:x, right:210-x, top:y, bottom:148-y}[side];
        assert.ok(along > 0 && along < g.length);
        assert.ok(Math.abs(inset) < 1e-7 || Math.abs(Math.abs(z) - depth / 2) < 1e-7);
      }
    }
  }
});

// Collect exactly the paths added by the normal reader entry point. The document
// fixture is installed only for this synchronous render.
function readWire(book, pair, layout) {
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
    addReaderWire(spread, book, pair, layout);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  }
  return paths;
}

test('each exposed spiral turn crosses the binding at right angles on single pages and full spreads', () => {
  for (const ringPlacement of ['left', 'right', 'top', 'bottom']) {
    const book = { bindingType: 'spiral', trimSizeMm: [120, 180], mockupDetails: { ringPlacement, ringCount: 9 } };
    for (const pair of physicalSpreads(4)) {
      const sheetCount = Number(!!pair.left) + Number(!!pair.right);
      const paths = readWire(book, pair);
      const wire = paths['reader-wire-stroke'];
      const holes = [...paths['reader-wire-holes'].matchAll(/M([-\d.]+) ([-\d.]+)a([\d.]+)/g)];
      assert.equal(holes.length, 9 * sheetCount);
      const acrossGutter = ['left', 'right'].includes(ringPlacement);
      const bars = [...wire.matchAll(/M([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)/g)];
      assert.equal(bars.length, 9 * (acrossGutter ? 1 : sheetCount));
      assert.equal(bars.map(bar => bar[0]).join(''), wire, 'returns behind the paper are invisible');
      const endpoints = [];
      for (const bar of bars) {
        const [x1, y1, x2, y2] = bar.slice(1).map(Number);
        if (acrossGutter) {
          assert.equal(y1, y2);
          assert.ok(Math.min(x1, x2) < 120 && Math.max(x1, x2) > 120);
        } else {
          assert.equal(x1, x2);
          assert.notEqual(y1, y2);
        }
        endpoints.push([x1, y1], [x2, y2]);
      }
      for (const [, left, y, radius] of holes) {
        assert.ok(endpoints.some(([px, py]) => Math.abs(px - Number(left) - Number(radius)) < .00002 && py === Number(y)),
          'each real punch terminates a visible bar');
      }
    }
  }
});

test('both covers, the wire through the stack, and each open page share the same drill guide', () => {
  for (const binding of ['spiral', 'ring']) {
    for (const side of ['left', 'right', 'top', 'bottom']) {
      for (const [diameter, depth] of [[4, .5], [30, 22], [65, 72]]) {
        const book = { bindingType: binding, trimSizeMm: [210, 148],
          mockupDetails: { ringPlacement: side, ringCount: 3, ringDiameterMm: diameter }, ringPositions: [8, 43, 93] };
        const guide = coverPunchLayout(book);
        const geom = wireGeometry(binding, resolveMockupDetails(book.mockupDetails), book.ringPositions, book.trimSizeMm, depth, 17);
        for (const [i, [x, y]] of guide.centers.entries()) {
          const bore = geom.rings[i].filter(p => p.local[0] > 0 && Math.abs(p.local[2]) <= depth / 2);
          assert.ok(bore.length >= 3);
          for (const p of bore) {
            assert.ok(Math.hypot(p.xyz[0] - x, p.xyz[1] - y) < 1e-9, 'wire traverses the straight bore');
          }
          for (const face of [1, -1]) {
            assert.ok(bore.some(p => p.local[2] === face * depth / 2));
            assert.deepEqual(geom.holes.find(h => h.face === face && h.local[1] === guide.stations[i]).xyz,
              [x, y, face * depth / 2]);
          }
        }
        for (const pair of physicalSpreads(4)) {
          const paths = readWire(book, pair);
          const punch = [...paths['reader-wire-holes'].matchAll(/M([-\d.]+) ([-\d.]+)a([\d.]+)/g)];
          const expected = guide.centers.flatMap(([x, y]) => {
            const across = side === 'right' ? guide.width - x : x;
            return [pair.left && [guide.width - across, y], pair.right && [guide.width + across, y]].filter(Boolean);
          });
          assert.equal(punch.length, expected.length);
          punch.forEach(([, left, y, r], i) => {
            assert.ok(Math.hypot(+left + +r - expected[i][0], +y - expected[i][1]) < .00002);
            assert.ok(Math.abs(+r - guide.radius) < .00001);
          });
        }
      }
    }
  }
  assert.equal(coverPunchLayout({ bindingType: 'ring', bookForm: 'cards' }), null);
  assert.equal(coverPunchLayout({ bindingType: 'hardcover' }), null);
});

test('the flat Works spiral shortens only the two folded ends and frames its complete windings', () => {
  const book = { bindingType:'spiral', trimSizeMm:[210,148], mockupDetails:{ringCount:19,ringDiameterMm:30} };
  const p = workWireProjection(book, 22);
  assert.equal(p.centers.length, 19);
  assert.equal(p.runs.length, 18);
  p.runs.forEach((turn, i) => {
    assert.ok(Math.abs(turn[0][0] - 6.3) < 1e-8 && Math.abs(turn[0][1] - p.centers[i][1]) < 1e-8);
    assert.ok(Math.abs(Math.min(...turn.map(([x]) => x)) + 23.7) < 1e-8);
    assert.ok(Math.abs(turn.at(-1)[0]) < 1e-8, 'return disappears at the cover edge');
  });
  const xControls = (p.ends.rear + p.ends.front).match(/-?[\d.]+/g).map(Number).filter((_,i)=>i%2===0);
  assert.ok(Math.min(...xControls) < -8 && Math.min(...xControls) > -9, 'only the little folded returns project about 8mm');
  assert.deepEqual(p.bounds, [-31.4,-6,247.4,160]);
});

test('independent flat Works rings keep their full diameter and each custom station on all four edges', () => {
  for (const side of ['left','right','top','bottom']) {
    const b = { bindingType:'ring', trimSizeMm:[120,175], ringPositions:[7,45,90],
      mockupDetails:{ringPlacement:side,ringCount:3,ringDiameterMm:38} };
    const g = workWireProjection(b,26), guide = coverPunchLayout(b);
    assert.deepEqual(g.centers,guide.centers);
    assert.equal(g.ends, undefined);
    assert.equal(g.runs.length,3);
    g.runs.forEach((ring, i) => {
      assert.deepEqual(ring[0],[guide.reach,guide.stations[i]]);
      assert.ok(Math.abs(Math.min(...ring.map(([x])=>x)) + 30.5) < .00001);
      assert.ok(Math.abs(ring.at(-1)[0]) < .00001);
    });
    assert.ok(g.bounds[0] <= 0 && g.bounds[1]<=0 && g.bounds[0]+g.bounds[2]>=120 && g.bounds[1]+g.bounds[3]>=175);
  }
  assert.equal(workWireProjection({bindingType:'ring',bookForm:'cards'}, 2),null);
  assert.equal(workWireProjection({bindingType:'hardcover'}, 20),null);
});

test('an inset top-bound leaf cannot move a punch away from the cover hole', () => {
  const book = { bindingType: 'ring', trimSizeMm: [120, 180], mockupDetails: { ringCount: 3, ringPlacement: 'top' } };
  const full = { width: 120, height: 180, top: 0 }, inset = { width: 120, height: 85, top: 35 };
  const layout = { width: 120, height: 180, coverTop: 0, faces: [inset, inset, full, full] };
  const marks = readWire(book, { left: 2, right: 3 }, layout);
  assert.equal(marks['reader-wire-holes'].match(/M/g).length, 3);
});

test('a stepped spiral spread punches only the printed face at each station', () => {
  const book = { bindingType: 'spiral', trimSizeMm: [120, 180], mockupDetails: { ringCount: 3 } };
  const full = { width: 120, height: 180, top: 0 };
  const inset = { width: 90, height: 60, top: 60 };
  const layout = { width: 120, height: 180, coverTop: 0, leaves: [full, full], faces: [full, inset, full, full] };
  const paths = readWire(book, { left: 2, right: 3 }, layout);
  const punches = [...paths['reader-wire-holes'].matchAll(/M([-\d.]+) ([-\d.]+)a/g)];
  assert.deepEqual(punches.map(match => Number(match[2])), [30, 90, 90, 150]);
  assert.equal(paths['reader-wire-stroke'].match(/L/g).length, 3);
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


test('only the center opening of each stitched section shows its inner fasteners', () => {
  const book = {
    bookForm: 'bound', bindingType: 'saddle-stitch', trimSizeMm: [148, 210],
    pages: Array.from({ length: 20 }, () => ({})),
    saddleSections: [{ pages: 4 }, { pages: 8, sizeMm: [100, 150] }, { pages: 8 }],
    mockupDetails: { stitchType: 'loop', stapleCount: 3, stapleInsetPercent: 20 },
  };
  const layout = bookLeafGeometry(book);
  const spreads = physicalSpreads(book.pages.length);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const node = tag => ({
    tag, dataset: {}, children: [], attrs: {},
    setAttribute(key, value) { this.attrs[key] = value; },
    append(child) { this.children.push(child); },
  });
  globalThis.document = { createElementNS: (_, tag) => node(tag) };
  try {
    const centers = [];
    for (const pair of spreads) {
      const spread = node('div');
      addReaderSaddle(spread, book, pair, layout, spreads);
      if (!spread.children.length) continue;
      const [marks] = spread.children;
      centers.push([pair.left, Number(marks.dataset.section)]);
      const punches = marks.children.filter(child => child.tag === 'ellipse');
      assert.equal(punches.length, 6);
      if (pair.left === 8) {
        const centers = [0, 2, 4].map(i => (punches[i].attrs.cy + punches[i + 1].attrs.cy) / 2);
        assert.deepEqual(centers, [60, 105, 150]);
      }
      assert.ok(marks.children.some(child => child.tag === 'path'));
    }
    assert.deepEqual(centers, [[2, 1], [8, 5], [16, 13]]);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  }
});
