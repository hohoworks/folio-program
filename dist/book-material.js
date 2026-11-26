import { resolveMockupDetails } from './mockup-options.js';
import { setBookSurfaces } from './book-surfaces.js';
import { stockThickness, trimSize } from './book-format.js';
export { trimSize };

export const mockupViews = Object.freeze({
  spine: { x: -12, y: 32 }, edge: { x: -12, y: -32 }, back: { x: -12, y: 148 }, front: { x: 0, y: 0 },
});
export const validBookColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
function spineDepthMm(book) {
  // One sheet of book paper contributes a front and a back to the page count.
  const sheets = Math.max(1, Math.ceil((book.pageCount ?? book.pages?.length ?? 0) / 2));
  if (book.bookForm === 'cards') {
    const stock = book.cardStock;
    const thickness = stockThickness(stock);
    const stack = thickness > 0 ? sheets * thickness : Math.max(.5, sheets * .22 * (stock?.layers?.length || 1));
    return book.spineWidthMm ?? stack;
  }
  const paperWidth = sheets * .1;
  let estimate = Math.max(3.5, paperWidth + .5);
  switch (book.bindingType) {
    case 'hardcover': estimate = Math.max(5, paperWidth + 4.5); break;
    case 'saddle-stitch':
      estimate = book.saddleSections?.length ? book.saddleSections.reduce((total, section) =>
        total + Math.max(.6, Math.ceil(section.pages / 2) * .1), 0) : Math.min(4, Math.max(1, paperWidth));
      break;
    case 'exposed-sewn': estimate = Math.max(3, paperWidth); break;
  }
  const board = stockThickness(book.coverStock);
  let depth = book.spineWidthMm ?? estimate;
  // A measured thickness can reserve less paper than the estimate. Two actual
  // boards still need room for their full plies and at least one sheet.
  if (board) depth = Math.max(depth, 2 * board + (book.spineWidthMm == null ? paperWidth : .1));
  return depth;
}

export function spineRatio(book, { shelf = false } = {}) {
  const depth = spineDepthMm(book);
  return (shelf ? Math.max(4, depth) : depth) / trimSize(book)[0];
}

const luminance = ([r, g, b]) => .2126 * r + .7152 * g + .0722 * b;
function applyCaseColor(surface, color) {
  surface.style.setProperty('--case-color', 'rgb(' + color.join(' ') + ')');
  surface.style.setProperty('--case-ink', luminance(color) > 154 ? '#252320' : '#fbf8ef');
}

const pendingSamples = new WeakMap();

// The outside wrap, recessed cover joint and rounded fore-edge each follow a
// physical cross-section. Adjacent tangent planes share their endpoints.
function stripBetween(className, x0, x1, z0, z1, unit) {
  const panel = document.createElement('i');
  panel.className = className;
  const run = x1 - x0, rise = z1 - z0;
  panel.style.left = (x0 + x1) * 50 + '%';
  panel.style.width = 'calc(var(' + unit + ') * ' + Math.hypot(run, rise) + ' + 1px)';
  panel.style.transform = 'translateX(-50%) translateZ(calc(var(' + unit + ') * ' +
    ((z0 + z1) / 2) + ')) rotateY(' + -Math.atan2(rise, run) + 'rad)';
  return panel;
}

function spineProfile(shape, depthMm) {
  // A square spine is flat across the middle; only the shoulders turn over.
  const rounded = shape === 'round';
  const amplitude = rounded ? .21 : Math.min(.11, (shape === 'square' ? 1.5 : .40) / depthMm);
  const stations = rounded ? Array.from({ length: 15 }, (_, i) => i / 14) :
    [0, .025, .055, .10, .17, .50, .83, .90, .945, .975, 1];
  const rise = t => {
    if (rounded) return amplitude * Math.sin(Math.PI * t);
    const shoulder = Math.sin(Math.PI * Math.min(.5, t / .34, (1 - t) / .34));
    return amplitude * (.86 * shoulder + .14 * Math.sin(Math.PI * t));
  };
  return { rounded, amplitude, stations, rise };
}

