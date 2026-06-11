import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  Version,
  getPlatform,
  type Platform,
  type ResolvedVersion,
} from '@xmcl/core';
import { open, openEntryReadStream, walkEntriesGenerator } from '@xmcl/unzip';
import type {
  LauncherLogLevel,
  LauncherLogStage,
} from './diagnostics';
import {
  MinecraftError,
  classifyRequestFailure,
  type MinecraftErrorCategory,
} from './minecraft-errors';
import {
  parseVersionManifest,
  resolveLibraryPath,
  type ParsedManifestVersion,
} from './launcher-utils';

const VERSION_MANIFEST_URL =
  'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const ASSET_OBJECT_BASE_URL = 'https://resources.download.minecraft.net';

type FetchLike = typeof fetch;

type DownloadDescriptor = {
  url: string;
  sha1?: string;
  size?: number;
};

type VersionManifestEntry = ParsedManifestVersion & {
  sha1?: string;
};

type AssetIndex = {
  objects: Record<string, { hash: string; size: number }>;
};

export type MinecraftDownloadPhase =
  | 'manifest'
  | 'version-json'
  | 'client'
  | 'libraries'
  | 'natives'
  | 'assets'
  | 'logging';

export type MinecraftDownloadProgress = {
  phase: MinecraftDownloadPhase;
  percent: number;
  message: string;
  file?: string;
  category?: MinecraftErrorCategory;
};

type DownloadResult = {
  downloaded: boolean;
  path: string;
};

export type DownloadStats = {
  downloaded: number;
  skipped: number;
  failed: number;
};

export type PreparedMinecraftVersion = {
  version: ResolvedVersion;
  libraries: DownloadStats;
  assets: DownloadStats;
  client: DownloadResult;
  logging?: DownloadResult;
  nativesDirectory: string;
};

type DownloaderOptions = {
  fetch?: FetchLike;
  manifestUrl?: string;
  assetObjectBaseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  platform?: Platform;
  libraryConcurrency?: number;
  assetConcurrency?: number;
};

type LogWriter = (
  level: LauncherLogLevel,
  stage: LauncherLogStage,
  message: string,
  detail?: Record<string, unknown>,
) => void;

type ProgressWriter = (progress: MinecraftDownloadProgress) => void;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const safeRelativePath = (root: string, relativePath: string) => {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new MinecraftError(
      `不正な相対パスです: ${relativePath || '(empty)'}`,
      'verification',
      'INVALID_PATH',
    );
  }
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, relativePath);
  if (
    candidate !== resolvedRoot &&
    !candidate.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new MinecraftError(
      `保存先がMinecraftデータディレクトリ外を指しています: ${relativePath}`,
      'verification',
      'PATH_TRAVERSAL',
    );
  }
  return candidate;
};

const fileSha1 = async (filePath: string) => {
  const hash = createHash('sha1');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
};

const runPool = async <T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) => {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
};

export class MinecraftDownloader {
  private readonly fetchImpl: FetchLike;
  private readonly manifestUrl: string;
  private readonly assetObjectBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly platform: Platform;
  private readonly libraryConcurrency: number;
  private readonly assetConcurrency: number;

  constructor(
    private readonly gameDirectory: () => Promise<string>,
    private readonly log: LogWriter = () => undefined,
    options: DownloaderOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.manifestUrl = options.manifestUrl ?? VERSION_MANIFEST_URL;
    this.assetObjectBaseUrl =
      options.assetObjectBaseUrl ?? ASSET_OBJECT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retries = options.retries ?? 2;
    this.platform = options.platform ?? getPlatform();
    this.libraryConcurrency = options.libraryConcurrency ?? 8;
    this.assetConcurrency = options.assetConcurrency ?? 16;
  }

