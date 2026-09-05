import { sanitizeHtml } from '../sanitizeHtml.js';

/**
 * Geração dos artefatos de SEO derivados do blog.
 *
 * Contexto do problema que este módulo resolve:
 * ---------------------------------------------
 * Os sites de cliente são SPAs (Vite + React) servidos como estático pelo
 * nginx. O sitemap.xml, o llms.txt e o HTML pré-renderizado de cada artigo
 * eram gerados APENAS no `npm run build`. Como o deploy é manual, publicar
 * um artigo no painel não produzia nenhum efeito para o Google: o artigo
 * ficava fora do sitemap, sem link em HTML na listagem do blog, e a URL
 * direta devolvia o shell da home (canonical apontando para "/").
 *
 * A partir daqui quem é dono desses artefatos é a API, em runtime. Publicou
 * no painel -> a API regrava os arquivos no volume que o nginx serve.
 *
 * Este arquivo é PURO (string in / string out) para ser testável sem DB e
 * sem filesystem. O IO fica em ./refresh.js.
 */

const DEFAULT_INDEX_ROBOTS = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
const FALLBACK_MARKER = '<!-- @artificialis-seo:fallback -->';

// ─── Escapes ───────────────────────────────────────────────────────────────

export const escapeXml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const stripMarkup = (value) =>
  String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_>`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function truncateAtWord(value, maxLength = 160) {
  const normalized = stripMarkup(value);
  if (normalized.length <= maxLength) return normalized;
  const candidate = normalized.slice(0, maxLength - 1);
  const lastSpace = candidate.lastIndexOf(' ');
  return `${candidate.slice(0, lastSpace > maxLength * 0.7 ? lastSpace : undefined).trim()}…`;
}

const safeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

const validDate = (value) => {
  if (typeof value !== 'string') return undefined;
  return value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
};

// ─── Elegibilidade ─────────────────────────────────────────────────────────

/**
 * Um post só entra em sitemap/prerender se realmente puder ser servido como
 * página. Mesmo critério que o build usava — mantido idêntico de propósito,
 * para que a migração para runtime não mude o conjunto de URLs indexáveis.
 */
export function isPublicPostReady(post) {
  const publishedAt = new Date(post?.publishedAt || '');
  return (
    (!post?.status || post.status === 'published') &&
    Number.isFinite(publishedAt.getTime()) &&
    publishedAt.getTime() <= Date.now() &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(post?.slug || '')) &&
    stripMarkup(post?.title).length > 0 &&
    stripMarkup(post?.excerpt).length > 0 &&
    stripMarkup(post?.content).length > 0
  );
}

export const selectPublicPosts = (posts = []) => posts.filter(isPublicPostReady);

// ─── URLs / imagens ────────────────────────────────────────────────────────

const trimSlash = (value) => String(value || '').replace(/\/+$/, '');

export function absoluteUrl(siteUrl, pathname) {
  const base = trimSlash(siteUrl);
  if (!pathname || pathname === '/') return `${base}/`;
  return `${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

export function resolveImage(value, config) {
  const fallback = config.defaultImage || `${trimSlash(config.siteUrl)}/og-default.svg`;
  try {
    const url = new URL(value || fallback, `${trimSlash(config.siteUrl)}/`);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : fallback;
  } catch {
    return fallback;
  }
}

export const postUrl = (config, slug) => absoluteUrl(config.siteUrl, `${config.blog?.path || '/blog'}/${slug}`);

// ─── sitemap.xml ───────────────────────────────────────────────────────────

export function buildSitemap(config, posts) {
  const entries = [
    ...(config.staticRoutes || []).map((route) => ({
      loc: absoluteUrl(config.siteUrl, route.loc),
      changefreq: route.changefreq || 'monthly',
      priority: route.priority || '0.7',
    })),
    ...selectPublicPosts(posts).map((post) => ({
      loc: postUrl(config, post.slug),
      lastmod: validDate(post.updatedAt || post.publishedAt || post.createdAt),
      changefreq: 'monthly',
      priority: '0.8',
    })),
  ];

  // Dedup por loc — uma rota estática mal configurada não deve gerar URL
  // duplicada no sitemap (Google trata como erro de qualidade).
  const seen = new Map();
  for (const entry of entries) if (!seen.has(entry.loc)) seen.set(entry.loc, entry);

  const body = [...seen.values()]
    .sort((a, b) => a.loc.localeCompare(b.loc, 'pt-BR'))
    .map(
      (entry) =>
        `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>\n${entry.lastmod ? `    <lastmod>${entry.lastmod}</lastmod>\n` : ''}    <changefreq>${entry.changefreq}</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function countSitemapEntries(xml) {
  return [...String(xml || '').matchAll(/<loc>/g)].length;
}

// ─── llms.txt ──────────────────────────────────────────────────────────────

export function buildLlms(config, posts) {
  const lines = [`# ${config.brandName || config.siteUrl}`, ''];
  if (config.llms?.tagline) lines.push(`> ${config.llms.tagline}`, '');

  for (const section of config.llms?.sections || []) {
    lines.push(`## ${section.heading}`);
    for (const item of section.items || []) {
      lines.push(`- [${item.label}](${absoluteUrl(config.siteUrl, item.url)})`);
    }
    lines.push('');
  }

  const published = selectPublicPosts(posts).sort((a, b) =>
    String(b.publishedAt).localeCompare(String(a.publishedAt)),
  );
  if (published.length) {
    lines.push(config.llms?.postsHeading || '## Artigos');
    for (const post of published) {
      lines.push(`- [${stripMarkup(post.title)}](${postUrl(config, post.slug)})`);
    }
    lines.push('');
  }

  if (config.llms?.footer) lines.push(config.llms.footer, '');
  return lines.join('\n');
}

// ─── Manipulação do template HTML ──────────────────────────────────────────

function setTitle(html, title) {
  return html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
}

function setMeta(html, attribute, name, content) {
  const pattern = new RegExp(`<meta\\s+${attribute}=["']${escapeRegex(name)}["'][^>]*>`, 'i');
  const tag = `<meta ${attribute}="${name}" content="${escapeHtml(content)}" />`;
  return pattern.test(html) ? html.replace(pattern, tag) : html.replace('</head>', `    ${tag}\n  </head>`);
}

function removeMeta(html, name) {
  return html.replace(
    new RegExp(`\\s*<meta\\s+[^>]*(?:name|property)=["']${escapeRegex(name)}["'][^>]*>`, 'gi'),
    '',
  );
}

function setLink(html, rel, href) {
  const pattern = new RegExp(`<link\\s+rel=["']${escapeRegex(rel)}["'][^>]*>`, 'i');
  const tag = `<link rel="${rel}" href="${escapeHtml(href)}" />`;
  return pattern.test(html) ? html.replace(pattern, tag) : html.replace('</head>', `    ${tag}\n  </head>`);
}

function setAlternate(html, hreflang, href) {
  const pattern = new RegExp(
    `<link\\s+rel=["']alternate["'][^>]*hreflang=["']${escapeRegex(hreflang)}["'][^>]*>`,
    'i',
  );
  const tag = `<link rel="alternate" hreflang="${hreflang}" href="${escapeHtml(href)}" />`;
  return pattern.test(html) ? html.replace(pattern, tag) : html.replace('</head>', `    ${tag}\n  </head>`);
}

/**
 * Substitui o conteúdo interno de <div id="root"> pelo HTML pré-renderizado.
 *
 * Por que localizar o fechamento por `lastIndexOf('</div>')` antes de
 * `</body>` em vez de regex: o conteúdo injetado tem divs aninhadas, e regex
 * não casa fechamento balanceado. No dist do Vite nada além do #root abre div
 * no body (só as tags <script> do bundle), então o último </div> antes de
 * </body> é sempre o fechamento do root.
 */
export function replaceRootContent(html, inner) {
  const open = html.match(/<div[^>]*id=["']root["'][^>]*>/i);
  if (!open) return html;
  const start = html.indexOf(open[0]) + open[0].length;
  const bodyClose = html.lastIndexOf('</body>');
  const end = html.lastIndexOf('</div>', bodyClose === -1 ? html.length : bodyClose);
  if (end === -1 || end < start) return html;
  return `${html.slice(0, start)}${inner}${html.slice(end)}`;
}

function addJsonLd(html, canonical, jsonLd) {
  if (!jsonLd) return html;
  const script = `    <script type="application/ld+json" data-prerendered="true" data-route="${escapeHtml(canonical)}">${safeJson(jsonLd)}</script>\n`;
  return html.replace('</head>', `${script}  </head>`);
}

/**
 * Aplica head completo (title, description, canonical, OG, Twitter, JSON-LD)
 * sobre o template do site.
 */
export function buildRouteHtml(template, config, {
  title,
  description,
  canonical,
  image,
  imageAlt,
  type = 'website',
  robots = config.indexRobots || DEFAULT_INDEX_ROBOTS,
  jsonLd,
  publishedTime,
  modifiedTime,
  body,
}) {
  const resolvedImage = resolveImage(image, config);
  const shortDescription = truncateAtWord(description);

  let html = setTitle(template, title);
  html = setMeta(html, 'name', 'description', shortDescription);
  html = setMeta(html, 'name', 'robots', robots);
  html = setLink(html, 'canonical', canonical);
  html = setAlternate(html, config.locale || 'pt-BR', canonical);
  html = setAlternate(html, 'x-default', canonical);
  html = setMeta(html, 'property', 'og:title', title);
  html = setMeta(html, 'property', 'og:description', shortDescription);
  html = setMeta(html, 'property', 'og:type', type);
  html = setMeta(html, 'property', 'og:url', canonical);
  html = setMeta(html, 'property', 'og:image', resolvedImage);
  html = setMeta(html, 'property', 'og:image:alt', imageAlt || config.brandName || title);
  html = setMeta(html, 'name', 'twitter:card', 'summary');
  html = setMeta(html, 'name', 'twitter:title', title);
  html = setMeta(html, 'name', 'twitter:description', shortDescription);
  html = setMeta(html, 'name', 'twitter:image', resolvedImage);
  html = setMeta(html, 'name', 'twitter:image:alt', imageAlt || config.brandName || title);
  html = removeMeta(html, 'og:image:width');
  html = removeMeta(html, 'og:image:height');
  html = removeMeta(html, 'article:published_time');
  html = removeMeta(html, 'article:modified_time');
  if (publishedTime) html = setMeta(html, 'property', 'article:published_time', publishedTime);
  if (modifiedTime) html = setMeta(html, 'property', 'article:modified_time', modifiedTime);
  html = addJsonLd(html, canonical, jsonLd);
  if (body) html = replaceRootContent(html, body);
  return html;
}

// ─── JSON-LD ───────────────────────────────────────────────────────────────

export function breadcrumb(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.item,
    })),
  };
}

