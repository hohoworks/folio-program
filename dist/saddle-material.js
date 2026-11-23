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
  vector(svg, 'path', { ...line, transform:'translate('+round(gauge*.42)+' '+round(gauge*.56)+')',
    stroke:'#36281d', opacity:'.23', 'stroke-width':gauge*1.65 });
  vector(svg, 'path', { ...line, stroke:'color-mix(in srgb, '+color+' 68%, #28211a)', 'stroke-width':gauge*1.13 });
  vector(svg, 'path', { ...line, stroke:color, 'stroke-width':gauge*.81 });
  vector(svg, 'path', { ...line, transform:'translate('+round(-gauge*.19)+' '+round(-gauge*.13)+')',
    stroke:'color-mix(in srgb, '+color+(metallic?' 35%, white)':' 60%, #fcf2d3)'),
    'stroke-width':gauge*(metallic?.24:.19), ...(metallic ? {} : {'stroke-dasharray':round(gauge*.72)+' '+round(gauge*.9)}) });
}

function punctures(svg, holes, gauge, compact = false) {
  let openings='';
  for(const [x,y] of holes){
    const rx=round(gauge*.73), ry=round(gauge*1.04);
    openings+='M'+round(x-rx)+' '+round(y)+'a'+rx+' '+ry+' 0 1 0 '+round(2*rx)+' 0a'+rx+' '+ry+' 0 1 0 '+round(-2*rx)+' 0Z';
  }
  vector(svg,'path',{d:openings,fill:'#f3e6c9',opacity:'.6',transform:'translate(0 '+round(gauge*.4)+')'});
  if (compact) vector(svg, 'path', { d: openings, fill: '#584b3b' });
  else for (const [cx, cy] of holes) vector(svg, 'ellipse', { cx, cy, rx: gauge*.73, ry: gauge*1.04, fill: '#584b3b' });
}

function stitches(svg, details, x, top, height, foldWidth, inside = false, standingEyes = false) {
  const stations = stitchFractions(details);
  const thread = details.stitchType === 'thread';
  const gauge = thread ? .4 : details.stapleThicknessMm;
  const spacing = stations.length > 1 ? height*(stations[1]-stations[0]) : height;
  const half = Math.min(5.8, height * .046, spacing*.4);
  const holes = [];
  let line = '';
  if (thread) {
    // Both sides of a lockstitch run between successive needle holes.
    const margin = Math.min(height*.13, 7);
    const span = height - 2*margin;
    const steps = Math.max(2, Math.min(240, Math.round(span/3.75)));
    for(let i=0;i<=steps;i++){
      const y=top+margin+span*i/steps;
      const px= x+(i%2 ? -.065 : .065)*(inside ? -1 : 1);
      holes.push([px,y]);
      if(i===0){line='M'+px+' '+y;continue;}
      line+='Q'+round(x+(inside ? -.2 : .21))+' '+round(y-span/steps*.5)+' '+round(px)+' '+round(y);
    }
  } else {
    for (const fraction of stations) {
      const y = top + fraction * height, a = y - half, b = y + half;
      holes.push([x,a],[x,b]);
      if (inside) {
        line += 'M'+(x-.16)+' '+a+'Q'+(x-.55)+' '+(a+1)+' '+(x-.25)+' '+(y-.66);
        line += 'M'+(x+.16)+' '+b+'Q'+(x+.55)+' '+(b-1)+' '+(x+.25)+' '+(y+.66);
      } else if (details.stitchType === 'loop') {
        if(standingEyes){
          line+='M'+x+' '+a+'L'+x+' '+(y-half*.76)+'M'+x+' '+(y+half*.76)+'L'+x+' '+b;
        } else {
          const bulge=foldWidth*.23;
          line+='M'+x+' '+a+'L'+x+' '+(y-half*.76)+'C'+(x+bulge)+' '+(y-half*.76)+' '+(x+bulge)+' '+(y+half*.76)+' '+x+' '+(y+half*.76)+'L'+x+' '+b;
        }
      } else {
        line+='M'+x+' '+a+'Q'+(x+.16)+' '+(a+.33)+' '+(x+.16)+' '+(a+.72)+'L'+(x+.16)+' '+(b-.72)+'Q'+(x+.16)+' '+(b-.33)+' '+x+' '+b;
      }
    }
  }
  punctures(svg, holes, gauge);
  stroke(svg, line, gauge, thread ? (details.threadColor || '#b38e62') : details.stapleColor, !thread);
  return half;
}

