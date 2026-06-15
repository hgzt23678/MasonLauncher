import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: '/MasonLauncher/',
  build: {
    rollupOptions: {
      input: {
        home: resolve(rootDirectory, 'index.html'),
        privacy: resolve(rootDirectory, 'privacy/index.html'),
      },
    },
  },
});
