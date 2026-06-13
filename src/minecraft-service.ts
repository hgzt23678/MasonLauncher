import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
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
  ModLoaderService,
  type ModLoaderType,
} from './mod-loader-service';
import { ensureLauncherLogsDirectory } from './instance-paths';
import {
  defaultJavaSettings,
  isJavaArchitectureCompatible,
  probeJavaExecutable,
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
import {
  MinecraftLaunchResolver,
  parseJavaMajorVersion,
} from './minecraft-launch-resolver';
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
  minecraftVersion?: string;
  loaderType?: 'vanilla' | 'forge' | 'neoforge' | 'fabric';
  loaderVersion?: string | null;
};

type LogWriter = (
  level: LauncherLogLevel,
  stage: LauncherLogStage,
  message: string,
  detail?: Record<string, unknown>,
) => void;

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export const resolveLaunchJavaExecutable = async (
  javaPath: string,
  platform: NodeJS.Platform = process.platform,
) => {
  if (
    platform !== 'win32' ||
    path.basename(javaPath).toLowerCase() !== 'java.exe'
  ) {
    return javaPath;
  }
  const javawPath = path.join(path.dirname(javaPath), 'javaw.exe');
  try {
    const stat = await fs.stat(javawPath);
    return stat.isFile() ? javawPath : javaPath;
  } catch {
    return javaPath;
  }
};

