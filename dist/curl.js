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

export function createCurl(frontPage, backPage, book, { cover = false, physicalLeaf, geometry } = {}) {
  const { width, height } = book.getBoundingClientRect();
  const lift = document.createElement('div');
  const sheet = document.createElement('div');
  const shadow = document.createElement('div');
  const front = makeFace(frontPage, 'front');
  const back = makeFace(backPage, 'back');

  if (physicalLeaf) {
    sheet.style.width = (50 * physicalLeaf.width / geometry.width) + '%';
    sheet.style.height = (100 * physicalLeaf.height / geometry.height) + '%';
    sheet.style.top = (100 * physicalLeaf.top / geometry.height) + '%';
    sheet.style.right = sheet.style.bottom = 'auto';
    shadow.style.top = sheet.style.top;
    shadow.style.height = sheet.style.height;
  }
  const leafWidth = physicalLeaf ? width * physicalLeaf.width / (2 * geometry.width) : width / 2;
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
      const freeEdge = leafWidth * Math.cos(angle);
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

// A loose card flips around its own centre. Crossing to a different card
// moves the top card aside and exposes the next one in the stack.
export function createCardTurn(current, target, container, { direction, flip }) {
  const lift = document.createElement('div');
  lift.className = 'card-turn';
  lift.inert = true;
  lift.setAttribute('aria-hidden', 'true');
  const sheet = document.createElement('div');
  sheet.className = 'card-turn-sheet';
  const front = makeFace(current, 'front');
  const back = makeFace(target, 'back');
  if (flip) {
    sheet.append(front, back);
    lift.append(sheet);
  } else {
    const moving = direction > 0 ? front : back;
    const still = direction > 0 ? back : front;
    moving.className = still.className = 'card-turn-layer';
    sheet.append(moving);
    lift.append(still, sheet);
  }
  container.append(lift);
  return {
    draw(progress) {
      if (flip) {
        sheet.style.transform = 'rotateY(' + (-direction * progress * 180) + 'deg)';
      } else {
        const out = direction > 0 ? progress : 1 - progress;
        sheet.style.transform = 'translateX(' + (-out * 32) + '%) rotate(' + (-out * 4) + 'deg)';
        sheet.style.opacity = String(1 - out);
      }
    },
    remove() { lift.remove(); },
  };
}
