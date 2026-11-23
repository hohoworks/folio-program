import { setBookSupport } from './book-photo.js';
import { bookLeafGeometry, leafCountForBook, trimSize } from './book-format.js';
import { setExposedSewing, setSaddleSpine } from './saddle-material.js';
import { resolveMockupDetails } from './mockup-options.js';

const cuts = ['fore', 'head', 'tail'];
const direction = { fore: 'to right', spine: 'to left', head: 'to top', tail: 'to bottom' };
const isColor = value => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
const svgNS = 'http://www.w3.org/2000/svg';
const round = value => Number(value.toFixed(5));
const mm = (value, width) => 'calc(var(--material-width) * ' + round(value / width) + ')';
const percent = fraction => round(fraction * 100) + '%';

function part(className, parent) {
  const node = document.createElement('i');
  node.className = className;
  node.setAttribute('aria-hidden', 'true');
  parent.append(node);
  return node;
}

function svgElement(name, attrs, parent) {
  const node = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  parent?.append(node);
  return node;
}

// Resolve overlaps once. As with per-leaf settings, a later row overrides an earlier one.
function bandRuns(bands, pageCount) {
  if (!bands?.length || !Number.isInteger(pageCount) || !pageCount) return [];
  const pages = new Array(pageCount);
  for (const band of bands) {
    if (Number.isInteger(band.start) && Number.isInteger(band.end) && isColor(band.color)) {
      pages.fill(band.color, Math.max(0, band.start - 1), Math.min(pageCount, Math.max(0, band.end)));
    }
  }
  const runs = [];
  for (let i = 0; i < pages.length;) {
    let next = i + 1;
    while (next < pages.length && pages[next] === pages[i]) next++;
    if (pages[i]) runs.push({start: i + 1, end: next, color: pages[i]});
    i = next;
  }
  return runs;
}

// Page 1 lies against the front cover. The CSS planes face in different directions.
function bandRunStops(runs, pageCount, start, end, stock) {
  if (!runs?.length || start >= end) return '';
  const stops = [];
  const at = value => percent((value - start) / (end - start));
  let cursor = start;
  for (const band of runs) {
    const first = Math.max(start, cursor, (band.start - 1) / pageCount);
    const last = Math.min(end, band.end / pageCount);
    if (last <= first) continue;
    if (first > cursor) stops.push(stock + ' ' + at(cursor) + ' ' + at(first));
    stops.push(band.color + ' ' + at(first) + ' ' + at(last));
    cursor = last;
  }
  if (!stops.length) return '';
  if (cursor < end) stops.push(stock + ' ' + at(cursor) + ' 100%');
  return stops.join(', ');
}

export function bandStops(bands, pageCount, start = 0, end = 1) {
  return bandRunStops(bandRuns(bands, pageCount), pageCount, start, end, 'var(--paper-color, #efede4)');
}

// A laminated edge is a single cross-section. Its bands fill the full depth,
// regardless of how many page images or cards the publication contains.
function plyStops(layers, thicknesses) {
  if (!layers?.length || !layers.every(isColor)) return '';
  const total = thicknesses?.reduce((sum, value) => sum + value, 0) ?? layers.length;
  let depth = 0;
  return layers.map((color, index) => {
    const from = depth;
    depth += thicknesses?.[index] ?? 1;
    return color + ' ' + percent(from / total) + ' ' + percent(depth / total);
  }).join(', ');
}

export function scanWindow(cut, start, end) {
  const depth = end - start;
  if (cut === 'fore') return [start * 100, 0, depth * 100, 100];
  return [0, (cut === 'head' ? 1 - end : start) * 100, 100, depth * 100];
}

function paintScan(face, cut, treatment, start, end) {
  const attrs = { preserveAspectRatio: 'none', 'aria-hidden': 'true' };
  const scan = svgElement('svg', { ...attrs, class: 'edge-scan', viewBox: scanWindow(cut, start, end).join(' ') }, face);
  const rotated = svgElement('g', { transform: 'rotate(' + (treatment.rotation || 0) + ' 50 50)' }, scan);
  const crop = treatment.crop ?? { x: 0, y: 0, width: 100, height: 100 };
  const frame = svgElement('svg', { ...attrs, width: 100, height: 100,
    viewBox: [crop.x, crop.y, crop.width, crop.height].join(' ') }, rotated);
  svgElement('image', { ...attrs, href: new URL(treatment.imageSrc, import.meta.url).href, width: 100, height: 100 }, frame);
}

function paintFace(face, cut, state, start = 0, end = 1) {
  face.querySelector(':scope > .edge-scan')?.remove();
  face.style.removeProperty('--cut-paint');
  face.removeAttribute('data-cut');
  const angle = direction[cut];
  if (state.plies) {
    face.dataset.cut = 'laminated';
    face.style.setProperty('--cut-paint', 'linear-gradient(' + angle + ', ' + state.plies + ')');
    return;
  }
  const treatment = state.treatments?.[cut];
  if (treatment?.mode === 'scan' && treatment.imageSrc) {
    face.dataset.cut = 'scan';
    paintScan(face, cut, treatment, start, end);
    return;
  }
  const color = treatment?.mode === 'solid' && isColor(treatment.color) && treatment.color;
  let paint;
  if (color) {
    paint = 'linear-gradient(' + color + ', ' + color + ')';
  } else {
    const bands = bandRunStops(state.bands, state.pages, start, end, 'var(--paper-color, #efede4)');
    if (bands) paint = 'linear-gradient(' + angle + ', ' + bands + ')';
  }
  if (paint) {
    face.dataset.cut = 'colored';
    face.style.setProperty('--cut-paint', paint);
  }
}

