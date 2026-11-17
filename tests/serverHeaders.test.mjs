import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('servidor não anuncia o framework (x-powered-by desligado)', async () => {
  const source = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(source, /app\.disable\('x-powered-by'\)/);
});