function shapedSpine(spine, shape, depthMm) {
  const previous = spine.querySelector('.round-spine');
  const print = spine.querySelector(':scope > :is(img, span)');
  const source = print?.currentSrc || print?.src || print?.textContent || '';
  const key = [shape, source, depthMm].join('/');
  if (!shape || previous?.dataset.source === key) {
    if (!shape) previous?.remove();
    return;
  }
  previous?.remove();
  const curve = document.createElement('i');
  curve.className = 'round-spine';
  curve.setAttribute('aria-hidden', 'true');
  curve.dataset.source = key;
  const { rounded, amplitude, stations, rise } = spineProfile(shape, depthMm);
  const tones = t => {
    const lo = Math.max(0, t - .007), hi = Math.min(1, t + .007);
    const normal = Math.atan2(rise(hi) - rise(lo), hi - lo);
    // Soft side light catches the first shoulder and falls off across the case.
    const diffuse = .06 + .10 * (1 - Math.cos(normal + .52)) + .07 * t;
    const sheen = (rounded ? .14 : .085) * Math.exp(-Math.pow((t - .28) / .28, 2));
    return [sheen + .09 * Math.max(0, normal), diffuse + .12 * Math.max(0, -normal)];
  };
  const cap = stations.map(t => (100 * t) + '% ' + (100 * rise(t) / amplitude) + '%');
  curve.style.setProperty('--spine-cap', 'polygon(' + cap.join(',') + ')');
  curve.style.setProperty('--spine-rise', amplitude);
  for (let i = 1; i < stations.length; i++) {
    const left = stations[i - 1], right = stations[i];
    const zl = rise(left), zr = rise(right);
    const panel = stripBetween('round-spine-panel', left, right, zl, zr, '--depth');
    const slope = (zr - zl) / (right - left);
    for (const [side, station] of [['left', left], ['right', right]]) {
      const [light, shadow] = tones(station);
      panel.style.setProperty('--arc-light-' + side, light);
      panel.style.setProperty('--arc-shadow-' + side, shadow);
    }
    if (print) {
      const ink = document.createElement('i');
      ink.className = 'round-spine-print';
      ink.style.transform = 'scaleX(' + Math.hypot(1, slope) + ') translateX(' + -(left + right) * 50 + '%)';
      ink.append(print.cloneNode(true));
      panel.append(ink);
    }
    curve.append(panel);
  }
  spine.append(curve);
}

const jointProfile = [[0, 0], [.18, -.02], [.34, -.25], [.48, -.79], [.58, -1], [.72, -.48], [.88, -.09], [1, 0]];

function coverJoint(surface, faceName, width, jointMm, depressionMm) {
  const face = surface.querySelector(':scope > .' + faceName);
  const previous = surface.querySelector(':scope > .joint-' + faceName);
  const source = face?.querySelector(':scope > img');
  // Generated jackets may contain live typesetting. Their original face keeps
  // the printed score; uploaded jackets can be reprojected across the joint.
  const active = Boolean(jointMm && source);
  face?.toggleAttribute('data-folded-print', active);
  if (!active) { previous?.remove(); return; }
  const key = [source.currentSrc || source.src, width, jointMm, depressionMm].join('/');
  if (previous?.dataset.source === key) return;
  previous?.remove();
  const joint = document.createElement('i');
  joint.className = 'case-joint joint-' + faceName;
  joint.dataset.source = key;
  joint.setAttribute('aria-hidden', 'true');
  const back = faceName === 'back';
  // A backing at the bottom of the crease fills subpixel rasterization cracks
  // on low-density displays without flattening the silhouette at either side.
  const backing = source.cloneNode();
  backing.alt = '';
  backing.removeAttribute('id');
  backing.className = 'joint-backing';
  backing.style.transform = 'translateZ(calc(var(--material-width) * ' + -depressionMm / width + ' - .25px))';
  joint.append(backing);
  const profile = back ? [...jointProfile].reverse() : jointProfile;
  const position = t => back ? 1 - jointMm / width * t : jointMm / width * t;
  for (let i = 1; i < profile.length; i++) {
    const [u, h] = profile[i - 1], [v, k] = profile[i];
    const x0 = position(u), x1 = position(v);
    const z0 = h * depressionMm / width, z1 = k * depressionMm / width;
    const panel = stripBetween('case-joint-panel', x0, x1, z0, z1, '--material-width');
    const slope = (z1 - z0) / (x1 - x0);
    const image = source.cloneNode();
    image.removeAttribute('id');
    image.alt = '';
    image.style.transform = 'scaleX(' + Math.hypot(1, slope) + ') translateX(' + -(x0 + x1) * 50 + '%)';
    panel.style.setProperty('--fold-shadow', Math.min(.21, Math.max(0, -slope) * .32 + Math.abs(h + k) * .011));
    panel.style.setProperty('--fold-light', Math.min(.18, Math.max(0, slope) * .28));
    panel.append(image);
    joint.append(panel);
  }
  surface.append(joint);
}

