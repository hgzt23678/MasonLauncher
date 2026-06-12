import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { WebContents } from 'electron';
import { createMinecraftProcessWatcher } from '@xmcl/core';
import { AuthService } from '../src/auth-service';
import {
  defaultJavaSettings,
  JavaRuntimeService,
} from '../src/java-runtime-service';
import { MinecraftDownloader } from '../src/minecraft-downloader';
import { MinecraftLaunchResolver } from '../src/minecraft-launch-resolver';
import { MinecraftService } from '../src/minecraft-service';
import type {
  LauncherLogLevel,
  LauncherLogStage,
} from '../src/diagnostics';

const requestedVersions = process.argv.slice(2);
const versions =
  requestedVersions.length > 0
    ? requestedVersions
    : ['26.1', '1.12.2', '1.16.5'];
const timeoutMs = 120_000;
const appData = process.env.APPDATA;
if (!appData) throw new Error('APPDATA is not available.');
const userData =
  process.env.MASON_VERIFY_USER_DATA?.trim() ||
  path.join(appData, 'Mason Launcher');

app.setName('Mason Launcher');
app.setPath('userData', userData);

type VerificationResult = {
  versionId: string;
  success: boolean;
  pid?: number;
  javaPath?: string;
  javaMajor?: number | null;
  mainClass?: string;
  classpathEntries?: number;
  windowReady?: boolean;
  exitCode?: number | null;
  signal?: string | null;
  error?: string;
};

const log = (
  level: LauncherLogLevel,
  stage: LauncherLogStage,
  message: string,
  detail?: Record<string, unknown>,
) => {
  if (level === 'debug') return;
  const safeDetail = detail
    ? Object.fromEntries(
        Object.entries(detail).filter(
          ([key]) => !/token|authorization|secret|credential/i.test(key),
        ),
      )
    : undefined;
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      stage,
      message,
      detail: safeDetail,
    }),
  );
};

const stopProcess = async (pid: number) => {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn(
        'taskkill',
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore' },
      );
      killer.once('close', () => resolve());
      killer.once('error', () => resolve());
    });
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // The process already exited.
  }
};

const waitForWindow = (
  command: string,
  args: string[],
  cwd: string,
): Promise<Pick<
  VerificationResult,
  'pid' | 'windowReady' | 'exitCode' | 'signal'
>> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pid = child.pid;
    if (!pid) {
      reject(new Error('Minecraft process did not return a PID.'));
      return;
    }

    let settled = false;
    let windowReady = false;
    let stderrTail = '';
    const watcher = createMinecraftProcessWatcher(child);
    const finish = async (
      result: Pick<
        VerificationResult,
        'pid' | 'windowReady' | 'exitCode' | 'signal'
      >,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = `${stderrTail}${chunk.toString()}`.slice(-8_000);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    watcher.on('minecraft-window-ready', () => {
      windowReady = true;
      void stopProcess(pid).then(() =>
        finish({
          pid,
          windowReady: true,
          exitCode: null,
          signal: null,
        }),
      );
    });
    watcher.on('minecraft-exit', ({ code, signal }) => {
      if (windowReady) return;
      const suffix = stderrTail.trim()
        ? `\nLast stderr:\n${stderrTail.trim()}`
        : '';
      reject(
        new Error(
          `Minecraft exited before a window appeared (code=${code}, signal=${signal ?? 'none'}).${suffix}`,
        ),
      );
    });

    const timer = setTimeout(() => {
      void stopProcess(pid).then(() => {
        if (windowReady) return;
        reject(
          new Error(
            `Minecraft did not create a detectable window within ${timeoutMs / 1000} seconds.`,
          ),
        );
      });
    }, timeoutMs);
  });

const run = async () => {
  await app.whenReady();
  const settings = JSON.parse(
    await fs.readFile(
      path.join(userData, 'launcher-settings.json'),
      'utf8',
    ),
  ) as {
    gameDirectory: string;
    microsoftClientId: string;
    minMemory?: number;
    maxMemory?: number;
  };
  const runtimeRoot =
    process.env.MASON_VERIFY_RUNTIME_ROOT?.trim() ||
    path.join(userData, 'runtime');
  const authService = new AuthService(userData, log);
  await authService.configure(settings.microsoftClientId);
  const session = await authService.getCachedOfflineSession();
  const downloader = new MinecraftDownloader(
    async () => settings.gameDirectory,
    log,
  );
  const javaService = new JavaRuntimeService(runtimeRoot, log);
  const resolver = new MinecraftLaunchResolver(log);
  const minecraftService = new MinecraftService(
    async () => settings.gameDirectory,
    runtimeRoot,
    log,
    javaService,
  );
  const progressSender = {
    isDestroyed: () => false,
    send: (): void => undefined,
  } as unknown as WebContents;
  const results: VerificationResult[] = [];

  for (const versionId of versions) {
    console.log(`VERIFY_START ${versionId}`);
    try {
      const prepared = await downloader.prepareVersion(versionId);
      const component =
        prepared.version.javaVersion?.component || 'jre-legacy';
      const officialJava = path.join(
        runtimeRoot,
        component,
        'bin',
        process.platform === 'win32' ? 'java.exe' : 'java',
      );
      try {
        await fs.access(officialJava);
      } catch {
        const remoteVersion = (
          await minecraftService.getRemoteVersions()
        ).find((candidate) => candidate.id === versionId);
        if (!remoteVersion) {
          throw new Error(
            `Version ${versionId} disappeared from the Mojang manifest.`,
          );
        }
        await minecraftService.installVersion(
          remoteVersion,
          progressSender,
        );
      }
      const java = await javaService.resolveForLaunch({
        settings: defaultJavaSettings(),
        minecraftVersion:
          prepared.version.minecraftVersion ?? prepared.version.id,
        metadataMajorVersion:
          prepared.version.javaVersion?.majorVersion,
        offlineOnly: true,
        instanceId: `verification-${versionId}`,
        mojangFallback: async () => {
          const executable = path.join(
            runtimeRoot,
            component,
            'bin',
            process.platform === 'win32' ? 'java.exe' : 'java',
          );
          await fs.access(executable);
          return executable;
        },
      });
      const gamePath = path.join(
        settings.gameDirectory,
        'mason-launcher',
        'verification',
        versionId,
      );
      await fs.mkdir(gamePath, { recursive: true });
      const resolved = await resolver.resolve({
        versionId,
        session,
        settings: {
          minMemory: settings.minMemory ?? 1024,
          maxMemory: settings.maxMemory ?? 4096,
        },
        gamePath,
        resourcePath: settings.gameDirectory,
        javaPath: java.javaPath,
        nativesDirectory: prepared.nativesDirectory,
      });
      const processResult = await waitForWindow(
        resolved.command,
        resolved.args,
        resolved.cwd,
      );
      const result: VerificationResult = {
        versionId,
        success: processResult.windowReady === true,
        ...processResult,
        javaPath: java.javaPath,
        javaMajor: java.majorVersion,
        mainClass: resolved.mainClass,
        classpathEntries: resolved.classpathEntries,
      };
      results.push(result);
      console.log(`VERIFY_PASS ${JSON.stringify(result)}`);
    } catch (error) {
      const result: VerificationResult = {
        versionId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(result);
      console.error(`VERIFY_FAIL ${JSON.stringify(result)}`);
    }
  }

  console.log(`VERIFY_RESULTS ${JSON.stringify(results)}`);
  app.exit(results.every((result) => result.success) ? 0 : 1);
};

void run().catch((error) => {
  console.error(
    `VERIFY_FATAL ${error instanceof Error ? error.stack : String(error)}`,
  );
  app.exit(1);
});
