const limit = 64;
// Pages gives these two HTML filenames special routing semantics.
const reserved = new Set(['index', '404']);

export function normalizeWorkSlug(value) {
  if (typeof value !== 'string') return '';
  const slug = value.normalize('NFKC').trim().toLowerCase()
    .replace(/[\s_-]+/g, '-').replace(/^-|-$/g, '');
  return slug.length <= limit && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && !reserved.has(slug) ? slug : '';
}

export function suggestWorkSlug(title) {
  if (typeof title !== 'string') return '';
  const words = title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return normalizeWorkSlug(words.slice(0, limit));
}

export function workPath(slug) {
  return '/work/' + slug;
}

function suggestedBase(item) {
  const uuid = /(?:^|-)([\da-f]{8})-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.exec(item.id);
  return suggestWorkSlug(item.translations?.en?.title) || suggestWorkSlug(item.title)
    || 'work-' + (uuid?.[1].toLowerCase() || suggestWorkSlug(item.id).slice(0, 50) || 'item');
}

function available(base, taken) {
  let candidate = base;
  for (let n = 2; taken.has(candidate); n++) {
    const suffix = '-' + n;
    candidate = base.slice(0, limit - suffix.length).replace(/-$/, '') + suffix;
  }
  return candidate;
}

export function availableWorkSlug(item, others) {
  const taken = new Set(others.flatMap(other => [other.slug, ...(other.slugAliases ?? [])]));
  return available(suggestedBase(item), taken);
}

// Reserve every saved address before assigning any missing legacy addresses.
// Sorting by internal ID makes the same legacy catalogue resolve identically
// in the administrator and public builds regardless of gallery order.
export function assignWorkSlugs(items) {
  const taken = new Set();
  function reserve(value) {
    const slug = normalizeWorkSlug(value);
    if (!slug) throw new Error('작품 주소 형식을 확인해주세요.');
    if (taken.has(slug)) throw new Error('중복된 작품 주소를 확인해주세요: ' + slug);
    taken.add(slug);
    return slug;
  }
  const resolved = items.map(item => {
    if (item.slugAliases != null && !Array.isArray(item.slugAliases)) throw new Error('이전 작품 주소 목록을 확인해주세요.');
    const slug = item.slug == null ? '' : reserve(item.slug);
    const slugAliases = (item.slugAliases ?? []).map(reserve);
    return { ...item, slug, ...(slugAliases.length && { slugAliases }) };
  });
  const unassigned = resolved.filter(item => !item.slug).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const item of unassigned) {
    item.slug = available(suggestedBase(item), taken);
    taken.add(item.slug);
  }
  return resolved;
}

export function resolveWorkRoute(entries, url) {
  const path = /^\/work\/([a-z0-9-]+)\/?$/.exec(url.pathname);
  const hash = url.hash.slice(1);
  let entry;
  if (path) {
    entry = entries.find(item => item.slug === path[1] || item.slugAliases?.includes(path[1]));
  } else {
    if (['about', 'project', 'bookshelf', 'contact'].includes(hash)) return { page: hash };
    const legacy = /^(?:(book|project)\/)?([\w-]+)$/.exec(hash);
    if (legacy) {
      entry = entries.find(item => item.id === legacy[2] && (legacy[1] !== 'book' || item.type === 'book'));
      if (entry) return { page: entry.type === 'book' ? 'book' : 'detail', entry, fromProject: legacy[1] === 'project' };
    }
  }
  return entry ? { page: entry.type === 'book' ? 'book' : 'detail', entry } : { page: 'project' };
}
