import { defineConfig, loadEnv } from 'vite';
import { resolveBuildMicrosoftClientId } from './src/auth-config';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const microsoftClientId = resolveBuildMicrosoftClientId(
    process.env.MICROSOFT_CLIENT_ID,
    env.MICROSOFT_CLIENT_ID,
  );
  const buildConfiguration =
    process.env.MASON_BUILD_CONFIGURATION?.toLowerCase() === 'release'
      ? 'release'
      : 'debug';
  return {
    define: {
      __MICROSOFT_CLIENT_ID__: JSON.stringify(
        microsoftClientId,
      ),
      __BUILD_CONFIGURATION__: JSON.stringify(buildConfiguration),
    },
  };
});
