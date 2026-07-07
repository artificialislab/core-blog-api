import { Router } from 'express';
import { q, one } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { ensureUniqueSlug, slugify } from '../slug.js';
import {
  asyncHandler, isUuid, parseAdminListFilters, parseOptionalDate, POST_STATUSES,
} from '../http.js';
import { sanitizeHtml, sanitizePlainText } from '../sanitizeHtml.js';

const router = Router();
const requireEditor = [requireAuth, requireRole('admin', 'editor')];
const requireAdmin = [requireAuth, requireRole('admin')];

/** Converte row snake_case do DB pro shape camelCase que o frontend TS espera. */
function rowToPost(r) {
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

function normalizePublication(status, publishedAt) {
  const now = new Date();
  if (status === 'draft') return { publishedAt: null };
  if (status === 'scheduled') {
    if (!publishedAt) return { error: 'scheduled_at_required' };
    if (publishedAt <= now) return { error: 'scheduled_at_must_be_future' };
    return { publishedAt };
  }
  if (status === 'published') {
    if (publishedAt && publishedAt > now) return { error: 'published_at_must_not_be_future' };
    return { publishedAt: publishedAt || now };
  }
  return { error: 'invalid_status' };
}

function normalizeAssetUrl(value, field) {
  if (value === undefined) return { provided: false };
  if (value === null || value === '') return { provided: true, value: null };

  const raw = String(value).trim();
  if (!raw) return { provided: true, value: null };
  if (raw.length > 2048) return { error: `${field}_invalid_url` };
  if (raw.startsWith('/uploads/')) return { provided: true, value: raw };

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:') return { provided: true, value: parsed.toString() };
  } catch {
    // handled below
  }

  return { error: `${field}_invalid_url` };
}

function normalizeSeoPayload(value) {
  if (value === undefined) return { provided: false };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { provided: true, value: {} };
  }

  const seo = { ...value };
  // Campos textuais do SEO nunca carregam HTML — sanitiza como texto puro.
  if (typeof seo.title === 'string') seo.title = sanitizePlainText(seo.title);
  if (typeof seo.description === 'string') {
    seo.description = sanitizePlainText(seo.description);
  }
  if (seo.ogImage !== undefined) {
    const normalized = normalizeAssetUrl(seo.ogImage, 'seo_og_image');
    if (normalized.error) return { error: normalized.error };
    if (normalized.value) seo.ogImage = normalized.value;
    else delete seo.ogImage;
  }
  return { provided: true, value: seo };
}

/** Paginacao com clamp: limit default 50 (max 100), offset default 0. */
function parsePagination(query = {}) {
  const parsedLimit = Number.parseInt(query.limit, 10);
  const parsedOffset = Number.parseInt(query.offset, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 100)
    : 50;
  const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;
  return { limit, offset };
}

// Cache curto pra evitar que cada GET público dispare UPDATE no DB. Posts
// agendados ficam visíveis até PUBLISH_LAZY_INTERVAL_MS após o horário,
// suficiente pra granularidade humana e elimina abuso via flood de GET.
const PUBLISH_LAZY_INTERVAL_MS = 30_000;
let lastPublishRunAt = 0;
let publishInFlight = null;

async function publishDueScheduledPosts() {
  const now = Date.now();
  if (now - lastPublishRunAt < PUBLISH_LAZY_INTERVAL_MS) return;
  // Serializa runs concorrentes — múltiplos GET simultâneos compartilham o UPDATE.
  if (publishInFlight) return publishInFlight;
  publishInFlight = q(
    `update blog_posts
     set status = 'published'
     where status = 'scheduled'
       and published_at <= now()`,
  ).finally(() => {
    lastPublishRunAt = Date.now();
    publishInFlight = null;
  });
  return publishInFlight;
}

// ───────────────────────────────────────────────────────────────
// PÚBLICO — só retorna posts com status=published e data passada
// ───────────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req, res) => {
  await publishDueScheduledPosts();
  const { limit, offset } = parsePagination(req.query);
  const rows = await q(
    `select * from blog_posts
     where status = 'published'
       and (published_at is null or published_at <= now())
     order by coalesce(published_at, updated_at) desc
     limit $1 offset $2`,
    [limit, offset],
  );
  res.json({ posts: rows.map(rowToPost) });
}));

router.get('/slug/:slug', asyncHandler(async (req, res) => {
  await publishDueScheduledPosts();
  const row = await one(
    `select * from blog_posts
     where slug = $1
       and status = 'published'
       and (published_at is null or published_at <= now())
     limit 1`,
    [req.params.slug],
  );
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ post: rowToPost(row) });
}));

// ───────────────────────────────────────────────────────────────
// ADMIN — requer JWT autenticado, enxerga TUDO
// ───────────────────────────────────────────────────────────────

router.get('/admin/all', requireEditor, asyncHandler(async (req, res) => {
  // Filtros opcionais que o blog-client-react (listPosts) envia:
  // status/category/tag. Whitelist + placeholders — sem SQL injection.
  const filters = parseAdminListFilters(req.query);
  if (filters.error) return res.status(400).json({ error: filters.error });
  const { limit, offset } = parsePagination(req.query);
  const whereSql = filters.where.length ? `where ${filters.where.join(' and ')}` : '';
  const rows = await q(
    `select * from blog_posts
     ${whereSql}
     order by coalesce(published_at, updated_at) desc
     limit $${filters.params.length + 1} offset $${filters.params.length + 2}`,
    [...filters.params, limit, offset],
  );
  res.json({ posts: rows.map(rowToPost) });
}));

