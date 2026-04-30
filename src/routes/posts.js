import { Router } from 'express';
import { q, one } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { ensureUniqueSlug, slugify } from '../slug.js';
import { asyncHandler, isUuid, parseOptionalDate } from '../http.js';
import { sanitizeHtml } from '../sanitizeHtml.js';

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

async function publishDueScheduledPosts() {
  await q(
    `update blog_posts
     set status = 'published'
     where status = 'scheduled'
       and published_at <= now()`,
  );
}

// ───────────────────────────────────────────────────────────────
// PÚBLICO — só retorna posts com status=published e data passada
// ───────────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (_req, res) => {
  await publishDueScheduledPosts();
  const rows = await q(
    `select * from blog_posts
     where status = 'published'
       and (published_at is null or published_at <= now())
     order by coalesce(published_at, updated_at) desc`,
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

router.get('/admin/all', requireEditor, asyncHandler(async (_req, res) => {
  const rows = await q(
    `select * from blog_posts
     order by coalesce(published_at, updated_at) desc`,
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
  const status = ['draft', 'scheduled', 'published'].includes(body.status) ? body.status : 'draft';
  const parsedPublishedAt = parseOptionalDate(body.publishedAt);
  if (parsedPublishedAt.error) return res.status(400).json({ error: parsedPublishedAt.error });
  const publishedAt = parsedPublishedAt.provided
    ? parsedPublishedAt.value
    : (status === 'published' ? new Date() : null);
  const publication = normalizePublication(status, publishedAt);
  if (publication.error) return res.status(400).json({ error: publication.error });

  const row = await one(
    `insert into blog_posts
       (slug, title, excerpt, cover, content, category, tags, status, published_at, seo, author_id)
     values
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning *`,
    [
      slug,
      String(body.title).trim(),
      String(body.excerpt || ''),
      body.cover || null,
      sanitizeHtml(body.content),
      String(body.category || ''),
      Array.isArray(body.tags) ? body.tags : [],
      status,
      publication.publishedAt,
      JSON.stringify(body.seo || {}),
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

  const nextStatus = ['draft', 'scheduled', 'published'].includes(body.status)
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
      body.excerpt !== undefined ? String(body.excerpt) : current.excerpt,
      body.cover !== undefined ? (body.cover || null) : current.cover,
      body.content !== undefined ? sanitizeHtml(body.content) : current.content,
      body.category !== undefined ? String(body.category) : current.category,
      Array.isArray(body.tags) ? body.tags : current.tags,
      nextStatus,
      publication.publishedAt,
      body.seo !== undefined ? JSON.stringify(body.seo) : current.seo,
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
