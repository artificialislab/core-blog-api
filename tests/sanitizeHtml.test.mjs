import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeHtml } from '../src/sanitizeHtml.js';

test('sanitizeHtml preserves editor-supported h4 and safe media attributes', () => {
  const html = sanitizeHtml('<h4>Subseção</h4><img src="https://cdn.example.com/a.jpg" alt="A" class="rounded" loading="lazy" onerror="alert(1)">');
  assert.match(html, /<h4>Subseção<\/h4>/);
  assert.match(html, /class="rounded"/);
  assert.match(html, /loading="lazy"/);
  assert.doesNotMatch(html, /onerror/);
});

test('sanitizeHtml blocks unsafe image protocols', () => {
  const html = sanitizeHtml('<img src="javascript:alert(1)" alt="x"><a href="javascript:alert(1)">x</a>');
  assert.doesNotMatch(html, /javascript:/);
});

test('token TTL parser keeps cookie lifetime aligned with JWT TTL', async () => {
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/db';
  const { _constants } = await import('../src/auth.js');
  assert.equal(_constants.tokenTtlToCookieMaxAge('12h'), 12 * 60 * 60 * 1000);
  assert.equal(_constants.tokenTtlToCookieMaxAge('7d'), 7 * 24 * 60 * 60 * 1000);
  // TOKEN_TTL numérico (segundos) — formato documentado no .env.example.
  assert.equal(_constants.tokenTtlToCookieMaxAge(3600), 3600 * 1000);
});