function variableLeaves(surface, size, state, layout) {
  surface.querySelector(':scope > .variable-block')?.remove();
  surface.removeAttribute('data-variable-block');
  const support = [];
  setBookSupport(surface, 'leaves', support);
  if (!layout) return;
  surface.setAttribute('data-variable-block', '');
  const block = part('variable-block', surface);
  // Contiguous leaves of the same dimensions form one slab, even in large books.
  for (let first = 0; first < layout.leaves.length;) {
    const leaf = layout.leaves[first];
    let after = first + 1;
    while (after < layout.leaves.length && layout.leaves[after].width === leaf.width &&
      layout.leaves[after].height === leaf.height && layout.leaves[after].top === leaf.top &&
      layout.leaves[after].sectionIndex === leaf.sectionIndex) after++;
    const slice = part('leaf-slice', block);
    if (leaf.sectionIndex != null) {
      const section = layout.sections[leaf.sectionIndex];
      slice.style.setProperty('--section-cover', section.color ?? 'var(--case-color, var(--paper-color, #efede4))');
      slice.classList.toggle('section-front', first === 0 || layout.leaves[first - 1].sectionIndex !== leaf.sectionIndex);
      slice.classList.toggle('section-back', after === layout.leaves.length || layout.leaves[after].sectionIndex !== leaf.sectionIndex);
    }
    const start = first / state.leaves, end = after / state.leaves;
    const top = (leaf.top - layout.coverTop) / size[1] - .5;
    const bottom = top + leaf.height / size[1];
    const right = leaf.width / size[0] - .5;
    if (top < -.5 || bottom > .5 || right > .5) {
      for (const x of [-.5, right]) {
        for (const y of [top, bottom]) {
          for (const z of [.5 - start, .5 - end]) support.push([x, y, z]);
        }
      }
    }
    slice.style.width = percent(leaf.width / size[0]);
    slice.style.height = percent(leaf.height / size[1]);
    slice.style.top = percent((leaf.top - layout.coverTop) / size[1]);
    slice.style.setProperty('--slab-depth', 'calc(var(--sheet-depth) * ' + round(end - start) + ')');
    slice.style.transform = 'translateZ(calc(var(--sheet-depth) * ' + round(.5 - (start + end) / 2) + '))';
    for (const cut of cuts) paintFace(part('slice-edge slice-' + cut, slice), cut, state, start, end);
    first = after;
  }
}

function shelfLeaves(surface, layout, size) {
  surface.querySelector('.shelf-leaves')?.remove();
  surface.style.removeProperty('--shelf-leaf-width');
  if (!layout) return;
  const outline = pathSVG(surface, 'shelf-leaves', [0, 0, layout.width, layout.height]);
  const wire = surface.hasAttribute('data-wire-bound');
  const compilation = surface.hasAttribute('data-saddle-sections');
  outline.style.top = wire ? 'var(--shelf-wire-leaf-top)' : compilation ? '0' : percent(-layout.coverTop / size[1]);
  outline.style.width = wire ? 'var(--shelf-wire-leaves)' : mm(layout.width, size[0]);
  outline.style.height = wire ? 'var(--shelf-wire-leaf-height)' : compilation ? '100%' : percent(layout.height / size[1]);
  surface.style.setProperty('--shelf-leaf-width', mm(layout.width, size[0]));
  surface.insertBefore(outline, surface.querySelector('.shelf-cover'));
  for (let i = layout.leaves.length - 1; i >= 0; i--) {
    const leaf = layout.leaves[i], next = layout.leaves[i+1];
    if (next && next.top === leaf.top && next.height === leaf.height && next.width === leaf.width) continue;
    svgElement('rect', { x: 0, y: leaf.top, width: leaf.width, height: leaf.height,
      fill: leaf.color ?? 'var(--paper-color, #efede4)', stroke: '#a7a399', 'stroke-width': .2 }, outline);
  }
}

function shelfEdges(surface, state) {
  surface.querySelector(':scope > .shelf-cuts')?.remove();
  if (!state.plies && !state.bands?.length && !cuts.some(cut => ['solid', 'scan'].includes(state.treatments?.[cut]?.mode))) return;
  const group = part('shelf-cuts', surface);
  for (const cut of cuts) paintFace(part('shelf-cut shelf-' + cut, group), cut, state);
}

const radial = (side, x, y, z, width, height) => {
  switch (side) {
    case 'right': return [width - x, y, z];
    case 'top': return [y, x, z];
    case 'bottom': return [y, height - x, z];
    default: return [x, y, z];
  }
};

// Keep the bore inside even a narrow sheet, with enough ring outside the binding edge.
function punchInset(diameter, across) {
  return Math.min(7.5, Math.max(2.5, diameter * .21), diameter * .42, across / 3);
}

// A single drill guide is used for both covers, every sheet and the actual wire.
function punchLayout(binding, details, positions, [width, height]) {
  const { ringPlacement: side, ringCount: count, ringDiameterMm: diameter } = details;
  const vertical = side === 'left' || side === 'right';
  const length = vertical ? height : width;
  const across = vertical ? width : height;
  const pitch = length / count;
  const wire = Math.min(1.7, Math.max(.65, diameter * .07), pitch * .27, across * .18);
  const reach = punchInset(diameter, across);
  const radius = Math.min(wire * (binding === 'ring' ? 1.6 : 1.35), reach * .8, pitch * .36);
  const custom = binding === 'ring' && positions?.length === count;
  const stations = Array.from({ length: count }, (_, i) => {
    const along = custom ? length * positions[i] / 100 : pitch * (i + .5);
    return Math.max(radius, Math.min(length - radius, along));
  });
  const centers = stations.map(along => radial(side, reach, along, 0, width, height).slice(0, 2));
  return { width, height, side, length, pitch, wire, reach, radius, stations, centers };
}

export function coverPunchLayout(book) {
  if (book.bookForm === 'cards' || !['spiral', 'ring'].includes(book.bindingType)) return null;
  return punchLayout(book.bindingType, resolveMockupDetails(book.mockupDetails), book.ringPositions, trimSize(book));
}

