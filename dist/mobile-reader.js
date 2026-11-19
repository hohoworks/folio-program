export function createMobileReader(viewport, onBreakpointChange) {
  const breakpoint = matchMedia('(max-width: 680px)');
  const spread = viewport.querySelector('#page-area');
  let pageSide = 'left';
  let following = false;

  function clearFollow() {
    following = false;
    viewport.classList.remove('camera-following');
    viewport.style.removeProperty('--camera-offset');
  }

  function move(side, { animate = true } = {}) {
    if (side === pageSide && !following) return false;

    const instant = !animate || following;
    if (instant) viewport.classList.add('camera-instant');
    pageSide = side;
    viewport.dataset.readerSide = side;
    if (following) clearFollow();
    if (instant) {
      spread.getBoundingClientRect();
      viewport.classList.remove('camera-instant');
    }
    return true;
  }

  function follow(side, progress) {
    if (!breakpoint.matches) return;
    if (!following) {
      following = true;
      viewport.classList.add('camera-following');
    }
    const offset = side === 'right' ? progress : 1 - progress;
    viewport.style.setProperty('--camera-offset', `${-45 * offset}%`);
  }

  breakpoint.addEventListener('change', () => onBreakpointChange?.());

  return {
    get active() { return breakpoint.matches; },
    get moving() {
      return breakpoint.matches && spread.getAnimations().some((animation) => (
        animation.transitionProperty === 'transform' && animation.playState === 'running'
      ));
    },
    get pageSide() { return pageSide; },
    move,
    follow,
    stopFollowing() { if (following) move(pageSide, { animate: false }); },
    reset() { move('left', { animate: false }); },
  };
}
