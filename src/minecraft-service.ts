import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Version, type ResolvedVersion } from '@xmcl/core';
import {
  installJavaRuntimeTask,
  type JavaRuntimeManifest,
  type MinecraftVersion,
} from '@xmcl/installer';
import type { Task, TaskContext } from '@xmcl/task';
import type { WebContents } from 'electron';
import type { MinecraftSession } from './auth-service';
import type {
  LauncherLogLevel,
  LauncherLogStage,
} from './diagnostics';
import { ForgeService } from './forge-service';
import {
  defaultJavaSettings,
  type JavaRuntimeService,
  type ProfileJavaSettings,
} from './java-runtime-service';
import {
  MinecraftDownloader,
  type MinecraftDownloadProgress,
} from './minecraft-downloader';
import {
  MinecraftError,
  toMinecraftError,
  type MinecraftErrorCategory,
} from './minecraft-errors';
import { MinecraftLaunchResolver } from './minecraft-launch-resolver';
import { MinecraftProcessRunner } from './minecraft-process-runner';
import {
  resolveJavaExecutable,
  resolveRuntimePlatformKey,
} from './launcher-utils';
import { installXmclUndiciCompatibility } from './xmcl-compat';

installXmclUndiciCompatibility();

export type ProgressEvent = {
  phase:
    | 'manifest'
    | 'authentication'
    | 'version-json'
    | 'client'
    | 'libraries'
    | 'natives'
    | 'assets'
    | 'logging'
    | 'java'
    | 'forge'
    | 'mods'
    | 'resolve'
    | 'spawn'
    | 'complete'
    | 'error';
  percent: number;
  message: string;
  file?: string;
  category?: MinecraftErrorCategory;
};

type LaunchSettings = {
  minMemory: number;
  maxMemory: number;
  jvmArgs?: string[];
};

type JavaLaunchOptions = {
  javaSettings?: ProfileJavaSettings;
  instanceId?: string;
};

