import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeSeoConfig } from '../src/seo/config.js';
import {
  buildBlogIndexHtml,
  buildLlms,
  buildPostHtml,
  buildSitemap,
  isPublicPostReady,
  replaceRootContent,
  selectPublicPosts,
} from '../src/seo/render.js';

const TEMPLATE = `<!doctype html>
<html lang="pt-BR">
  <head>
    <title>Site</title>
    <meta name="description" content="home" />
    <link rel="canonical" href="https://exemplo.com.br/" />
  </head>
  <body>
    <div id="root"><div class="skeleton"><h1>Site</h1></div></div>
    <script type="module" src="/assets/index.js"></script>
  </body>
</html>`;

const CONFIG = normalizeSeoConfig({
  siteUrl: 'https://exemplo.com.br',
  brandName: 'Marca',
  defaultImage: 'https://exemplo.com.br/og.jpg',
  titleSuffix: '| Marca',
  schemaIds: { author: 'https://exemplo.com.br/#person', publisher: 'https://exemplo.com.br/#org' },
  blog: { path: '/blog', title: 'Blog da Marca', metaTitle: 'Blog | Marca', description: 'Artigos.' },
  staticRoutes: [
    { loc: '/', changefreq: 'monthly', priority: '1.0' },
    { loc: '/blog', changefreq: 'daily', priority: '0.8' },
  ],
  llms: { tagline: 'Tudo sobre a marca.', sections: [{ heading: 'Páginas', items: [{ label: 'Início', url: '/' }] }] },
});

const post = (over = {}) => ({
  slug: 'artigo-um',
  title: 'Artigo um',
  excerpt: 'Resumo do artigo um.',
  content: '<p>Corpo do artigo com texto suficiente.</p>',
  status: 'published',
  publishedAt: '2026-01-10T12:00:00.000Z',
  updatedAt: '2026-02-02T12:00:00.000Z',
  createdAt: '2026-01-01T12:00:00.000Z',
  tags: [],
  seo: {},
  ...over,
});

test('isPublicPostReady rejeita o que nao pode virar pagina', () => {
  assert.equal(isPublicPostReady(post()), true);
  assert.equal(isPublicPostReady(post({ status: 'draft' })), false, 'rascunho');
  assert.equal(isPublicPostReady(post({ publishedAt: '2099-01-01T00:00:00.000Z' })), false, 'data futura');
  assert.equal(isPublicPostReady(post({ slug: 'Slug Invalido' })), false, 'slug invalido');
  assert.equal(isPublicPostReady(post({ excerpt: '   ' })), false, 'sem excerpt');
  assert.equal(isPublicPostReady(post({ content: '<p>  </p>' })), false, 'sem conteudo');
});

test('sitemap inclui rotas estaticas e todos os posts publicos, ordenados e sem duplicata', () => {
  const xml = buildSitemap(CONFIG, [post(), post({ slug: 'artigo-dois' }), post({ status: 'draft', slug: 'oculto' })]);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  assert.deepEqual(locs, [
    'https://exemplo.com.br/',
    'https://exemplo.com.br/blog',
    'https://exemplo.com.br/blog/artigo-dois',
    'https://exemplo.com.br/blog/artigo-um',
  ]);
  assert.ok(!xml.includes('oculto'), 'rascunho nao entra no sitemap');
  assert.ok(xml.includes('<lastmod>2026-02-02</lastmod>'), 'usa updatedAt como lastmod');
});

test('sitemap deduplica rotas estaticas repetidas', () => {
  const config = normalizeSeoConfig({ ...JSON.parse(JSON.stringify(CONFIG)), staticRoutes: [{ loc: '/' }, { loc: '/' }] });
  assert.equal([...buildSitemap(config, []).matchAll(/<loc>/g)].length, 1);
});

test('replaceRootContent respeita divs aninhadas e preserva os scripts', () => {
  const out = replaceRootContent(TEMPLATE, '<main><div><div>ok</div></div></main>');
  assert.ok(out.includes('<div id="root"><main><div><div>ok</div></div></main></div>'));
  assert.ok(out.includes('<script type="module" src="/assets/index.js"></script>'));
  assert.ok(!out.includes('skeleton'));
});

