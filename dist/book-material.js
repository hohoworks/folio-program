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
    const plies = Math.max(1, book.cardStock?.layers?.length || 1);
    return (book.spineWidthMm ?? Math.max(.5, sheets * .22 * plies)) / trimSize(book)[0];
  }
  const paperWidth = sheets * .1;
  let estimate = Math.max(3.5, paperWidth + .5);
  switch (book.bindingType) {
    case 'hardcover': estimate = Math.max(5, paperWidth + 4.5); break;
    case 'saddle-stitch': estimate = Math.min(4, Math.max(1, paperWidth)); break;
    case 'exposed-sewn': estimate = Math.max(3, paperWidth); break;
  }
  return (book.spineWidthMm ?? estimate) / trimSize(book)[0];
}

const luminance = ([r, g, b]) => .2126 * r + .7152 * g + .0722 * b;
function applyCaseColor(surface, color) {
  surface.style.setProperty('--case-color', 'rgb(' + color.join(' ') + ')');
  surface.style.setProperty('--case-ink', luminance(color) > 154 ? '#252320' : '#fbf8ef');
}

const pendingSamples = new WeakMap();

// Split the printed spine into tangent planes so the artwork follows a rounded case.
function roundedSpine(spine, enabled) {
  let curve = spine.querySelector('.round-spine');
  if (!enabled) { curve?.remove(); return; }
  const print = spine.querySelector(':scope > :is(img, span)');
  if (!print) return;
  const source = print.currentSrc || print.src || print.textContent;
  if (curve?.dataset.source === source) return;
  curve?.remove();
  curve = document.createElement('i');
  curve.className = 'round-spine';
  curve.setAttribute('aria-hidden', 'true');
  curve.dataset.source = source;
  const rise = t => .8 * t * (1 - t);
  const divisions = 8;
  for (let i = 0; i < divisions; i++) {
    const left = i / divisions, right = (i + 1) / divisions;
    const middle = (left + right) / 2;
    const dz = rise(right) - rise(left);
    const panel = document.createElement('i');
    panel.className = 'round-spine-panel';
    panel.style.left = middle * 100 + '%';
    const chord = Math.hypot(right - left, dz);
    panel.style.width = 'calc(var(--depth) * ' + chord + ' + 1px)';
    panel.style.transform = 'translateX(-50%) translateZ(calc(var(--depth) * ' +
      (rise(right) + rise(left)) / 2 + ')) rotateY(' + -Math.atan2(dz, right - left) + 'rad)';
    panel.style.setProperty('--arc-left', Math.abs(left - .34) * .34);
    panel.style.setProperty('--arc-right', Math.abs(right - .34) * .34);
    const ink = document.createElement('i');
    ink.className = 'round-spine-print';
    ink.style.transform = 'scaleX(' + chord * divisions + ') translateX(' + -middle * 100 + '%)';
    ink.append(print.cloneNode(true));
    panel.append(ink);
    curve.append(panel);
  }
  spine.append(curve);
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

function saddleFasteners(spine, count) {
  let row = spine.querySelector('.binding-fasteners');
  if (!count) { row?.remove(); return; }
  if (row?.childElementCount === count) return;
  row?.remove();
  row = document.createElement('i');
  row.className = 'binding-fasteners';
  row.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < count; index++) {
    const fastener = document.createElement('i');
    fastener.style.top = ((index + .5) / count) * 100 + '%';
    row.append(fastener);
  }
  spine.append(row);
}

function setPhysicalDetails(surface, book, width) {
  const d = resolveMockupDetails(book.mockupDetails);
  const cards = book.bookForm === 'cards';
  const hardcover = !cards && book.bindingType === 'hardcover';
  const saddle = !cards && book.bindingType === 'saddle-stitch';
  const model = surface.classList.contains('book-model');
  const height = trimSize(book)[1];
  const radius = Math.max(0, Math.min((cards ? book.cardStock?.cornerRadiusMm : d.cornerRadiusMm) ?? 0, width / 2, height / 2));
  const length = mm => 'calc(var(--material-width) * ' + mm / width + ')';
  const properties = {
    '--custom-board': d.boardThicknessMm == null ? null : length(d.boardThicknessMm),
    '--endpaper': d.endpaperColor,
    '--custom-groove': d.grooveWidthMm == null ? null : d.grooveWidthMm / width * 100 + '%',
    '--corner-radius': length(radius),
    '--headband-a': d.headbandColor, '--headband-b': d.headbandAccentColor,
    '--ribbon-color': d.ribbonColor, '--ribbon-length': length(d.ribbonLengthMm),
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
  surface.toggleAttribute('data-ribbon', hardcover && d.ribbonEnabled);
  surface.toggleAttribute('data-round-spine', hardcover && d.spineShape === 'round');
  surface.toggleAttribute('data-rounded-corners', radius > 0);
  surface.toggleAttribute('data-colored-sewing', book.bindingType === 'exposed-sewn' && Boolean(d.threadColor));
  surface.toggleAttribute('data-saddle-thread', saddle && d.stitchType === 'thread');
  const spine = surface.querySelector('.spine, .shelf-spine');
  if (model) {
    const stage = surface.closest('.stage');
    const drop = hardcover && d.ribbonEnabled ? d.ribbonLengthMm * Math.cos(d.ribbonAngle * Math.PI / 180) : 0;
    // Reserve extra space for long ribbons at the bottom of a compact preview.
    const extra = Math.max(0, drop / height - .12);
    stage.style.setProperty('--extra-ribbon-height', extra);
    stage.style.setProperty('--ribbon-lift', extra ? 'calc(var(--model-width) * ' + (-extra * height / width / 2) + ')' : '0px');
    roundedSpine(spine, hardcover && d.spineShape === 'round');
    roundedCorners(surface, radius > 0, hardcover, cards);
  }
  saddleFasteners(spine, saddle && d.stitchType === 'wire' ? d.stapleCount : 0);
  setBookSurfaces(surface, book, d, [width, height], spineRatio(book) * width);
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
