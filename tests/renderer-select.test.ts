import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('Material selectへネイティブOptionを挿入しない', async () => {
  const rendererSource = await fs.readFile(
    path.resolve('src', 'renderer.ts'),
    'utf8',
  );

  assert.doesNotMatch(rendererSource, /\bnew\s+Option\s*\(/);
});
