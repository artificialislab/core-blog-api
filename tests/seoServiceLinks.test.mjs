import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeSeoConfig, resetSeoConfigCache } from '../src/seo/config.js';
import { normalizeServiceLinks, selectServiceLinks } from '../src/seo/serviceLinks.js';
import { buildPostBody } from '../src/seo/render.js';
import { refreshSeoNow, resetSeoSignature, stopSeoRefreshLoop } from '../src/seo/refresh.js';

const link = (over = {}) => ({ label: 'Extração de siso em Itajaí', path: '/extracao-de-siso-itajai', keywords: ['siso'], ...over });
const rawConfig = (links = [link()]) => ({
  siteUrl: 'https://example.com', blog: { serviceLinks: links },
  staticRoutes: [{ loc: '/' }, { loc: '/blog' }, { loc: '/extracao-de-siso-itajai' }, { loc: '/ortognatica' }],
});
const post = (over = {}) => ({ slug: 'dor-no-siso', title: 'Dor no siso', content: '<p>Texto original.</p>', excerpt: 'Resumo.', publishedAt: '2026-09-01T10:00:00Z', status: 'published', ...over });

test('opt-in preserva artigos sem configuração e sem correspondência', () => {
  const config = normalizeSeoConfig(rawConfig([]));
  assert.deepEqual(config.blog.serviceLinks, []);
  assert.doesNotMatch(buildPostBody(config, post()), /Atendimento relacionado/);
  assert.doesNotMatch(buildPostBody(normalizeSeoConfig(rawConfig()), post({ slug: 'outra-duvida', title: 'Outra dúvida' })), /Atendimento relacionado/);
});

test('normaliza acentos, delimitadores e frases completas em metadados', () => {
  const config = normalizeSeoConfig(rawConfig([link({ path: '/ortognatica', keywords: ['cirurgia ortognática'] })]));
  for (const over of [{ title: 'Cirurgia ortognática dói?' }, { title: 'Pergunta', slug: 'cirurgia-ortognatica-doi' }, { title: 'Pergunta', slug: 'pergunta', category: 'CIRURGIA ORTOGNÁTICA' }]) {
    assert.equal(selectServiceLinks(config, post(over)).length, 1);
  }
  const siso = normalizeSeoConfig(rawConfig());
  assert.equal(selectServiceLinks(siso, post({ title: 'Sisos', slug: 'sisos', category: 'Outro' })).length, 0);
  assert.equal(selectServiceLinks(siso, post({ title: 'Outra', slug: 'outra', content: '<p>siso</p>', tags: ['siso'] })).length, 0);
  assert.equal(selectServiceLinks(config, post({ title: 'Cirurgia', slug: 'ortognatica' })).length, 0);
});

test('só aceita caminhos locais estáticos exatos; nunca URL externa ou traversal', () => {
  for (const path of ['https://evil.test/x', '//evil.test/x', '/x//y', '/x/../y', '/%2e%2e/x', '/siso?x=1', '/siso#x', '/siso\\x', '/', '/siso/']) {
    assert.deepEqual(normalizeServiceLinks([link({ path })], [{ loc: path }]), [], path);
  }
  assert.deepEqual(normalizeServiceLinks([link({ path: '/unlisted' })], [{ loc: '/' }]), []);
  assert.equal(normalizeServiceLinks([link()], ['/extracao-de-siso-itajai']).length, 1);
});

test('limita configuração, remove entrada inválida e deduplica destinos', () => {
  assert.deepEqual(normalizeServiceLinks([null, link({ label: '' }), link({ label: 'x'.repeat(101) }), link({ keywords: ['a', null, '<>'] })], rawConfig().staticRoutes), []);
  assert.equal(normalizeServiceLinks([link(), link({ label: 'Duplicado' })], rawConfig().staticRoutes).length, 1);
  const links = Array.from({ length: 35 }, (_, i) => link({ path: `/servico-${i}`, keywords: ['siso'] }));
  const config = normalizeSeoConfig({ ...rawConfig(links), staticRoutes: links.map(({ path }) => ({ loc: path })) });
  assert.equal(config.blog.serviceLinks.length, 30);
  assert.deepEqual(selectServiceLinks(config, post()).map((l) => l.path), ['/servico-0', '/servico-1', '/servico-2']);
});

test('renderiza navegação escapada sem alterar o corpo clínico', () => {
  const config = normalizeSeoConfig(rawConfig([link({ label: 'Siso <script> & "teste"' })]));
  const html = buildPostBody(config, post());
  assert.match(html, /<h2[^>]*>Atendimento relacionado<\/h2>/);
  assert.match(html, /href="\/extracao-de-siso-itajai"/);
  assert.match(html, /Siso &lt;script&gt; &amp; &quot;teste&quot;/);
  assert.match(html, /<p>Texto original\.<\/p>/);
  assert.doesNotMatch(html, /indicado para voc/);
});

test('refresh e republicação preservam links opt-in no HTML entregue', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'seo-service-links-'));
  const previous = process.env.SEO_SITE_DIR;
  try {
    await writeFile(join(dir, 'index.html'), '<!doctype html><html><head><title>Site</title></head><body><div id="root"></div></body></html>');
    await writeFile(join(dir, 'seo.config.json'), JSON.stringify(rawConfig()));
    await mkdir(join(dir, 'extracao-de-siso-itajai'));
    await writeFile(join(dir, 'extracao-de-siso-itajai/index.html'), '<h1>Siso</h1>');
    process.env.SEO_SITE_DIR = dir;
    resetSeoConfigCache(); resetSeoSignature();
    await refreshSeoNow('service-links-first', { loadPosts: async () => [post()] });
    let html = await readFile(join(dir, 'blog/dor-no-siso/index.html'), 'utf8');
    assert.match(html, /Atendimento relacionado/);
    resetSeoSignature();
    await refreshSeoNow('service-links-update', { loadPosts: async () => [post({ content: '<p>Texto atualizado.</p>', updatedAt: '2026-09-02T10:00:00Z' })] });
    html = await readFile(join(dir, 'blog/dor-no-siso/index.html'), 'utf8');
    assert.match(html, /Texto atualizado/);
    assert.match(html, /href="\/extracao-de-siso-itajai"/);
  } finally {
    if (previous === undefined) delete process.env.SEO_SITE_DIR; else process.env.SEO_SITE_DIR = previous;
    stopSeoRefreshLoop(); resetSeoConfigCache(); resetSeoSignature();
    await rm(dir, { recursive: true, force: true });
  }
});
