import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  estimateReadTime,
  rowToPost,
  rowToSummaryPost,
  SUMMARY_COLUMNS,
  SUMMARY_WORD_COUNT_SQL,
} from '../src/postShape.js';
import { isSummaryQuery } from '../src/http.js';
import { sanitizeHtml } from '../src/sanitizeHtml.js';
import { normalizeSeoConfig } from '../src/seo/config.js';
import { buildBlogIndexHtml, buildPostHtml } from '../src/seo/render.js';

const TEMPLATE = '<!doctype html><html><head><title>Base</title></head><body><div id="root"></div></body></html>';

const WORDS_360 = '<p>' + Array.from({ length: 360 }, (_, i) => `palavra${i}`).join(' ') + '</p>';

const BASE_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'artigo-teste',
  title: 'Artigo de Teste',
  excerpt: 'Resumo curto do artigo.',
  cover: '/uploads/capa.jpg',
  content: WORDS_360,
  category: 'Cirurgia Bucomaxilofacial',
  tags: ['siso', 'recuperacao'],
  status: 'published',
  published_at: '2026-10-01T12:00:00.000Z',
  created_at: '2026-10-01T10:00:00.000Z',
  updated_at: '2026-10-02T10:00:00.000Z',
  seo: { metaTitle: 'Título SEO' },
};

const ECMASCRIPT_WHITESPACE_CODE_POINTS = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d,
  0x0020, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];

const NON_WHITESPACE_BOUNDARY_CODE_POINTS = [
  0x0001, 0x0007, 0x0008, 0x000e, 0x001f, 0x007f, 0x0085, 0x200b, 0x2060,
];

async function loadOptionalPGlite() {
  const candidates = [
    process.env.PGLITE_MODULE_PATH,
    fileURLToPath(new URL('../../templates-n8n/node_modules/@electric-sql/pglite/dist/index.js', import.meta.url)),
    fileURLToPath(new URL('../../../templates-n8n/node_modules/@electric-sql/pglite/dist/index.js', import.meta.url)),
  ].filter(Boolean);

  try {
    const mod = await import('@electric-sql/pglite');
    return mod.PGlite;
  } catch {
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        const mod = await import(pathToFileURL(candidate).href);
        return mod.PGlite;
      }
    }
  }
  return null;
}

test('rowToSummaryPost omite content e preserva readTime idêntico ao corpo integral (por word_count ou fallback)', () => {
  const full = rowToPost(BASE_ROW);
  const summaryFromContent = rowToSummaryPost(BASE_ROW);
  const { content: _omitted, ...sqlProjectedRow } = { ...BASE_ROW, word_count: 360 };
  const summaryFromSqlCount = rowToSummaryPost(sqlProjectedRow);

  assert.equal('content' in full, true);
  assert.equal('content' in summaryFromContent, false);
  assert.equal('content' in summaryFromSqlCount, false);
  assert.equal('word_count' in summaryFromSqlCount, false);
  assert.equal(estimateReadTime(full.content), '2 min de leitura');
  assert.equal(summaryFromContent.readTime, '2 min de leitura');
  assert.equal(summaryFromSqlCount.readTime, '2 min de leitura');

  const { content: _ignored, ...expectedBase } = full;
  assert.deepEqual(summaryFromContent, { ...expectedBase, readTime: '2 min de leitura' });
  assert.deepEqual(summaryFromSqlCount, { ...expectedBase, readTime: '2 min de leitura' });
  assert.equal(estimateReadTime(0), '1 min de leitura');
  assert.equal(estimateReadTime(180), '1 min de leitura');
  assert.equal(estimateReadTime(181), '2 min de leitura');
  assert.equal(rowToSummaryPost(null), null);
});