  private async request(url: string, label: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new MinecraftError(
          `${label} の取得に失敗しました: HTTP ${response.status} ${response.statusText}`.trim(),
          'download',
          `HTTP_${response.status}`,
          { url, status: response.status },
        );
      }
      return response;
    } catch (error) {
      throw classifyRequestFailure(error, label, url);
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseJsonResponse<T>(
    response: Response,
    label: string,
    url: string,
  ) {
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw classifyRequestFailure(error, label, url);
    }
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new MinecraftError(
        `${label} のJSON解析に失敗しました。`,
        'json',
        'JSON_PARSE_ERROR',
        { url },
        { cause: error },
      );
    }
  }

  async getManifest(onProgress: ProgressWriter = () => undefined) {
    onProgress({
      phase: 'manifest',
      percent: 0,
      message: 'Mojang version manifestを取得しています',
    });
    this.log('info', 'manifest', 'Mojang version manifestを取得します。', {
      url: this.manifestUrl,
    });
    try {
      const response = await this.request(
        this.manifestUrl,
        'Mojang version manifest',
      );
      const raw = await this.parseJsonResponse<unknown>(
        response,
        'Mojang version manifest',
        this.manifestUrl,
      );
      const versions = parseVersionManifest(raw) as VersionManifestEntry[];
      this.log('info', 'manifest', 'Mojang version manifestを取得しました。', {
        versions: versions.length,
        newest: versions[0]?.id ?? null,
      });
      onProgress({
        phase: 'manifest',
        percent: 100,
        message: 'Mojang version manifestを取得しました',
      });
      return versions;
    } catch (error) {
      const minecraftError =
        error instanceof MinecraftError
          ? error
          : new MinecraftError(
              'Mojang version manifestの取得に失敗しました。',
              'manifest',
              undefined,
              undefined,
              { cause: error },
            );
      onProgress({
        phase: 'manifest',
        percent: 0,
        message: minecraftError.message,
        category: minecraftError.category,
      });
      this.log(
        'error',
        'manifest',
        'Mojang version manifestの取得に失敗しました。',
        {
          message: minecraftError.message,
          code: minecraftError.code,
        },
      );
      throw minecraftError;
    }
  }

  private async validateFile(
    filePath: string,
    descriptor: Pick<DownloadDescriptor, 'sha1' | 'size'>,
  ) {
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      return { valid: false, reason: 'missing' };
    }
    if (!stat.isFile() || stat.size === 0) {
      return { valid: false, reason: 'empty' };
    }
    if (
      typeof descriptor.size === 'number' &&
      descriptor.size >= 0 &&
      stat.size !== descriptor.size
    ) {
      return {
        valid: false,
        reason: 'size',
        actualSize: stat.size,
        expectedSize: descriptor.size,
      };
    }
    if (descriptor.sha1) {
      const actualSha1 = await fileSha1(filePath);
      if (actualSha1.toLowerCase() !== descriptor.sha1.toLowerCase()) {
        return {
          valid: false,
          reason: 'sha1',
          actualSha1,
          expectedSha1: descriptor.sha1,
        };
      }
    }
    return { valid: true, reason: 'ok', actualSize: stat.size };
  }

  private async downloadFile(
    descriptor: DownloadDescriptor,
    destination: string,
    label: string,
    force = false,
    quiet = false,
  ): Promise<DownloadResult> {
    if (!force) {
      const existing = await this.validateFile(destination, descriptor);
      if (existing.valid) {
        if (!quiet) {
          this.log('debug', 'files', `${label} は検証済みのため再利用します。`, {
            destination,
            size: existing.actualSize,
            sha1: descriptor.sha1 ?? null,
          });
        }
        return { downloaded: false, path: destination };
      }
      if (existing.reason !== 'missing') {
        this.log('warn', 'files', `${label} が破損しているため再取得します。`, {
          destination,
          ...existing,
        });
        await fs.rm(destination, { force: true });
      }
    }
    if (!descriptor.url) {
      throw new MinecraftError(
        `${label} のダウンロードURLがなく、再取得できません。`,
        'download',
        'MISSING_URL',
        { destination },
      );
    }

    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporaryPrefix = `${path.basename(destination)}.tmp-`;
    const siblings = await fs.readdir(path.dirname(destination), {
      withFileTypes: true,
    });
    await Promise.all(
      siblings
        .filter(
          (entry) => entry.isFile() && entry.name.startsWith(temporaryPrefix),
        )
        .map((entry) =>
          fs.rm(path.join(path.dirname(destination), entry.name), {
            force: true,
          }),
        ),
    );
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
      try {
        const response = await this.request(descriptor.url, label);
        if (!response.body) {
          throw new MinecraftError(
            `${label} のレスポンス本文が空です。`,
            'download',
            'EMPTY_RESPONSE',
            { url: descriptor.url },
          );
        }
        await pipeline(
          Readable.fromWeb(response.body as never),
          createWriteStream(temporary, { flags: 'wx' }),
        );
        const validation = await this.validateFile(temporary, descriptor);
        if (!validation.valid) {
          throw new MinecraftError(
            `${label} のファイル検証に失敗しました (${validation.reason})。`,
            'verification',
            `FILE_${validation.reason.toUpperCase()}_MISMATCH`,
            { destination, ...validation },
          );
        }
        await fs.rm(destination, { force: true });
        await fs.rename(temporary, destination);
        if (!quiet) {
          this.log('info', 'files', `${label} を保存し、検証しました。`, {
            destination,
            size: validation.actualSize,
            sha1: descriptor.sha1 ?? null,
            attempt: attempt + 1,
          });
        }
        return { downloaded: true, path: destination };
      } catch (error) {
        lastError = error;
        await fs
          .rm(temporary, { force: true })
          .catch((): undefined => undefined);
        const retryable =
          !(error instanceof MinecraftError) ||
          error.category === 'network' ||
          error.category === 'verification' ||
          error.code === 'EMPTY_RESPONSE';
        if (!retryable || attempt >= this.retries) break;
        this.log('warn', 'files', `${label} の取得を再試行します。`, {
          destination,
          attempt: attempt + 1,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    throw lastError;
  }

  private async readJsonFile<T>(filePath: string, label: string) {
    try {
      const text = await fs.readFile(filePath, 'utf8');
      return JSON.parse(text) as T;
    } catch (error) {
      throw new MinecraftError(
        `${label} のJSON解析に失敗しました。`,
        'json',
        'JSON_PARSE_ERROR',
        { filePath },
        { cause: error },
      );
    }
  }

  private async downloadJson<T>(
    descriptor: DownloadDescriptor,
    destination: string,
    label: string,
  ) {
    let result = await this.downloadFile(descriptor, destination, label);
    try {
      return {
        value: await this.readJsonFile<T>(destination, label),
        result,
      };
    } catch (error) {
      if (result.downloaded) throw error;
      await fs.rm(destination, { force: true });
      result = await this.downloadFile(descriptor, destination, label, true);
      return {
        value: await this.readJsonFile<T>(destination, label),
        result,
      };
    }
  }

  private async downloadLibraries(
    root: string,
    version: ResolvedVersion,
    onProgress: ProgressWriter,
  ) {
    const stats: DownloadStats = { downloaded: 0, skipped: 0, failed: 0 };
    const libraries = version.libraries;
    this.log('info', 'files', 'Minecraft librariesを検証します。', {
      versionId: version.id,
      count: libraries.length,
    });
    await runPool(
      libraries,
      this.libraryConcurrency,
      async (library, index) => {
        try {
          const destination = resolveLibraryPath(root, library.download.path);
          const result = await this.downloadFile(
            {
              url: library.download.url,
              sha1: library.download.sha1 || undefined,
              size:
                library.download.size >= 0
                  ? library.download.size
                  : undefined,
            },
            destination,
            `library ${library.name}`,
          );
          stats[result.downloaded ? 'downloaded' : 'skipped'] += 1;
          onProgress({
            phase: 'libraries',
            percent: Math.round(((index + 1) / libraries.length) * 100),
            message: `librariesを取得しています (${index + 1}/${libraries.length})`,
            file: path.basename(destination),
          });
        } catch (error) {
          stats.failed += 1;
          throw error;
        }
      },
    );
    this.log('info', 'files', 'Minecraft librariesの取得が完了しました。', {
      ...stats,
      total: libraries.length,
    });
    return stats;
  }

  private async downloadLogging(
    root: string,
    version: ResolvedVersion,
    onProgress: ProgressWriter,
  ) {
    const file = version.logging?.client?.file;
    if (!file?.url || !file.id) return undefined;
    const destination = safeRelativePath(
      root,
      path.join('assets', 'log_configs', file.id),
    );
    onProgress({
      phase: 'logging',
      percent: 0,
      message: 'Minecraft logging configを取得しています',
      file: file.id,
    });
    const result = await this.downloadFile(
      {
        url: file.url,
        sha1: file.sha1 || undefined,
        size: file.size >= 0 ? file.size : undefined,
      },
      destination,
      'Minecraft logging config',
    );
    onProgress({
      phase: 'logging',
      percent: 100,
      message: 'Minecraft logging configを取得しました',
      file: file.id,
    });
    return result;
  }

  private async downloadAssets(
    root: string,
    version: ResolvedVersion,
    onProgress: ProgressWriter,
  ) {
    const stats: DownloadStats = { downloaded: 0, skipped: 0, failed: 0 };
    const index = version.assetIndex;
    if (!index?.url || !index.id) {
      throw new MinecraftError(
        `バージョン ${version.id} にassetIndexがありません。`,
        'download',
        'MISSING_ASSET_INDEX',
      );
    }
    const indexPath = safeRelativePath(
      root,
      path.join('assets', 'indexes', `${index.id}.json`),
    );
    onProgress({
      phase: 'assets',
      percent: 0,
      message: `asset index ${index.id} を取得しています`,
      file: `${index.id}.json`,
    });
    const { value: assetIndex } = await this.downloadJson<AssetIndex>(
      {
        url: index.url,
        sha1: index.sha1 || undefined,
        size: index.size >= 0 ? index.size : undefined,
      },
      indexPath,
      `asset index ${index.id}`,
    );
    if (!isRecord(assetIndex) || !isRecord(assetIndex.objects)) {
      throw new MinecraftError(
        `asset index ${index.id} にobjectsがありません。`,
        'json',
        'INVALID_ASSET_INDEX',
        { indexPath },
      );
    }
    const indexedObjects = Object.entries(assetIndex.objects);
    const objects = [
      ...new Map(
        indexedObjects.map(
          ([name, object]) =>
            [object.hash, [name, object] as const] as const,
        ),
      ).values(),
    ];
    let completed = 0;
    await runPool(objects, this.assetConcurrency, async ([name, object]) => {
      try {
        if (
          !object ||
          typeof object.hash !== 'string' ||
          typeof object.size !== 'number' ||
          !/^[a-f0-9]{40}$/i.test(object.hash)
        ) {
          throw new MinecraftError(
            `asset index ${index.id} のobject ${name} が不正です。`,
            'json',
            'INVALID_ASSET_OBJECT',
          );
        }
        const relative = path.join(
          'assets',
          'objects',
          object.hash.slice(0, 2),
          object.hash,
        );
        const destination = safeRelativePath(root, relative);
        const result = await this.downloadFile(
          {
            url: `${this.assetObjectBaseUrl}/${object.hash.slice(0, 2)}/${object.hash}`,
            sha1: object.hash,
            size: object.size,
          },
          destination,
          `asset ${name}`,
          false,
          true,
        );
        stats[result.downloaded ? 'downloaded' : 'skipped'] += 1;
        completed += 1;
        if (
          completed === objects.length ||
          completed % Math.max(1, Math.floor(objects.length / 100)) === 0
        ) {
          onProgress({
            phase: 'assets',
            percent: Math.round((completed / objects.length) * 100),
            message: `assetsを取得しています (${completed}/${objects.length})`,
            file: name,
          });
        }
      } catch (error) {
        stats.failed += 1;
        throw error;
      }
    });
    this.log('info', 'files', 'Minecraft assetsの取得が完了しました。', {
      assetIndexId: index.id,
      ...stats,
      indexedObjects: indexedObjects.length,
      uniqueObjects: objects.length,
    });
    return stats;
  }

  private isNativeEntryAllowed(
    entryName: string,
    exclusions: readonly string[],
  ) {
    const normalized = entryName.replaceAll('\\', '/');
    if (
      normalized.endsWith('/') ||
      normalized.startsWith('/') ||
      normalized.includes('../') ||
      normalized.toUpperCase().startsWith('META-INF/')
    ) {
      return false;
    }
    return !exclusions.some((excluded) =>
      normalized.startsWith(excluded.replaceAll('\\', '/')),
    );
  }

  private async extractNativeArchive(
    archive: string,
    destination: string,
    exclusions: readonly string[],
  ) {
    const zip = await open(archive, {
      lazyEntries: true,
      autoClose: false,
    });
    try {
      for await (const entry of walkEntriesGenerator(zip)) {
        if (!this.isNativeEntryAllowed(entry.fileName, exclusions)) continue;
        const output = safeRelativePath(
          destination,
          path.basename(entry.fileName),
        );
        await fs.mkdir(path.dirname(output), { recursive: true });
        const input = await openEntryReadStream(zip, entry);
        await pipeline(input, createWriteStream(output));
      }
    } finally {
      zip.close();
    }
  }

  private async extractNatives(
    root: string,
    version: ResolvedVersion,
    onProgress: ProgressWriter,
  ) {
    const nativeLibraries = version.libraries.filter(
      (library) => library.isNative,
    );
    const destination = safeRelativePath(
      root,
      path.join('versions', version.id, `${version.id}-natives`),
    );
    const marker = JSON.stringify(
      nativeLibraries.map((library) => ({
        name: library.name,
        sha1: library.download.sha1,
        path: library.download.path,
      })),
    );
    const markerPath = path.join(destination, '.simple-craft-natives.json');
    try {
      if ((await fs.readFile(markerPath, 'utf8')) === marker) {
        this.log('debug', 'files', 'nativesは展開済みのため再利用します。', {
          destination,
          libraries: nativeLibraries.length,
        });
        onProgress({
          phase: 'natives',
          percent: 100,
          message: 'nativesは展開済みです',
          file: destination,
        });
        return destination;
      }
    } catch {
      // Missing or stale marker: rebuild the directory below.
    }

    const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
    await fs.rm(temporary, { recursive: true, force: true });
    await fs.mkdir(temporary, { recursive: true });
    try {
      for (let index = 0; index < nativeLibraries.length; index += 1) {
        const library = nativeLibraries[index];
        const archive = resolveLibraryPath(root, library.download.path);
        await this.extractNativeArchive(
          archive,
          temporary,
          library.extractExclude ?? [],
        );
        onProgress({
          phase: 'natives',
          percent: Math.round(((index + 1) / nativeLibraries.length) * 100),
          message: `nativesを展開しています (${index + 1}/${nativeLibraries.length})`,
          file: path.basename(archive),
        });
      }
      await fs.writeFile(
        path.join(temporary, '.simple-craft-natives.json'),
        marker,
        'utf8',
      );
      await fs.rm(destination, { recursive: true, force: true });
      await fs.rename(temporary, destination);
    } catch (error) {
      await fs.rm(temporary, { recursive: true, force: true });
      throw new MinecraftError(
        'Minecraft nativesの展開に失敗しました。',
        'verification',
        'NATIVE_EXTRACTION_FAILED',
        { destination },
        { cause: error },
      );
    }
    this.log('info', 'files', 'Minecraft nativesを展開しました。', {
      destination,
      libraries: nativeLibraries.length,
      os: this.platform.name,
      arch: this.platform.arch,
    });
    return destination;
  }

  private async prepareResolvedVersion(
    root: string,
    version: ResolvedVersion,
    onProgress: ProgressWriter,
  ): Promise<PreparedMinecraftVersion> {
    const clientPath = safeRelativePath(
      root,
      path.join(
        'versions',
        version.minecraftVersion,
        `${version.minecraftVersion}.jar`,
      ),
    );
    onProgress({
      phase: 'client',
      percent: 0,
      message: `client.jar ${version.minecraftVersion} を検証しています`,
      file: clientPath,
    });
    const client = await this.downloadFile(
      {
        url: version.downloads.client.url,
        sha1: version.downloads.client.sha1 || undefined,
        size:
          version.downloads.client.size >= 0
            ? version.downloads.client.size
            : undefined,
      },
      clientPath,
      `Minecraft client.jar ${version.minecraftVersion}`,
    );
    this.log('info', 'files', 'Minecraft client.jarを検証しました。', {
      destination: clientPath,
      sha1: version.downloads.client.sha1 || null,
      size: version.downloads.client.size,
      downloaded: client.downloaded,
    });
    onProgress({
      phase: 'client',
      percent: 100,
      message: 'client.jarの検証が完了しました',
      file: clientPath,
    });

    const libraries = await this.downloadLibraries(root, version, onProgress);
    const logging = await this.downloadLogging(root, version, onProgress);
    const assets = await this.downloadAssets(root, version, onProgress);
    const nativesDirectory = await this.extractNatives(
      root,
      version,
      onProgress,
    );
    return {
      version,
      libraries,
      assets,
      client,
      logging,
      nativesDirectory,
    };
  }

  async prepareVersion(
    versionId: string,
    onProgress: ProgressWriter = () => undefined,
  ) {
    const root = await this.gameDirectory();
    await fs.mkdir(root, { recursive: true });
    this.log('info', 'files', 'Minecraftバージョンの準備を開始します。', {
      versionId,
      gameDirectory: root,
    });
    const manifest = await this.getManifest(onProgress);
    const entry = manifest.find((candidate) => candidate.id === versionId);
    if (!entry) {
      throw new MinecraftError(
        `Mojang version manifestに ${versionId} がありません。`,
        'manifest',
        'VERSION_NOT_FOUND',
        { versionId },
      );
    }
    const versionJsonPath = safeRelativePath(
      root,
      path.join('versions', versionId, `${versionId}.json`),
    );
    onProgress({
      phase: 'version-json',
      percent: 0,
      message: `${versionId} のversion JSONを取得しています`,
      file: versionJsonPath,
    });
    await this.downloadJson<Record<string, unknown>>(
      {
        url: entry.url,
        sha1: entry.sha1,
      },
      versionJsonPath,
      `version JSON ${versionId}`,
    );
    this.log('info', 'files', 'Minecraft version JSONを保存しました。', {
      versionId,
      destination: versionJsonPath,
    });
    onProgress({
      phase: 'version-json',
      percent: 100,
      message: `${versionId} のversion JSONを保存しました`,
      file: versionJsonPath,
    });
    let version: ResolvedVersion;
    try {
      version = await Version.parse(root, versionId, this.platform);
    } catch (error) {
      throw new MinecraftError(
        `${versionId} のversion JSON解決に失敗しました。`,
        'json',
        'VERSION_PARSE_ERROR',
        { versionJsonPath },
        { cause: error },
      );
    }
    return this.prepareResolvedVersion(root, version, onProgress);
  }

  async prepareInstalledVersion(
    versionId: string,
    onProgress: ProgressWriter = () => undefined,
  ) {
    const root = await this.gameDirectory();
    let version: ResolvedVersion;
    try {
      version = await Version.parse(root, versionId, this.platform);
    } catch (error) {
      throw new MinecraftError(
        `インストール済みバージョン ${versionId} を解析できません。`,
        'json',
        'VERSION_PARSE_ERROR',
        { versionId },
        { cause: error },
      );
    }
    return this.prepareResolvedVersion(root, version, onProgress);
  }
}