function roundedFore(surface, active) {
  const fore = surface.querySelector(':scope > .fore');
  if (!fore) return;
  const enabled = active && !surface.hasAttribute('data-variable-block');
  surface.toggleAttribute('data-hollow-cut', enabled);
  const previous = fore.querySelector('.fore-arc');
  if (!enabled) { previous?.remove(); return; }
  const scan = fore.querySelector(':scope > .edge-scan');
  const source = scan?.outerHTML ?? '';
  if (previous?.dataset.scan === source) return;
  previous?.remove();
  const arc = document.createElement('i');
  arc.className = 'fore-arc';
  arc.dataset.scan = source;
  arc.setAttribute('aria-hidden', 'true');
  const divisions = 10;
  const hollow = t => -.14 * Math.sin(Math.PI * t);
  const contour = ['0 0'];
  for (let i = 0; i <= divisions; i++) {
    const t = i / divisions;
    contour.push('calc(100% + var(--block) * ' + hollow(t) + ') ' + t * 100 + '%');
    if (i === divisions) break;
    const next = (i + 1) / divisions;
    const panel = stripBetween('fore-arc-panel', t, next, hollow(t), hollow(next), '--block');
    panel.style.setProperty('--edge-shadow', .035 + .14 * Math.sin(Math.PI * next));
    const ink = document.createElement('i');
    ink.className = 'fore-arc-print';
    // Every part samples the full, registered cut. A scan, crop or colored
    // page band thus crosses the hollow once, from the front ply to the back.
    const stretch = Math.hypot(1, (hollow(next) - hollow(t)) * divisions);
    ink.style.transform = 'scaleX(' + stretch + ') translateX(' + -(t + next) * 50 + '%)';
    if (scan) ink.append(scan.cloneNode(true));
    panel.append(ink);
    arc.append(panel);
  }
  contour.push('0 100%');
  surface.style.setProperty('--fore-contour', 'polygon(' + contour.join(',') + ')');
  fore.append(arc);
}

// At a case-bound head the turn-in sits level with the boards, while the
// text block sits lower. The colored endband is sewn around a separate core.
const svgNamespace = 'http://www.w3.org/2000/svg';
const precision = value => +value.toFixed(5);

function cutPath(host, path, attributes) {
  const part = document.createElementNS(svgNamespace, 'path');
  part.setAttribute('d', path);
  for (const [key, value] of Object.entries(attributes)) part.setAttribute(key, value);
  host.append(part);
}

function cutLayer(host, end, name, unit, span, start) {
  const layer = document.createElementNS(svgNamespace, 'svg');
  layer.setAttribute('class', 'case-cut-insert case-' + name + ' case-at-' + end);
  layer.setAttribute('viewBox', [start, 0, span, 1].join(' '));
  layer.setAttribute('preserveAspectRatio', 'none');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.setProperty('--cut-unit', 'var(' + unit + ')');
  layer.style.setProperty('--cut-span', span);
  layer.style.setProperty('--cut-start', start);
  host.append(layer);
  return layer;
}

