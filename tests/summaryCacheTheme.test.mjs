import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { estimateReadTime, rowToPost, rowToSummaryPost } from '../src/postShape.js';
import { isSummaryQuery } from '../src/http.js';
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

test('rowToSummaryPost omite content e preserva readTime idêntico ao corpo integral (por word_count ou fallback)', () => {
  const full = rowToPost(BASE_ROW);
  const summaryFromContent = rowToSummaryPost(BASE_ROW);
  const { content: _omitted, ...sqlProjectedRow } = { ...BASE_ROW, word_count: 360 };
  const summaryFromSqlCount = rowToSummaryPost(sqlProjectedRow);

  assert.equal('content' in full, true);
  assert.equal('content' in summaryFromContent, false);
  assert.equal('content' in summaryFromSqlCount, false);
  assert.equal(estimateReadTime(full.content), '2 min de leitura');
  assert.equal(summaryFromContent.readTime, '2 min de leitura');
  assert.equal(summaryFromSqlCount.readTime, '2 min de leitura');

  const { content: _ignored, ...expectedBase } = full;
  assert.deepEqual(summaryFromContent, { ...expectedBase, readTime: '2 min de leitura' });
  assert.deepEqual(summaryFromSqlCount, { ...expectedBase, readTime: '2 min de leitura' });
  assert.equal(estimateReadTime(0), '1 min de leitura');
  assert.equal(estimateReadTime(181), '2 min de leitura');
  assert.equal(rowToSummaryPost(null), null);
});

test('isSummaryQuery ativa apenas com summary=1 ou summary=true', () => {
  assert.equal(isSummaryQuery({}), false);
  assert.equal(isSummaryQuery({ summary: '0' }), false);
  assert.equal(isSummaryQuery({ summary: 'false' }), false);
  assert.equal(isSummaryQuery({ summary: '1' }), true);
  assert.equal(isSummaryQuery({ summary: 'true' }), true);
});

test('rotas públicas de leitura enviam Cache-Control: public, no-cache e projetam word_count sem content', async () => {
  const source = await readFile(new URL('../src/routes/posts.js', import.meta.url), 'utf8');
  const matches = source.match(/res\.set\('Cache-Control', 'public, no-cache'\)/g) || [];
  assert.equal(matches.length, 2, 'apenas GET / e GET /slug/:slug definem Cache-Control público');
  assert.match(source, /as word_count/);
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
  assert.match(darkIndexHtml, /background:#0a0a0a;color:#f5f5f5/);
  assert.match(lightIndexHtml, /background:#ffffff;color:#1c1c1c/);
});