export const validateMinecraftNatives = async (
  nativesDirectory: string,
  platform: NodeJS.Platform = process.platform,
) => {
  if (/(?:^|[\\/])[^\\/]+\.asar(?:[\\/]|$)/i.test(nativesDirectory)) {
    throw new MinecraftError(
      'Minecraft nativesディレクトリがASAR内を指しています。',
      'natives',
      'NATIVES_INSIDE_ASAR',
      { nativesDirectory },
    );
  }
  let stat;
  try {
    stat = await fs.stat(nativesDirectory);
  } catch (error) {
    throw new MinecraftError(
      'Minecraft nativesディレクトリが存在しません。',
      'natives',
      'NATIVES_DIRECTORY_MISSING',
      { nativesDirectory },
      { cause: error },
    );
  }
  if (!stat.isDirectory()) {
    throw new MinecraftError(
      'Minecraft nativesの展開先がディレクトリではありません。',
      'natives',
      'NATIVES_DIRECTORY_INVALID',
      { nativesDirectory },
    );
  }
  const extension =
    platform === 'win32' ? '.dll' : platform === 'darwin' ? '.dylib' : '.so';
  const nativeFiles = (await fs.readdir(nativesDirectory, {
    recursive: true,
    withFileTypes: true,
  })).filter(
    (entry) =>
      entry.isFile() && entry.name.toLowerCase().endsWith(extension),
  );
  if (nativeFiles.length === 0) {
    throw new MinecraftError(
      `Minecraft nativesに必要な${extension}ファイルがありません。`,
      'natives',
      'NATIVES_FILES_MISSING',
      { nativesDirectory, extension },
    );
  }
  const writeProbe = path.join(
    nativesDirectory,
    `.mason-write-test-${process.pid}-${randomUUID()}`,
  );
  try {
    await fs.writeFile(writeProbe, '');
  } catch (error) {
    throw new MinecraftError(
      'Minecraft nativesディレクトリへ書き込めません。',
      'natives',
      'NATIVES_DIRECTORY_READ_ONLY',
      { nativesDirectory },
      { cause: error },
    );
  } finally {
    await fs.rm(writeProbe, { force: true }).catch((): void => undefined);
  }
  return { nativeFileCount: nativeFiles.length };
};

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
      const actualSha1 = createHash('sha1')
        .update(await fs.readFile(path.join(destination, relativePath)))
        .digest('hex');
      if (
        actualSha1.toLowerCase() !==
        entry.downloads.raw.sha1.toLowerCase()
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
      if (stat.isFile() && stat.size === expected.size) {
        const actualSha1 = createHash('sha1')
          .update(await fs.readFile(target))
          .digest('hex');
        if (actualSha1.toLowerCase() === expected.sha1.toLowerCase()) {
          continue;
        }
      }
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
  private readonly modLoaderService: ModLoaderService;

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
    this.modLoaderService = new ModLoaderService(gameDirectory, log, {
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

  async getModLoaderBuilds(
    loader: Exclude<ModLoaderType, 'forge'>,
    minecraftVersion: string,
  ) {
    return this.modLoaderService.getBuilds(loader, minecraftVersion);
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
    const manifestCachePath = path.join(
      runtimeDirectory,
      '.mason-runtime-manifest.json',
    );
    let manifest: JavaRuntimeManifest | undefined;
    try {
      manifest = JSON.parse(
        await fs.readFile(manifestCachePath, 'utf8'),
      ) as JavaRuntimeManifest;
    } catch {
      // The online path refreshes and stores the manifest below.
    }
    if (!offlineOnly) {
      manifest = await this.fetchJavaRuntimeManifest(component);
      await fs.mkdir(runtimeDirectory, { recursive: true });
      const temporary = `${manifestCachePath}.tmp-${process.pid}-${randomUUID()}`;
      try {
        await fs.writeFile(temporary, JSON.stringify(manifest), 'utf8');
        await fs.rm(manifestCachePath, { force: true });
        await fs.rename(temporary, manifestCachePath);
      } finally {
        await fs.rm(temporary, { force: true }).catch((): void => undefined);
      }
    }
    if (!manifest) {
      throw new MinecraftError(
        `Java runtime manifest is not available locally: ${manifestCachePath}`,
        'java',
        'JAVA_RUNTIME_MANIFEST_NOT_FOUND_OFFLINE',
        { component, majorVersion, executable, manifestCachePath },
      );
    }
    try {
      if (!(await isJavaRuntimeManifestComplete(runtimeDirectory, manifest))) {
        throw new Error('Java runtime SHA-1 verification failed.');
      }
      this.log('info', 'java', 'Java実行ファイルを検出しました。', {
        component,
        majorVersion,
        executable,
        sha1Verified: true,
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
      if (!(await isJavaRuntimeManifestComplete(runtimeDirectory, manifest))) {
        await repairJavaRuntimeManifestFiles(runtimeDirectory, manifest);
      }
      if (!(await isJavaRuntimeManifestComplete(runtimeDirectory, manifest))) {
        throw new MinecraftError(
          'Java runtime files failed SHA-1 verification after installation.',
          'java',
          'JAVA_RUNTIME_INSTALL_VERIFICATION_FAILED',
          { component, majorVersion, executable },
        );
      }
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
   * Resolves the launch Java. Prefers JavaRuntimeService (Temurin-first auto
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
      const javaPath = await this.ensureJava(version, sender, offlineOnly);
      return {
        javaPath,
        majorVersion: version.javaVersion?.majorVersion ?? 8,
        distribution: 'mojang',
        runtimeId: null,
        source: 'mojang-fallback' as const,
        requiredMajorVersion: version.javaVersion?.majorVersion ?? 8,
      };
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
    return selection;
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
        java.javaPath,
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

  async ensureModLoader(
    loader: ModLoaderType,
    minecraftVersion: string,
    loaderVersion: string,
    resolvedVersionId: string,
    sender: WebContents,
    offlineOnly = false,
    javaOptions: JavaLaunchOptions = {},
  ) {
    if (loader === 'forge') {
      return this.ensureForge(
        minecraftVersion,
        loaderVersion,
        sender,
        offlineOnly,
        javaOptions,
      );
    }

    let javaPath: string | undefined;
    if (loader === 'neoforge' && !offlineOnly) {
      let baseVersion: ResolvedVersion;
      try {
        baseVersion = await Version.parse(
          await this.gameDirectory(),
          minecraftVersion,
        );
      } catch (error) {
        throw new MinecraftError(
          `NeoForge parent version could not be resolved: ${minecraftVersion}`,
          'forge-version-json',
          'NEOFORGE_PARENT_RESOLUTION_FAILED',
          { minecraftVersion },
          { cause: error },
        );
      }
      javaPath = (
        await this.provisionJava(
          baseVersion,
          sender,
          false,
          javaOptions,
        )
      ).javaPath;
    }

    this.report(sender, {
      phase: 'forge',
      percent: 0,
      message: `${loader === 'fabric' ? 'Fabric' : 'NeoForge'}を準備しています...`,
    });
    const versionId = await this.modLoaderService.ensureInstalled({
      loader,
      minecraftVersion,
      loaderVersion,
      resolvedVersionId,
      javaPath,
      offlineOnly,
    });
    this.report(sender, {
      phase: 'forge',
      percent: 100,
      message: `${loader === 'fabric' ? 'Fabric' : 'NeoForge'}の準備が完了しました。`,
    });
    return versionId;
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
      const javaSelection = await this.provisionJava(
        prepared.version,
        sender,
        session.mode === 'authenticated-offline',
        javaOptions,
      );
      const javaPath = javaSelection.javaPath;
      const javaProbe = await probeJavaExecutable(javaPath);
      const requiredJavaMajor = prepared.version.javaVersion?.majorVersion ?? 8;
      if (
        javaProbe.majorVersion !== null &&
        javaProbe.majorVersion !== requiredJavaMajor
      ) {
        throw new MinecraftError(
          `Selected Java ${javaProbe.majorVersion} does not match required Java ${requiredJavaMajor}.`,
          'java',
          'JAVA_VERSION_MISMATCH',
          {
            javaPath,
            actualMajorVersion: javaProbe.majorVersion,
            requiredMajorVersion: requiredJavaMajor,
          },
        );
      }
      if (!isJavaArchitectureCompatible(process.arch, javaProbe.arch)) {
        throw new MinecraftError(
          `Selected Java architecture (${javaProbe.arch}) is incompatible with this system (${process.arch}).`,
          'java',
          'JAVA_ARCHITECTURE_MISMATCH',
          {
            javaPath,
            javaArchitecture: javaProbe.arch,
            hostArchitecture: process.arch,
          },
        );
      }
      const totalMemoryMb = Math.floor(os.totalmem() / (1024 * 1024));
      const freeMemoryMb = Math.floor(os.freemem() / (1024 * 1024));
      const normalizedJavaArch = javaProbe.arch.toLowerCase();
      if (
        /(?:x86|i[3-6]86|32)/.test(normalizedJavaArch) &&
        !/(?:x86_64|amd64|x64)/.test(normalizedJavaArch) &&
        settings.maxMemory > 1536
      ) {
        throw new MinecraftError(
          `32-bit Javaでは最大メモリ ${settings.maxMemory} MBを確保できません。`,
          'memory',
          'JAVA_32BIT_HEAP_TOO_LARGE',
          { javaArchitecture: javaProbe.arch, maxMemoryMb: settings.maxMemory },
        );
      }
      if (settings.maxMemory > Math.max(512, totalMemoryMb - 512)) {
        throw new MinecraftError(
          `設定された最大メモリ ${settings.maxMemory} MBが物理メモリ容量に対して大きすぎます。`,
          'memory',
          'JAVA_HEAP_EXCEEDS_PHYSICAL_MEMORY',
          { maxMemoryMb: settings.maxMemory, totalMemoryMb, freeMemoryMb },
        );
      }
      const nativesValidation = await validateMinecraftNatives(
        prepared.nativesDirectory,
      );
      const launchJavaPath = await resolveLaunchJavaExecutable(javaPath);
      this.log('info', 'java', 'Minecraft起動前のJava・メモリ・natives検証が完了しました。', {
        probeJavaPath: javaPath,
        launchJavaPath,
        javaDistribution: javaSelection.distribution,
        javaMajor: javaProbe.majorVersion,
        javaArch: javaProbe.arch,
        minMemoryMb: settings.minMemory,
        maxMemoryMb: settings.maxMemory,
        freeMemoryMb,
        totalMemoryMb,
        nativesDirectory: prepared.nativesDirectory,
        nativeFileCount: nativesValidation.nativeFileCount,
      });

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
        javaPath: launchJavaPath,
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
      const instanceId = (javaOptions.instanceId ?? `direct-${versionId}`)
        .replace(/[^a-zA-Z0-9-]/g, '-')
        .slice(0, 100);
      const launcherLogDirectory = await ensureLauncherLogsDirectory(
        path.join(path.dirname(this.runtimeRoot), 'instances'),
        instanceId,
      );
      const launcherLogPath = path.join(
        launcherLogDirectory,
        `${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
      );
      const latestLogPath = path.join(gamePath, 'logs', 'latest.log');
      const processHandle = this.runner.run(
        {
          command: resolved.command,
          args: resolved.args,
          cwd: resolved.cwd,
          metadata: {
            instanceId,
            versionId,
            minecraftVersion:
              javaOptions.minecraftVersion ??
              prepared.version.minecraftVersion ??
              versionId,
            loaderType: javaOptions.loaderType ?? 'vanilla',
            loaderVersion: javaOptions.loaderVersion ?? null,
            javaPath: resolved.command,
            javaDistribution: javaSelection.distribution,
            javaMajor:
              javaProbe.majorVersion ??
              parseJavaMajorVersion(resolved.javaVersion) ??
              null,
            javaArch: javaProbe.arch ?? 'unknown',
            gameDir: gamePath,
            assetsDir: path.join(resourcePath, 'assets'),
            nativesDir: resolved.nativesDirectory,
            mainClass: resolved.mainClass,
            classpathEntries: resolved.classpathEntries,
            argumentCount: resolved.args.length,
            minMemoryMb: settings.minMemory,
            maxMemoryMb: settings.maxMemory,
            freeMemoryMb,
            totalMemoryMb,
            nativeFileCount: nativesValidation.nativeFileCount,
            latestLogPath,
            launcherLogPath,
          },
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
        message: `${versionId} のJavaプロセスを起動しました（画面表示は未確認）`,
      });
      return {
        ok: true,
        pid: processHandle.pid,
        message:
          'Minecraft Javaプロセスを起動しました。画面表示を確認しています。',
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
