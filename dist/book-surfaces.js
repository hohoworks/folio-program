import { leafCountForBook, leafGeometry } from './book-format.js';

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

function plyGradient(layers, count, start, end, angle) {
  if (!layers?.length || !layers.every(isColor)) return '';
  const period = 1 / (count * (end - start));
  // Slice boundaries represent whole sheets. Each sheet repeats the card's ply sequence.
  const stops = layers.map((color, index) => color + ' ' + percent(period * index / layers.length) +
    ' ' + percent(period * (index + 1) / layers.length));
  return 'repeating-linear-gradient(' + angle + ', ' + stops.join(', ') + ')';
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
  svgElement('image', { ...attrs, href: treatment.imageSrc, width: 100, height: 100 }, frame);
}

function paintFace(face, cut, state, start = 0, end = 1) {
  face.querySelector(':scope > .edge-scan')?.remove();
  face.style.removeProperty('--cut-paint');
  face.removeAttribute('data-cut');
  const treatment = state.treatments?.[cut];
  if (treatment?.mode === 'scan' && treatment.imageSrc) {
    face.dataset.cut = 'scan';
    paintScan(face, cut, treatment, start, end);
    return;
  }
  const angle = direction[cut];
  const color = treatment?.mode === 'solid' && isColor(treatment.color) && treatment.color;
  let paint;
  if (color) {
    paint = 'linear-gradient(' + color + ', ' + color + ')';
  } else {
    const plies = plyGradient(state.layers, state.leaves, start, end, angle);
    const bands = bandRunStops(state.bands, state.pages, start, end, plies ? 'transparent' : 'var(--paper-color, #efede4)');
    paint = [bands && 'linear-gradient(' + angle + ', ' + bands + ')', plies].filter(Boolean).join(', ');
  }
  if (paint) {
    face.dataset.cut = 'colored';
    face.style.setProperty('--cut-paint', paint);
  }
}

