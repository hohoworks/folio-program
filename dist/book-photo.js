// Extra support points describe binding wire and leaves which protrude beyond
// a rectangular cover. Coordinates are fractions of its width, height, depth.
const supports = new WeakMap();
export function setBookSupport(model, part, points) {
  supports.set(model, { ...supports.get(model), [part]: points });
}

// The front cover sits at half the actual CSS depth, including any display limits.
export function renderedBookDepth(front) {
  return 2 * new DOMMatrixReadOnly(getComputedStyle(front).transform).m43;
}

// A large overhead light stays fixed while the object turns. Read the displayed
// transform so keyboard transitions and the administrator preview use the same pose.
export function lightBook(model, shadow) {
  const frame = model.parentElement;
  const cover = model.querySelector(':scope > .front');
  let queued = 0;
  let lastView = '';
  let lastSupport;

  function paint() {
    queued = 0;
    const width = model.offsetWidth;
    const height = model.offsetHeight;
    if (!width || !height) return;
    const transform = getComputedStyle(model).transform;
    const depth = renderedBookDepth(cover);
    const frameStyle = getComputedStyle(frame);
    const perspective = parseFloat(frameStyle.perspective) || 1300;
    const fit = parseFloat(frameStyle.scale) || 1;
    const view = [width, height, depth, transform, perspective, fit].join('/');
    const support = supports.get(model);
    if (view !== lastView || support !== lastSupport) {
      lastView = view;
      lastSupport = support;
      const pose = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
      const lighting = (x, y, z) => -.40 * x - .72 * y + .56 * z;
      const front = lighting(pose.m31, pose.m32, pose.m33);
      const fore = lighting(pose.m11, pose.m12, pose.m13);
      const down = lighting(pose.m21, pose.m22, pose.m23);
      frame.style.setProperty('--front-shade', Math.max(0, .48 - front) * .12);
      frame.style.setProperty('--back-shade', Math.max(0, .48 + front) * .12);
      for (const [name, light] of [['head', -down], ['fore', fore], ['tail', down]]) {
        frame.style.setProperty('--' + name + '-light', .88 + .12 * light);
      }

      const corners = [];
      function project(x, y, z) {
        const point = pose.transformPoint({ x: x * width, y: y * height, z: z * depth });
        const scale = fit * perspective / (perspective - point.z);
        return { x: point.x * scale, y: point.y * scale };
      }
      for (const x of [-.5, .5]) {
        for (const y of [-.5, .5]) {
          for (const z of [-.5, .5]) corners.push(project(x, y, z));
        }
      }
      // Only a feature that protrudes below the cover changes where the book rests.
      const coverFloor = Math.max(...corners.map(point => point.y));
      let floor = coverFloor;
      let minX = Math.min(...corners.map(point => point.x));
      let maxX = Math.max(...corners.map(point => point.x));
      for (const points of [support?.wire, support?.leaves]) {
        for (const [x, y, z] of points || []) {
          const point = project(x, y, z);
          minX = Math.min(minX, point.x);
          maxX = Math.max(maxX, point.x);
          if (point.y > coverFloor) {
            floor = Math.max(floor, point.y);
            corners.push(point);
          }
        }
      }
      const footprint = maxX - minX;
      // Near-level edges approach the floor together. Weighting by clearance
      // avoids the contact jumping from one corner to another during a rotation.
      const falloff = Math.max(1, width * fit * .014);
      let sum = 0, first = 0, second = 0;
      for (const point of corners) {
        const weight = Math.exp((point.y - floor) / falloff);
        sum += weight;
        first += weight * point.x;
        second += weight * point.x * point.x;
      }
      const center = first / sum;
      const span = Math.sqrt(Math.max(0, second / sum - center * center)) * 2;
      shadow.style.setProperty('--contact-x', center + 'px');
      shadow.style.setProperty('--contact-y', floor + 'px');
      shadow.style.setProperty('--footprint', footprint + 'px');
      shadow.style.setProperty('--contact-span', Math.max(10, Math.min(footprint, width * fit * .16 + span * .84)) + 'px');
    }
    if (model.getAnimations().some(animation => animation.playState === 'running')) schedule();
  }

  function schedule() {
    if (!queued) queued = requestAnimationFrame(paint);
  }
  new ResizeObserver(schedule).observe(model);
  model.addEventListener('transitionrun', schedule);
  model.addEventListener('transitionend', schedule);
  model.addEventListener('transitioncancel', schedule);
  return schedule;
}