router.get('/admin/:id', requireEditor, asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
  const row = await one(`select * from blog_posts where id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ post: rowToPost(row) });
}));

router.post('/admin', requireEditor, asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!String(body.title || '').trim()) {
    return res.status(400).json({ error: 'title_required' });
  }
  const slug = await ensureUniqueSlug(body.slug || body.title);
  const status = POST_STATUSES.includes(body.status) ? body.status : 'draft';
  const parsedPublishedAt = parseOptionalDate(body.publishedAt);
  if (parsedPublishedAt.error) return res.status(400).json({ error: parsedPublishedAt.error });
  const publishedAt = parsedPublishedAt.provided
    ? parsedPublishedAt.value
    : (status === 'published' ? new Date() : null);
  const publication = normalizePublication(status, publishedAt);
  if (publication.error) return res.status(400).json({ error: publication.error });
  const cover = normalizeAssetUrl(body.cover, 'cover');
  if (cover.error) return res.status(400).json({ error: cover.error });
  const seo = normalizeSeoPayload(body.seo);
  if (seo.error) return res.status(400).json({ error: seo.error });

  const row = await one(
    `insert into blog_posts
       (slug, title, excerpt, cover, content, category, tags, status, published_at, seo, author_id)
     values
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning *`,
    [
      slug,
      String(body.title).trim(),
      sanitizePlainText(body.excerpt),
      cover.provided ? cover.value : null,
      sanitizeHtml(body.content),
      String(body.category || ''),
      Array.isArray(body.tags) ? body.tags : [],
      status,
      publication.publishedAt,
      JSON.stringify(seo.provided ? seo.value : {}),
      req.user.sub,
    ],
  );
  res.status(201).json({ post: rowToPost(row) });
}));

async function updatePostById(req, res) {
  const id = req.params.id;
  if (!isUuid(id)) return res.status(400).json({ error: 'invalid_id' });
  const current = await one(`select * from blog_posts where id = $1`, [id]);
  if (!current) return res.status(404).json({ error: 'not_found' });

  const body = req.body || {};
  const nextTitle = body.title !== undefined ? String(body.title).trim() : current.title;
  if (!nextTitle) return res.status(400).json({ error: 'title_required' });

  // Slug: se user mandou slug, garantimos unicidade (ignorando o próprio id).
  // Se não mandou e o título mudou e o slug atual é derivado, deixa como está
  // — não queremos quebrar links públicos de posts já publicados.
  let nextSlug = current.slug;
  if (body.slug !== undefined && body.slug !== null) {
    const candidate = slugify(body.slug) || slugify(nextTitle);
    if (candidate && candidate !== current.slug) {
      nextSlug = await ensureUniqueSlug(candidate, id);
    }
  }

  const nextStatus = POST_STATUSES.includes(body.status)
    ? body.status
    : current.status;

  let nextPublishedAt = current.published_at;
  if (body.publishedAt !== undefined) {
    const parsedPublishedAt = parseOptionalDate(body.publishedAt);
    if (parsedPublishedAt.error) return res.status(400).json({ error: parsedPublishedAt.error });
    nextPublishedAt = parsedPublishedAt.value;
  } else if (nextStatus === 'published' && !current.published_at) {
    nextPublishedAt = new Date();
  }
  const publication = normalizePublication(nextStatus, nextPublishedAt);
  if (publication.error) return res.status(400).json({ error: publication.error });
  const cover = normalizeAssetUrl(body.cover, 'cover');
  if (cover.error) return res.status(400).json({ error: cover.error });
  const seo = normalizeSeoPayload(body.seo);
  if (seo.error) return res.status(400).json({ error: seo.error });

  const row = await one(
    `update blog_posts set
       slug         = $1,
       title        = $2,
       excerpt      = $3,
       cover        = $4,
       content      = $5,
       category     = $6,
       tags         = $7,
       status       = $8,
       published_at = $9,
       seo          = $10
     where id = $11
     returning *`,
    [
      nextSlug,
      nextTitle,
      body.excerpt !== undefined ? sanitizePlainText(body.excerpt) : current.excerpt,
      cover.provided ? cover.value : current.cover,
      body.content !== undefined ? sanitizeHtml(body.content) : current.content,
      body.category !== undefined ? String(body.category) : current.category,
      Array.isArray(body.tags) ? body.tags : current.tags,
      nextStatus,
      publication.publishedAt,
      seo.provided ? JSON.stringify(seo.value) : current.seo,
      id,
    ],
  );
  res.json({ post: rowToPost(row) });
}

router.put('/admin/:id', requireEditor, asyncHandler(updatePostById));
router.patch('/admin/:id', requireEditor, asyncHandler(updatePostById));

router.delete('/admin/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'invalid_id' });
  const row = await one(`delete from blog_posts where id = $1 returning id`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ deleted: row.id });
}));

export default router;
