// The same handle supports a mouse, a touch pointer, or the keyboard arrow keys.
export function bindMediaOrder(list, move) {
  let drag;
  let frame;

  function updateTarget() {
    const hit = document.elementFromPoint(drag.x, drag.y)?.closest('[data-media-id]');
    if (hit && list.contains(hit)) {
      const rect = hit.getBoundingClientRect();
      drag.target = hit;
      drag.after = drag.y >= rect.top + rect.height / 2;
    } else if (list.children.length) {
      const rect = list.getBoundingClientRect();
      if (drag.y <= rect.top || drag.y >= rect.bottom) {
        drag.after = drag.y >= rect.bottom;
        drag.target = drag.after ? list.lastElementChild : list.firstElementChild;
      }
    }
    if (drag.mark && drag.mark !== drag.target) drag.mark.removeAttribute('data-drop');
    drag.mark = drag.target;
    if (drag.mark && drag.mark !== drag.source) drag.mark.dataset.drop = drag.after ? 'after' : 'before';
    else drag.mark?.removeAttribute('data-drop');
  }

  function autoScroll() {
    const y = drag.y;
    const edge = 48;
    const speed = y < edge ? -Math.ceil((edge - Math.max(0, y)) / 4)
      : y > innerHeight - edge ? Math.ceil((Math.min(y, innerHeight) - innerHeight + edge) / 4) : 0;
    if (speed) {
      window.scrollBy(0, speed);
      updateTarget();
    }
    frame = requestAnimationFrame(autoScroll);
  }

  function finish(event, apply) {
    if (!drag || drag.pointer !== event.pointerId) return;
    const { source, target, mark, after, handle, pointer } = drag;
    drag = null;
    cancelAnimationFrame(frame);
    mark?.removeAttribute('data-drop');
    source.classList.remove('sorting');
    if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
    if (!apply || !target || target === source) return;
    const rows = [...list.children];
    const from = rows.indexOf(source);
    const slot = rows.indexOf(target) + Number(after);
    move(from, slot > from ? slot - 1 : slot);
  }

  list.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.media-handle');
    if (drag || !handle || !event.isPrimary || event.button !== 0 || handle.matches(':disabled')) return;
    drag = { handle, pointer: event.pointerId, source: handle.closest('li'), x: event.clientX, y: event.clientY };
    drag.source.classList.add('sorting');
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  list.addEventListener('pointermove', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    updateTarget();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(autoScroll);
  });
  list.addEventListener('pointerup', event => finish(event, true));
  list.addEventListener('pointercancel', event => finish(event, false));
  list.addEventListener('lostpointercapture', event => finish(event, false));
  list.addEventListener('keydown', event => {
    if (!event.target.closest('.media-handle') || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const from = [...list.children].indexOf(event.target.closest('li'));
    move(from, from + (event.key === 'ArrowUp' ? -1 : 1));
  });
}
