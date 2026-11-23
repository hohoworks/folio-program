export const MAX_PROJECT_VIDEO_BYTES = 25 * 1024 * 1024;

export function projectEmbedURL(value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^https:\/\//i.test(value) ||
      /[\s\u0000-\u001f\u007f<>"\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function isProjectVideoPath(path) {
  return typeof path === 'string' && /^(?:\.\/)?assets\/projects\/(?:[\w-]+\/)+[\w.-]+\.(?:mp4|webm)$/i.test(path);
}

// Keep the saved share URL for editing and the link beneath the player.
export function projectVideoPlayer(value) {
  const href = projectEmbedURL(value);
  if (!href) return null;
  const url = new URL(href);
  const host = url.host;
  const path = url.pathname.replace(/\/$/, '');
  if (['youtu.be', 'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
    'www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(host)) {
    if (/^\/embed\/[\w-]{11}$/.test(path) && host !== 'youtu.be') return { provider: 'YouTube', src: href };
    const id = host === 'youtu.be' ? path.slice(1) : path === '/watch'
      ? url.searchParams.get('v') : /^\/(?:shorts|live)\/([\w-]{11})$/.exec(path)?.[1];
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    const player = new URL('https://www.youtube-nocookie.com/embed/' + id);
    player.searchParams.set('playsinline', '1');
    const t = url.searchParams.get('t') || url.searchParams.get('start') || new URLSearchParams(url.hash.slice(1)).get('t');
    const units = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(t || '');
    const seconds = units ? Number(units[1] || 0) * 3600 + Number(units[2] || 0) * 60 + Number(units[3] || 0)
      : /^\d+$/.test(t || '') ? Number(t) : 0;
    if (Number.isSafeInteger(seconds) && seconds > 0) player.searchParams.set('start', String(seconds));
    return { provider: 'YouTube', src: player.href };
  }
  if (host === 'player.vimeo.com' && /^\/video\/\d+$/.test(path)) return { provider: 'Vimeo', src: href };
  if (host !== 'vimeo.com' && host !== 'www.vimeo.com') return null;
  const video = /^\/(?:channels\/[\w-]+\/|groups\/[\w-]+\/videos\/|showcase\/\d+\/video\/)?(\d+)(?:\/([a-zA-Z0-9]+))?$/.exec(path);
  if (!video) return null;
  const player = new URL('https://player.vimeo.com/video/' + video[1]);
  const privacyHash = video[2] || url.searchParams.get('h');
  if (privacyHash) player.searchParams.set('h', privacyHash);
  if (/^#t=[\dhms]+$/i.test(url.hash)) player.hash = url.hash;
  return { provider: 'Vimeo', src: player.href };
}

// Editors may still publish a link when its host has no exact CSP host-source representation.
export function projectFrame(value) {
  const href = projectEmbedURL(value);
  if (!href) return null;
  const frame = projectVideoPlayer(href) ?? { src: href };
  const { hostname } = new URL(frame.src);
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(hostname) ? frame : null;
}

// Image-only catalogues predate ordered project media.
export function projectMedia(project) {
  if (project?.media !== undefined) return Array.isArray(project.media) ? project.media : [];
  return Array.isArray(project?.images) ? project.images.map(image => ({ ...image, type: 'image' })) : [];
}