export function wireGeometry(binding, details, positions, size, depth, steps = 16) {
  const guide = punchLayout(binding, details, positions, size);
  const { width, height, side, wire, pitch, reach, stations } = guide;
  const r = details.ringDiameterMm / 2;
  const half = depth / 2;
  const rz = Math.max(r, half + wire * 1.55);
  const entry = Math.asin(half / rz);
  const cosEntry = Math.cos(entry);
  const tip = Math.PI - entry;
  // Include the exact entrances in the mesh, regardless of the curve resolution.
  const angles = [...new Set([...Array.from({ length: steps + 1 }, (_, i) => (2 * i / steps - 1) * Math.PI),
    -tip, -Math.PI / 2, -entry, 0, entry, Math.PI / 2, tip])].sort((a, b) => a - b);
  const rings = stations.map(station => angles.map(angle => {
    const a = Math.abs(angle);
    // Inside the stack the wire follows a straight bore. Its entire advance to
    // the next hole takes place around the exposed edge, never through solid paper.
    const outside = Math.max(0, (a - entry) / tip);
    const x = a <= entry ? reach : reach - 2 * r * (cosEntry - Math.cos(angle)) / (1 + cosEntry);
    const y = station + (binding === 'spiral' ? Math.sign(angle) * pitch * outside / 2 : 0)
      + Math.sin(angle) * wire * .65 * outside;
    const z = a === entry || a === tip ? Math.sign(angle) * half : rz * Math.sin(angle);
    return { local: [x, y, z], xyz: radial(side, x, y, z, width, height) };
  }));
  const holes = stations.flatMap((station, i) => [1, -1].map(face => ({
    local: [reach, station, face * half], xyz: [...guide.centers[i], face * half], face,
  })));
  return { ...guide, rings, holes, rz, r, depth, firstTip: angles.indexOf(-tip), lastTip: angles.indexOf(tip) };
}

// The Works grid is a still, head-on product view. Keep a little depth in the
// metal along the binding axis while leaving the printed cover exactly square.
function frontWireRuns(points, half, tilt) {
  const runs = [];
  let run;
  const project = ([x, y, z]) => [x, y + tilt * (z - half)];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const limits = [0, 1];
    // Between these crossings the segment is wholly visible or wholly hidden.
    for (const [axis, plane] of [[0, 0], [2, half]]) {
      const t = (plane - a[axis]) / (b[axis] - a[axis]);
      if (t > 0 && t < 1) limits.push(t);
    }
    limits.sort((first, second) => first - second);
    const at = t => a.map((v, axis) => v + (b[axis] - v) * t);
    for (let j = 1; j < limits.length; j++) {
      if (limits[j] === limits[j - 1]) continue;
      const [x, , z] = at((limits[j] + limits[j - 1]) / 2);
      if (x >= 0 && z < half) { run = undefined; continue; }
      const p = project(at(limits[j - 1])), q = project(at(limits[j]));
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < .00001) continue;
      if (!run) { run = [p]; runs.push(run); }
      run.push(q);
    }
  }
  return runs;
}

// Both clipped ends turn back under the cover. Dimensions follow the coil and
// its pitch so changing the ring count does not lengthen the tips into a neighbour.
function tuckedEnds(guide, diameter) {
  const extent = (diameter - guide.reach) * .34;
  const pitch = Math.min(guide.pitch, diameter * .44);
  const first = guide.stations[0], last = guide.stations.at(-1);
  function tip(station, direction) {
    const xy = (u, y) => round(u < 0 ? u * extent : u * guide.reach) + ' ' + round(station + direction * y * pitch);
    const root = xy(.55, .097), bend = xy(-1, .029), shoulder = xy(-.718, -.248);
    const returnToCover = 'C' + xy(-.932, .284) + ' ' + xy(-.422, .090) + ' ' + root;
    return {
      rear: 'M' + bend + returnToCover,
      top: 'M' + root + 'C' + xy(-.422,.090) + ' ' + xy(-.932,.284) + ' ' + bend +
        'C' + xy(-1.069,-.224) + ' ' + xy(-.889,-.279) + ' ' + shoulder +
        'C' + xy(-.453,-.201) + ' ' + xy(-.137,-.136) + ' ' + xy(.54,-.085),
      front: 'M' + xy(1,0) + 'C' + xy(.38,-.080) + ' ' + xy(-.410,-.194) + ' ' + shoulder +
        'C' + xy(-.889,-.279) + ' ' + xy(-1.069,-.224) + ' ' + bend,
    };
  }
  const upper = tip(first, 1), lower = tip(last, -1);
  return { rear: upper.top + lower.rear, front: lower.front };
}

export function workWireProjection(book, depth) {
  if (book.bookForm === 'cards' || !['spiral','ring'].includes(book.bindingType)) return null;
  const kind = book.bindingType, d = resolveMockupDetails(book.mockupDetails);
  const geom = wireGeometry(kind, d, book.ringPositions, trimSize(book), depth, 64);
  const { width, height, side, wire, radius, centers, length, reach } = geom;
  let runs, ends;
  if (kind === 'spiral') {
    const spiral = geom.rings.flatMap((loop, i) => loop.slice(i ? 1 : geom.firstTip,
      i === geom.rings.length - 1 ? geom.lastTip + 1 : loop.length).map(point => point.local));
    // Replace just the two cut ends. Every complete winding retains its full diameter.
    runs = frontWireRuns(spiral, depth / 2, .026).slice(1, -1);
    ends = tuckedEnds(geom, d.ringDiameterMm);
  } else {
    runs = geom.rings.flatMap(loop => {
      const parts = frontWireRuns(loop.map(point => point.local), depth / 2, .105);
      // The independent ring begins and ends at the same point outside the spine.
      if (parts.length > 1) parts[0] = parts.pop().concat(parts[0].slice(1));
      return parts;
    });
  }
  const outer = d.ringDiameterMm - reach + wire;
  const padding = Math.min(6, width * .05, height * .05);
  // Include the metal's shallow projection at extreme, custom O-ring stations.
  const along = runs.flat();
  let lo = 0, hi = length;
  for (const [,y] of along) { lo = Math.min(lo, y - wire); hi = Math.max(hi, y + wire); }
  const vertical = side === 'left' || side === 'right';
  const left = vertical ? (side === 'left' ? -outer : 0) : lo;
  const top = vertical ? lo : (side === 'top' ? -outer : 0);
  const frameWidth = (vertical ? width + outer : hi - lo) + 2 * padding;
  const frameHeight = (vertical ? hi - lo : height + outer) + 2 * padding;
  return { width, height, side, radius, wire, centers, outer, lo, hi, runs, ends, color: d.ringColor,
    bounds: [left - padding, top - padding, frameWidth, frameHeight] };
}

