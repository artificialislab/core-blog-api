/**
 * Carrega a configuração de SEO específica do site do cliente.
 *
 * A API é genérica (serve Carolina, Aline, Ana Paula, ...), então nada de
 * marca, rota estática ou texto institucional vive aqui. Tudo isso vem de
 * `seo.config.json`, que o build do site emite dentro do próprio dist. A API
 * só sabe: "leia o config que está ao lado do index.html que o nginx serve".
 *
 * Se o arquivo não existir, a geração fica DESLIGADA em silêncio — sites que
 * ainda não migraram continuam funcionando exatamente como antes.
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeServiceLinks } from './serviceLinks.js';

export const SEO_CONFIG_FILENAME = 'seo.config.json';

let cache = null; // { path, mtimeMs, config }

export function getSiteDir() {
  const dir = process.env.SEO_SITE_DIR;
  return dir ? resolve(dir) : null;
}

export function isSeoEnabled() {
  if (String(process.env.SEO_ENABLED || '').toLowerCase() === 'false') return false;
  return Boolean(getSiteDir());
}

/** Normaliza e valida o config, preenchendo defaults seguros. */
export function normalizeSeoConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('seo.config.json não é um objeto');

  const siteUrl = String(raw.siteUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(siteUrl)) {
    throw new Error(`siteUrl inválido em ${SEO_CONFIG_FILENAME}: ${JSON.stringify(raw.siteUrl)}`);
  }

  const blogPath = String(raw.blog?.path || '/blog');
  if (!/^\/[a-z0-9-]+$/.test(blogPath)) {
    throw new Error(`blog.path inválido em ${SEO_CONFIG_FILENAME}: ${JSON.stringify(blogPath)}`);
  }

  const staticRoutes = (Array.isArray(raw.staticRoutes) ? raw.staticRoutes : [])
    .map((route) => (typeof route === 'string' ? { loc: route } : route))
    .filter((route) => route && typeof route.loc === 'string' && route.loc.startsWith('/'));

  return {
    version: Number(raw.version || 1),
    siteUrl,
    locale: raw.locale || 'pt-BR',
    brandName: raw.brandName || '',
    homeLabel: raw.homeLabel || 'Início',
    defaultImage: raw.defaultImage || '',
    indexRobots: raw.indexRobots || '',
    titleSuffix: raw.titleSuffix || '',
    titleSuffixMaxLength: Number(raw.titleSuffixMaxLength || 54),
    schemaIds: raw.schemaIds && typeof raw.schemaIds === 'object' ? raw.schemaIds : {},
    blog: {
      path: blogPath,
      label: raw.blog?.label || 'Blog',
      title: raw.blog?.title || 'Blog',
      metaTitle: raw.blog?.metaTitle || '',
      description: raw.blog?.description || '',
      serviceLinks: normalizeServiceLinks(raw.blog?.serviceLinks, staticRoutes),
    },
    staticRoutes,
    llms: raw.llms && typeof raw.llms === 'object' ? raw.llms : null,
  };
}

/**
 * Lê o config do disco. Faz cache por mtime — um redeploy do site troca o
 * arquivo e a API pega a versão nova sem restart.
 */
export async function loadSeoConfig() {
  const dir = getSiteDir();
  if (!dir) return null;

  const path = resolve(dir, SEO_CONFIG_FILENAME);
  let mtimeMs;
  try {
    ({ mtimeMs } = await stat(path));
  } catch {
    return null; // site ainda não emite o config — geração desligada
  }

  if (cache && cache.path === path && cache.mtimeMs === mtimeMs) return cache.config;

  const config = normalizeSeoConfig(JSON.parse(await readFile(path, 'utf8')));
  cache = { path, mtimeMs, config };
  return config;
}

/** Só para testes. */
export function resetSeoConfigCache() {
  cache = null;
}
