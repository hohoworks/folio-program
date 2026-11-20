export const MAX_PROJECT_VIDEO_BYTES = 16 * 1024 * 1024;

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

// Image-only catalogues predate ordered project media.
export function projectMedia(project) {
  if (project?.media !== undefined) return Array.isArray(project.media) ? project.media : [];
  return Array.isArray(project?.images) ? project.images.map(image => ({ ...image, type: 'image' })) : [];
}