export function addWorkWire(parent, book, depth) {
  const view = workWireProjection(book, depth);
  if (!view) return;
  const { width, height, side, bounds, wire, centers, outer, lo, hi, ends } = view;
  const [x,y,w,h] = bounds;
  parent.classList.add('work-wire-cover');
  for (const [k,v] of Object.entries({ x: percent(-x / w), y: percent(-y / h), w: percent(width / w),
    h: percent(height / h), ratio: w / h, color: view.color })) parent.style.setProperty('--work-wire-' + k, v);
  const svg = pathSVG(parent, 'work-wire-ink', bounds);
  const matrix = { left:'', right:`translate(${width} 0) scale(-1 1)`, top:'matrix(0 1 1 0 0 0)', bottom:`matrix(0 -1 1 0 0 ${height})` }[side];
  const edgeGroup = () => svgElement('g', { transform: matrix }, svg);
  function metal(group, data, back = false) {
    if (!data) return;
    const strokes = [['var(--work-wire-edge)',1.12],['var(--work-wire-color)',back ? .60 : .78]];
    if (!back) strokes.push(['var(--work-wire-light)',.22]);
    for (const [color, scale] of strokes) svgElement('path', { d: data, fill:'none', stroke:color,
      'stroke-width':wire * scale, 'stroke-linejoin':'round', 'stroke-linecap':'round' }, group);
  }
  if (ends) {
    const clipId = 'wire-tuck-' + ++wireFinishId;
    const clip = svgElement('clipPath', { id:clipId }, svgElement('defs', {}, svg));
    svgElement('rect', { x:-outer-2, y:lo-2, width:outer+2, height:hi-lo+4 }, clip);
    metal(svgElement('g', { 'clip-path':'url(#'+clipId+')' }, edgeGroup()), ends.rear, true);
  }
  const holes = svgElement('g', { class:'work-wire-holes' }, svg);
  for (const [cx,cy] of centers) svgElement('circle', { cx, cy, r:view.radius * .89,
    fill:'#302f2c', stroke:'#69635a', 'stroke-width':view.radius * .22 }, holes);
  const ink = edgeGroup();
  const line = points => 'M' + points.map(([u,t]) => round(u) + ' ' + round(t)).join('L');
  metal(ink, view.runs.map(line).join(''));
  if (ends) metal(ink, ends.front);
  return view;
}

// Intersect a camera ray with the paper block in book coordinates. The wire is
// visible up to its actual punch and never crosses the cover artwork behind it.
function behindBook(point, camera, bounds) {
  let near = 0, far = 1 - 1e-7;
  for (let axis = 0; axis < 3; axis++) {
    const step = point[axis] - camera[axis];
    const [min, max] = bounds[axis];
    if (Math.abs(step) < 1e-9) {
      if (camera[axis] < min || camera[axis] > max) return false;
      continue;
    }
    const entry = (min - camera[axis]) / step, exit = (max - camera[axis]) / step;
    near = Math.max(near, Math.min(entry, exit));
    far = Math.min(far, Math.max(entry, exit));
    if (near > far) return false;
  }
  return true;
}

function visibleWirePath(curves, camera, bounds, project, projectedRuns) {
  const data = [];
  function emit(command, point) {
    const xy = project(point);
    data.push(command + xy);
    if (projectedRuns) {
      if (command === 'M') projectedRuns.push([]);
      projectedRuns.at(-1).push(xy);
    }
  }
  for (const curve of curves) {
    let a = curve[0];
    let hidden = behindBook(a, camera, bounds);
    if (!hidden) emit('M', a);
    for (let i = 1; i < curve.length; i++) {
      const b = curve[i];
      const nextHidden = behindBook(b, camera, bounds);
      if (hidden !== nextHidden) {
        // Locate the visible endpoint inside this chord to subpixel accuracy.
        let lo = a, hi = b;
        for (let j = 0; j < 8; j++) {
          const middle = lo.map((value, axis) => (value + hi[axis]) / 2);
          if (behindBook(middle, camera, bounds) === hidden) lo = middle;
          else hi = middle;
        }
        emit(hidden ? 'M' : 'L', hi);
      }
      if (!nextHidden) emit('L', b);
      a = b;
      hidden = nextHidden;
    }
  }
  return data.join('');
}

// Trim the free ends back to cover height on the outside of the edge. Their
// caps then stay clear of the head and tail without removing a punched station.
export function modelWireCurves(geometry, binding) {
  if (binding !== 'spiral') return geometry.rings.map(loop => loop.map(point => point.xyz));
  return [geometry.rings.flatMap((turn, index) => {
    const start = index === 0 ? geometry.firstTip : 1;
    const end = index === geometry.rings.length - 1 ? geometry.lastTip + 1 : turn.length;
    return turn.slice(start, end).map(point => point.xyz);
  })];
}

const wireViews = new WeakMap();
let wireFinishId = 0;