export function articleSchema(config, post, canonical, image) {
  const ids = config.schemaIds || {};
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      '@id': `${canonical}#article`,
      url: canonical,
      headline: post.title,
      description: post.excerpt,
      datePublished: post.publishedAt || post.createdAt,
      dateModified: post.updatedAt || post.publishedAt || post.createdAt,
      inLanguage: config.locale || 'pt-BR',
      author: ids.author ? { '@id': ids.author } : undefined,
      publisher: ids.publisher ? { '@id': ids.publisher } : undefined,
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      articleSection: post.category || undefined,
      keywords: Array.isArray(post.tags) && post.tags.length ? post.tags.join(', ') : undefined,
      image,
      isAccessibleForFree: true,
    },
    breadcrumb([
      { name: config.homeLabel || 'Início', item: absoluteUrl(config.siteUrl, '/') },
      { name: config.blog?.label || 'Blog', item: absoluteUrl(config.siteUrl, config.blog?.path || '/blog') },
      { name: post.title, item: canonical },
    ]),
  ];
}

// ─── Corpo pré-renderizado ─────────────────────────────────────────────────
//
// O React substitui o conteúdo de #root ao montar, então este HTML só é visto
// por crawlers e por quem está com o JS ainda carregando. Ele existe para que
// título, resumo, data e TEXTO DO ARTIGO cheguem no HTML inicial — antes era
// só um spinner, e o Google precisava renderizar JS para ver qualquer coisa.

