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

test('developer logs append visible rows and defer hidden DOM updates', async () => {
  const rendererSource = await fs.readFile(
    path.resolve('src', 'renderer.ts'),
    'utf8',
  );

  assert.match(rendererSource, /const appendDeveloperLog/);
  assert.match(
    rendererSource,
    /const isDeveloperLogViewVisible/,
  );
  assert.match(rendererSource, /!settingsModal\.hasAttribute\('hidden'\)/);
  assert.match(
    rendererSource,
    /developerLogList\.prepend\(createDeveloperLogRow\(entry\)\)/,
  );
  assert.match(
    rendererSource,
    /while \(developerLogList\.children\.length > 500\)/,
  );
  assert.match(rendererSource, /if \(visible && developerLogDomDirty\)/);
  assert.match(rendererSource, /appendDeveloperLog\(entry\)/);
  assert.doesNotMatch(
    rendererSource,
    /renderDeveloperLogs\(\[\.\.\.developerLogs,\s*entry\]\)/,
  );
});

test('Developer-capable login screen exposes the Client ID controls', async () => {
  const [html, mainSource] = await Promise.all([
    fs.readFile(path.resolve('index.html'), 'utf8'),
    fs.readFile(path.resolve('src', 'main.ts'), 'utf8'),
  ]);

  assert.match(html, /id="debug-client-id-panel"\s+hidden/);
  assert.match(html, /id="debug-client-id-input"/);
  assert.match(html, /id="debug-client-id-save"/);
  assert.match(mainSource, /if \(!canShowDeveloperSettings\(settings\)\)/);
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

test('Developer mode exposes Client ID and Material theme controls', async () => {
  const [html, rendererSource, mainSource, css] = await Promise.all([
    fs.readFile(path.resolve('index.html'), 'utf8'),
    fs.readFile(path.resolve('src', 'renderer.ts'), 'utf8'),
    fs.readFile(path.resolve('src', 'main.ts'), 'utf8'),
    fs.readFile(path.resolve('src', 'index.css'), 'utf8'),
  ]);

  assert.match(html, /id="developer-settings"/);
  assert.match(html, /id="developer-mode-toggle"/);
  assert.match(html, /id="developer-client-id-input"/);
  assert.match(html, /id="developer-theme-color-input"/);
  assert.match(rendererSource, /createMaterialThemeTokens/);
  assert.match(rendererSource, /state\.canShowDeveloperSettings/);
  assert.match(
    mainSource,
    /clientIdConfigurationEnabled\(buildConfiguration\) \|\| settings\.developerMode/,
  );
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

test('Settings is a Material 3 destination instead of a blocking dialog', async () => {
  const [html, rendererSource, css] = await Promise.all([
    fs.readFile(path.resolve('index.html'), 'utf8'),
    fs.readFile(path.resolve('src', 'renderer.ts'), 'utf8'),
    fs.readFile(path.resolve('src', 'index.css'), 'utf8'),
  ]);

  assert.match(
    html,
    /<section class="settings-main" id="settings-modal" hidden/,
  );
  assert.match(html, /<md-filled-card class="settings-card account-settings-card"/);
  assert.match(html, /<md-filled-card class="settings-card preferences-settings-card"/);
  assert.match(html, /<md-filled-card class="settings-card java-settings-card"/);
  assert.doesNotMatch(
    html,
    /id="settings-modal"[^>]*role="dialog"|aria-modal="true"[^>]*aria-labelledby="settings-title"/,
  );
  assert.match(rendererSource, /setMainView\('settings'\)/);
  assert.match(
    css,
    /\.settings-layout\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s,
  );
});

test('ModPack discovery uses Material search, filled cards, and chips', async () => {
  const [html, rendererSource, css, preloadSource, mainSource] = await Promise.all([
    fs.readFile(path.resolve('index.html'), 'utf8'),
    fs.readFile(path.resolve('src', 'renderer.ts'), 'utf8'),
    fs.readFile(path.resolve('src', 'index.css'), 'utf8'),
    fs.readFile(path.resolve('src', 'preload.ts'), 'utf8'),
    fs.readFile(path.resolve('src', 'main.ts'), 'utf8'),
  ]);

  assert.match(html, /class="modpacks-search-surface"/);
  assert.match(html, /slot="leading-icon"/);
  assert.match(html, /id="modpacks-results-title"/);
  assert.match(html, /id="modpacks-result-count"/);
  assert.match(rendererSource, /document\.createElement\('md-filled-card'\)/);
  assert.match(rendererSource, /document\.createElement\('md-assist-chip'\)/);
  assert.match(rendererSource, /dataset\.action\s*=\s*'install-modpack'/);
  assert.match(preloadSource, /modrinthInstallModpack/);
  assert.match(preloadSource, /modrinth:install-modpack/);
  assert.match(mainSource, /modrinth:install-modpack/);
  assert.match(
    mainSource,
    /phase:\s*terminalPhase[\s\S]*done:\s*true/,
  );
  assert.match(rendererSource, /finally\s*\{[\s\S]*modpackInstallActive = false/);
  assert.match(rendererSource, /resetStatusProgress\(3000\)/);
  assert.match(css, /\.modpacks-search-surface\s*\{/);
  assert.match(css, /\.modpacks-collection-header\s*\{/);
  assert.match(
    css,
    /\.modpacks-search-row\s*\{[^}]*align-items:\s*center/s,
  );
  assert.match(
    css,
    /\.modpacks-search-row\s*\{[^}]*box-sizing:\s*border-box[^}]*width:\s*100%[^}]*max-width:\s*100%[^}]*overflow:\s*hidden/s,
  );
  assert.match(
    css,
    /\.modpacks-search-field\s*\{[^}]*flex:\s*1 1 auto[^}]*min-width:\s*0[^}]*width:\s*auto/s,
  );
  assert.match(
    css,
    /\.modpacks-search-row\s*\{[^}]*height:\s*64px[^}]*max-height:\s*64px[^}]*resize:\s*none/s,
  );
  assert.match(
    css,
    /\.modpacks-search-field\s*\{[^}]*height:\s*56px[^}]*max-height:\s*56px[^}]*resize:\s*none/s,
  );
  assert.doesNotMatch(
    html,
    /id="modpacks-search-input"[\s\S]{0,220}data-i18n-label=/,
  );
  assert.match(css, /\.mod-search-row\s*\{[^}]*align-items:\s*center/s);
});

test('Material 3 color roles and motion tokens define accessible light and dark themes', async () => {
  const [html, css] = await Promise.all([
    fs.readFile(path.resolve('index.html'), 'utf8'),
    fs.readFile(path.resolve('src', 'index.css'), 'utf8'),
  ]);

  assert.match(html, /name="color-scheme"\s+content="light dark"/);
  assert.match(css, /--md-sys-color-primary:\s*#0b57d0/);
  assert.match(css, /--md-sys-color-surface-container:\s*#f0f4f9/);
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*dark\)/);
  assert.match(css, /--md-sys-color-primary:\s*#a8c7fa/);
  assert.match(
    css,
    /--md-sys-motion-easing-emphasized-decelerate:\s*cubic-bezier\(0\.05,\s*0\.7,\s*0\.1,\s*1\)/,
  );
  assert.match(css, /--md-sys-motion-duration-medium2:\s*300ms/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(css, /#9bd36f/i);
});
