import { displayText } from './punctuation.js';

export const DEFAULT_SITE_TITLE = 'HOHO WORKS';

// Only the original starter setting has this revision. Later edits keep the chosen name.
export function migrateStarterSite(site) {
  if (site?.title === 'HOHOHO' && site.revision === 'e1edee23-0932-4b9a-8c67-9c803a4b2e93') {
    return { ...site, title: DEFAULT_SITE_TITLE };
  }
  return site;
}

export function localizedSiteTitles(site) {
  const title = migrateStarterSite(site)?.title;
  const ko = typeof title === 'string' && title.trim() ? title.trim() : DEFAULT_SITE_TITLE;
  const translation = site?.translations?.en?.title;
  const en = typeof translation === 'string' && translation.trim() ? translation : ko;
  return { ko: displayText(ko), en: displayText(en) };
}
