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

test('Debug login screen exposes the Client ID configuration controls', async () => {
  const [html, mainSource] = await Promise.all([
    fs.readFile(path.resolve('index.html'), 'utf8'),
    fs.readFile(path.resolve('src', 'main.ts'), 'utf8'),
  ]);

  assert.match(html, /id="debug-client-id-panel"\s+hidden/);
  assert.match(html, /id="debug-client-id-input"/);
  assert.match(html, /id="debug-client-id-save"/);
  assert.match(mainSource, /if \(!canConfigureClientId\)/);
  assert.match(mainSource, /auth:configure-client-id/);
});

test('Login UI uses Material Web cards instead of custom card containers', async () => {
  const [html, rendererSource] = await Promise.all([
    fs.readFile(path.resolve('index.html'), 'utf8'),
    fs.readFile(path.resolve('src', 'renderer.ts'), 'utf8'),
  ]);

  assert.match(html, /<md-filled-card class="login-card"/);
  assert.match(
    html,
    /<md-outlined-card class="debug-client-id-panel"/,
  );
  assert.match(html, /<md-outlined-card class="device-code-panel"/);
  assert.doesNotMatch(html, /<section class="login-card"/);
  assert.doesNotMatch(html, /<section class="debug-client-id-panel"/);
  assert.match(
    rendererSource,
    /@material\/web\/labs\/card\/filled-card\.js/,
  );
  assert.match(
    rendererSource,
    /@material\/web\/labs\/card\/outlined-card\.js/,
  );
});