type LogWriter = (
  level: LauncherLogLevel,
  stage: LauncherLogStage,
  message: string,
  detail?: Record<string, unknown>,
) => void;

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export const isJavaRuntimeManifestComplete = async (
  destination: string,
  manifest: Pick<JavaRuntimeManifest, 'files'>,
) => {
  for (const [relativePath, entry] of Object.entries(manifest.files)) {
    if (entry.type !== 'file') continue;
    try {
      const stat = await fs.stat(path.join(destination, relativePath));
      if (
        !stat.isFile() ||
        stat.size !== entry.downloads.raw.size
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
};

export const waitForJavaRuntimeManifest = async (
  destination: string,
  manifest: Pick<JavaRuntimeManifest, 'files'>,
  timeoutMs = 10 * 60 * 1000,
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isJavaRuntimeManifestComplete(destination, manifest)) return;
    await delay(500);
  }
  throw new MinecraftError(
    'Java runtime download did not complete before the timeout.',
    'java',
    'JAVA_RUNTIME_INSTALL_TIMEOUT',
    { destination, timeoutMs },
  );
};

export const repairJavaRuntimeManifestFiles = async (
  destination: string,
  manifest: Pick<JavaRuntimeManifest, 'files'>,
  fetchImpl: typeof fetch = fetch,
) => {
  for (const [relativePath, entry] of Object.entries(manifest.files)) {
    if (entry.type !== 'file') continue;
    const target = path.join(destination, relativePath);
    const expected = entry.downloads.raw;
    try {
      const stat = await fs.stat(target);
      if (stat.isFile() && stat.size === expected.size) continue;
    } catch {
      // Missing files are downloaded below.
    }

    const response = await fetchImpl(expected.url);
    if (!response.ok) {
      throw new MinecraftError(
        `Java runtime file download failed: HTTP ${response.status}`,
        'java',
        `HTTP_${response.status}`,
        { relativePath, url: expected.url },
      );
    }
    const data = Buffer.from(await response.arrayBuffer());
    const actualSha1 = createHash('sha1').update(data).digest('hex');
    if (
      data.length !== expected.size ||
      actualSha1.toLowerCase() !== expected.sha1.toLowerCase()
    ) {
      throw new MinecraftError(
        'Java runtime file verification failed.',
        'java',
        'JAVA_RUNTIME_FILE_VERIFICATION_FAILED',
        {
          relativePath,
          expectedSize: expected.size,
          actualSize: data.length,
          expectedSha1: expected.sha1,
          actualSha1,
        },
      );
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await fs.writeFile(temporary, data);
      await fs.rm(target, { force: true });
      await fs.rename(temporary, target);
    } finally {
      await fs
        .rm(temporary, { force: true })
        .catch((): void => undefined);
    }
  }
};

export class MinecraftService {
  private launchInProgress = false;
  private installInProgress = false;
  private readonly downloader: MinecraftDownloader;
  private readonly resolver: MinecraftLaunchResolver;
  private readonly runner: MinecraftProcessRunner;
  private readonly forgeService: ForgeService;

  constructor(
    private readonly gameDirectory: () => Promise<string>,
    private readonly runtimeRoot: string,
    private readonly log: LogWriter = () => undefined,
    private readonly javaService?: JavaRuntimeService,
  ) {
    this.downloader = new MinecraftDownloader(gameDirectory, log);
    this.resolver = new MinecraftLaunchResolver(log);
    this.runner = new MinecraftProcessRunner(log);
    this.forgeService = new ForgeService(gameDirectory, log, {
      prepareInstalledVersion: async (versionId, offlineOnly) =>
        this.downloader.prepareInstalledVersion(
          versionId,
          () => undefined,
          { offlineOnly },
        ),
    });
  }

  private report(sender: WebContents, progress: ProgressEvent) {
    if (!sender.isDestroyed()) {
      sender.send('minecraft:progress', progress);
    }
  }

  private reportDownload(
    sender: WebContents,
    progress: MinecraftDownloadProgress,
  ) {
    this.report(sender, progress);
  }

  async getRemoteVersions() {
    return (await this.downloader.getManifest()) as MinecraftVersion[];
  }

  async getForgeBuilds(minecraftVersion: string) {
    return this.forgeService.getBuilds(minecraftVersion);
  }

  private taskContext(
    sender: WebContents,
    rootTask: Task<unknown>,
    phase: ProgressEvent['phase'],
    label: string,
  ): TaskContext {
    const emit = (task: Task<unknown>) => {
      const total = rootTask.total || task.total;
      const current = rootTask.progress || task.progress;
      const percent =
        total > 0 ? Math.min(99, Math.round((current / total) * 100)) : 0;
      this.report(sender, {
        phase,
        percent,
        message: label,
        file: task.to ? path.basename(task.to) : task.name,
      });
    };
    return { onStart: emit, onUpdate: emit };
  }

  async installVersion(version: MinecraftVersion, sender: WebContents) {
    if (this.installInProgress) {
      throw new MinecraftError(
        '別のMinecraftインストール処理が進行中です。',
        'download',
        'INSTALL_IN_PROGRESS',
      );
    }
    this.installInProgress = true;
    try {
      this.log('info', 'files', 'Minecraftバージョンの取得を開始します。', {
        versionId: version.id,
      });
      const prepared = await this.downloader.prepareVersion(
        version.id,
        (progress) => this.reportDownload(sender, progress),
      );
      await this.provisionJava(prepared.version, sender);
      this.report(sender, {
        phase: 'complete',
        percent: 100,
        message: `${version.id} の準備が完了しました`,
      });
      return prepared.version;
    } catch (error) {
      const failure = toMinecraftError(
        error,
        'download',
        'Minecraftの取得に失敗しました。',
      );
      this.report(sender, {
        phase: 'error',
        percent: 0,
        message: failure.message,
        category: failure.category,
      });
      this.log('error', 'files', 'Minecraftバージョンの取得に失敗しました。', {
        versionId: version.id,
        category: failure.category,
        code: failure.code,
        message: failure.message,
      });
      throw failure;
    } finally {
      this.installInProgress = false;
    }
  }

  private async fetchJavaRuntimeManifest(
    component: string,
  ): Promise<JavaRuntimeManifest> {
    const url =
      'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
    let indexResponse: Response;
    try {
      indexResponse = await fetch(url);
    } catch (error) {
      throw new MinecraftError(
        'Mojang Java runtime一覧へ接続できません。',
        'java',
        'JAVA_RUNTIME_NETWORK_ERROR',
        { url },
        { cause: error },
      );
    }
    if (!indexResponse.ok) {
      throw new MinecraftError(
        `Mojang Java runtime一覧を取得できません: HTTP ${indexResponse.status}`,
        'java',
        `HTTP_${indexResponse.status}`,
        { url },
      );
    }

    const index = (await indexResponse.json()) as Record<
      string,
      Record<
        string,
        Array<{
          manifest: { url: string };
          version: JavaRuntimeManifest['version'];
        }>
      >
    >;
    const platformKey = resolveRuntimePlatformKey();
    const target = index[platformKey]?.[component]?.[0];
    if (!target) {
      throw new MinecraftError(
        `この環境向けJava runtime ${component} が見つかりません (${platformKey})。`,
        'java',
        'JAVA_RUNTIME_NOT_FOUND',
      );
    }

    const manifestResponse = await fetch(target.manifest.url);
    if (!manifestResponse.ok) {
      throw new MinecraftError(
        `Java runtime manifestを取得できません: HTTP ${manifestResponse.status}`,
        'java',
        `HTTP_${manifestResponse.status}`,
        { url: target.manifest.url },
      );
    }
    const manifest = (await manifestResponse.json()) as Pick<
      JavaRuntimeManifest,
      'files'
    >;
    return {
      target: component,
      version: target.version,
      files: manifest.files,
    };
  }

  private async ensureJava(
    version: ResolvedVersion,
    sender: WebContents,
    offlineOnly = false,
  ) {
    // javaVersion may be absent in very old version JSONs; fall back to
    // jre-legacy (Java 8) which covers all pre-1.17 releases.
    const component = version.javaVersion?.component || 'jre-legacy';
    const majorVersion = version.javaVersion?.majorVersion ?? 8;
    const runtimeDirectory = path.join(this.runtimeRoot, component);
    const executable = resolveJavaExecutable(runtimeDirectory);
    try {
      await fs.access(executable);
      this.log('info', 'java', 'Java実行ファイルを検出しました。', {
        component,
        majorVersion,
        executable,
      });
      return executable;
    } catch {
      if (offlineOnly) {
        throw new MinecraftError(
          `Java runtime is not available locally: ${executable}`,
          'java',
          'JAVA_NOT_FOUND_OFFLINE',
          {
            component,
            majorVersion,
            executable,
          },
        );
      }
      this.report(sender, {
        phase: 'java',
        percent: 0,
        message: `Java ${majorVersion} を準備しています`,
      });
      this.log('warn', 'java', 'Java runtimeがないため取得します。', {
        component,
        majorVersion,
        executable,
      });
    }

    try {
      const manifest = await this.fetchJavaRuntimeManifest(component);
      const task = installJavaRuntimeTask({
        destination: runtimeDirectory,
        manifest,
      });
      const installation = task.startAndWait(
        this.taskContext(
          sender,
          task,
          'java',
          `Java ${majorVersion} をダウンロードしています`,
        ),
      );
      const repairAfterStall = (async () => {
        await delay(30_000);
        if (await isJavaRuntimeManifestComplete(runtimeDirectory, manifest)) {
          return;
        }
        this.log(
          'warn',
          'java',
          'Java runtime download stalled; repairing incomplete files.',
          { component, majorVersion },
        );
        await repairJavaRuntimeManifestFiles(runtimeDirectory, manifest);
        await waitForJavaRuntimeManifest(
          runtimeDirectory,
          manifest,
          60_000,
        );
      })();
      await Promise.race([
        installation,
        repairAfterStall,
      ]);
      await fs.access(executable);
    } catch (error) {
      throw toMinecraftError(
        error,
        'java',
        `Java実行ファイルを準備できません: ${executable}`,
      );
    }
    this.log('info', 'java', 'Java runtimeの取得が完了しました。', {
      component,
      majorVersion,
      executable,
    });
    return executable;
  }

  /**
   * Resolves the launch Java. Prefers JavaRuntimeService (Liberica-first auto
   * selection / per-instance settings); the legacy Mojang runtime path is the
   * compatibility fallback and the only path when no JavaRuntimeService is
   * injected (tests).
   */
  private async provisionJava(
    version: ResolvedVersion,
    sender: WebContents,
    offlineOnly = false,
    options: JavaLaunchOptions = {},
  ) {
    if (!this.javaService) {
      return this.ensureJava(version, sender, offlineOnly);
    }
    const selection = await this.javaService.resolveForLaunch({
      settings: options.javaSettings ?? defaultJavaSettings(),
      minecraftVersion: version.minecraftVersion ?? version.id,
      metadataMajorVersion: version.javaVersion?.majorVersion,
      offlineOnly,
      instanceId: options.instanceId,
      onProgress: (progress) =>
        this.report(sender, {
          phase: 'java',
          percent: progress.percent,
          message: progress.message,
          file: progress.file,
        }),
      mojangFallback: () => this.ensureJava(version, sender, offlineOnly),
    });
    return selection.javaPath;
  }

  async ensureForge(
    minecraftVersion: string,
    loaderVersion: string,
    sender: WebContents,
    offlineOnly = false,
    javaOptions: JavaLaunchOptions = {},
  ) {
    if (offlineOnly) {
      return this.forgeService.verifyReady(
        minecraftVersion,
        loaderVersion,
        true,
      );
    }
    const gameDirectory = await this.gameDirectory();
    let baseVersion: ResolvedVersion;
    try {
      baseVersion = await Version.parse(gameDirectory, minecraftVersion);
    } catch (error) {
      throw new MinecraftError(
        `Forge parent version could not be resolved: ${minecraftVersion}`,
        'forge-version-json',
        'FORGE_PARENT_RESOLUTION_FAILED',
        { minecraftVersion },
        { cause: error },
      );
    }
    const java = await this.provisionJava(
      baseVersion,
      sender,
      false,
      javaOptions,
    );
    try {
      return await this.forgeService.ensureInstalled(
        minecraftVersion,
        loaderVersion,
        java,
        (progress) =>
          this.report(sender, {
            phase: 'forge',
            ...progress,
          }),
      );
    } catch (error) {
      const failure = this.forgeService.normalizeError(error);
      this.report(sender, {
        phase: 'error',
        percent: 0,
        message: failure.message,
        category: failure.category,
      });
      throw failure;
    }
  }

  async launchVersion(
    versionId: string,
    session: MinecraftSession,
    settings: LaunchSettings,
    sender: WebContents,
    instanceDirectory?: string,
    javaOptions: JavaLaunchOptions = {},
  ) {
    if (this.runner.isRunning() || this.launchInProgress) {
      throw new MinecraftError(
        'Minecraftの起動処理はすでに進行中です。',
        'spawn',
        'LAUNCH_IN_PROGRESS',
      );
    }
    this.launchInProgress = true;
    try {
      const resourcePath = await this.gameDirectory();
      const gamePath = instanceDirectory ?? resourcePath;
      await fs.mkdir(gamePath, { recursive: true });
      this.log('info', 'files', '起動対象のMinecraftファイルを検証します。', {
        versionId,
        resourcePath,
        gamePath,
      });
      const prepared = await this.downloader.prepareInstalledVersion(
        versionId,
        (progress) => this.reportDownload(sender, progress),
        { offlineOnly: session.mode === 'authenticated-offline' },
      );
      const javaPath = await this.provisionJava(
        prepared.version,
        sender,
        session.mode === 'authenticated-offline',
        javaOptions,
      );

      this.report(sender, {
        phase: 'resolve',
        percent: 0,
        message: 'Minecraft起動引数を生成しています',
      });
      const resolved = await this.resolver.resolve({
        versionId,
        session,
        settings,
        gamePath,
        resourcePath,
        javaPath,
        nativesDirectory: prepared.nativesDirectory,
      });
      this.report(sender, {
        phase: 'resolve',
        percent: 100,
        message: 'Minecraft起動引数を生成しました',
      });
      this.report(sender, {
        phase: 'spawn',
        percent: 0,
        message: `${versionId} を起動しています`,
      });
      const processHandle = this.runner.run(
        {
          command: resolved.command,
          args: resolved.args,
          cwd: resolved.cwd,
        },
        {
          onState: (state) => {
            if (!sender.isDestroyed()) {
              sender.send('minecraft:process-state', state);
            }
          },
        },
      );
      this.report(sender, {
        phase: 'spawn',
        percent: 100,
        message: `${versionId} を起動しました`,
      });
      return {
        ok: true,
        pid: processHandle.pid,
        message: 'Minecraftを起動しました。',
      };
    } catch (error) {
      const failure = toMinecraftError(
        error,
        'spawn',
        'Minecraftを起動できませんでした。',
      );
      this.report(sender, {
        phase: 'error',
        percent: 0,
        message: failure.message,
        category: failure.category,
      });
      this.log(
        'error',
        failure.category === 'spawn' || failure.category === 'java'
          ? 'spawn'
          : 'process',
        'Minecraft起動フローに失敗しました。',
        {
          versionId,
          category: failure.category,
          code: failure.code,
          message: failure.message,
        },
      );
      throw failure;
    } finally {
      this.launchInProgress = false;
    }
  }

  isRunning() {
    return this.runner.isRunning();
  }
}