function caseEnds(surface, shape, depth, boardMm, depression) {
  const active = Boolean(shape && !surface.hasAttribute('data-variable-block'));
  surface.toggleAttribute('data-case-cut', active);
  const headband = surface.hasAttribute('data-headband');
  const headPaint = surface.querySelector(':scope > .head')?.dataset.cut;
  const tailPaint = surface.querySelector(':scope > .tail')?.dataset.cut;
  const key = [shape, depth, boardMm, depression, headband, headPaint, tailPaint,
    surface.hasAttribute('data-hollow-cut')].join('/');
  const previous = surface.querySelector(':scope > .case-cut-insert');
  if (active && previous?.dataset.profile === key) return;
  for (const old of surface.querySelectorAll(':scope > .case-cut-insert')) old.remove();
  if (!active) return;

  const { stations, rise } = spineProfile(shape, depth);
  const round = shape === 'round';
  const block = Math.max(depth * .04, depth - 2 * Math.min(boardMm, depth * .48));
  const thickness = Math.min(.045, .79 / depth);
  const bead = Math.min(.13, 1.65 / block);
  const paper = t => .025 - (round ? .155 * Math.sin(Math.PI * t) : 0);
  const xyz = (x, y) => precision(x) + ' ' + precision(y);
  const trace = (points, x) => points.map(t => xyz(x(t), t)).join(' L');
  const outline = (points, left, right) => 'M' + trace(points, left) + ' L' + trace([...points].reverse(), right) + 'Z';
  const negative = t => -rise(t);
  const lining = t => negative(t) + thickness;
  const steps = Array.from({ length: 19 }, (_, i) => i / 18);
  const percent = t => precision(100 * t) + '%';
  const hollow = surface.hasAttribute('data-hollow-cut');
  const right = steps.map(t => (hollow ? 'calc(100% - var(--block) * ' + precision(.14 * Math.sin(Math.PI * t)) + ')' : '100%') + ' ' + percent(t));
  const left = [...steps].reverse().map(t => 'calc(var(--case-cut-extension) + var(--block) * ' + precision(paper(t)) + ') ' + percent(t));
  surface.style.setProperty('--case-paper-outline', 'polygon(' + [...right, ...left].join(',') + ')');

  const depressionRatio = Math.min(.28, depression / boardMm);
  for (const edge of ['top', 'bottom']) {
    const near = edge === 'top';
    const edgePoint = (u, h) => 'calc(var(--case-joint-width) * ' + u + ') ' + percent(near ? -h * depressionRatio : 1 + h * depressionRatio);
    const fold = jointProfile.map(([u, h]) => edgePoint(u, h));
    const rest = near ? ['100% 0', '100% 100%', '0 100%'] : ['100% 100%', '100% 0', '0 0'];
    surface.style.setProperty('--board-notch-' + edge, 'polygon(' + [...fold, ...rest].join(',') + ')');
  }
  for (const [end, treatment] of [['head', headPaint], ['tail', tailPaint]]) {
    const recess = cutLayer(surface, end, 'lining', '--depth', .75, -.25);
    recess.dataset.profile = key;
    const blockFraction = block / depth;
    const blockSide = t => Math.min(1, Math.max(0, (t - .5) / blockFraction + .5));
    const paperAtDepth = t => paper(blockSide(t)) * blockFraction + .009;
    cutPath(recess, outline(steps, negative, paperAtDepth), { fill: 'var(--lining-shadow)' });
    const rim = cutLayer(surface, end, 'turn-in', '--depth', .75, -.25);
    cutPath(rim, outline(stations, negative, lining), { fill: 'var(--turn-in-color)' });

    if (!treatment) {
      const folds = cutLayer(surface, end, 'gatherings', '--block', .85, -.25);
      const gatherings = Math.min(30, Math.max(4, Math.round(block / 1.5)));
      for (let i = 1; i < gatherings; i++) {
        const t = i / gatherings;
        // Rounding and backing angle the outer signatures into the shoulders.
        const shoulder = round ? Math.sin(2 * Math.PI * t) * .031 : 0;
        const x = paper(t) + .007;
        cutPath(folds, 'M' + xyz(x,t) + ' C' + xyz(x + .12, t + shoulder) + ' ' +
          xyz(.29,t) + ' ' + xyz(.58,t), { fill: 'none', stroke: '#534735', 'stroke-opacity': '.21', 'stroke-width': '.006' });
      }
    }
    if (!headband) continue;
    const band = cutLayer(surface, end, 'endband', '--block', .85, -.25);
    // The core follows the shape of the folded spine, leaving the upper board
    // turn-in visible behind it. Each diagonal stitch wraps that same core.
    const axis = t => paper(t) - .01;
    const points = steps.map(t => .018 + .964 * t);
    cutPath(band, 'M' + trace(points, axis), { fill: 'none', stroke: 'var(--headband-shadow)', 'stroke-width': bead, 'stroke-linecap': 'round' });
    const count = Math.min(56, Math.max(5, Math.round(block / 1.1)));
    for (let i = 0; i < count; i++) {
      const t = .023 + .95 * (i + .5) / count;
      const x = axis(t), z = .34 / count, r = bead * .39;
      cutPath(band, 'M' + xyz(x-r, t+z) + ' Q' + xyz(x-.003,t-z) + ' ' + xyz(x+r,t-z), {
        fill: 'none', stroke: i % 2 ? 'var(--headband-a)' : 'var(--headband-b)',
        'stroke-width': .90 / count, 'stroke-linecap': 'round',
      });
    }
  }
}

