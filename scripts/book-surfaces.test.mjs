import test from 'node:test';
import assert from 'node:assert/strict';
import { bandStops, scanWindow, wireGeometry } from '../dist/book-surfaces.js';
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

test('card deck thickness respects the layer count and an explicit measured stack', () => {
  const card = {bookForm:'cards',trimSizeMm:[100,150],pageCount:7};
  assert.ok(spineRatio({...card,cardStock:{layers:['#ffffff','#ac1234']}}) > spineRatio(card));
  assert.equal(spineRatio({...card,spineWidthMm:6}), .06);
  assert.equal(spineRatio({trimSizeMm:[100,150],pageCount:16,bindingType:'paperback'}), .035);
});
