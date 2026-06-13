import { spawn } from 'node:child_process';
import {
  appendFileSync,
  promises as fs,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { AuthService } from '../src/auth-service';
import {
  defaultJavaSettings,
  JavaRuntimeService,
  probeJavaExecutable,
} from '../src/java-runtime-service';
import { MinecraftDownloader } from '../src/minecraft-downloader';
import { MinecraftLaunchResolver } from '../src/minecraft-launch-resolver';
import { ModLoaderService } from '../src/mod-loader-service';
import {
  resolveLaunchJavaExecutable,
  validateMinecraftNatives,
} from '../src/minecraft-service';
import {
  isConfirmedMinecraftWindow,
  probeMinecraftWindow,
} from '../src/minecraft-window-probe';
import type {
  LauncherLogLevel,
  LauncherLogStage,
} from '../src/diagnostics';

type VerificationTarget = {
  loader: 'vanilla' | 'fabric' | 'neoforge';
  minecraftVersion: string;
  loaderVersion?: string;
};

const parseTarget = (value: string): VerificationTarget => {
  const [loader, minecraftVersion, loaderVersion] = value.split(':');
  if (
    loader === 'fabric' ||
    loader === 'neoforge'
  ) {
    if (!minecraftVersion || !loaderVersion) {
      throw new Error(`Invalid loader target: ${value}`);
    }
    return { loader, minecraftVersion, loaderVersion };
  }
  if (loader === 'vanilla' && minecraftVersion) {
    return { loader, minecraftVersion };
  }
  return { loader: 'vanilla', minecraftVersion: value };
};

const requestedTargets = process.argv.slice(2);
const targets = (
  requestedTargets.length > 0
    ? requestedTargets
    : ['vanilla:26.1', 'vanilla:1.12.2', 'vanilla:1.16.5']
).map(parseTarget);
const timeoutMs = 120_000;
const appData = process.env.APPDATA;
if (!appData) throw new Error('APPDATA is not available.');
const userData =
  process.env.MASON_VERIFY_USER_DATA?.trim() ||
  path.join(appData, 'Mason Launcher');

app.setName('Mason Launcher');
app.setPath('userData', userData);
const verificationResultPath =
  process.env.MASON_VERIFY_RESULT_PATH?.trim() ||
  path.join(userData, 'verification-results.json');
const verificationProgressPath =
  process.env.MASON_VERIFY_PROGRESS_PATH?.trim() ||
  path.join(userData, 'verification-progress.log');

const recordProgress = (message: string) => {
  appendFileSync(
    verificationProgressPath,
    `${new Date().toISOString()} ${message}\n`,
    'utf8',
  );
};

type VerificationResult = {
  versionId: string;
  minecraftVersion: string;
  loader: VerificationTarget['loader'];
  loaderVersion?: string;
  success: boolean;
  pid?: number;
  javaPath?: string;
  javaMajor?: number | null;
  javaArch?: string | null;
  javaDistribution?: string;
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
  recordProgress(
    JSON.stringify({
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
      env: process.env,
      shell: false,
      windowsHide: false,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pid = child.pid;
    if (!pid) {
      reject(new Error('Minecraft process did not return a PID.'));
      return;
    }

    let settled = false;
    let windowReady = false;
    let visibleWindow:
      | { pid: number; handle: number; firstSeenAt: number }
      | undefined;
    let stderrTail = '';
    let probeTimer: NodeJS.Timeout | undefined;
    const finish = async (
      result: Pick<
        VerificationResult,
        'pid' | 'windowReady' | 'exitCode' | 'signal'
      >,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (probeTimer) clearTimeout(probeTimer);
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
    child.once('exit', (code, signal) => {
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
    const pollWindow = async (): Promise<void> => {
      if (settled) return;
      const result = await probeMinecraftWindow(pid);
      const candidate = result.candidates.find(isConfirmedMinecraftWindow);
      const now = Date.now();
      if (candidate) {
        if (
          visibleWindow?.pid === candidate.pid &&
          visibleWindow.handle === candidate.handle
        ) {
          if (now - visibleWindow.firstSeenAt >= 2_000) {
            windowReady = true;
            await stopProcess(pid);
            await finish({
              pid,
              windowReady: true,
              exitCode: null,
              signal: null,
            });
            return;
          }
        } else {
          visibleWindow = {
            pid: candidate.pid,
            handle: candidate.handle,
            firstSeenAt: now,
          };
        }
      } else {
        visibleWindow = undefined;
      }
      probeTimer = setTimeout(() => void pollWindow(), 500);
    };
    void pollWindow();

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
  writeFileSync(verificationProgressPath, '', 'utf8');
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
    profiles?: Array<{
      id: string;
      resolvedVersionId?: string;
      versionId?: string;
      instanceDir?: string;
      minMemory?: number;
      maxMemory?: number;
    }>;
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
  const modLoaderService = new ModLoaderService(
    async () => settings.gameDirectory,
    log,
    {
      prepareInstalledVersion: async (versionId, offlineOnly) =>
        downloader.prepareInstalledVersion(versionId, () => undefined, {
          offlineOnly,
        }),
    },
  );
  const results: VerificationResult[] = [];

  for (const target of targets) {
    const targetLabel = [
      target.loader,
      target.minecraftVersion,
      target.loaderVersion,
    ].filter(Boolean).join(':');
    console.log(`VERIFY_START ${targetLabel}`);
    recordProgress(`VERIFY_START ${targetLabel}`);
    try {
      const baseVersionId = target.minecraftVersion;
      let prepared = await downloader.prepareVersion(baseVersionId);
      const component =
        prepared.version.javaVersion?.component || 'jre-legacy';
      let java = await javaService.resolveForLaunch({
        settings: defaultJavaSettings(),
        minecraftVersion:
          prepared.version.minecraftVersion ?? prepared.version.id,
        metadataMajorVersion:
          prepared.version.javaVersion?.majorVersion,
        offlineOnly: false,
        instanceId: `verification-${targetLabel}`,
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
      let versionId = baseVersionId;
      if (target.loader !== 'vanilla') {
        versionId = await modLoaderService.ensureInstalled({
          loader: target.loader,
          minecraftVersion: baseVersionId,
          loaderVersion: target.loaderVersion as string,
          resolvedVersionId:
            target.loader === 'fabric'
              ? `${baseVersionId}-fabric${target.loaderVersion}`
              : `neoforge-${target.loaderVersion}`,
          javaPath: java.javaPath,
          offlineOnly: false,
        });
        prepared = await downloader.prepareInstalledVersion(
          versionId,
          () => undefined,
          { offlineOnly: true },
        );
        java = await javaService.resolveForLaunch({
          settings: defaultJavaSettings(),
          minecraftVersion:
            prepared.version.minecraftVersion ?? baseVersionId,
          metadataMajorVersion:
            prepared.version.javaVersion?.majorVersion,
          offlineOnly: true,
          instanceId: `verification-${targetLabel}`,
        });
      }
      const javaProbe = await probeJavaExecutable(java.javaPath);
      const matchingProfile = settings.profiles?.find(
        (profile) =>
          profile.resolvedVersionId === versionId ||
          profile.versionId === versionId,
      );
      const gamePath =
        matchingProfile?.instanceDir ??
        path.join(
          userData,
          'instances',
          `verification-${targetLabel.replace(/[^a-zA-Z0-9.-]/g, '-')}`,
          'instance',
        );
      await fs.mkdir(gamePath, { recursive: true });
      await Promise.all(
        ['mods', 'config', 'saves', 'logs'].map((name) =>
          fs.mkdir(path.join(gamePath, name), { recursive: true }),
        ),
      );
      await validateMinecraftNatives(prepared.nativesDirectory);
      const launchJavaPath = await resolveLaunchJavaExecutable(java.javaPath);
      const resolved = await resolver.resolve({
        versionId,
        session,
        settings: {
          minMemory:
            matchingProfile?.minMemory ?? settings.minMemory ?? 1024,
          maxMemory:
            matchingProfile?.maxMemory ?? settings.maxMemory ?? 4096,
        },
        gamePath,
        resourcePath: settings.gameDirectory,
        javaPath: launchJavaPath,
        nativesDirectory: prepared.nativesDirectory,
      });
      const processResult = await waitForWindow(
        resolved.command,
        resolved.args,
        resolved.cwd,
      );
      const result: VerificationResult = {
        versionId,
        minecraftVersion: baseVersionId,
        loader: target.loader,
        loaderVersion: target.loaderVersion,
        success: processResult.windowReady === true,
        ...processResult,
        javaPath: launchJavaPath,
        javaMajor: java.majorVersion,
        javaArch: javaProbe.arch,
        javaDistribution: java.distribution,
        mainClass: resolved.mainClass,
        classpathEntries: resolved.classpathEntries,
      };
      results.push(result);
      console.log(`VERIFY_PASS ${JSON.stringify(result)}`);
      recordProgress(`VERIFY_PASS ${JSON.stringify(result)}`);
    } catch (error) {
      const result: VerificationResult = {
        versionId:
          target.loader === 'vanilla'
            ? target.minecraftVersion
            : `${target.loader}:${target.minecraftVersion}:${target.loaderVersion}`,
        minecraftVersion: target.minecraftVersion,
        loader: target.loader,
        loaderVersion: target.loaderVersion,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(result);
      console.error(`VERIFY_FAIL ${JSON.stringify(result)}`);
      recordProgress(`VERIFY_FAIL ${JSON.stringify(result)}`);
    }
  }

  writeFileSync(
    verificationResultPath,
    JSON.stringify(results, null, 2),
    'utf8',
  );
  console.log(`VERIFY_RESULTS ${JSON.stringify(results)}`);
  app.exit(results.every((result) => result.success) ? 0 : 1);
};

void run().catch((error) => {
  recordProgress(
    `VERIFY_FATAL ${error instanceof Error ? error.stack : String(error)}`,
  );
  console.error(
    `VERIFY_FATAL ${error instanceof Error ? error.stack : String(error)}`,
  );
  app.exit(1);
});
