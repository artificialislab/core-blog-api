/**
 * Shape canônico de um post exposto pela API (camelCase), extraído de
 * routes/posts.js para poder ser reusado pelo gerador de SEO sem import
 * circular entre as rotas e src/seo/refresh.js.
 */

/** Estima tempo de leitura com a mesma regra do cliente React (180 palavras/min). */
export function estimateReadTime(contentOrWords) {
  const words = typeof contentOrWords === 'number' && Number.isFinite(contentOrWords)
    ? Math.max(0, Math.trunc(contentOrWords))
    : String(contentOrWords || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[#*_>`-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
  return `${Math.max(1, Math.ceil(words / 180))} min de leitura`;
}

/** Converte row snake_case do DB pro shape camelCase que o frontend TS espera. */
export function rowToPost(r) {
  if (!r) return null;
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    cover: r.cover,
    content: r.content,
    category: r.category,
    tags: r.tags || [],
    status: r.status,
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : undefined,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    seo: r.seo || {},
  };
}

/** Projeção resumida para listagens públicas (?summary=1), preservando readTime sem trafegar o corpo HTML. */
export function rowToSummaryPost(r) {
  if (!r) return null;
  const full = rowToPost(r);
  const hasWordCount =
    typeof r.word_count === 'number' ||
    (typeof r.word_count === 'string' && /^\d+$/.test(r.word_count));
  full.readTime = estimateReadTime(hasWordCount ? Number(r.word_count) : r.content);
  delete full.content;
  return full;
}
