import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

// Sem import de db.js aqui: refresh.js carrega o driver do Postgres sob
// demanda, e este teste injeta os posts — nada toca o banco.
import { resetSeoConfigCache } from '../src/seo/config.js';
import { refreshSeoNow, resetSeoSignature, stopSeoRefreshLoop } from '../src/seo/refresh.js';

const TEMPLATE = `<!doctype html>
<html lang="pt-BR">
  <head>
    <title>Site</title>
    <meta name="description" content="home" />
    <link rel="canonical" href="https://exemplo.com.br/" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/index.js"></script>
  </body>
</html>`;

const CONFIG = {
  version: 1,
  siteUrl: 'https://exemplo.com.br',
  brandName: 'Marca',
  blog: { path: '/blog', title: 'Blog da Marca', description: 'Artigos.' },
  staticRoutes: [{ loc: '/', priority: '1.0' }, { loc: '/blog', priority: '0.8' }],
  llms: { tagline: 'Tudo sobre a marca.' },
};

const post = (slug, over = {}) => ({
  slug,
  title: `Artigo ${slug}`,
  excerpt: `Resumo de ${slug}.`,
  content: `<p>Conteudo de ${slug}.</p>`,
  status: 'published',
  publishedAt: '2026-01-10T12:00:00.000Z',
  updatedAt: '2026-01-10T12:00:00.000Z',
  createdAt: '2026-01-10T12:00:00.000Z',
  tags: [],
  seo: {},
  ...over,
});

const exists = (path) => access(path).then(() => true, () => false);

async function makeSite({ withConfig = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'seo-site-'));
  await writeFile(join(dir, 'index.html'), TEMPLATE);
  if (withConfig) await writeFile(join(dir, 'seo.config.json'), JSON.stringify(CONFIG));
  process.env.SEO_SITE_DIR = dir;
  delete process.env.SEO_ENABLED;
  resetSeoConfigCache();
  resetSeoSignature();
  return dir;
}

after(() => stopSeoRefreshLoop());

test('escreve sitemap, llms, listagem e um HTML por artigo no diretorio do nginx', async () => {
  const dir = await makeSite();
  const posts = [post('artigo-um'), post('artigo-dois')];

  const result = await refreshSeoNow('test', { loadPosts: async () => posts });

  assert.equal(result.posts, 2);
  assert.equal(result.urls, 4); // 2 rotas estaticas + 2 artigos

  const sitemap = await readFile(join(dir, 'sitemap.xml'), 'utf8');
  assert.ok(sitemap.includes('https://exemplo.com.br/blog/artigo-um'));
  assert.ok(sitemap.includes('https://exemplo.com.br/blog/artigo-dois'));

  const artigo = await readFile(join(dir, 'blog/artigo-um/index.html'), 'utf8');
  assert.match(artigo, /<link rel="canonical" href="https:\/\/exemplo\.com\.br\/blog\/artigo-um" \/>/);
  assert.ok(artigo.includes('Conteudo de artigo-um.'));

  const listagem = await readFile(join(dir, 'blog/index.html'), 'utf8');
  assert.ok(listagem.includes('href="/blog/artigo-um"'));
  assert.ok(listagem.includes('href="/blog/artigo-dois"'));

  const llms = await readFile(join(dir, 'llms.txt'), 'utf8');
  assert.ok(llms.includes('/blog/artigo-um'));

  const manifest = JSON.parse(await readFile(join(dir, '.seo-manifest.json'), 'utf8'));
  assert.deepEqual(new Set(manifest.slugs), new Set(['artigo-um', 'artigo-dois']));
});

test('artigo despublicado tem a pasta removida — a URL nao pode continuar respondendo 200', async () => {
  const dir = await makeSite();
  await refreshSeoNow('test', { loadPosts: async () => [post('fica'), post('sai')] });
  assert.equal(await exists(join(dir, 'blog/sai/index.html')), true);

  resetSeoSignature();
  const result = await refreshSeoNow('test', { loadPosts: async () => [post('fica')] });

  assert.equal(result.removed, 1);
  assert.equal(await exists(join(dir, 'blog/sai')), false);
  assert.equal(await exists(join(dir, 'blog/fica/index.html')), true);
  assert.ok(!(await readFile(join(dir, 'sitemap.xml'), 'utf8')).includes('/blog/sai'));
});

test('nao apaga nada que nao esteja no manifest anterior', async () => {
  const dir = await makeSite();
  await mkdir(join(dir, 'blog/pagina-a-mao'), { recursive: true });
  await writeFile(join(dir, 'blog/pagina-a-mao/index.html'), 'feito por fora');

  await refreshSeoNow('test', { loadPosts: async () => [post('artigo-um')] });

  assert.equal(await exists(join(dir, 'blog/pagina-a-mao/index.html')), true);
});

test('sem seo.config.json a geracao fica desligada e nao escreve nada', async () => {
  const dir = await makeSite({ withConfig: false });
  const result = await refreshSeoNow('test', { loadPosts: async () => [post('artigo-um')] });

  assert.deepEqual(result, { skipped: 'sem seo.config.json' });
  assert.equal(await exists(join(dir, 'sitemap.xml')), false);
});

