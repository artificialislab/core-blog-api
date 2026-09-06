/** Optional navigation to configured services; never infer clinical indication. */
export function normalizeServiceText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

const isLocalServicePath = (path) => typeof path === 'string' && path.length <= 240
  && /^\/[a-z0-9]+(?:[a-z0-9/-]*[a-z0-9])?$/.test(path) && !path.includes('//');

export function normalizeServiceLinks(links, staticRoutes = []) {
  if (!Array.isArray(links)) return [];
  const routes = new Set(staticRoutes.map((route) => typeof route === 'string' ? route : route?.loc));
  const seen = new Set();
  return links.slice(0, 30).flatMap((link) => {
    if (!link || typeof link !== 'object') return [];
    const { path } = link;
    const label = typeof link.label === 'string' ? link.label.trim() : '';
    if (!isLocalServicePath(path) || !routes.has(path) || seen.has(path)
      || !label || label.length > 100 || /[\u0000-\u001f\u007f]/.test(label)) return [];
    const keywords = [...new Set((Array.isArray(link.keywords) ? link.keywords : [])
      .slice(0, 20).filter((value) => typeof value === 'string' && value.length <= 80)
      .map(normalizeServiceText).filter((value) => value.length >= 3))];
    if (!keywords.length) return [];
    seen.add(path);
    return [{ label, path, keywords }];
  });
}

/** Config order determines priority. Only complete words/phrases in metadata match. */
export function selectServiceLinks(config, post) {
  const fields = [post?.title, post?.slug, post?.category].map((value) => ` ${normalizeServiceText(value)} `);
  return normalizeServiceLinks(config?.blog?.serviceLinks, config?.staticRoutes)
    .filter((link) => link.keywords.some((keyword) => fields.some((field) => field.includes(` ${keyword} `))))
    .slice(0, 3);
}