test('pagina do artigo tem title, canonical, description e o TEXTO no HTML inicial', () => {
  const html = buildPostHtml(TEMPLATE, CONFIG, post());

  assert.match(html, /<title>Artigo um \| Marca<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/exemplo\.com\.br\/blog\/artigo-um" \/>/);
  assert.match(html, /<meta name="description" content="Resumo do artigo um\." \/>/);
  assert.match(html, /<meta property="og:type" content="article" \/>/);
  assert.match(html, /<meta property="article:published_time"/);
  assert.ok(html.includes('Corpo do artigo com texto suficiente.'), 'conteudo do artigo vai no HTML');
  assert.ok(!html.split('<body')[1].includes('canonical'), 'nada de meta vazando pro body');

  const ld = JSON.parse(html.match(/data-route="[^"]*">(.*?)<\/script>/s)[1].replace(/\\u003c/g, '<'));
  assert.equal(ld[0]['@type'], 'BlogPosting');
  assert.equal(ld[0].url, 'https://exemplo.com.br/blog/artigo-um');
  assert.equal(ld[1]['@type'], 'BreadcrumbList');
});

test('titulo longo nao recebe sufixo de marca', () => {
  const longTitle = 'Um titulo bem comprido que passa do limite configurado para o sufixo';
  assert.ok(buildPostHtml(TEMPLATE, CONFIG, post({ title: longTitle })).includes(`<title>${longTitle}</title>`));
});

test('seo.metaTitle e seo.metaDescription do painel tem precedencia', () => {
  const html = buildPostHtml(TEMPLATE, CONFIG, post({ seo: { metaTitle: 'Titulo manual', metaDescription: 'Descricao manual' } }));
  assert.match(html, /<title>Titulo manual<\/title>/);
  assert.match(html, /<meta name="description" content="Descricao manual" \/>/);
});

test('listagem /blog entrega links reais para cada artigo', () => {
  const posts = [post(), post({ slug: 'artigo-dois', title: 'Artigo dois' })];
  const html = buildBlogIndexHtml(TEMPLATE, CONFIG, posts);
  const hrefs = [...html.matchAll(/href="(\/blog\/[a-z0-9-]+)"/g)].map((m) => m[1]);

  assert.deepEqual(new Set(hrefs), new Set(['/blog/artigo-um', '/blog/artigo-dois']));
  assert.match(html, /<link rel="canonical" href="https:\/\/exemplo\.com\.br\/blog" \/>/);
});

test('llms.txt lista secoes do config e todos os artigos', () => {
  const txt = buildLlms(CONFIG, [post(), post({ slug: 'artigo-dois', title: 'Artigo dois' })]);
  assert.ok(txt.startsWith('# Marca'));
  assert.ok(txt.includes('> Tudo sobre a marca.'));
  assert.ok(txt.includes('- [Início](https://exemplo.com.br/)'));
  assert.ok(txt.includes('- [Artigo um](https://exemplo.com.br/blog/artigo-um)'));
  assert.ok(txt.includes('- [Artigo dois](https://exemplo.com.br/blog/artigo-dois)'));
});

test('escapa caracteres perigosos vindos do painel', () => {
  const html = buildPostHtml(TEMPLATE, CONFIG, post({ title: 'Aspas " e <tag>', excerpt: 'a & b' }));
  assert.ok(html.includes('<title>Aspas &quot; e &lt;tag&gt; | Marca</title>'));
  assert.ok(html.includes('content="a &amp; b"'));

  const xml = buildSitemap(CONFIG, []);
  assert.ok(!xml.includes('&&'));
});

test('normalizeSeoConfig recusa config invalido', () => {
  assert.throws(() => normalizeSeoConfig({ siteUrl: 'nao-e-url' }), /siteUrl/);
  assert.throws(() => normalizeSeoConfig({ siteUrl: 'https://x.com', blog: { path: '../etc' } }), /blog\.path/);
  assert.throws(() => normalizeSeoConfig(null), /objeto/);
});

test('selectPublicPosts e o mesmo filtro usado em toda a geracao', () => {
  const posts = [post(), post({ slug: 'x', status: 'draft' })];
  assert.equal(selectPublicPosts(posts).length, 1);
  const locs = [...buildSitemap(CONFIG, posts).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs.filter((loc) => loc.includes('/blog/')), ['https://exemplo.com.br/blog/artigo-um']);
});


test('runtime preserva o payload usado pelos clientes sem rede e remove HTML executável', () => {
  const article = post({ title: 'Texto </script><script>alert(1)</script>', content: '<p>Texto público</p><img src="/cover.jpg" onerror="alert(1)"><script>alert(1)</script>' });
  const html = buildPostHtml(TEMPLATE, CONFIG, article);
  const raw = html.match(/<script type="application\/json" id="__artificialis_post__">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(raw, 'payload obrigatório para não voltar ao skeleton depois do runtime');
  const embedded = JSON.parse(raw);
  assert.equal(embedded.slug, article.slug);
  assert.match(embedded.content, /Texto público/);
  assert.doesNotMatch(embedded.content, /onerror|<script/);
  assert.doesNotMatch(raw, /<\/script>/);
  assert.doesNotMatch(html, /<script>alert/);
});
