import { resolveMockupDetails } from './mockup-options.js';
import { setBookSurfaces } from './book-surfaces.js';
import { trimSize } from './book-format.js';
export { trimSize };

export const mockupViews = Object.freeze({
  spine: { x: -12, y: 32 }, edge: { x: -12, y: -32 }, back: { x: -12, y: 148 }, front: { x: 0, y: 0 },
});
export const validBookColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export function spineRatio(book) {
  // One sheet of book paper contributes a front and a back to the page count.
  const sheets = Math.max(1, Math.ceil((book.pageCount ?? book.pages?.length ?? 0) / 2));
  if (book.bookForm === 'cards') {
    const stock = book.cardStock;
    const thickness = stock?.layerThicknessMm?.reduce((sum, value) => sum + value, 0);
    const stack = thickness > 0 ? sheets * thickness : Math.max(.5, sheets * .22 * (stock?.layers?.length || 1));
    return (book.spineWidthMm ?? stack) / trimSize(book)[0];
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
  const coverDepth = book.coverStock?.layerThicknessMm?.reduce((sum, ply) => sum + ply, 0);
  if (coverDepth) estimate = Math.max(estimate, paperWidth + 2 * coverDepth);
  return (book.spineWidthMm ?? estimate) / trimSize(book)[0];
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
  const profile = [[0, 0], [.18, -.02], [.34, -.25], [.48, -.79], [.58, -1], [.72, -.48], [.88, -.09], [1, 0]];
  if (back) profile.reverse();
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

function setPhysicalDetails(surface, book, width) {
  const d = resolveMockupDetails(book.mockupDetails);
  const cards = book.bookForm === 'cards';
  const hardcover = !cards && book.bindingType === 'hardcover';
  const paperback = !cards && (book.bindingType ?? 'paperback') === 'paperback';
  const model = surface.classList.contains('book-model');
  const height = trimSize(book)[1];
  const radius = Math.max(0, Math.min((cards ? book.cardStock?.cornerRadiusMm : d.cornerRadiusMm) ?? 0, width / 2, height / 2));
  const length = mm => 'calc(var(--material-width) * ' + mm / width + ')';
  const coverDepth = cards ? null : book.coverStock?.layerThicknessMm?.reduce((sum, ply) => sum + ply, 0);
  const board = coverDepth ?? d.boardThicknessMm;
  const depthMm = spineRatio(book) * width;
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
    const shape = hardcover ? d.spineShape : paperback ? 'paper' : null;
    surface.toggleAttribute('data-shaped-spine', Boolean(shape));
    surface.toggleAttribute('data-soft-cover', paperback);
    shapedSpine(spine, shape, depthMm);
    const depression = hardcover ? Math.min((board ?? 2.2) * .62, 1.6, depthMm * .13) : .14;
    for (const face of ['front', 'back']) coverJoint(surface, face, width, jointMm, depression);
    roundedFore(surface, hardcover && d.spineShape === 'round' && !radius);
  }
}

export function setBookMaterial(surface, book, artwork) {
  const ratio = spineRatio(book);
  surface.style.setProperty('--spine-ratio', ratio);
  const width = trimSize(book)[0];
  setPhysicalDetails(surface, book, width);
  const thicknessMm = ratio * width;
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