// A curved fore-edge needs to meet both the top and side of the page block.
function roundedCorners(surface, enabled, hardcover, allCorners) {
  let wall = surface.querySelector('.corner-walls');
  if (!enabled) { wall?.remove(); return; }
  const layers = hardcover ? ['edge-paper', 'front-rim', 'back-rim'] : ['edge-paper'];
  if (wall?.dataset.layers === layers.length + '/' + allCorners) return;
  wall?.remove();
  wall = document.createElement('i');
  wall.className = 'corner-walls';
  wall.setAttribute('aria-hidden', 'true');
  wall.dataset.layers = layers.length + '/' + allCorners;
  const segments = 5;
  for (let i = 0; i < segments; i++) {
    const angle = (i + .5) * Math.PI / (2 * segments);
    for (const layer of layers) {
      for (const side of ['upper', 'lower']) {
        const strip = document.createElement('i');
        strip.className = 'corner-strip ' + layer + ' ' + side;
        strip.style.setProperty('--x-inset', 1 - Math.sin(angle));
        strip.style.setProperty('--y-inset', 1 - Math.cos(angle));
        strip.style.setProperty('--edge-angle', (side === 'upper' ? angle : -angle) + 'rad');
        strip.style.setProperty('--edge-shade', .05 + .14 * Math.sin(angle));
        strip.style.width = 'calc(var(--corner-radius) * ' + 2 * Math.sin(Math.PI / (4 * segments)) + ' + .7px)';
        wall.append(strip);
        if (allCorners) {
          const left = strip.cloneNode();
          left.classList.add('left-corner');
          left.style.setProperty('--edge-angle', (side === 'upper' ? -angle : angle) + 'rad');
          wall.append(left);
        }
      }
    }
  }
  surface.append(wall);
}

function setRibbon(surface, material) {
  const existing = surface.querySelector(':scope > .book-ribbon');
  surface.toggleAttribute('data-ribbon', Boolean(material));
  if (!material) {
    existing?.remove();
    delete surface.dataset.ribbonMaterial;
    return;
  }
  surface.dataset.ribbonMaterial = material;
  if (existing) return;
  const ribbon = document.createElement('i');
  ribbon.className = 'book-ribbon';
  ribbon.setAttribute('aria-hidden', 'true');
  surface.prepend(ribbon);
}