function variableLeaves(surface, size, state, layout) {
  surface.querySelector(':scope > .variable-block')?.remove();
  surface.removeAttribute('data-variable-block');
  if (!layout) return;
  surface.setAttribute('data-variable-block', '');
  const block = part('variable-block', surface);
  // Contiguous leaves of the same dimensions form one slab, even in large books.
  for (let first = 0; first < layout.leaves.length;) {
    const leaf = layout.leaves[first];
    let after = first + 1;
    while (after < layout.leaves.length && layout.leaves[after].width === leaf.width &&
      layout.leaves[after].height === leaf.height && layout.leaves[after].top === leaf.top) after++;
    const slice = part('leaf-slice', block);
    const start = first / state.leaves, end = after / state.leaves;
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
  outline.style.top = percent(-layout.coverTop / size[1]);
  outline.style.width = mm(layout.width, size[0]);
  outline.style.height = percent(layout.height / size[1]);
  surface.style.setProperty('--shelf-leaf-width', mm(layout.width, size[0]));
  surface.insertBefore(outline, surface.querySelector('.shelf-cover'));
  for (let i = layout.leaves.length - 1; i >= 0; i--) {
    const leaf = layout.leaves[i], next = layout.leaves[i+1];
    if (next && next.top === leaf.top && next.height === leaf.height && next.width === leaf.width) continue;
    svgElement('rect', { x: 0, y: leaf.top, width: leaf.width, height: leaf.height,
      fill: 'var(--paper-color, #efede4)', stroke: '#a7a399', 'stroke-width': .2 }, outline);
  }
}

function shelfEdges(surface, state) {
  surface.querySelector(':scope > .shelf-cuts')?.remove();
  if (!state.layers?.length && !state.bands?.length && !cuts.some(cut => ['solid', 'scan'].includes(state.treatments?.[cut]?.mode))) return;
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

// A spiral advances a full pitch each revolution. An independent O closes at its own station.
export function wireGeometry(binding, details, positions, [width, height], depth) {
  const { ringPlacement: side, ringCount: count, ringDiameterMm: diameter } = details;
  const length = ['left', 'right'].includes(side) ? height : width;
  const r = diameter / 2;
  const wire = Math.min(1.7, Math.max(.65, diameter * .07));
  const rz = Math.max(r, depth / 2 + wire * 1.55);
  const pitch = length / count;
  const rings = [];
  for (let index = 0; index < count; index++) {
    const center = binding === 'ring' && positions?.length === count ? positions[index] / 100 * length : (index + .5) * pitch;
    const vertices = [];
    for (let step = 0; step <= 16; step++) {
      const t = step / 16, a = t * Math.PI * 2;
      const x = r * (Math.cos(a) - .18);
      const y = center + Math.sin(a) * wire * .65 + (binding === 'spiral' ? (t - .5) * pitch : 0);
      const z = rz * Math.sin(a);
      vertices.push({ local: [x, y, z], xyz: radial(side, x, y, z, width, height) });
    }
    rings.push(vertices);
  }
  const holes = [];
  // The wire crosses each cover on the inside of the binding edge.
  for (const loop of rings) {
    for (const face of [1, -1]) {
      const z = face * depth / 2;
      for (let step = 1; step < loop.length; step++) {
        const a = loop[step - 1].local, b = loop[step].local;
        if ((a[2] > z) === (b[2] > z)) continue;
        const t = (z - a[2]) / (b[2] - a[2]);
        const x = a[0] + (b[0] - a[0]) * t;
        if (x <= 0) continue;
        const y = a[1] + (b[1] - a[1]) * t;
        holes.push({ xyz: radial(side, x, y, z, width, height), face });
        break;
      }
    }
  }
  return { rings, holes, wire, rz, r, length, side, depth };
}

const unit = vector => vector.map(v => v / Math.hypot(...vector));
const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];

function modelWire(surface, geom, [width, height]) {
  const mesh = part('model-hardware', surface);
  mesh.style.setProperty('--wire-gauge', 'max(.85px, ' + mm(geom.wire, width) + ')');
  const axial = ['left', 'right'].includes(geom.side) ? [0,1,0] : [1,0,0];
  for (const { xyz: [x,y], face } of geom.holes) {
    const hole = part('wire-hole', mesh);
    hole.style.left = percent(x / width);
    hole.style.top = percent(y / height);
    hole.style.transform = 'translate(-50%, -50%) translateZ(calc(var(--depth) * ' + face / 2 + ' + ' + face * .06 + 'px))' +
      (face < 0 ? ' rotateY(180deg)' : '');
  }
  for (const loop of geom.rings) {
    for (let i = 1; i < loop.length; i++) {
      const a = loop[i - 1].xyz, b = loop[i].xyz;
      const delta = b.map((v, j) => v - a[j]);
      const along = unit(delta), normal = unit(cross(along, axial)), across = cross(normal, along);
      const segment = part('wire-segment', mesh);
      segment.style.left = percent((a[0] + b[0]) / 2 / width);
      segment.style.top = percent((a[1] + b[1]) / 2 / height);
      segment.style.width = 'calc(' + mm(Math.hypot(...delta), width) + ' + .5px)';
      const matrix = [...along, 0, ...across, 0, ...normal, 0, 0, 0, 0, 1].map(round);
      segment.style.transform = 'translateZ(' + mm((a[2] + b[2]) / 2, width) + ') matrix3d(' + matrix + ') translate(-50%, -50%)';
    }
  }
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

function shelfWire(surface, geom, [width, height]) {
  const [minX, minY, maxX, maxY] = geom.rings.flat().reduce((bounds, { xyz: [x,y] }) =>
    [Math.min(bounds[0],x), Math.min(bounds[1],y), Math.max(bounds[2],x), Math.max(bounds[3],y)], [Infinity, Infinity, -Infinity, -Infinity]);
  const pad = geom.wire;
  const bounds = [minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2];
  const front = pathSVG(surface, 'shelf-hardware', bounds);
  front.style.left = mm(bounds[0], width);
  front.style.top = percent(bounds[1] / height);
  front.style.width = mm(bounds[2], width);
  front.style.height = percent(bounds[3] / height);
  for (const { xyz: [cx,cy], face } of geom.holes) {
    if (face === 1) svgElement('circle', { cx, cy, r: geom.wire * 1.05, fill: '#3d3833' }, front);
  }
  const frontPath = [], spinePath = [];
  for (const loop of geom.rings) {
    let drawing = false;
    for (const [index, {xyz, local: [x, , z]}] of loop.entries()) {
      if (x < 0 || z >= geom.depth / 2) {
        frontPath.push((drawing ? 'L' : 'M') + round(xyz[0]) + ' ' + round(xyz[1]));
        drawing = true;
      } else drawing = false;
      spinePath.push((index ? 'L' : 'M') + round(z) + ' ' + round(xyz[1]));
    }
  }
  wirePath(front, frontPath.join(''), geom.wire);
  // Looking straight at the spine exposes the complete wire around the paper block.
  const side = pathSVG(surface, 'shelf-wire-spine', [-geom.rz - pad, -pad, 2 * (geom.rz + pad), height + 2 * pad]);
  side.style.width = mm(2 * (geom.rz + pad), width);
  wirePath(side, spinePath.join(''), geom.wire);
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
  const pages = book.pageCount ?? book.pages?.length ?? 0;
  const leaves = Math.max(1, leafCountForBook(book) || Math.ceil(pages / 2));
  const state = { treatments: book.edgeTreatments, bands: bandRuns(book.edgeBands, pages), pages, leaves, layers: cards && book.cardStock?.layers };
  const geometry = book.leafLayout && leafGeometry(book.leafLayout, leaves, size, book.pages);
  const layout = geometry?.leaves.some(leaf => leaf.width !== size[0] || leaf.height !== size[1] || leaf.top !== geometry.coverTop)
    ? geometry : null;
  if (model) {
    for (const cut of cuts) paintFace(surface.querySelector(':scope > .' + cut), cut, state);
    paintFace(surface.querySelector(':scope > .spine'), 'spine', { ...state, bands: null });
    variableLeaves(surface, size, state, layout);
    for (const edge of surface.querySelectorAll('.corner-strip.edge-paper')) {
      const cut = edge.classList.contains('upper') ? 'head' : 'tail';
      paintFace(edge, cut, state);
    }
  } else {
    shelfEdges(surface, state);
    shelfLeaves(surface, layout, size);
    const spine = surface.querySelector('.shelf-spine');
    paintFace(spine, 'spine', { ...state, bands: null });
  }
  const wireKey = hardware ? JSON.stringify([book.bindingType, details.ringPlacement, details.ringCount,
    details.ringDiameterMm, book.ringPositions, size, depth]) : null;
  if (hardware) surface.style.setProperty('--wire-color', details.ringColor);
  if (wireKeys.get(surface) !== wireKey) {
    for (const node of surface.querySelectorAll(':scope > :is(.model-hardware, .shelf-hardware, .shelf-wire-spine)')) node.remove();
    if (hardware) {
      const wire = wireGeometry(book.bindingType, details, book.ringPositions, size, depth);
      if (model) modelWire(surface, wire, size);
      else shelfWire(surface, wire, size);
    }
    wireKeys.set(surface, wireKey);
  }
  const extra = hardware ? details.ringDiameterMm * .65 + 1 : 0;
  const side = hardware && details.ringPlacement;
  const left = side === 'left' ? -extra : 0;
  const right = Math.max(layout?.width ?? 0, size[0] + (side === 'right' ? extra : 0));
  const top = Math.min(-(layout?.coverTop ?? 0), side === 'top' ? -extra : 0);
  const bottom = Math.max((layout?.height ?? 0) - (layout?.coverTop ?? 0), size[1] + (side === 'bottom' ? extra : 0));
  stage.style.setProperty('--physical-fit', Math.min(1, size[0] / (right - left), size[1] / (bottom - top)));
  if (model) {
    surface.style.setProperty('--center-cut-x', mm((size[0] - right - left) / 2, size[0]));
    surface.style.setProperty('--center-cut-y', mm((size[1] - bottom - top) / 2, size[0]));
  } else if (hardware || layout) {
    surface.style.setProperty('--shelf-over-top', mm(-top, size[0]));
    surface.style.setProperty('--shelf-over-bottom', mm(bottom - size[1], size[0]));
  }
}
