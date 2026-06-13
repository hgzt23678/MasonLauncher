import { defineConfig, loadEnv } from 'vite';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const microsoftClientId =
    process.env.MICROSOFT_CLIENT_ID ?? env.MICROSOFT_CLIENT_ID ?? '';
  return {
    define: {
      __MICROSOFT_CLIENT_ID__: JSON.stringify(
        microsoftClientId.trim(),
      ),
    },
  };
});