function setPhysicalDetails(surface, book, width, depthMm) {
  const d = resolveMockupDetails(book.mockupDetails);
  const cards = book.bookForm === 'cards';
  const hardcover = !cards && book.bindingType === 'hardcover';
  const paperback = !cards && (book.bindingType ?? 'paperback') === 'paperback';
  const model = surface.classList.contains('book-model');
  const height = trimSize(book)[1];
  const radius = Math.max(0, Math.min((cards ? book.cardStock?.cornerRadiusMm : d.cornerRadiusMm) ?? 0, width / 2, height / 2));
  const length = mm => 'calc(var(--material-width) * ' + mm / width + ')';
  const coverDepth = cards ? 0 : stockThickness(book.coverStock);
  const board = coverDepth || d.boardThicknessMm;
  const jointMm = hardcover ? Math.min(width * .1, 3 + (d.grooveWidthMm ?? 4)) : paperback ? Math.min(width * .07, 4.5) : 0;
  const properties = {
    '--case-joint-width': jointMm ? length(jointMm) : null,
    '--soft-board': paperback ? length(.32) : null,
    '--case-overhang': hardcover ? length(2.6) : null,
    '--custom-board': board == null ? null : length(board),
    '--endpaper': d.endpaperColor,
    '--custom-groove': d.grooveWidthMm == null ? null : d.grooveWidthMm / width * 100 + '%',
    '--corner-radius': length(radius),
    '--headband-a': d.headbandColor, '--headband-b': d.headbandAccentColor,
    '--ribbon-color': d.ribbonColor, '--ribbon-length': length(d.ribbonLengthMm), '--ribbon-width': length(4),
    '--ribbon-angle': d.ribbonAngle + 'deg',
    '--staple-color': d.stapleColor, '--staple-width': length(d.stapleThicknessMm),
    // Each tile has two evenly spaced rows of stitching.
    '--sewing-tile-height': book.bindingType === 'exposed-sewn' && !book.coverImages?.spine
      ? 200 / d.sewingStationCount + '%' : null,
    '--thread-color': d.threadColor,
    '--gloss-strength': d.coverGloss / 100,
  };
  for (const [key, value] of Object.entries(properties)) {
    if (value == null) surface.style.removeProperty(key);
    else surface.style.setProperty(key, value);
  }
  surface.toggleAttribute('data-endpaper', hardcover && Boolean(d.endpaperColor));
  surface.toggleAttribute('data-headband', hardcover && d.headbandEnabled);
  setRibbon(surface, hardcover && d.ribbonEnabled && d.ribbonLengthMm > 0 ? d.ribbonMaterial : null);
  surface.toggleAttribute('data-round-spine', hardcover && d.spineShape === 'round');
  surface.toggleAttribute('data-rounded-corners', radius > 0);
  surface.toggleAttribute('data-colored-sewing', book.bindingType === 'exposed-sewn' && Boolean(d.threadColor));
  const spine = surface.querySelector('.spine, .shelf-spine');
  if (model) roundedCorners(surface, radius > 0, hardcover || paperback || Boolean(coverDepth), cards);
  setBookSurfaces(surface, book, d, [width, height], depthMm);
  if (model) {
    surface.parentElement.style.setProperty('--measured-scan-ratio', book.coverImages?.spine && book.spineWidthMm > 0 ? depthMm / width : 0);
    const shape = hardcover ? d.spineShape : paperback ? 'paper' : null;
    surface.toggleAttribute('data-shaped-spine', Boolean(shape));
    surface.toggleAttribute('data-soft-cover', paperback);
    shapedSpine(spine, shape, depthMm);
    const depression = hardcover ? Math.min((board ?? 2.2) * .62, 1.6, depthMm * .13) : .14;
    for (const face of ['front', 'back']) coverJoint(surface, face, width, jointMm, depression);
    roundedFore(surface, hardcover && d.spineShape === 'round' && !radius);
    caseEnds(surface, hardcover ? d.spineShape : null, depthMm,
      board ?? Math.min(depthMm * .16, width * .0095), depression);
  }
}

export function setBookMaterial(surface, book, artwork) {
  const ratio = spineRatio(book, { shelf: surface.classList.contains('shelf-book') });
  surface.style.setProperty('--spine-ratio', ratio);
  const width = trimSize(book)[0];
  const thicknessMm = ratio * width;
  setPhysicalDetails(surface, book, width, thicknessMm);
  // The material repeats across four folded gatherings.
  const gatherings = Math.max(2, Math.round(thicknessMm / 2));
  surface.style.setProperty('--sewing-repeat', (400 / gatherings) + '%');
  pendingSamples.get(surface)?.abort();
  pendingSamples.delete(surface);
  if (validBookColor(book.paperColor)) surface.style.setProperty('--paper-color', book.paperColor);
  else surface.style.removeProperty('--paper-color');
  if (validBookColor(book.caseColor)) {
    applyCaseColor(surface, book.caseColor.slice(1).match(/../g).map(channel => parseInt(channel, 16)));
    return;
  }
  surface.style.removeProperty('--case-color');
  surface.style.removeProperty('--case-ink');
  const image = artwork.querySelector('img');
  if (!image || !book.coverImages) return;

  function sampleCoverEdge() {
    if (image.parentElement !== artwork || !image.naturalWidth) return;
    const swatch = document.createElement('canvas');
    swatch.width = 1;
    swatch.height = 11;
    const context = swatch.getContext('2d');
    if (!context) return;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 1, 11);
    context.drawImage(image, 0, image.naturalHeight * .12, Math.max(1, image.naturalWidth * .025),
      image.naturalHeight * .76, 0, 0, 1, 11);
    let pixels;
    try { pixels = context.getImageData(0, 0, 1, 11).data; }
    catch { return; } // The cover and orbit still work when a browser disallows canvas sampling.
    const colors = [];
    for (let i = 0; i < pixels.length; i += 4) colors.push(pixels.slice(i, i + 3));
    colors.sort((a, b) => luminance(a) - luminance(b));
    applyCaseColor(surface, colors[5]);
  }
  if (image.complete) sampleCoverEdge();
  else {
    const controller = new AbortController();
    pendingSamples.set(surface, controller);
    image.addEventListener('load', sampleCoverEdge, { once: true, signal: controller.signal });
  }
}