// The light-facing strip follows the projected tangent around each bend.
function wireReflection(runs, gauge) {
  const data = [];
  for (const run of runs) {
    if (run.length < 2) continue;
    for (let i = 0; i < run.length; i++) {
      const a = run[Math.max(0, i - 1)], b = run[Math.min(run.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const length = Math.hypot(dx, dy) || 1;
      const nx = -dy / length, ny = dx / length;
      const offset = (-.45 * nx - .89 * ny) * gauge * .26;
      data.push((i ? 'L' : 'M') + round(run[i][0] + offset * nx) + ',' + round(run[i][1] + offset * ny));
    }
  }
  return data.join('');
}

// Project the punches in exactly the same coordinate system as the wire.
// From the side, the thickness of the paper hides the openings on both covers.
const punchCircle = Array.from({ length: 16 }, (_, i) => [Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)]);
function projectedPunches(geom, camera, project, radius, inset = 0) {
  const data = [];
  for (const { xyz: [x, y, z], face } of geom.holes) {
    if ((camera[2] - z) * face <= 0) continue;
    for (let i = 0; i < punchCircle.length; i++) {
      const [dx, dy] = punchCircle[i];
      const xy = project([x + radius * dx, y + inset + radius * dy, z]);
      data.push((i ? 'L' : 'M') + xy);
    }
    data.push('Z');
  }
  return data.join('');
}

function modelWire(surface, geom, [width, height], binding) {
  // Render a whole curve in screen space. Its stroke keeps a round gauge even
  // when the ring is edge-on. The projection uses the same moving CSS camera as the book.
  const frame = surface.parentElement;
  const ink = pathSVG(frame, 'model-wire-ink', [0, 0, width, height]);
  const gauge = geom.wire * (binding === 'ring' ? 1.24 : 1);
  const finish = 'wire-finish-' + ++wireFinishId;
  const defs = svgElement('defs', {}, ink);
  const gradient = svgElement('linearGradient', { id: finish, x1: '0%', y1: '10%', x2: '100%', y2: '25%' }, defs);
  for (const [offset, color] of [[0, 'var(--wire-glint)'], [.27, 'var(--wire-sheen)'], [.58, 'var(--wire-glint)'], [1, 'var(--wire-sheen)']]) {
    svgElement('stop', { offset, 'stop-color': color }, gradient);
  }
  const coverClip = svgElement('clipPath', { id: finish + '-cover', clipPathUnits: 'userSpaceOnUse' }, defs);
  const coverOutline = svgElement('path', {}, coverClip);
  const punches = svgElement('g', { 'clip-path': 'url(#' + finish + '-cover)' }, ink);
  const lip = svgElement('path', { class: 'wire-hole-rim', fill: 'var(--wire-punch-rim)' }, punches);
  const bore = svgElement('path', { class: 'wire-hole', fill: 'var(--wire-punch-depth)' }, punches);
  function stroke(scale, color) {
    return svgElement('path', { fill: 'none', stroke: color, 'stroke-width': gauge * scale,
      'stroke-linecap': 'butt', 'stroke-linejoin': 'round' }, ink);
  }
  const outline = stroke(1.08, 'var(--wire-contour)');
  const body = stroke(.81, 'var(--wire-color)');
  const sheen = stroke(.32, 'var(--wire-sheen)');
  const glint = stroke(.14, 'url(#' + finish + ')');
  const curves = modelWireCurves(geom, binding);
  // Each turn repeats along one axis, so the two end turns bound the coil
  // at every viewing angle, including books bound along the bottom edge.
  const alongEdge = [...geom.rings].sort((a, b) => a[0].local[1] - b[0].local[1]);
  const ends = new Set([alongEdge[0], alongEdge.at(-1)]);
  const support = [...ends].flatMap(turn => turn.map(({ xyz: [x, y, z] }) =>
    [x / width - .5, y / height - .5, z / geom.depth]));
  setBookSupport(surface, 'wire', support);
  const bounds = [[0, width], [0, height], [-geom.depth / 2, geom.depth / 2]];
  let pending = 0, previous = '';

  function draw() {
    pending = 0;
    const size = getComputedStyle(surface);
    const scaleX = parseFloat(size.width) / width, scaleY = parseFloat(size.height) / height;
    if (!scaleX || !scaleY || !surface.offsetWidth) return;
    const perspective = parseFloat(getComputedStyle(frame).perspective);
    const color = surface.style.getPropertyValue('--wire-color');
    const stamp = [size.transform, scaleX, scaleY, perspective, color].join('/');
    if (stamp !== previous) {
      previous = stamp;
      ink.style.setProperty('--wire-color', color);
      const matrix = new DOMMatrixReadOnly(size.transform === 'none' ? undefined : size.transform);
      const scaleZ = Math.max(1.5, Math.min(80, scaleX * geom.depth)) / geom.depth;
      const eye = matrix.inverse().transformPoint({ x: 0, y: 0, z: perspective });
      const camera = [eye.x / scaleX + width / 2, eye.y / scaleY + height / 2, eye.z / scaleZ];
      const project = ([x, y, z]) => {
        const p = matrix.transformPoint({ x: (x - width / 2) * scaleX, y: (y - height / 2) * scaleY, z: z * scaleZ });
        const factor = perspective / (perspective - p.z);
        return [round(width / 2 + p.x * factor / scaleX), round(height / 2 + p.y * factor / scaleY)];
      };
      const faceZ = Math.sign(camera[2]) * geom.depth / 2;
      const corners = [[0, 0], [width, 0], [width, height], [0, height]];
      coverOutline.setAttribute('d', 'M' + corners.map(([x, y]) => project([x, y, faceZ])).join('L') + 'Z');
      lip.setAttribute('d', projectedPunches(geom, camera, project, geom.radius));
      bore.setAttribute('d', projectedPunches(geom, camera, project, geom.radius * .85, -geom.radius * .05));
      const runs = [];
      const d = visibleWirePath(curves, camera, bounds, project, runs);
      outline.setAttribute('d', d);
      body.setAttribute('d', d);
      const reflection = wireReflection(runs, gauge);
      sheen.setAttribute('d', reflection);
      glint.setAttribute('d', reflection);
    }
    if (surface.getAnimations().some(animation => animation.playState === 'running')) schedule();
  }

  function schedule() {
    if (!pending) pending = requestAnimationFrame(draw);
  }
  const changes = new MutationObserver(schedule);
  changes.observe(surface, { attributes: true, attributeFilter: ['style', 'class'] });
  const resize = new ResizeObserver(schedule);
  resize.observe(surface);
  surface.addEventListener('transitionrun', schedule);
  surface.addEventListener('transitionend', schedule);
  schedule();
  wireViews.set(surface, () => {
    cancelAnimationFrame(pending);
    changes.disconnect();
    resize.disconnect();
    surface.removeEventListener('transitionrun', schedule);
    surface.removeEventListener('transitionend', schedule);
    ink.remove();
  });
}

function pathSVG(parent, className, bounds) {
  return svgElement('svg', { class: className, viewBox: bounds.map(round).join(' '),
    preserveAspectRatio: 'none', 'aria-hidden': 'true' }, parent);
}

function wirePath(svg, data, wire) {
  for (const [size, stroke] of [[wire * 1.1, 'var(--wire-shadow)'], [wire * .7, 'var(--wire-color)'], [wire * .23, 'var(--wire-light)']]) {
    svgElement('path', { d: data, fill: 'none', stroke, 'stroke-width': size, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
  }
}

// Look straight along the pages at their bound edge. Only the wire extends
// beyond the rectangular section of the book.
let profileSerial = 0;
function wireProfile(surface, geom, width, binding) {
  const { side, wire, rings, length, depth, rz } = geom;
  const half = depth / 2;
  const facing = side === 'right' ? -1 : 1;
  const project = ([x, y, z]) => {
    // A loose O-ring rests slightly below its holes at its outermost point.
    const hang = binding === 'ring' ? Math.max(0, -x) * .10 : 0;
    return [facing * z, (side === 'top' ? length - y : y) + hang];
  };
  const point = local => project(local).map(round).join(' ');
  const pad = wire * .6;
  const radius = rz + pad;
  let top = 0, bottom = length;
  const front = [], back = [], seams = [];
  for (const loop of rings) {
    let a = loop[0].local;
    let visible = a[0] < 0;
    let path = visible ? front : back;
    path.push('M' + point(a));
    for (const vertex of loop.slice(1)) {
      const b = vertex.local;
      if ((b[0] < 0) !== visible) {
        const t = a[0] / (a[0] - b[0]);
        const crossing = point([0, a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);
        path.push('L' + crossing);
        visible = !visible;
        path = visible ? front : back;
        path.push('M' + crossing);
      }
      const [u, v] = project(b);
      path.push('L' + round(u) + ' ' + round(v));
      if (visible || Math.abs(u) > half) {
        top = Math.min(top, v - pad);
        bottom = Math.max(bottom, v + pad);
      }
      a = b;
    }
    if (binding === 'ring') {
      const [u, v] = project(loop[Math.floor(loop.length / 2)].local);
      seams.push('M' + round(u) + ' ' + round(v - wire * .36) + 'v' + round(wire * .72));
    }
  }

  const h = bottom - top;
  const svg = pathSVG(surface, 'shelf-wire-spine', [-radius, top, radius * 2, h]);
  surface.style.setProperty('--profile-height', 'min(' + mm(h, width) + ', calc(var(--shelf-height) * .84))');
  surface.style.setProperty('--profile-ratio', round(radius * 2 / h));
  const stock = 'var(--paper-color, #efede4)';
  const board = 'var(--case-color, var(--binding, #b3a897))';
  const metal = 'wire-section-' + ++profileSerial;
  const defs = svgElement('defs', {}, svg);
  const gradient = svgElement('linearGradient', {
    id: metal, gradientUnits: 'userSpaceOnUse', x1: -rz, x2: rz, y1: 0, y2: 0,
  }, defs);
  for (const [offset, color] of [[0, 'shadow'], [.17, 'color'], [.36, 'light'], [.62, 'color'], [1, 'shadow']]) {
    svgElement('stop', { offset, 'stop-color': 'var(--wire-' + color + ')' }, gradient);
  }
  const stroke = (d, color, weight) => svgElement('path', {
    d, stroke: color, 'stroke-width': weight, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }, svg);

  stroke(back.join(''), 'var(--wire-shadow)', wire);
  svgElement('rect', { x: -half, y: 0, width: depth, height: length, fill: stock }, svg);
  const sheets = Math.max(3, Math.min(65, Math.round(depth / .72)));
  const grain = [];
  for (let i = 1; i < sheets; i++) grain.push('M' + round(i / sheets * depth - half) + ' 0v' + length);
  stroke(grain.join(''), 'color-mix(in srgb, ' + stock + ' 70%, #443f35)', Math.min(.18, depth / sheets * .19));
  const boardWidth = Math.min(.65, depth * .10);
  for (const x of [-half, half - boardWidth]) {
    svgElement('rect', { x, y: 0, width: boardWidth, height: length, fill: board }, svg);
  }
  const wireFace = front.join('');
  stroke(wireFace, 'var(--wire-shadow)', wire * 1.05);
  stroke(wireFace, 'url(#' + metal + ')', wire * .71);
  if (seams.length) stroke(seams.join(''), 'var(--wire-shadow)', wire * .22);
}

function shelfWire(surface, geom, [width, height], binding, layout, hasCuts) {
  const [minX, minY, maxX, maxY] = geom.rings.flat().reduce((bounds, { xyz: [x,y] }) =>
    [Math.min(bounds[0],x), Math.min(bounds[1],y), Math.max(bounds[2],x), Math.max(bounds[3],y)], [Infinity, Infinity, -Infinity, -Infinity]);
  const pad = Math.max(geom.wire, geom.radius);
  const bounds = [minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2];
  const leafWidth = layout?.width ?? width, leafHeight = layout?.height ?? height;
  const leafTop = -(layout?.coverTop ?? 0);
  const left = Math.min(0, bounds[0]);
  const cutWidth = hasCuts ? Math.min(width * .035, geom.depth * .38) : 0;
  const right = Math.max(width + cutWidth, leafWidth, maxX + pad);
  const top = Math.min(-cutWidth * .45, leafTop, bounds[1]);
  const bottom = Math.max(height + cutWidth * .45, leafTop + leafHeight, maxY + pad);
  const slotWidth = right - left;
  const slotHeight = bottom - top;
  // The entire projected face scales with its animated shelf slot. The wire,
  // the cover and any stepped leaves therefore stay aligned during a turn.
  surface.style.setProperty('--shelf-wire-slot', mm(slotWidth, width));
  surface.style.setProperty('--shelf-wire-slot-height', mm(slotHeight, width));
  surface.style.setProperty('--shelf-wire-inset', percent(-left / slotWidth));
  surface.style.setProperty('--shelf-wire-top', percent(-top / slotHeight));
  surface.style.setProperty('--shelf-wire-cover', percent(width / slotWidth));
  surface.style.setProperty('--shelf-wire-cover-height', percent(height / slotHeight));
  surface.style.setProperty('--shelf-wire-cut', percent(cutWidth / width));
  surface.style.setProperty('--shelf-wire-cut-height', percent(cutWidth * .45 / height));
  surface.style.setProperty('--shelf-wire-leaves', percent(leafWidth / slotWidth));
  surface.style.setProperty('--shelf-wire-leaf-top', percent((leafTop - top) / slotHeight));
  surface.style.setProperty('--shelf-wire-leaf-height', percent(leafHeight / slotHeight));
  surface.style.setProperty('--shelf-paint-ratio', slotWidth / height);
  surface.style.setProperty('--shelf-painted-height', slotHeight / height);
  const front = pathSVG(surface, 'shelf-hardware', bounds);
  front.style.left = percent((bounds[0] - left) / slotWidth);
  front.style.top = percent((bounds[1] - top) / slotHeight);
  front.style.width = percent(bounds[2] / slotWidth);
  front.style.height = percent(bounds[3] / slotHeight);
  for (const { xyz: [cx,cy], face } of geom.holes) {
    if (face === 1) svgElement('circle', { cx, cy, r: geom.radius, fill: '#3d3833' }, front);
  }
  const frontPath = [];
  for (const loop of geom.rings) {
    let drawing = false;
    for (const {xyz, local: [x, , z]} of loop) {
      if (x < 0 || z >= geom.depth / 2) {
        frontPath.push((drawing ? 'L' : 'M') + round(xyz[0]) + ' ' + round(xyz[1]));
        drawing = true;
      } else drawing = false;
    }
  }
  wirePath(front, frontPath.join(''), geom.wire);
  wireProfile(surface, geom, width, binding);
}

const wireKeys = new WeakMap();
export function setBookSurfaces(surface, book, details, size, depth) {
  const model = surface.classList.contains('book-model');
  const stage = model ? surface.closest('.stage') : surface;
  const cards = book.bookForm === 'cards';
  const hardware = !cards && ['spiral', 'ring'].includes(book.bindingType);
  stage.dataset.binding = cards ? 'cards' : book.bindingType ?? 'paperback';
  surface.toggleAttribute('data-card-stock', cards);
  surface.toggleAttribute('data-wire-bound', hardware);
  const stock = !cards && book.coverStock;
  const boardPlies = stock && plyStops(stock.layers, stock.layerThicknessMm);
  surface.toggleAttribute('data-cover-stock', !!boardPlies);
  if (boardPlies) surface.style.setProperty('--cover-plies', boardPlies);
  else surface.style.removeProperty('--cover-plies');
  const pages = book.pageCount ?? book.pages?.length ?? 0;
  const leaves = Math.max(1, leafCountForBook(book) || Math.ceil(pages / 2));
  const state = {
    treatments: book.edgeTreatments, bands: bandRuns(book.edgeBands, pages), pages, leaves,
    plies: cards ? plyStops(book.cardStock?.layers, book.cardStock?.layerThicknessMm) : '',
  };
  const geometry = cards ? null : bookLeafGeometry(book);
  const hasSections = Boolean(geometry?.sections?.length);
  const layout = hasSections || geometry?.leaves.some(leaf => leaf.width !== size[0] || leaf.height !== size[1] || leaf.top !== geometry.coverTop)
    ? geometry : null;
  setSaddleSpine(surface, book, details, size, depth, geometry);
  setExposedSewing(surface, book, details, size, depth);
  if (model) {
    for (const cut of cuts) paintFace(surface.querySelector(':scope > .' + cut), cut, state);
    paintFace(surface.querySelector(':scope > .spine'), 'spine', { ...state, bands: null });
    variableLeaves(surface, size, state, layout);
    for (const edge of surface.querySelectorAll('.corner-strip.edge-paper')) {
      const cut = edge.classList.contains('upper') ? 'head' : 'tail';
      paintFace(edge, cut, state);
    }
  } else {
    // The open shelf cover is seen head-on. A card deck shows its plies
    // on the closed spine, with the selected card's flat face when open.
    if (cards) surface.querySelector(':scope > .shelf-cuts')?.remove();
    else shelfEdges(surface, state);
    shelfLeaves(surface, layout, size);
    const spine = surface.querySelector('.shelf-spine');
    paintFace(spine, 'spine', { ...state, bands: null });
  }
  const leafWidth = layout?.width ?? size[0];
  const hasShelfCuts = !model && !!surface.querySelector('.shelf-cuts');
  const wireKey = hardware ? JSON.stringify([book.bindingType, details.ringPlacement, details.ringCount,
    details.ringDiameterMm, book.ringPositions, size, depth, leafWidth, layout?.height, layout?.coverTop, hasShelfCuts]) : null;
  if (hardware) surface.style.setProperty('--wire-color', details.ringColor);
  if (wireKeys.get(surface) !== wireKey) {
    wireViews.get(surface)?.();
    wireViews.delete(surface);
    if (model && !hardware) setBookSupport(surface, 'wire', []);
    for (const node of surface.querySelectorAll(':scope > :is(.model-hardware, .shelf-hardware, .shelf-wire-spine)')) node.remove();
    if (hardware) {
      const wire = wireGeometry(book.bindingType, details, book.ringPositions, size, depth, 48);
      if (model) modelWire(surface, wire, size, book.bindingType);
      else shelfWire(surface, wire, size, book.bindingType, layout, hasShelfCuts);
    }
    wireKeys.set(surface, wireKey);
  }
  const side = hardware && details.ringPlacement;
  const across = side === 'top' || side === 'bottom' ? size[1] : size[0];
  const extra = hardware ? details.ringDiameterMm - punchInset(details.ringDiameterMm, across) + 1.7 : 0;
  const left = side === 'left' ? -extra : 0;
  const right = Math.max(layout?.width ?? 0, size[0] + (side === 'right' ? extra : 0));
  const top = Math.min(-(layout?.coverTop ?? 0), side === 'top' ? -extra : 0);
  const bottom = Math.max((layout?.height ?? 0) - (layout?.coverTop ?? 0), size[1] + (side === 'bottom' ? extra : 0));
  stage.style.setProperty('--physical-fit', Math.min(1, size[0] / (right - left), size[1] / (bottom - top)));
  if (model) {
    surface.style.setProperty('--center-cut-x', mm((size[0] - right - left) / 2, size[0]));
    surface.style.setProperty('--center-cut-y', mm((size[1] - bottom - top) / 2, size[0]));
  } else if (!hardware) {
    surface.style.setProperty('--shelf-paint-ratio', leafWidth / size[1]);
    surface.style.setProperty('--shelf-painted-height', (bottom - top) / size[1]);
    surface.style.setProperty('--shelf-over-top', mm(-top, size[0]));
    surface.style.setProperty('--shelf-over-bottom', mm(bottom - size[1], size[0]));
  }
}

// Place marks on the real sheets already painted in the spread. At a stepped
// edge the first sheet under a punch can be an exposed portion of a larger leaf.
export function addReaderWire(spread, book, pair, layout) {
  const guide = coverPunchLayout(book);
  if (!guide) return;
  const kind = book.bindingType;
  const { side: edge, width: trimWidth, height: trimHeight, stations, reach, radius, wire: gauge, pitch } = guide;
  const { ringColor } = resolveMockupDetails(book.mockupDetails);
  const spine = layout?.width ?? trimWidth;
  const height = layout?.height ?? trimHeight;
  const coverTop = layout?.coverTop ?? 0;
  const standard = { width: trimWidth, height: trimHeight, top: 0 };
  const stacks = {};
  for (const side of ['left', 'right']) {
    stacks[side] = pair[side] ? [...spread.querySelectorAll('.paper-' + side + '[data-page]')].reverse()
      .map(page => {
        const index = Number(page.dataset.page) - 1;
        return layout?.faces?.[index] ?? layout?.leaves[Math.floor(index / 2)] ?? standard;
      }) : [];
  }
  const vertical = edge === 'left' || edge === 'right';
  const holes = [], runs = [];

  function punch(x, y) {
    const r = round(radius);
    holes.push('M' + round(x - r) + ' ' + round(y) + 'a' + r + ' ' + r + ' 0 1 0 ' + round(2 * r) + ' 0a' +
      r + ' ' + r + ' 0 1 0 ' + round(-2 * r) + ' 0Z');
    return [x, y];
  }
  // Store both sides of each turn, even where the first or last sheet exposes
  // the return side of the coil. Only a real sheet gets a punched hole.
  const seam = [];
  const edges = { left: [], right: [] };
  for (const station of stations) {
    if (vertical) {
      const y = coverTop + station;
      let punched = false;
      const ends = [];
      for (const [side, sign] of [['left', -1], ['right', 1]]) {
        const leaf = stacks[side].find(part => reach + radius <= part.width &&
          y >= part.top + radius && y <= part.top + part.height - radius);
        if (leaf) {
          ends.push(punch(spine + sign * reach, y));
          punched = true;
        } else {
          ends.push([spine + sign * reach * .65, y]);
        }
      }
      if (punched) seam.push(edge === 'right' ? ends.reverse() : ends);
      continue;
    }
    for (const [side, sign] of [['left', -1], ['right', 1]]) {
      const inward = edge === 'top' ? 1 : -1;
      const boundary = edge === 'top' ? coverTop : coverTop + trimHeight;
      const y = boundary + inward * reach;
      const leaf = stacks[side].find(part => station >= radius && station <= part.width - radius &&
        y >= part.top + radius && y <= part.top + part.height - radius);
      if (!leaf) continue;
      const x = spine + sign * station;
      const outer = [x, boundary + inward * gauge / 2];
      const inner = punch(x, y);
      edges[side].push([outer, inner]);
    }
  }

  // Viewed straight on, each exposed turn crosses its pair of holes. The
  // return to the next station is hidden behind the paper.
  const bend = Math.min(gauge * 1.35, pitch * .2);
  const point = (p, dx = 0, dy = 0) => round(p[0] + dx) + ' ' + round(p[1] + dy);
  function wirePath(turns, ax, ay) {
    const dx = ax * bend, dy = ay * bend;
    for (const [a, b] of turns) {
      runs.push('M' + point(a));
      if (kind === 'spiral') {
        runs.push('L' + point(b));
      } else {
        runs.push('C' + point(a, dx, dy) + ' ' + point(b, dx, dy) + ' ' + point(b));
        runs.push('C' + point(b, -dx, -dy) + ' ' + point(a, -dx, -dy) + ' ' + point(a) + 'Z');
      }
    }
  }
  if (vertical) wirePath(seam, 0, 1);
  else {
    wirePath(edges.left, -1, 0);
    wirePath(edges.right, 1, 0);
  }
  if (!runs.length) return;
  const svg = pathSVG(spread, 'reader-wire-marks', [0, 0, 2 * spine, height]);
  svg.setAttribute('focusable', 'false');
  svg.dataset.binding = kind;
  svg.dataset.edge = edge;
  svg.style.setProperty('--wire-color', ringColor);
  svgElement('path', {
    class: 'reader-wire-holes', d: holes.join(''), fill: '#34332f',
    stroke: '#999486', 'stroke-width': gauge * .19,
  }, svg);
  const d = runs.join('');
  for (const [name, weight, color] of [
    ['reader-wire-stroke', 1, 'color-mix(in srgb, var(--wire-color) 76%, #20201d)'],
    ['reader-wire-light', .36, 'color-mix(in srgb, var(--wire-color) 68%, white)'],
  ]) {
    svgElement('path', {
      class: name, d, fill: 'none', stroke: color, 'stroke-width': gauge * weight, 'stroke-linecap': 'round',
    }, svg);
  }
}