const SHELL_STYLE = 'min-height:100vh;background:#0a0a0a;color:#f5f5f5;font-family:system-ui,-apple-system,sans-serif;padding:2rem 1.25rem';
const WRAP_STYLE = 'max-width:720px;margin:0 auto;line-height:1.65';
const MUTED = 'color:#a8a8a8';

const formatDate = (value, locale = 'pt-BR') => {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return '';
  try {
    return date.toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' });
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

export function buildPostBody(config, post) {
  const canonical = postUrl(config, post.slug);
  const published = post.publishedAt || post.createdAt;
  const isoDate = validDate(published) || '';
  return `${FALLBACK_MARKER}
      <div style="${SHELL_STYLE}">
        <div style="${WRAP_STYLE}">
          <nav style="font-size:0.875rem;${MUTED};margin:0 0 1.5rem" aria-label="Trilha de navegação">
            <a href="/" style="color:inherit">${escapeHtml(config.homeLabel || 'Início')}</a> ›
            <a href="${escapeHtml(config.blog?.path || '/blog')}" style="color:inherit">${escapeHtml(config.blog?.label || 'Blog')}</a>
          </nav>
          <article>
            <h1 style="font-size:2rem;font-weight:700;margin:0 0 1rem;line-height:1.2">${escapeHtml(post.title)}</h1>
            ${isoDate ? `<p style="font-size:0.875rem;${MUTED};margin:0 0 1.5rem"><time datetime="${escapeHtml(isoDate)}">${escapeHtml(formatDate(published, config.locale))}</time></p>` : ''}
            <p style="font-size:1.125rem;opacity:0.9;margin:0 0 2rem">${escapeHtml(stripMarkup(post.excerpt))}</p>
            <div>${sanitizeHtml(post.content)}</div>
          </article>
          <p style="margin:2.5rem 0 0;font-size:0.875rem;${MUTED}">
            <a href="${escapeHtml(canonical)}" style="color:inherit">${escapeHtml(canonical)}</a>
          </p>
        </div>
      </div>
    `;
}

/**
 * Corpo da listagem /blog. O ponto crítico aqui são os <a href> reais: sem
 * eles o HTML inicial da listagem não tinha NENHUM link para os artigos, e o
 * sitemap virava o único caminho de descoberta.
 */
export function buildBlogIndexBody(config, posts) {
  const items = selectPublicPosts(posts)
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
    .map((post) => {
      const href = `${config.blog?.path || '/blog'}/${post.slug}`;
      const published = post.publishedAt || post.createdAt;
      const isoDate = validDate(published) || '';
      return `            <li style="margin:0 0 2rem">
              <h2 style="font-size:1.25rem;font-weight:600;margin:0 0 0.5rem;line-height:1.3"><a href="${escapeHtml(href)}" style="color:inherit;text-decoration:none">${escapeHtml(post.title)}</a></h2>
              ${isoDate ? `<p style="font-size:0.8125rem;${MUTED};margin:0 0 0.5rem"><time datetime="${escapeHtml(isoDate)}">${escapeHtml(formatDate(published, config.locale))}</time></p>` : ''}
              <p style="margin:0;opacity:0.85">${escapeHtml(truncateAtWord(post.excerpt, 200))}</p>
            </li>`;
    })
    .join('\n');

  return `${FALLBACK_MARKER}
      <div style="${SHELL_STYLE}">
        <div style="${WRAP_STYLE}">
          <h1 style="font-size:2rem;font-weight:700;margin:0 0 0.75rem;line-height:1.2">${escapeHtml(config.blog?.title || 'Blog')}</h1>
          <p style="font-size:1.0625rem;opacity:0.85;margin:0 0 2.5rem">${escapeHtml(config.blog?.description || '')}</p>
          <ul style="list-style:none;padding:0;margin:0">
${items}
          </ul>
        </div>
      </div>
    `;
}

// ─── Páginas ───────────────────────────────────────────────────────────────

export function buildPostHtml(template, config, post) {
  const canonical = postUrl(config, post.slug);
  const image = resolveImage(post?.seo?.ogImage || post.cover, config);
  const suffix = config.titleSuffix || '';
  const maxBase = Number(config.titleSuffixMaxLength || 54);
  const title =
    post?.seo?.metaTitle || (suffix && post.title.length <= maxBase ? `${post.title} ${suffix}`.trim() : post.title);

  const html = buildRouteHtml(template, config, {
    title,
    description: post?.seo?.metaDescription || post.excerpt,
    canonical,
    image,
    imageAlt: post.title,
    type: 'article',
    publishedTime: post.publishedAt || post.createdAt,
    modifiedTime: post.updatedAt || post.publishedAt || post.createdAt,
    jsonLd: articleSchema(config, post, canonical, image),
    body: buildPostBody(config, post),
  });
  const payload = { ...post, content: sanitizeHtml(post.content) };
  return html.replace(/<script\b[^>]*\bid=["']__artificialis_post__["'][^>]*>[\s\S]*?<\/script>/gi, '')
    .replace('</head>', () => `<script type="application/json" id="__artificialis_post__">${safeJson(payload)}</script></head>`);
}

export function buildBlogIndexHtml(template, config, posts) {
  const canonical = absoluteUrl(config.siteUrl, config.blog?.path || '/blog');
  const published = selectPublicPosts(posts);
  const ids = config.schemaIds || {};

  return buildRouteHtml(template, config, {
    title: config.blog?.metaTitle || config.blog?.title || 'Blog',
    description: config.blog?.description || '',
    canonical,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Blog',
        '@id': `${canonical}#blog`,
        url: canonical,
        name: config.blog?.title || 'Blog',
        description: config.blog?.description || undefined,
        inLanguage: config.locale || 'pt-BR',
        publisher: ids.publisher ? { '@id': ids.publisher } : undefined,
        blogPost: published.map((post) => ({ '@id': `${postUrl(config, post.slug)}#article` })),
      },
      breadcrumb([
        { name: config.homeLabel || 'Início', item: absoluteUrl(config.siteUrl, '/') },
        { name: config.blog?.label || 'Blog', item: canonical },
      ]),
    ],
    body: buildBlogIndexBody(config, published),
  });
}
