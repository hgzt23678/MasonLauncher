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

test('Debug developer settings expose Client ID and Material theme controls', async () => {
  const [html, rendererSource, mainSource, css] = await Promise.all([
    fs.readFile(path.resolve('index.html'), 'utf8'),
    fs.readFile(path.resolve('src', 'renderer.ts'), 'utf8'),
    fs.readFile(path.resolve('src', 'main.ts'), 'utf8'),
    fs.readFile(path.resolve('src', 'index.css'), 'utf8'),
  ]);

  assert.match(html, /id="developer-settings"/);
  assert.match(html, /id="developer-client-id-input"/);
  assert.match(html, /id="developer-theme-color-input"/);
  assert.match(rendererSource, /createMaterialThemeTokens/);
  assert.match(rendererSource, /state\.buildConfiguration === 'debug'/);
  assert.match(
    mainSource,
    /modCount:\s*await countEntries\(profileModsDirectory,\s*'file'\)/,
  );
  assert.match(css, /\.profile-grid\s*\{[^}]*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /scrollbar-gutter:\s*stable/);
});

test('ModPack navigation opens a dedicated Modrinth search view', async () => {
  const [html, rendererSource, preloadSource, mainSource] = await Promise.all([
    fs.readFile(path.resolve('index.html'), 'utf8'),
    fs.readFile(path.resolve('src', 'renderer.ts'), 'utf8'),
    fs.readFile(path.resolve('src', 'preload.ts'), 'utf8'),
    fs.readFile(path.resolve('src', 'main.ts'), 'utf8'),
  ]);

  assert.match(html, /id="modpacks-nav"/);
  assert.match(html, /id="modpacks-section"\s+hidden/);
  assert.ok(
    html.indexOf('id="modpacks-nav"') < html.indexOf('id="settings-nav"'),
    'ModPack button should be immediately above Settings in the sidebar',
  );
  assert.match(rendererSource, /setMainView\('modpacks'\)/);
  assert.match(rendererSource, /setMainView\('profiles'\)/);
  assert.match(rendererSource, /modrinthSearchModpacks/);
  assert.match(preloadSource, /modrinth:search-modpacks/);
  assert.match(mainSource, /modrinth:search-modpacks/);
});
