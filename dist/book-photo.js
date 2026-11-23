// A large overhead light stays fixed while the object turns. Read the displayed
// transform so keyboard transitions and the administrator preview use the same pose.
export function lightBook(model, shadow) {
  const frame = model.parentElement;
  let queued = 0;
  let lastView = '';

  function paint() {
    queued = 0;
    const width = model.offsetWidth;
    const height = model.offsetHeight;
    if (!width || !height) return;
    const transform = getComputedStyle(model).transform;
    const depth = Math.max(1.5, Math.min(80, width * (Number(model.style.getPropertyValue('--spine-ratio')) || .025)));
    const perspective = parseFloat(getComputedStyle(frame).perspective) || 1300;
    const view = [width, height, depth, transform, perspective].join('/');
    if (view !== lastView) {
      lastView = view;
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
      for (const x of [-width / 2, width / 2]) {
        for (const y of [-height / 2, height / 2]) {
          for (const z of [-depth / 2, depth / 2]) {
            const point = pose.transformPoint({ x, y, z });
            const scale = perspective / (perspective - point.z);
            corners.push({ x: point.x * scale, y: point.y * scale });
          }
        }
      }
      const floor = Math.max(...corners.map(point => point.y));
      const footprint = Math.max(...corners.map(point => point.x)) - Math.min(...corners.map(point => point.x));
      // Near-level edges approach the floor together. Weighting by clearance
      // avoids the contact jumping from one corner to another during a rotation.
      const falloff = Math.max(1, width * .014);
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
      shadow.style.setProperty('--contact-span', Math.max(10, Math.min(footprint, width * .16 + span * .84)) + 'px');
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