test('SUMMARY_WORD_COUNT_SQL fixa explicitamente os separadores do ECMAScript sem depender de \\s do PostgreSQL', () => {
  assert.doesNotMatch(SUMMARY_WORD_COUNT_SQL, /\\s/);
  assert.doesNotMatch(SUMMARY_WORD_COUNT_SQL, /\[:space:\]/);
  assert.match(SUMMARY_WORD_COUNT_SQL, /\\u202f/);
  assert.match(SUMMARY_WORD_COUNT_SQL, /\\ufeff/);
  assert.match(SUMMARY_COLUMNS, /^id, slug, title, excerpt, cover, category, tags, status, published_at, created_at, updated_at, seo, coalesce\(/);
});

test('projeção SQL real de SUMMARY_COLUMNS mantém paridade exata na fronteira 180/181 (Unicode + controles ASCII + sanitizador)', async (t) => {
  const PGlite = await loadOptionalPGlite();
  if (!PGlite) {
    t.skip('PGlite opcional ausente neste ambiente');
    return;
  }

  const db = new PGlite();
  t.after(async () => {
    await db.close();
  });

  const sql001 = await readFile(new URL('../db/001_init.sql', import.meta.url), 'utf8');
  const sql002 = await readFile(new URL('../db/002_blog_schema_hardening.sql', import.meta.url), 'utf8');
  await db.exec(sql001);
  await db.exec(sql002);

  const base180 = Array.from({ length: 180 }, () => 'palavra').join(' ');
  const cases = [
    { slug: 'vazio', raw: '<p>\u202f\ufeff</p>', expectedAfterSanitize: '1 min de leitura' },
    { slug: 'exato-180', raw: `<p>${base180}</p>`, expectedAfterSanitize: '1 min de leitura' },
  ];

  for (const cp of ECMASCRIPT_WHITESPACE_CODE_POINTS) {
    const hex = cp.toString(16).padStart(4, '0');
    cases.push({
      slug: `ws-${hex}`,
      raw: `<p>${base180}${String.fromCodePoint(cp)}final</p>`,
      expectedAfterSanitize: '2 min de leitura',
    });
  }

  for (const cp of NON_WHITESPACE_BOUNDARY_CODE_POINTS) {
    const hex = cp.toString(16).padStart(4, '0');
    cases.push({
      slug: `nonws-${hex}`,
      raw: `<p>${base180}${String.fromCodePoint(cp)}final</p>`,
      expectedAfterSanitize: '1 min de leitura',
    });
  }

  for (const item of cases) {
    const sanitized = sanitizeHtml(item.raw);
    await db.query(
      `insert into blog_posts (slug, title, excerpt, content, category, tags, status, published_at)
       values ($1, $2, $3, $4, $5, $6, 'published', now() - interval '1 minute')`,
      [item.slug, `Post ${item.slug}`, 'Resumo', sanitized, 'Blog', []],
    );
  }

  const summaryRes = await db.query(
    `select ${SUMMARY_COLUMNS} from blog_posts
     where status = 'published' and (published_at is null or published_at <= now())
     order by slug asc`,
  );
  const detailRes = await db.query(
    `select * from blog_posts
     where status = 'published' and (published_at is null or published_at <= now())
     order by slug asc`,
  );

  assert.equal(summaryRes.rows.length, cases.length);
  const expectedBySlug = new Map(cases.map((c) => [c.slug, c.expectedAfterSanitize]));

  for (let i = 0; i < cases.length; i++) {
    const summaryPost = rowToSummaryPost(summaryRes.rows[i]);
    const detailPost = rowToPost(detailRes.rows[i]);
    const clientDetailReadTime = estimateReadTime(detailPost.content);

    assert.equal('content' in summaryPost, false);
    assert.equal('word_count' in summaryPost, false);
    assert.equal(
      summaryPost.readTime,
      clientDetailReadTime,
      `divergência resumo vs detalhe em ${detailPost.slug}: resumo=${summaryPost.readTime} detalhe=${clientDetailReadTime}`,
    );
    assert.equal(summaryPost.readTime, expectedBySlug.get(detailPost.slug), `esperado incorreto em ${detailPost.slug}`);
  }
});

test('isSummaryQuery ativa apenas com summary=1 ou summary=true', () => {
  assert.equal(isSummaryQuery({}), false);
  assert.equal(isSummaryQuery({ summary: '0' }), false);
  assert.equal(isSummaryQuery({ summary: 'false' }), false);
  assert.equal(isSummaryQuery({ summary: '1' }), true);
  assert.equal(isSummaryQuery({ summary: 'true' }), true);
});

test('rotas públicas de leitura enviam Cache-Control: public, no-cache e usam SUMMARY_COLUMNS', async () => {
  const source = await readFile(new URL('../src/routes/posts.js', import.meta.url), 'utf8');
  const matches = source.match(/res\.set\('Cache-Control', 'public, no-cache'\)/g) || [];
  assert.equal(matches.length, 2, 'apenas GET / e GET /slug/:slug definem Cache-Control público');
  assert.match(source, /const columns = summary \? SUMMARY_COLUMNS : '\*'/);
  const adminSlice = source.slice(source.indexOf("router.get('/admin/all'"));
  assert.doesNotMatch(adminSlice, /Cache-Control.*public/);
});

test('fallbackTheme tem default dark (idêntico aos clientes existentes) e suporta light opt-in', () => {
  const darkCfg = normalizeSeoConfig({ siteUrl: 'https://exemplo.com.br' });
  const lightCfg = normalizeSeoConfig({ siteUrl: 'https://exemplo.com.br', fallbackTheme: 'light' });
  const invalidCfg = normalizeSeoConfig({ siteUrl: 'https://exemplo.com.br', fallbackTheme: 'neon' });

  assert.equal(darkCfg.fallbackTheme, 'dark');
  assert.equal(lightCfg.fallbackTheme, 'light');
  assert.equal(invalidCfg.fallbackTheme, 'dark');

  const post = {
    slug: 'artigo-um',
    title: 'Artigo um',
    excerpt: 'Resumo do artigo.',
    content: '<p>Corpo do artigo.</p>',
    status: 'published',
    publishedAt: '2026-09-01T12:00:00.000Z',
  };

  const darkPostHtml = buildPostHtml(TEMPLATE, darkCfg, post);
  const lightPostHtml = buildPostHtml(TEMPLATE, lightCfg, post);
  assert.match(darkPostHtml, /background:#0a0a0a;color:#f5f5f5/);
  assert.match(darkPostHtml, /color:#a8a8a8/);
  assert.match(lightPostHtml, /background:#ffffff;color:#1c1c1c/);
  assert.match(lightPostHtml, /color:#595959/);

  const darkIndexHtml = buildBlogIndexHtml(TEMPLATE, darkCfg, [post]);
  const lightIndexHtml = buildBlogIndexHtml(TEMPLATE, lightCfg, [post]);
  assert.match(darkPostHtml.slice(0, 10), /^<!doctype /);
  assert.match(darkIndexHtml, /background:#0a0a0a;color:#f5f5f5/);
  assert.match(lightIndexHtml, /background:#ffffff;color:#1c1c1c/);
});