const crownHeight = t => .27 * Math.sin(Math.PI * t);
function curvedFold(fold, width, facets = 8) {
  for (let i = 0; i < facets; i++) {
    const a=i/facets, b=(i+1)/facets, middle=(a+b)/2;
    const slope=crownHeight(b)-crownHeight(a);
    const panel=materialPart(fold, 'fold-facet');
    panel.style.left=percent(middle);
    panel.style.width='calc(var(--fold-depth) * '+round(Math.hypot(b-a,slope))+' + .46px)';
    panel.style.setProperty('--fold-tone-left', percent(.025 + .42 * Math.abs(a - .38)));
    panel.style.setProperty('--fold-tone-right', percent(.025 + .42 * Math.abs(b - .38)));
    panel.style.transform='translateX(-50%) translateZ(calc(var(--fold-depth) * '+round((crownHeight(a)+crownHeight(b))/2)+')) rotateY('+round(-Math.atan2(slope,b-a))+'rad)';
  }
  // At the head and tail, each nested sheet doubles back on itself.
  // The narrower gatherings only resolve a few of those paper edges.
  const lineCount=Math.max(2,Math.min(18,Math.round(width/.5)));
  let profile='';
  for(let i=1;i<=lineCount;i++){
    const r=48*i/lineCount, x=round(50-r), reach=round(r*2);
    profile+='M'+x+' 0C'+x+' '+round(reach*.55)+' '+round(50-r*.54)+' '+reach+' 50 '+reach;
    profile+='S'+round(50+r)+' '+round(reach*.55)+' '+round(50+r)+' 0';
  }
  for(const position of ['upper','lower']){
    const cap=materialPart(fold,'fold-cap '+position);
    const paper=diagram(cap,'gathering-end',100,100);
    vector(paper,'path',{d:profile,fill:'none',stroke:'#665a44',opacity:'.48','stroke-width':.85});
  }
}

// Piercing positions follow the middle of each folded gathering. Successive
// loops return through those stations and interlock on the exposed paper.
export function setExposedSewing(surface, book, details, size, depth) {
  const spine=surface.querySelector('.spine, .shelf-spine');
  spine.querySelector('.exposed-sewing')?.remove();
  const exposed=book.bookForm!=='cards' && book.bindingType==='exposed-sewn' && !book.coverImages?.spine;
  surface.toggleAttribute('data-sewn-gatherings',exposed);
  if(!exposed)return;

  const model=surface.classList.contains('book-model');
  const group=materialPart(spine,'exposed-sewing');
  group.setAttribute('aria-hidden','true');
  const count=Math.max(1,Math.min(32,Math.round(depth/2.25)));
  const weights=Array.from({length:count},(_,i)=>1+.042*Math.sin((i+1)*2.36));
  const total=weights.reduce((sum,weight)=>sum+weight,0);
  const centers=[];
  let edge=0;
  weights.forEach(weight=>{
    const share=weight/total;
    const fold=materialPart(group,'sewn-gathering');
    fold.style.width=percent(share);
    fold.style.left=percent(edge);
    fold.style.setProperty('--fold-share',round(share));
    if(model)curvedFold(fold,depth*share,4);
    centers.push(depth*(edge+share/2));
    edge+=share;
  });
  const h=size[1], pitch=depth/count, gauge=Math.min(.53,pitch*.32,h*.008);
  const reach=Math.min(1.05,pitch*.44,h/(details.sewingStationCount+1)*.13);
  const ink=diagram(group,'signature-thread',depth,h);
  ink.style.setProperty('--thread-lift',round(.27/count));
  const color=details.threadColor || '#b0a080';
  for(let j=0;j<details.sewingStationCount;j++){
    const station=vector(ink,'g',{class:'sewing-station'});
    const y=h*(j+.5)/details.sewingStationCount;
    const holes=centers.map((x,i)=>[x,y+reach*.13*Math.sin(i*1.7+j*2.2)]);
    punctures(station,holes,gauge*1.08,true);
    const direction=j%2 ? 1 : -1;
    let thread='M0 '+round(y-direction*reach*.42);
    let previous=0,py=y-direction*reach*.42;
    for(const [x,cy] of holes){
      const span=x-previous, crest=direction*reach;
      // Pick up the preceding loop, then pull the strand into the next hole.
      thread+='C'+round(previous+span*.23)+' '+round(py+crest*.16)+' '+round(x-span*.3)+' '+round(cy+crest)+' '+round(x)+' '+round(cy);
      previous=x;py=cy;
    }
    thread+='Q'+round((previous+depth)/2)+' '+round(py-direction*reach*.36)+' '+round(depth)+' '+round(y+direction*reach*.35);
    stroke(station,thread,gauge,color,false);
    let links='';
    for(let i=0;i+1<holes.length;i++){
      const [x,cy]=holes[i], span=holes[i+1][0]-x;
      links+='M'+round(x)+' '+round(cy)+'Q'+round(x+span*.16)+' '+round(cy-direction*reach*.56)+' '+round(x+span*.52)+' '+round(cy+direction*reach*.42);
    }
    stroke(station,links,gauge*.83,color,false);
  }
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
    const width=Math.max(.2,depth*share);
    if (model) curvedFold(fold,width);
    const ink=diagram(fold,'fold-fasteners',width,section.height);
    const half=stitches(ink,details,width/2,0,section.height,width,false,model);
    if (model && details.stitchType==='loop') {
      // Each eye bends away from the spine, on its own standing wire plane.
      for (const fraction of stitchFractions(details)) {
        const eye=diagram(fold,'saddle-eye',6.5,12);
        eye.style.top=percent(fraction);
        eye.style.setProperty('--eye-mm','calc(var(--material-width) / '+size[0]+')');
        eye.style.height='calc(var(--eye-mm) * '+round(half*2)+')';
        stroke(eye,'M0 1.44C2.45 1.44 5.8 2.45 5.8 6S2.45 10.56 0 10.56',details.stapleThicknessMm,details.stapleColor,true);
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
