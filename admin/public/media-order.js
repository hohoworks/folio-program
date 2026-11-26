// Reorder the visible slots while keeping filtered-out works in their original slots.
export function reorderedCatalogue(order, visible, from, to) {
  if (![from, to].every(index => Number.isInteger(index) && index >= 0 && index < visible.length) || from === to) return null;
  const visibleIds = new Set(visible);
  const current = order.filter(id => visibleIds.has(id));
  if (current.length !== visible.length || current.some((id, index) => id !== visible[index])) return null;
  const [moved] = current.splice(from, 1);
  current.splice(to, 0, moved);
  let slot = 0;
  return order.map(id => visibleIds.has(id) ? current[slot++] : id);
}

export function bindMediaOrder(list, move, scrollPane = null) {
  let drag;
  let frame;

  function updateTarget() {
    const hit = document.elementFromPoint(drag.x, drag.y)?.closest('li');
    drag.target = null;
    if (hit?.parentElement === list) {
      const rect = hit.getBoundingClientRect();
      drag.target = hit;
      drag.after = drag.y >= rect.top + rect.height / 2;
    } else if (list.children.length) {
      const rect = list.getBoundingClientRect();
      if (drag.x >= rect.left && drag.x <= rect.right && (drag.y <= rect.top || drag.y >= rect.bottom)) {
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
    if (!list.contains(drag.source)) {
      finish({ pointerId: drag.pointer }, false);
      return;
    }
    const pane = scrollPane && getComputedStyle(scrollPane).overflowY === 'auto' ? scrollPane : null;
    const bounds = pane?.getBoundingClientRect();
    const top = Math.max(0, bounds?.top ?? 0);
    const bottom = Math.min(innerHeight, bounds?.bottom ?? innerHeight);
    const y = Math.max(top, Math.min(bottom, drag.y));
    const edge = 48;
    const speed = y < top + edge ? -Math.ceil((top + edge - y) / 4)
      : y > bottom - edge ? Math.ceil((y - bottom + edge) / 4) : 0;
    if (speed && (!bounds || (drag.x >= bounds.left && drag.x <= bounds.right))) {
      (pane || window).scrollBy(0, speed);
      updateTarget();
    }
    frame = requestAnimationFrame(autoScroll);
  }

  function finish(event, apply) {
    if (!drag || drag.pointer !== event.pointerId) return;
    if (apply) {
      drag.x = event.clientX;
      drag.y = event.clientY;
      updateTarget();
    }
    const { source, target, mark, after, handle, pointer } = drag;
    drag = null;
    cancelAnimationFrame(frame);
    mark?.removeAttribute('data-drop');
    source.classList.remove('sorting');
    if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
    if (!apply || !target || target === source || source.parentElement !== list || target.parentElement !== list) return;
    const rows = [...list.children];
    const from = rows.indexOf(source);
    const slot = rows.indexOf(target) + Number(after);
    const to = slot > from ? slot - 1 : slot;
    if (to !== from) move(from, to);
  }

  list.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.media-handle');
    if (drag || !handle || !event.isPrimary || event.button !== 0 || handle.matches(':disabled')) return;
    drag = { handle, pointer: event.pointerId, source: handle.closest('li'), x: event.clientX, y: event.clientY };
    drag.source.classList.add('sorting');
    handle.focus({ preventScroll: true });
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
    if (!event.target.closest('.media-handle')) return;
    if (event.key === 'Escape' && drag) {
      finish({ pointerId: drag.pointer }, false);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const from = [...list.children].indexOf(event.target.closest('li'));
    const to = { Home: 0, End: list.children.length - 1, ArrowUp: from - 1, ArrowDown: from + 1 }[event.key];
    if (to >= 0 && to < list.children.length && to !== from) move(from, to);
  });
}
