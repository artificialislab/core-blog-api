/**
 * Unit tests — parseAdminListFilters (filtros do GET /posts/admin/all).
 * Funcao pura em src/http.js — roda sem DB.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdminListFilters, POST_STATUSES } from '../src/http.js';

test('sem filtros: where/params vazios', () => {
  const r = parseAdminListFilters({});
  assert.deepEqual(r, { where: [], params: [] });
});

test('query undefined: nao explode', () => {
  const r = parseAdminListFilters(undefined);
  assert.deepEqual(r, { where: [], params: [] });
});

test('status valido: gera predicate parametrizado', () => {
  for (const status of POST_STATUSES) {
    const r = parseAdminListFilters({ status });
    assert.deepEqual(r.where, ['status = $1']);
    assert.deepEqual(r.params, [status]);
  }
});

test('status fora da whitelist: invalid_status', () => {
  assert.equal(parseAdminListFilters({ status: 'archived' }).error, 'invalid_status');
  // Tentativa de injection nunca vira SQL — cai na whitelist antes.
  assert.equal(
    parseAdminListFilters({ status: "published' or '1'='1" }).error,
    'invalid_status',
  );
});

test('status nao-string (objeto via qs aninhado): invalid_status', () => {
  assert.equal(parseAdminListFilters({ status: { x: 1 } }).error, 'invalid_status');
});

test('status vazio ou ausente: ignorado (sem filtro)', () => {
  assert.deepEqual(parseAdminListFilters({ status: '' }).where, []);
  assert.deepEqual(parseAdminListFilters({ status: undefined }).where, []);
});

test('category: match exato parametrizado', () => {
  const r = parseAdminListFilters({ category: 'ia-aplicada' });
  assert.deepEqual(r.where, ['category = $1']);
  assert.deepEqual(r.params, ['ia-aplicada']);
});

test('tag: pertencimento no array tags', () => {
  const r = parseAdminListFilters({ tag: 'llm' });
  assert.deepEqual(r.where, ['$1 = any(tags)']);
  assert.deepEqual(r.params, ['llm']);
});

test('combinado: placeholders sequenciais na ordem status, category, tag', () => {
  const r = parseAdminListFilters({ status: 'draft', category: 'ops', tag: 'n8n' });
  assert.deepEqual(r.where, ['status = $1', 'category = $2', '$3 = any(tags)']);
  assert.deepEqual(r.params, ['draft', 'ops', 'n8n']);
});

test('param repetido (?status=a&status=b vira array): usa o primeiro', () => {
  const r = parseAdminListFilters({ status: ['draft', 'published'] });
  assert.deepEqual(r.params, ['draft']);
});

test('valor com aspas em category/tag: vai como parametro, nunca como SQL', () => {
  const r = parseAdminListFilters({ category: "x'; drop table blog_posts; --" });
  assert.deepEqual(r.where, ['category = $1']);
  assert.equal(r.params[0], "x'; drop table blog_posts; --");
});