test('SEO_ENABLED=false desliga mesmo com config presente', async () => {
  const dir = await makeSite();
  process.env.SEO_ENABLED = 'false';
  const result = await refreshSeoNow('test', { loadPosts: async () => [post('artigo-um')] });

  assert.deepEqual(result, { skipped: 'disabled' });
  assert.equal(await exists(join(dir, 'sitemap.xml')), false);
  delete process.env.SEO_ENABLED;
});

test('varredura periodica nao reescreve quando nada mudou', async () => {
  await makeSite();
  const posts = [post('artigo-um')];
  await refreshSeoNow('interval', { loadPosts: async () => posts });

  const again = await refreshSeoNow('interval', { loadPosts: async () => posts });
  assert.deepEqual(again, { skipped: 'sem mudanças' });
});

test('post agendado para o futuro nao vaza para o sitemap', async () => {
  const dir = await makeSite();
  await refreshSeoNow('test', {
    loadPosts: async () => [post('agora'), post('depois', { publishedAt: '2099-01-01T00:00:00.000Z' })],
  });

  const sitemap = await readFile(join(dir, 'sitemap.xml'), 'utf8');
  assert.ok(sitemap.includes('/blog/agora'));
  assert.ok(!sitemap.includes('/blog/depois'));
  assert.equal(await exists(join(dir, 'blog/depois')), false);
});

// ─── Travas contra regressao ───────────────────────────────────────────────
//
// O modo de falha que importa aqui nao e "o sitemap saiu errado", e "o site
// perdeu o blog". Estes testes cobrem os caminhos em que a API prefere nao
// escrever a escrever coisa errada.

test('lista de posts vazia nao reescreve nada — sitemap existente e preservado', async () => {
  const dir = await makeSite();
  await refreshSeoNow('test', { loadPosts: async () => [post('artigo-um')] });
  const antes = await readFile(join(dir, 'sitemap.xml'), 'utf8');

  resetSeoSignature();
  const result = await refreshSeoNow('test', { loadPosts: async () => [] });

  assert.deepEqual(result, { skipped: 'nenhum post publicado' });
  assert.equal(await readFile(join(dir, 'sitemap.xml'), 'utf8'), antes, 'sitemap intacto');
  assert.equal(await exists(join(dir, 'blog/artigo-um/index.html')), true, 'artigo intacto');
});

test('remocao em massa e bloqueada: reescreve os arquivos mas nao apaga pasta nenhuma', async () => {
  const dir = await makeSite();
  const dez = Array.from({ length: 10 }, (_, i) => post(`artigo-${i}`));
  await refreshSeoNow('test', { loadPosts: async () => dez });

  resetSeoSignature();
  const result = await refreshSeoNow('test', { loadPosts: async () => dez.slice(0, 2) });

  assert.equal(result.pruneBlocked, true);
  assert.equal(result.removed, 0);
  for (let i = 2; i < 10; i++) {
    assert.equal(await exists(join(dir, `blog/artigo-${i}/index.html`)), true, `artigo-${i} preservado`);
  }
  // O sitemap ja reflete a verdade, entao o Google para de indexar os que
  // sairam mesmo com os arquivos ainda no disco.
  const sitemap = await readFile(join(dir, 'sitemap.xml'), 'utf8');
  assert.ok(!sitemap.includes('/blog/artigo-9'));
});

test('guarda uma copia dos arquivos do build antes da primeira escrita', async () => {
  const dir = await makeSite();
  await writeFile(join(dir, 'sitemap.xml'), '<urlset>original do build</urlset>');

  await refreshSeoNow('test', { loadPosts: async () => [post('artigo-um')] });

  const backup = await readFile(join(dir, '.seo-backup/sitemap.xml'), 'utf8');
  assert.equal(backup, '<urlset>original do build</urlset>');

  // Segunda passada nao sobrescreve o backup com o ja-gerado.
  resetSeoSignature();
  await refreshSeoNow('test', { loadPosts: async () => [post('artigo-um'), post('artigo-dois')] });
  assert.equal(await readFile(join(dir, '.seo-backup/sitemap.xml'), 'utf8'), '<urlset>original do build</urlset>');
});

test('a poda nunca alcanca caminho fora de <site>/blog/', async () => {
  const dir = await makeSite();
  await refreshSeoNow('test', { loadPosts: async () => [post('artigo-um')] });

  // Manifest adulterado com travessia de caminho.
  await writeFile(
    join(dir, '.seo-manifest.json'),
    JSON.stringify({ slugs: ['artigo-um', '../../etc', '..', 'valido-que-saiu'] }),
  );
  await writeFile(join(dir, 'index-sentinela.html'), 'nao me apague');

  resetSeoSignature();
  await refreshSeoNow('test', { loadPosts: async () => [post('artigo-um')] });

  assert.equal(await exists(join(dir, 'index.html')), true);
  assert.equal(await exists(join(dir, 'index-sentinela.html')), true);
});
