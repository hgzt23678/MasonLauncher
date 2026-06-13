const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');

const rendererUrl =
  process.env.MASON_RENDERER_URL || 'http://localhost:5173';

const waitFor = async (window, expression, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
};

const run = async () => {
  await app.whenReady();
  const window = new BrowserWindow({
    width: 1120,
    height: 720,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadURL(rendererUrl);
  await waitFor(
    window,
    `document.querySelector('[data-profile-id="forge-profile"] [data-action="edit"]') !== null`,
  );
  const navigationState = await window.webContents.executeJavaScript(`(() => ({
    labels: [...document.querySelectorAll('.sidebar-nav md-icon-button')]
      .map((button) => button.getAttribute('aria-label')),
    activeId: document.querySelector('.sidebar-nav [data-active="true"]')?.id ?? null,
    legacyLoaderSelectPresent: document.querySelector('#profile-loader-select') !== null,
    legacyProfileIdInputPresent: document.querySelector('#profile-id-input') !== null
  }))()`);
  if (
    navigationState.activeId !== 'profiles-nav' ||
    navigationState.labels.includes('ホーム') ||
    navigationState.legacyLoaderSelectPresent ||
    navigationState.legacyProfileIdInputPresent
  ) {
    throw new Error(
      `Sidebar or profile loader state is inconsistent: ${JSON.stringify(navigationState)}`,
    );
  }
  const cardMetrics = await window.webContents.executeJavaScript(`(() =>
    [...document.querySelectorAll('.profile-card')].map((card) => {
      const cardBounds = card.getBoundingClientRect();
      const actionBounds = card.querySelector('.profile-card-actions')
        ?.getBoundingClientRect();
      return {
        width: Math.round(cardBounds.width),
        height: Math.round(cardBounds.height),
        actionTop: Math.round(actionBounds?.top ?? 0),
        actionBottom: Math.round(actionBounds?.bottom ?? 0)
      };
    })
  )()`);
  if (
    cardMetrics.length === 0 ||
    cardMetrics.some((card) => card.width > 232 || card.height > 240) ||
    new Set(cardMetrics.map((card) => card.actionBottom)).size !== 1
  ) {
    throw new Error(
      `Profile card layout is inconsistent: ${JSON.stringify(cardMetrics)}`,
    );
  }
  if (process.env.MASON_PROFILE_UI_SCREENSHOT) {
    const image = await window.webContents.capturePage();
    fs.writeFileSync(process.env.MASON_PROFILE_UI_SCREENSHOT, image.toPNG());
  }
  await window.webContents.executeJavaScript(
    `document.querySelector('[data-profile-id="forge-profile"] [data-action="edit"]').click()`,
  );
  await waitFor(
    window,
    `document.querySelector('#mod-search-results')?.textContent?.includes('Example Mod') === true`,
  );
  const result = await window.webContents.executeJavaScript(`(() => ({
    resultCount: document.querySelectorAll('#mod-search-results .mod-result').length,
    resultText: document.querySelector('#mod-search-results')?.textContent ?? '',
    query: document.querySelector('#mod-search-input')?.value ?? '',
    editorOpen: document.querySelector('#profile-modal')?.hasAttribute('hidden') === false
  }))()`);
  console.log(
    `MODRINTH_UI_PASS ${JSON.stringify({
      ...result,
      cardMetrics,
      navigationState,
    })}`,
  );
  window.destroy();
  app.exit(0);
};

void run().catch((error) => {
  console.error(
    `MODRINTH_UI_FAIL ${error instanceof Error ? error.stack : String(error)}`,
  );
  app.exit(1);
});
