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
};

type LogWriter = (
  level: LauncherLogLevel,
  stage: LauncherLogStage,
  message: string,
  detail?: Record<string, unknown>,
) => void;

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
      await this.ensureJava(prepared.version, sender);
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
    const component = version.javaVersion.component;
    const runtimeDirectory = path.join(this.runtimeRoot, component);
    const executable = resolveJavaExecutable(runtimeDirectory);
    try {
      await fs.access(executable);
      this.log('info', 'java', 'Java実行ファイルを検出しました。', {
        component,
        majorVersion: version.javaVersion.majorVersion,
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
            majorVersion: version.javaVersion.majorVersion,
            executable,
          },
        );
      }
      this.report(sender, {
        phase: 'java',
        percent: 0,
        message: `Java ${version.javaVersion.majorVersion} を準備しています`,
      });
      this.log('warn', 'java', 'Java runtimeがないため取得します。', {
        component,
        majorVersion: version.javaVersion.majorVersion,
        executable,
      });
    }

    try {
      const manifest = await this.fetchJavaRuntimeManifest(component);
      const task = installJavaRuntimeTask({
        destination: runtimeDirectory,
        manifest,
      });
      await task.startAndWait(
        this.taskContext(
          sender,
          task,
          'java',
          `Java ${version.javaVersion.majorVersion} をダウンロードしています`,
        ),
      );
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
      majorVersion: version.javaVersion.majorVersion,
      executable,
    });
    return executable;
  }

  async ensureForge(
    minecraftVersion: string,
    loaderVersion: string,
    sender: WebContents,
    offlineOnly = false,
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
    const java = await this.ensureJava(baseVersion, sender);
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
      const javaPath = await this.ensureJava(
        prepared.version,
        sender,
        session.mode === 'authenticated-offline',
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
