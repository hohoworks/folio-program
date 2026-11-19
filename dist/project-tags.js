export const STOCK_PROJECT_TAGS = [
  { id: 'book', ko: '책', en: 'Book' },
  { id: 'identity', ko: '아이덴티티', en: 'Identity' },
  { id: 'logo', ko: '로고', en: 'Logo' },
  { id: 'poster', ko: '포스터', en: 'Poster' },
  { id: 'object', ko: '오브젝트', en: 'Object' },
  { id: 'print', ko: '기타 인쇄물', en: 'Other print' },
  { id: 'photography', ko: '사진', en: 'Photography' },
  { id: 'web', ko: '웹 디자인', en: 'Web design' },
  { id: 'video', ko: '비디오', en: 'Video' },
  { id: 'music', ko: '음악', en: 'Music' },
];

export function idsFor(work, kind, tags = STOCK_PROJECT_TAGS) {
  const assigned = Array.isArray(work?.tagIds) ? work.tagIds : kind === 'book' ? ['book'] : [];
  const available = new Set(tags.map(tag => tag.id));
  return [...new Set(assigned)].filter(id => available.has(id));
}
