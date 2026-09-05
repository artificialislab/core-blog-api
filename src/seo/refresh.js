/**
 * Regeneração dos artefatos de SEO do blog, em runtime.
 *
 * Escreve dentro do diretório que o nginx do tenant serve (SEO_SITE_DIR,
 * montado no container como o mesmo volume `landing-site`):
 *
 *   sitemap.xml           — rotas estáticas do config + todos os posts públicos
 *   llms.txt              — mesmo conteúdo, formato para LLMs
 *   blog/index.html       — listagem com <a href> reais para cada artigo
 *   blog/<slug>/index.html— artigo com title, description, canonical e TEXTO
 *
 * Disparado em três momentos:
 *   1. startup do container (garante consistência após qualquer deploy)
 *   2. toda mutação de post (criar/editar/apagar/publicar) — com debounce
 *   3. a cada SEO_REFRESH_INTERVAL_MS (posts agendados que venceram)
 *
 * Falha aqui NUNCA derruba a API: erro é logado e a request do painel segue.
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { rowToPost } from '../postShape.js';
import { getSiteDir, isSeoEnabled, loadSeoConfig } from './config.js';
import {
  buildBlogIndexHtml,
  buildLlms,
  buildPostHtml,
  buildSitemap,
  countSitemapEntries,
  selectPublicPosts,
} from './render.js';

const MANIFEST_FILENAME = '.seo-manifest.json';
const DEBOUNCE_MS = Number(process.env.SEO_REFRESH_DEBOUNCE_MS || 3_000);
const INTERVAL_MS = Number(process.env.SEO_REFRESH_INTERVAL_MS || 5 * 60 * 1_000);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Fracao dos artigos conhecidos que uma unica passada pode remover. Acima
// disso o mais provavel e defeito (banco errado, query capada, migracao pela
// metade) do que despublicacao em massa deliberada — entao escreve os
// arquivos e NAO apaga nada, deixando o rastro no log.
const PRUNE_MAX_RATIO = Number(process.env.SEO_PRUNE_MAX_RATIO || 0.34);
const BACKUP_DIRNAME = '.seo-backup';

const log = (...args) => console.log('[seo]', ...args);
const warn = (...args) => console.warn('[seo]', ...args);

let running = false;
let pendingReason = null;
let debounceTimer = null;
let intervalTimer = null;
let lastSignature = null;

// ─── IO ────────────────────────────────────────────────────────────────────

/**
 * Escrita atômica: grava num `.tmp` no mesmo diretório e renomeia. Evita que
 * o nginx sirva um sitemap.xml truncado se o processo morrer no meio.
 */
async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}

async function readManifest(siteDir) {
  try {
    const parsed = JSON.parse(await readFile(join(siteDir, MANIFEST_FILENAME), 'utf8'));
    return Array.isArray(parsed?.slugs) ? parsed.slugs : [];
  } catch {
    return [];
  }
}

/**
 * Remove diretórios de artigos que saíram do ar (despublicados/apagados).
 * Sem isso a URL continuaria respondendo 200 com o artigo antigo.
 *
 * Só apaga caminhos que: têm slug válido, estão sob <siteDir>/<blogPath>/ e
 * foram criados por nós (constam no manifest anterior).
 */
