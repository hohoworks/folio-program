import { trimSize } from './book-format.js';
import { resolveMockupDetails } from './mockup-options.js';

const svgNS = 'http://www.w3.org/2000/svg';
const round = number => Number(number.toFixed(4));
const percent = fraction => round(fraction * 100) + '%';

function materialPart(parent, name) {
  const item = document.createElement('i');
  item.className = name;
  parent.append(item);
  return item;
}

function vector(parent, tag, attributes) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  parent.append(node);
  return node;
}

function diagram(parent, className, width, height) {
  return vector(parent, 'svg', { class: className, viewBox: '0 0 ' + width + ' ' + height,
    preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
}

function stitchFractions(details) {
  const count = details.stapleCount;
  const inset = (details.stapleInsetPercent ?? 25) / 100;
  return Array.from({ length: count }, (_, i) => count === 1 ? .5 : inset + (1 - 2 * inset) * i / (count - 1));
}

// The wire has one continuous crown. The visible ends on the inside are
// two separate legs folded back against the paper.
function stroke(svg, path, gauge, color, metallic) {
  if (!path) return;
  const line = { d: path, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  vector(svg, 'path', { ...line, stroke: 'color-mix(in srgb, ' + color + ' 70%, #231e1b)', 'stroke-width': gauge * 1.4 });
  vector(svg, 'path', { ...line, stroke: 'color-mix(in srgb, ' + color + (metallic ? ' 68%, white)' : ' 85%, white)'), 'stroke-width': gauge * .72 });
}

function stitches(svg, details, x, top, height, foldWidth, inside = false) {
  const stations = stitchFractions(details);
  const thread = details.stitchType === 'thread';
  const gauge = thread ? .48 : details.stapleThicknessMm;
  const half = Math.min(5.8, height * .046, height * .37 / stations.length);
  const punches = [];
  let line = '';
  function hole(px, py) { punches.push([round(px), round(py)]); }
  if (thread) {
    const low = Math.min(...stations) * height;
    const high = Math.max(...stations) * height;
    const start = stations.length > 1 ? low : height * .12;
    const end = stations.length > 1 ? high : height * .88;
    const spans = Math.min(180, Math.max(2, Math.round((end - start) / 5)));
    for (let i = 0; i <= spans; i++) {
      const y = top + start + i * (end - start) / spans;
      const px = x + (i % 2 ? -.12 : .12);
      hole(px, y);
      if (i === spans || i % 2 !== (inside ? 1 : 0)) continue;
      const next = y + (end - start) / spans;
      line += 'M'+px+' '+y+'Q'+(x + .45)+' '+((y+next)/2)+' '+(2*x-px)+' '+next;
    }
  } else {
    for (const fraction of stations) {
      const y = top + fraction * height, a = y - half, b = y + half;
      hole(x, a); hole(x, b);
      if (inside) {
        line += 'M'+(x-.16)+' '+a+'Q'+(x-.55)+' '+(a+1)+' '+(x-.25)+' '+(y-.66);
        line += 'M'+(x+.16)+' '+b+'Q'+(x+.55)+' '+(b-1)+' '+(x+.25)+' '+(y+.66);
      } else if (details.stitchType === 'loop') {
        const bulge = foldWidth * .37;
        line += 'M'+x+' '+a+'L'+x+' '+(a+half*.4)+'C'+(x+bulge)+' '+(a+half*.4)+' '+(x+bulge)+' '+(b-half*.4)+' '+x+' '+(b-half*.4)+'L'+x+' '+b;
      } else {
        line += 'M'+x+' '+a+'Q'+(x+.13)+' '+y+' '+x+' '+b;
      }
    }
  }
  for (const [cx,cy] of punches) vector(svg,'ellipse',{cx,cy,rx:gauge*.92,ry:gauge*1.15,fill:'#3c3028'});
  stroke(svg, line, gauge, thread ? (details.threadColor || '#b38e62') : details.stapleColor, !thread);
}

const crownHeight = t => .27 * Math.sin(Math.PI * t);
function curvedFold(fold) {
  const facets = 8;
  for (let i = 0; i < facets; i++) {
    const a=i/facets, b=(i+1)/facets, middle=(a+b)/2;
    const slope=crownHeight(b)-crownHeight(a);
    const panel=materialPart(fold, 'fold-facet');
    panel.style.left=percent(middle);
    panel.style.width='calc(var(--fold-depth) * '+round(Math.hypot(b-a,slope))+' + .24px)';
    panel.style.setProperty('--fold-tone-left', percent(.025 + .42 * Math.abs(a - .38)));
    panel.style.setProperty('--fold-tone-right', percent(.025 + .42 * Math.abs(b - .38)));
    panel.style.transform='translateX(-50%) translateZ(calc(var(--fold-depth) * '+round((crownHeight(a)+crownHeight(b))/2)+')) rotateY('+round(-Math.atan2(slope,b-a))+'rad)';
  }
  materialPart(fold,'fold-cap upper');
  materialPart(fold,'fold-cap lower');
}

export function setSaddleSpine(surface, book, details, size, depth, layout) {
  const eligible = book.bookForm !== 'cards' && book.bindingType === 'saddle-stitch';
  const model = surface.classList.contains('book-model');
  const spine = surface.querySelector('.spine, .shelf-spine');
  spine.querySelector('.saddle-folds')?.remove();
  surface.toggleAttribute('data-saddle-folds', eligible);
  if (!eligible) {
    surface.removeAttribute('data-saddle-sections');
    return;
  }
  const sections = layout?.sections || [{ startPage:1, endPage:Math.max(1,book.pages?.length || book.pageCount || 1),
    width:size[0], height:size[1], top:layout?.coverTop || 0 }];
  const grouped = Boolean(book.saddleSections?.length);
  surface.toggleAttribute('data-saddle-sections',grouped);
  const coverTop = layout?.coverTop || 0, hullHeight=layout?.height || size[1];
  surface.style.setProperty('--saddle-rise',percent(coverTop/hullHeight));
  surface.style.setProperty('--saddle-hull-ratio',hullHeight/size[1]);
  const tree=materialPart(spine,'saddle-folds');
  tree.setAttribute('aria-hidden','true');
  const total=sections.at(-1).endPage;
  for (const section of sections) {
    const share=(section.endPage-section.startPage+1)/total;
    const fold=materialPart(tree,'saddle-fold');
    fold.style.width=percent(share);
    fold.style.left=percent(1-section.endPage/total);
    fold.style.height=percent(section.height/(model ? size[1] : hullHeight));
    fold.style.top=percent(model ? (section.top-coverTop)/size[1] : section.top/hullHeight);
    fold.style.setProperty('--fold-share',share);
    if (section.color) fold.style.setProperty('--fold-color',section.color);
    if (model) curvedFold(fold);
    const width=Math.max(.2,depth*share);
    const ink=diagram(fold,'fold-fasteners',width,section.height);
    stitches(ink,details,width/2,0,section.height,width);
    if (model && details.stitchType==='loop') {
      // Each eye bends away from the spine, on its own standing wire plane.
      for (const fraction of stitchFractions(details)) {
        const eye=diagram(fold,'saddle-eye',6.5,12);
        eye.style.top=percent(fraction);
        eye.style.setProperty('--eye-mm','calc(var(--material-width) / '+size[0]+')');
        stroke(eye,'M0.3 1.4C2.2 1.4 5.9 1.9 5.9 6S2.2 10.6 0.3 10.6',details.stapleThicknessMm,details.stapleColor,true);
      }
    }
  }
}

export function addReaderSaddle(spread, book, pair, layout, spreads) {
  if(book.bookForm==='cards'||book.bindingType!=='saddle-stitch') return;
  const [width,height]=trimSize(book);
  const sections=layout?.sections || [{startPage:1,endPage:book.pages.length,width,height,top:layout?.coverTop||0}];
  const details=resolveMockupDetails(book.mockupDetails);
  for(const sec of sections){
    const center=(sec.startPage+sec.endPage)/2;
    if (Math.abs((pair.left||pair.right)-center)>2 && Math.abs((pair.right||pair.left)-center)>2) continue;
    // An odd-length section may begin on a verso or end on a recto. Select
    // exactly one real opening rather than painting its hardware twice.
    let nearest, best=Infinity;
    for(const opening of spreads){
      const pages=[opening.left,opening.right].filter(n=>n>=sec.startPage&&n<=sec.endPage);
      if(!pages.length)continue;
      const distance=Math.abs(pages.reduce((sum,n)=>sum+n,0)/pages.length-center)+(pages.length === 1 ? .51 : 0);
      if(distance<best){nearest=opening;best=distance;}
    }
    if(nearest!==pair)continue;
    const spine=layout?.width||width, h=layout?.height||height;
    const svg=diagram(spread,'reader-saddle-marks',spine*2,h);
    svg.dataset.section=String(sec.startPage);
    const faces=[pair.left,pair.right].filter(n=>n>=sec.startPage&&n<=sec.endPage)
      .map(n=>layout?.faces?.[n-1]||layout?.leaves[Math.ceil(n/2)-1]||sec);
    const top=Math.max(...faces.map(face=>face.top)), bottom=Math.min(...faces.map(face=>face.top+face.height));
    if(bottom>top)stitches(svg,details,spine,top,bottom-top,2,true);
  }
}
