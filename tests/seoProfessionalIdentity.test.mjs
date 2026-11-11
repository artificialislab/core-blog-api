import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeSeoConfig, resetSeoConfigCache } from '../src/seo/config.js';
import { buildBlogIndexHtml, buildPostHtml } from '../src/seo/render.js';
import { refreshSeoNow, resetSeoSignature, stopSeoRefreshLoop } from '../src/seo/refresh.js';

// Identidade e artigo fictícios; nenhuma conta, API remota ou banco.
const identity = { name: 'Dra. Teste Local', profession: 'Cirurgiã-dentista', registration: 'CRO-FICTICIO 000' };
const raw = { siteUrl: 'https://fixture.invalid', brandName: 'Clínica fictícia', blog: { title: 'Blog de teste' }, staticRoutes: ['/', '/blog'] };
const post = { slug: 'edicao-local', title: 'Artigo fictício', excerpt: 'Resumo fictício.', content: '<p>Versão inicial.</p>', status: 'published', publishedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', tags: [], seo: {} };
const template = '<html><head><title>Fixture</title></head><body><div id="root"><p>Identificação antiga</p></div><script src="/fixture.js"></script></body></html>';
const marker = /<p data-professional-identity="true">[\s\S]*?<\/p>/g;

test('identificação é opt-in, completa e não inferida da marca', () => {
  for (const value of [undefined, null, '', [], {}, { ...identity, registration: '' }, { ...identity, profession: 123 }]) {
    const config = normalizeSeoConfig({ ...raw, professionalIdentity: value });
    assert.equal(config.professionalIdentity, null);
    assert.doesNotMatch(buildPostHtml(template, config, post), marker);
    assert.doesNotMatch(buildBlogIndexHtml(template, config, [post]), marker);
  }
  assert.deepEqual(normalizeSeoConfig({ ...raw, professionalIdentity: { ...identity, name: '  Dra. Teste Local  ', ignored: true } }).professionalIdentity, identity);
});

test('novo parágrafo é a única diferença no artigo/listagem quando opt-in é ativado', () => {
  const off = normalizeSeoConfig(raw);
  const on = normalizeSeoConfig({ ...raw, professionalIdentity: identity });
  for (const render of [(c) => buildPostHtml(template, c, post), (c) => buildBlogIndexHtml(template, c, [post])]) {
    const before = render(off);
    const afterHtml = render(on);
    assert.equal([...afterHtml.matchAll(marker)].length, 1);
    assert.ok(afterHtml.includes('Dra. Teste Local · Cirurgiã-dentista · CRO-FICTICIO 000'));
    assert.equal(afterHtml.replace(/<p data-professional-identity="true">[\s\S]*?<\/p>\n\s*/g, ''), before);
  }
});

test('identificação é texto escapado; corpo continua com o sanitizador real', () => {
  const config = normalizeSeoConfig({ ...raw, professionalIdentity: { ...identity, name: '<img src=x onerror=alert(1)> & "Teste"' } });
  const html = buildPostHtml(template, config, { ...post, content: '<p>Seguro</p><script>alert(1)</script>' });
  const paragraph = html.match(marker)[0];
  assert.ok(paragraph.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Teste&quot;'));
  assert.doesNotMatch(paragraph, /<img/);
  assert.ok(html.includes('<p>Seguro</p>'));
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test('edição e regeneração em disco mantêm identidade, sem contaminar outro site', async () => {
  const savedDir = process.env.SEO_SITE_DIR;
  const savedEnabled = process.env.SEO_ENABLED;
  const dir = await mkdtemp(join(tmpdir(), 'seo-identity-fixture-'));
  try {
    process.env.SEO_SITE_DIR = dir;
    delete process.env.SEO_ENABLED;
    await writeFile(join(dir, 'index.html'), template);
    await writeFile(join(dir, 'seo.config.json'), JSON.stringify({ ...raw, professionalIdentity: identity }));
    resetSeoConfigCache(); resetSeoSignature();
    await refreshSeoNow('initial-fixture', { loadPosts: async () => [post] });
    const edited = { ...post, excerpt: 'Resumo editado.', content: '<p>Versão editada.</p>', updatedAt: '2026-01-02T00:00:00Z' };
    await refreshSeoNow('edited-fixture', { loadPosts: async () => [edited] });
    const article = await readFile(join(dir, 'blog/edicao-local/index.html'), 'utf8');
    const list = await readFile(join(dir, 'blog/index.html'), 'utf8');
    for (const html of [article, list]) {
      assert.equal([...html.matchAll(marker)].length, 1);
      assert.ok(html.includes('Dra. Teste Local · Cirurgiã-dentista · CRO-FICTICIO 000'));
      assert.ok(html.includes('Resumo editado.'));
    }
    assert.ok(article.includes('<p>Versão editada.</p>'));
    assert.ok(article.includes('2026-01-01T00:00:00Z'));
    const embedded = JSON.parse(article.match(/id="__artificialis_post__">(.*?)<\/script>/s)[1]);
    assert.deepEqual(embedded, edited);

    const other = join(dir, 'other-site');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(other);
    await writeFile(join(other, 'index.html'), template);
    await writeFile(join(other, 'seo.config.json'), JSON.stringify({ ...raw, siteUrl: 'https://other-fixture.invalid' }));
    process.env.SEO_SITE_DIR = other;
    // Mesmo processo e cache anterior: a configuração de um site não vaza.
    await refreshSeoNow('other-site', { loadPosts: async () => [edited] });
    for (const path of ['blog/index.html', 'blog/edicao-local/index.html']) {
      const html = await readFile(join(other, path), 'utf8');
      assert.doesNotMatch(html, marker);
      assert.ok(!html.includes(identity.name));
    }
  } finally {
    if (savedDir === undefined) delete process.env.SEO_SITE_DIR; else process.env.SEO_SITE_DIR = savedDir;
    if (savedEnabled === undefined) delete process.env.SEO_ENABLED; else process.env.SEO_ENABLED = savedEnabled;
    resetSeoConfigCache(); resetSeoSignature(); stopSeoRefreshLoop();
    await rm(dir, { recursive: true, force: true });
  }
});

after(() => stopSeoRefreshLoop());
