import { one } from './db.js';

export function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

/**
 * Garante que o slug é único na tabela blog_posts. Se já existe, anexa -2, -3…
 * Ignora o ignoreId (útil em UPDATE quando o slug não mudou).
 */
export async function ensureUniqueSlug(base, ignoreId = null) {
  const candidate0 = slugify(base) || 'post';
  let candidate = candidate0;
  let i = 2;
  // Limite defensivo
  for (let attempt = 0; attempt < 1000; attempt++) {
    const existing = await one(
      `select id from blog_posts where slug = $1 and ($2::uuid is null or id <> $2) limit 1`,
      [candidate, ignoreId],
    );
    if (!existing) return candidate;
    candidate = `${candidate0}-${i++}`;
  }
  throw new Error(`não foi possível gerar slug único a partir de "${base}"`);
}
