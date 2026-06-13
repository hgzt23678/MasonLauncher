const { app, BrowserWindow } = require('electron');

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
  console.log(`MODRINTH_UI_PASS ${JSON.stringify(result)}`);
  window.destroy();
  app.exit(0);
};

void run().catch((error) => {
  console.error(
    `MODRINTH_UI_FAIL ${error instanceof Error ? error.stack : String(error)}`,
  );
  app.exit(1);
});
