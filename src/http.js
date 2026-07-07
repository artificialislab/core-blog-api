export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

/** Status validos do enum post_status do DB (db/001_init.sql). */
export const POST_STATUSES = ['draft', 'scheduled', 'published'];

/**
 * Filtros da listagem admin (GET /posts/admin/all): `status` validado contra
 * a whitelist do enum, `category` (match exato na coluna text) e `tag`
 * (pertencimento no array text[] `tags`). Retorna `{ where, params }` pra
 * compor SQL parametrizado — nunca interpola valor do usuario — ou
 * `{ error }` quando o filtro e invalido.
 */
export function parseAdminListFilters(query = {}) {
  const where = [];
  const params = [];
  // Query string repetida (?status=a&status=b) chega como array — usa o 1o.
  const pick = (value) => (Array.isArray(value) ? value[0] : value);

  const status = pick(query.status);
  if (status !== undefined && status !== '') {
    if (typeof status !== 'string' || !POST_STATUSES.includes(status)) {
      return { error: 'invalid_status' };
    }
    params.push(status);
    where.push(`status = $${params.length}`);
  }

  const category = pick(query.category);
  if (category !== undefined && category !== '') {
    if (typeof category !== 'string') return { error: 'invalid_category' };
    params.push(category);
    where.push(`category = $${params.length}`);
  }

  const tag = pick(query.tag);
  if (tag !== undefined && tag !== '') {
    if (typeof tag !== 'string') return { error: 'invalid_tag' };
    params.push(tag);
    where.push(`$${params.length} = any(tags)`);
  }

  return { where, params };
}

export function parseOptionalDate(value) {
  if (value === undefined) return { provided: false, value: undefined };
  if (value === null || value === '') return { provided: true, value: null };

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { provided: true, error: 'invalid_published_at' };
  }
  return { provided: true, value: date };
}
