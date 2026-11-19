const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

function makeFace(sheet, side) {
  const face = document.createElement('div');
  face.className = 'curl-' + side;
  const content = sheet.cloneNode(true);
  content.classList.remove('paper-left', 'paper-right');
  content.style.opacity = '';
  content.removeAttribute('tabindex');
  face.append(content);
  return face;
}

export function createCurl(frontPage, backPage, book, { cover = false } = {}) {
  const { width, height } = book.getBoundingClientRect();
  const lift = document.createElement('div');
  const sheet = document.createElement('div');
  const shadow = document.createElement('div');
  const front = makeFace(frontPage, 'front');
  const back = makeFace(backPage, 'back');

  lift.className = 'curl';
  sheet.className = 'curl-sheet';
  shadow.className = 'curl-shadow';
  lift.inert = shadow.inert = true;
  lift.setAttribute('aria-hidden', 'true');
  sheet.append(front, back);
  lift.append(sheet);
  book.append(shadow, lift);

  return {
    draw(progress, corner, pullY = 0) {
      const angle = Math.PI * progress;
      const liftAmount = Math.sin(angle);
      const freeEdge = width / 2 * Math.cos(angle);
      const drift = clamp(pullY / height, -.14, .14);
      const shear = liftAmount * (drift * .33 + (.5 - corner) * .05) * (cover ? .4 : 1);
      sheet.style.transform = `translateZ(.35px) rotateY(${-angle}rad) skewY(${shear}rad)`;

      const shade = liftAmount * (cover ? .12 : .21);
      const sheen = cover ? .07 : .12;
      front.style.setProperty('--shade', String(shade));
      back.style.setProperty('--shade', String(shade * .9));
      front.style.setProperty('--glint', String(liftAmount * sheen));
      back.style.setProperty('--glint', String(liftAmount * sheen * .8));
      front.style.setProperty('--sheen', `${20 + progress * 65}%`);
      back.style.setProperty('--sheen', `${80 - progress * 65}%`);

      shadow.style.opacity = String(liftAmount * .46);
      shadow.style.setProperty('--shadow-width', `${12 + liftAmount * 20}%`);
      shadow.style.setProperty('--shadow-x', `${width / 2 + freeEdge * .45}px`);
    },
    remove() {
      shadow.remove();
      lift.remove();
    },
  };
}