async function pruneRemovedPosts(siteDir, blogPath, previousSlugs, currentSlugs) {
  const current = new Set(currentSlugs);
  const stale = previousSlugs.filter((slug) => SLUG_RE.test(slug) && !current.has(slug));
  if (!stale.length) return { removed: [], blocked: false };

  const ceiling = Math.max(3, Math.ceil(previousSlugs.length * PRUNE_MAX_RATIO));
  if (stale.length > ceiling) {
    warn(
      `remocao de ${stale.length} de ${previousSlugs.length} artigos parece anormal (teto ${ceiling}) — ` +
      'arquivos reescritos, NENHUMA pasta apagada. Se a despublicacao foi intencional, revise os slugs ' +
      'ou suba SEO_PRUNE_MAX_RATIO.',
    );
    return { removed: [], blocked: true };
  }

  const blogRoot = resolve(siteDir, blogPath.replace(/^\//, ''));
  const removed = [];
  for (const slug of stale) {
    const target = resolve(blogRoot, slug);
    // Defesa em profundidade: so apaga estritamente dentro de <site>/<blog>/.
    if (target !== blogRoot && target.startsWith(blogRoot + sep)) {
      await rm(target, { recursive: true, force: true });
      removed.push(slug);
    }
  }
  return { removed, blocked: false };
}

/**
 * Copia, UMA unica vez por diretorio, os arquivos que o build gerou antes de
 * a API assumir a escrita. Rollback trivial se algo sair errado na estreia.
 */
async function backupOriginalsOnce(siteDir, blogPath) {
  const backupDir = join(siteDir, BACKUP_DIRNAME);
  try {
    await stat(backupDir);
    return false; // ja existe: a estreia ja aconteceu
  } catch { /* primeira vez */ }

  await mkdir(backupDir, { recursive: true });
  for (const rel of ['sitemap.xml', 'llms.txt', `${blogPath.replace(/^\//, '')}/index.html`]) {
    try {
      await writeFile(join(backupDir, rel.replace(/\//g, '_')), await readFile(resolve(siteDir, rel), 'utf8'), 'utf8');
    } catch { /* arquivo nao existia — nada a guardar */ }
  }
  log(`copia dos arquivos originais em ${BACKUP_DIRNAME}/ antes da primeira escrita`);
  return true;
}

// ─── Núcleo ────────────────────────────────────────────────────────────────

async function fetchPublishedPosts() {
  // Import tardio de propósito: mantém o módulo de SEO livre do driver do
  // Postgres no grafo de imports, então render/refresh podem ser testados
  // sem DATABASE_URL nem `pg` instalado.
  const { q } = await import('../db.js');
  const rows = await q(
    `select * from blog_posts
     where status = 'published'
       and (published_at is null or published_at <= now())
     order by coalesce(published_at, updated_at) desc`,
  );
  return rows.map(rowToPost);
}

/**
 * Assinatura barata do estado publicado. Se nada mudou desde o último ciclo,
 * o refresh periódico não reescreve dezenas de arquivos à toa.
 */
const signatureOf = (posts) =>
  posts.map((p) => `${p.slug}:${p.updatedAt}:${p.publishedAt || ''}`).sort().join('|');

/**
 * @param {string} reason
 * @param {{ loadPosts?: () => Promise<object[]> }} [deps] injeção usada pelos
 *   testes para exercitar a escrita em disco sem precisar de Postgres.
 */
export async function refreshSeoNow(reason = 'manual', deps = {}) {
  if (!isSeoEnabled()) return { skipped: 'disabled' };

  const siteDir = getSiteDir();
  const config = await loadSeoConfig();
  if (!config) return { skipped: 'sem seo.config.json' };

  const templatePath = resolve(siteDir, 'index.html');
  const template = await readFile(templatePath, 'utf8');
  const posts = selectPublicPosts(await (deps.loadPosts || fetchPublishedPosts)());

  // A assinatura inclui o mtime do template: um redeploy do site troca o
  // index.html sem mudar nenhum post, e o HTML dos artigos precisa ser
  // regerado em cima do template novo (bundle novo, tags novas).
  const { mtimeMs: templateMtime } = await stat(templatePath);
  const signature = `${siteDir}#${templateMtime}#${JSON.stringify(config)}#${signatureOf(posts)}`;
  if (reason === 'interval' && signature === lastSignature) return { skipped: 'sem mudanças' };

  // Trava dura: lista vazia nunca reescreve nada.
  //
  // Um blog com zero posts publicados e um estado legitimo, mas indistinguivel
  // de um defeito — banco errado no DATABASE_URL, migracao pela metade, pool
  // devolvendo vazio num soluco. Nos dois casos a acao correta e a mesma: nao
  // tocar em nada. O sitemap que o build gerou continua no ar, e a proxima
  // varredura tenta de novo. O custo de errar para o lado de nao escrever e
  // zero; o de errar para o outro lado e o site perder o blog inteiro.
  if (posts.length === 0) {
    warn('nenhum post publicado retornado — nada reescrito (o sitemap atual e preservado)');
    return { skipped: 'nenhum post publicado' };
  }

  const blogPath = config.blog.path.replace(/^\//, '');
  await backupOriginalsOnce(siteDir, config.blog.path);

  for (const post of posts) {
    await writeAtomic(resolve(siteDir, blogPath, post.slug, 'index.html'), buildPostHtml(template, config, post));
  }
  await writeAtomic(resolve(siteDir, blogPath, 'index.html'), buildBlogIndexHtml(template, config, posts));

  const sitemap = buildSitemap(config, posts);
  await writeAtomic(resolve(siteDir, 'sitemap.xml'), sitemap);
  await writeAtomic(resolve(siteDir, 'llms.txt'), buildLlms(config, posts));

  const slugs = posts.map((p) => p.slug);
  const previousSlugs = await readManifest(siteDir);
  const { removed, blocked } = await pruneRemovedPosts(siteDir, config.blog.path, previousSlugs, slugs);

  const retainedSlugs = blocked ? [...new Set([...slugs, ...previousSlugs.filter((slug) => SLUG_RE.test(slug))])] : slugs;

  // O manifest preserva slugs cuja remocao foi bloqueada para permitir
  // reconciliacao posterior, sem abandonar arquivos antigos para sempre.
  // O manifest so registra o que a API de fato escreveu — nunca as pastas que
  // o build deixou para tras. E o que garante que a poda jamais alcance um
  // arquivo que nao foi ela quem criou.
  await writeAtomic(
    join(siteDir, MANIFEST_FILENAME),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), reason, slugs: retainedSlugs }, null, 2)}\n`,
  );

  lastSignature = blocked ? null : signature;
  const result = {
    posts: posts.length,
    urls: countSitemapEntries(sitemap),
    removed: removed.length,
    pruneBlocked: blocked,
    reason,
  };
  log(`${result.urls} URLs no sitemap; ${result.posts} artigos prerenderizados${removed.length ? `; ${removed.length} removidos` : ''}${blocked ? '; poda bloqueada pela trava' : ''} (${reason})`);
  return result;
}

// ─── Agendamento ───────────────────────────────────────────────────────────

async function runGuarded(reason) {
  if (running) {
    pendingReason = reason;
    return;
  }
  running = true;
  try {
    await refreshSeoNow(reason);
  } catch (err) {
    warn(`falha ao regerar (${reason}):`, err.message);
  } finally {
    running = false;
    if (pendingReason) {
      const next = pendingReason;
      pendingReason = null;
      setTimeout(() => runGuarded(next), 0);
    }
  }
}

/**
 * Chamado pelas rotas de mutação. Não retorna promise de propósito: publicar
 * um post não deve esperar o disco. Debounce agrupa edições em sequência.
 */
export function scheduleSeoRefresh(reason = 'mutation') {
  if (!isSeoEnabled()) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runGuarded(reason);
  }, DEBOUNCE_MS);
  if (typeof debounceTimer.unref === 'function') debounceTimer.unref();
}

/** Startup + varredura periódica (pega posts agendados que venceram). */
export function startSeoRefreshLoop() {
  if (!isSeoEnabled()) {
    log('geração desligada (SEO_SITE_DIR nao definido ou SEO_ENABLED=false)');
    return;
  }
  runGuarded('startup');
  intervalTimer = setInterval(() => runGuarded('interval'), INTERVAL_MS);
  if (typeof intervalTimer.unref === 'function') intervalTimer.unref();
}

/** Só para testes: zera o memo de "nada mudou". */
export function resetSeoSignature() {
  lastSignature = null;
}

export function stopSeoRefreshLoop() {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  debounceTimer = null;
  intervalTimer = null;
}
