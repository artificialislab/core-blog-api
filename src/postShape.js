/**
 * Shape canônico de um post exposto pela API (camelCase), extraído de
 * routes/posts.js para poder ser reusado pelo gerador de SEO sem import
 * circular entre as rotas e src/seo/refresh.js.
 */

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
