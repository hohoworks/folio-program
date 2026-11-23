import { leafCountForBook, leafGeometry, trimSize } from './book-format.js';
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
export function wireGeometry(binding, details, positions, [width, height], depth, steps = 16) {
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
    for (let step = 0; step <= steps; step++) {
      const t = step / steps, a = t * Math.PI * 2;
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
        holes.push({ xyz: radial(side, x, y, z, width, height), local: [x,y,z], face });
        break;
      }
    }
  }
  return { rings, holes, wire, rz, r, length, side, depth };
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

function visibleWirePath(curves, camera, bounds, project) {
  const data = [];
  for (const curve of curves) {
    let a = curve[0];
    let hidden = behindBook(a, camera, bounds);
    if (!hidden) data.push('M' + project(a));
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
        data.push((hidden ? 'M' : 'L') + project(hi));
      }
      if (!nextHidden) data.push('L' + project(b));
      a = b;
      hidden = nextHidden;
    }
  }
  return data.join('');
}

const wireViews = new WeakMap();
function modelWire(surface, geom, [width, height], binding) {
  const mesh = part('model-hardware', surface);
  mesh.style.setProperty('--wire-gauge', 'max(.85px, ' + mm(geom.wire, width) + ')');
  for (const { xyz: [x, y], face } of geom.holes) {
    const hole = part('wire-hole', mesh);
    hole.style.left = percent(x / width);
    hole.style.top = percent(y / height);
    hole.style.transform = 'translate(-50%, -50%) translateZ(calc(var(--depth) * ' + face / 2 + ' + ' + face * .06 + 'px))' +
      (face < 0 ? ' rotateY(180deg)' : '');
  }

  // Render a whole curve in screen space. Its stroke keeps a round gauge even
  // when the ring is edge-on. The projection uses the same moving CSS camera as the book.
  const frame = surface.parentElement;
  const ink = pathSVG(frame, 'model-wire-ink', [0, 0, width, height]);
  const paths = [];
  for (const [scale, color, offset] of [
    [1.06, 'var(--wire-shadow)', 0], [.73, 'var(--wire-color)', 0],
    [.23, 'var(--wire-light)', -.20],
  ]) {
    paths.push(svgElement('path', {
      fill: 'none', stroke: color, 'stroke-width': geom.wire * scale,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      transform: 'translate(0 ' + round(offset * geom.wire) + ')',
    }, ink));
  }
  const rings = geom.rings.map(loop => loop.map(vertex => vertex.xyz));
  const curves = binding === 'spiral' ? [rings.flatMap((turn, index) => index ? turn.slice(1) : turn)] : rings;
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
        return (width / 2 + p.x * factor / scaleX).toFixed(3) + ' ' + (height / 2 + p.y * factor / scaleY).toFixed(3);
      };
      const d = visibleWirePath(curves, camera, bounds, project);
      for (const path of paths) path.setAttribute('d', d);
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

function shelfWire(surface, geom, [width, height], binding) {
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
    wireViews.get(surface)?.();
    wireViews.delete(surface);
    for (const node of surface.querySelectorAll(':scope > :is(.model-hardware, .shelf-hardware, .shelf-wire-spine)')) node.remove();
    if (hardware) {
      const wire = wireGeometry(book.bindingType, details, book.ringPositions, size, depth, 48);
      if (model) modelWire(surface, wire, size, book.bindingType);
      else shelfWire(surface, wire, size, book.bindingType);
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

// Place marks on the real sheets already painted in the spread. At a stepped
// edge the first sheet under a punch can be an exposed portion of a larger leaf.
export function addReaderWire(spread, book, pair, layout) {
  const kind = book.bindingType;
  if (book.bookForm === 'cards' || (kind !== 'ring' && kind !== 'spiral')) return;
  const { ringPlacement: edge, ringCount, ringDiameterMm, ringColor } = resolveMockupDetails(book.mockupDetails);
  const [trimWidth, trimHeight] = trimSize(book);
  const spine = layout?.width ?? trimWidth;
  const height = layout?.height ?? trimHeight;
  const coverTop = layout?.coverTop ?? 0;
  const standard = { width: trimWidth, height: trimHeight, top: 0 };
  const stacks = {};
  for (const side of ['left', 'right']) {
    stacks[side] = pair[side] ? [...spread.querySelectorAll('.paper-' + side + '[data-page]')].reverse()
      .map(page => layout?.leaves[Math.ceil(Number(page.dataset.page) / 2) - 1] ?? standard) : [];
  }
  const vertical = edge === 'left' || edge === 'right';
  const length = vertical ? trimHeight : trimWidth;
  const pitch = length / ringCount;
  const gauge = Math.min(1.55, Math.max(.65, ringDiameterMm * .055), pitch * .27);
  const radius = gauge * 1.12;
  const reach = Math.min(7.5, Math.max(2.5, ringDiameterMm * .21));
  const drift = kind === 'spiral' ? Math.min(pitch * .24, reach * .58) * (edge === 'right' || edge === 'bottom' ? -1 : 1) : 0;
  const custom = kind === 'ring' && book.ringPositions?.length === ringCount;
  const holes = [], runs = [];

  function punch(x, y) {
    const r = round(radius);
    holes.push('M' + round(x - r) + ' ' + round(y) + 'a' + r + ' ' + r + ' 0 1 0 ' + round(2 * r) + ' 0a' +
      r + ' ' + r + ' 0 1 0 ' + round(-2 * r) + ' 0Z');
    return [x, y];
  }
  const point = coords => coords.map(round).join(' ');
  function stroke(a, b) {
    runs.push('M' + point(a) + 'L' + point(b));
  }
  for (let index = 0; index < ringCount; index++) {
    const fraction = custom ? book.ringPositions[index] / 100 : (index + .5) / ringCount;
    const station = Math.max(radius, Math.min(length - radius, fraction * length));
    const ends = [];
    for (const [side, sign] of [['left', -1], ['right', 1]]) {
      // A coil advances along its axis between the left and right punches.
      const offset = vertical ? station + sign * drift : station;
      if (vertical) {
        const y = coverTop + offset;
        const leaf = stacks[side].find(part => y >= part.top + radius && y <= part.top + part.height - radius);
        if (leaf) ends.push(punch(spine + sign * Math.min(reach, leaf.width / 3), y));
      } else {
        const leaf = stacks[side].find(part => offset >= radius && offset <= part.width - radius);
        if (!leaf) continue;
        const x = spine + sign * offset;
        const boundary = edge === 'top' ? leaf.top : leaf.top + leaf.height;
        const inset = Math.min(reach, leaf.height / 3);
        stroke([x + sign * drift, boundary], punch(x, boundary + (edge === 'top' ? inset : -inset)));
      }
    }
    if (ends.length) stroke(ends[0], ends[1] ?? [spine, coverTop + station]);
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
