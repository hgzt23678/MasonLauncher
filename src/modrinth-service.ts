import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { WebContents } from 'electron';
import type {
  LauncherLogLevel,
  LauncherLogStage,
} from './diagnostics';
import { ensureInstanceSubdirectory } from './instance-paths';

const defaultApiBase = 'https://api.modrinth.com/v2';
// A unique, contactable User-Agent is required by Modrinth's API guidelines.
const defaultUserAgent =
  'hgzt23678/MasonLauncher/1.4.1 (https://github.com/hgzt23678)';
const defaultMaxDownloadBytes = 512 * 1024 * 1024;
const defaultDownloadHosts = ['cdn.modrinth.com', 'api.modrinth.com'];

type LogWriter = (
  level: LauncherLogLevel,
  stage: LauncherLogStage,
  message: string,
  detail?: Record<string, unknown>,
) => void;

// --- Foundation types (Modrinth API v2) -----------------------------------

export type ModrinthLoader = 'forge' | 'fabric' | 'quilt' | 'neoforge';

export type ModrinthReleaseChannel = 'release' | 'beta' | 'alpha';

export type ModrinthDependencyType =
  | 'required'
  | 'optional'
  | 'incompatible'
  | 'embedded';

export type ModrinthSideSupport =
  | 'required'
  | 'optional'
  | 'unsupported'
  | 'unknown';

export type ModrinthSearchHit = {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  iconUrl: string | null;
  downloads: number;
  follows: number;
  categories: string[];
  clientSide: ModrinthSideSupport;
  serverSide: ModrinthSideSupport;
  latestVersion: string | null;
};

export type ModrinthProjectDetail = {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  iconUrl: string | null;
  downloads: number;
  follows: number;
  categories: string[];
  clientSide: ModrinthSideSupport;
  serverSide: ModrinthSideSupport;
  loaders: string[];
  gameVersions: string[];
};

export type ModrinthDependency = {
  projectId: string | null;
  versionId: string | null;
  fileName: string | null;
  dependencyType: ModrinthDependencyType;
};

export type ModrinthVersionFile = {
  url: string;
  filename: string;
  primary: boolean;
  size: number;
  sha1: string | null;
  sha512: string | null;
};

export type ModrinthVersionInfo = {
  id: string;
  projectId: string;
  name: string;
  versionNumber: string;
  versionType: ModrinthReleaseChannel;
  gameVersions: string[];
  loaders: string[];
  datePublished: string | null;
  files: ModrinthVersionFile[];
  dependencies: ModrinthDependency[];
};

export type InstalledModRecord = {
  projectId: string | null;
  versionId: string;
  fileName: string;
  title: string;
  sha1: string | null;
  sha512: string | null;
  loader: string;
  minecraftVersion: string;
  dateInstalled: string;
  source: 'modrinth';
};

export type DownloadVersionResult = {
  fileName: string;
  filePath: string;
  alreadyPresent: boolean;
  renamed: boolean;
  record: InstalledModRecord;
  requiredDependencies: ModrinthDependency[];
  optionalDependencies: ModrinthDependency[];
  incompatibleDependencies: ModrinthDependency[];
  embeddedDependencies: ModrinthDependency[];
};

export type ModrinthErrorKind =
  | 'invalid-input'
  | 'network'
  | 'not-found'
  | 'rate-limited'
  | 'server'
  | 'http'
  | 'no-compatible-version'
  | 'no-loader'
  | 'no-files'
  | 'download-failed'
  | 'hash-mismatch'
  | 'write-permission'
  | 'file-conflict';

export class ModrinthError extends Error {
  constructor(
    message: string,
    readonly kind: ModrinthErrorKind,
    readonly detail?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ModrinthError';
  }
}

// --- Legacy types (used by the existing Forge auto-sync flow) --------------

export type ModrinthProject = {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  iconUrl: string | null;
  downloads: number;
};

export type ProfileMod = Pick<
  ModrinthProject,
  'projectId' | 'slug' | 'title' | 'iconUrl'
>;

type SearchResponse = {
  hits: Array<{
    project_id: string;
    slug: string;
    title: string;
    description: string;
    icon_url: string | null;
    downloads: number;
    follows?: number;
    categories?: string[];
    client_side?: string;
    server_side?: string;
    latest_version?: string | null;
  }>;
};

type ModrinthVersion = {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  dependencies: Array<{
    version_id: string | null;
    project_id: string | null;
    dependency_type: string;
  }>;
  files: Array<{
    hashes: {
      sha1?: string;
    };
    url: string;
    filename: string;
    primary: boolean;
  }>;
};

// Fuller raw shape used by the new foundation mappers.
type RawModrinthVersion = {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  version_type?: string;
  date_published?: string;
  game_versions?: string[];
  loaders?: string[];
  dependencies?: Array<{
    version_id?: string | null;
    project_id?: string | null;
    file_name?: string | null;
    dependency_type?: string;
  }>;
  files?: Array<{
    hashes?: { sha1?: string; sha512?: string };
    url: string;
    filename: string;
    primary?: boolean;
    size?: number;
  }>;
};

type RawModrinthProject = {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon_url?: string | null;
  downloads?: number;
  follows?: number;
  followers?: number;
  categories?: string[];
  client_side?: string;
  server_side?: string;
  loaders?: string[];
  game_versions?: string[];
};

type ResolvedMod = {
  projectId: string;
  title: string;
  version: ModrinthVersion;
};

type ManagedModsFile = {
  files: string[];
};

type InstalledModsFile = {
  version: number;
  mods: InstalledModRecord[];
};

const installedModsFileName = 'installed-mods.json';

const sideSupport = (value: unknown): ModrinthSideSupport =>
  value === 'required' ||
  value === 'optional' ||
  value === 'unsupported' ||
  value === 'unknown'
    ? value
    : 'unknown';

const releaseChannel = (value: unknown): ModrinthReleaseChannel =>
  value === 'beta' || value === 'alpha' ? value : 'release';

const dependencyType = (value: unknown): ModrinthDependencyType =>
  value === 'optional' || value === 'incompatible' || value === 'embedded'
    ? value
    : 'required';

const channelRank: Record<ModrinthReleaseChannel, number> = {
  release: 0,
  beta: 1,
  alpha: 2,
};

const normalizeSearchName = (value: string) =>
  value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');

export const rankModrinthNameMatches = (
  hits: ModrinthSearchHit[],
  query: string,
) => {
  const normalizedQuery = normalizeSearchName(query);
  if (!normalizedQuery) return hits;
  const rank = (hit: ModrinthSearchHit) => {
    const title = normalizeSearchName(hit.title);
    const slug = normalizeSearchName(hit.slug).replace(/[-_]+/g, ' ');
    if (title === normalizedQuery || slug === normalizedQuery) return 0;
    if (
      title.startsWith(normalizedQuery) ||
      slug.startsWith(normalizedQuery)
    ) {
      return 1;
    }
    return 2;
  };
  return hits
    .filter((hit) => {
      const title = normalizeSearchName(hit.title);
      const slug = normalizeSearchName(hit.slug).replace(/[-_]+/g, ' ');
      return (
        title.includes(normalizedQuery) ||
        slug.includes(normalizedQuery)
      );
    })
    .sort(
      (left, right) =>
        rank(left) - rank(right) || right.downloads - left.downloads,
    );
};

const classifyWriteError = (error: unknown, destination: string) => {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  if (
    code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'EROFS' ||
    code === 'ENOSPC'
  ) {
    return new ModrinthError(
      'MODファイルを保存できませんでした（書き込み権限またはディスク容量を確認してください）。',
      'write-permission',
      { destination, code },
      { cause: error },
    );
  }
  return new ModrinthError(
    `MODファイルの保存に失敗しました: ${
      error instanceof Error ? error.message : String(error)
    }`,
    'download-failed',
    { destination, code },
    { cause: error },
  );
};

export class ModrinthService {
  private readonly apiBase: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly allowInsecureDownloads: boolean;
  private readonly allowedDownloadHosts: Set<string>;
  private readonly maxDownloadBytes: number;

  constructor(
    private readonly log: LogWriter = () => undefined,
    options: {
      apiBase?: string;
      userAgent?: string;
      fetchImpl?: typeof fetch;
      allowInsecureDownloads?: boolean;
      allowedDownloadHosts?: string[];
      maxDownloadBytes?: number;
    } = {},
  ) {
    this.apiBase = options.apiBase ?? defaultApiBase;
    this.userAgent = options.userAgent ?? defaultUserAgent;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.allowInsecureDownloads = options.allowInsecureDownloads === true;
    this.allowedDownloadHosts = new Set(
      options.allowedDownloadHosts ?? defaultDownloadHosts,
    );
    this.maxDownloadBytes =
      options.maxDownloadBytes ?? defaultMaxDownloadBytes;
  }

  private validateDownloadUrl(value: string) {
    let url: URL;
    try {
      url = new URL(value);
    } catch (error) {
      throw new ModrinthError(
        'Modrinth download URL is invalid.',
        'invalid-input',
        { url: value },
        { cause: error },
      );
    }
    if (!this.allowInsecureDownloads && url.protocol !== 'https:') {
      throw new ModrinthError(
        'Modrinth downloads must use HTTPS.',
        'invalid-input',
        { protocol: url.protocol, host: url.host },
      );
    }
    if (
      !this.allowInsecureDownloads &&
      !this.allowedDownloadHosts.has(url.hostname) &&
      !url.hostname.endsWith('.modrinth.com')
    ) {
      throw new ModrinthError(
        'Modrinth download host is not allowed.',
        'invalid-input',
        { host: url.hostname },
      );
    }
    return url;
  }

  private safeModFileName(fileName: string, fallbackId: string) {
    const baseName = path.basename(fileName)
      .replace(/[<>:"/\\|?*]/g, '-')
      .split('')
      .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
      .join('')
      .replace(/[ .]+$/g, '')
      .slice(0, 180);
    const fallback = `mod-${fallbackId
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .slice(0, 80)}.jar`;
    const normalized = baseName || fallback;
    return normalized.toLowerCase().endsWith('.jar')
      ? normalized
      : `${normalized}.jar`;
  }

  private async requestJson<T>(url: URL | string): Promise<T> {
    const requestUrl = new URL(url);
    let response: Response;
    try {
      response = await this.fetchImpl(requestUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': this.userAgent,
        },
      });
    } catch (error) {
      this.log('error', 'mods', 'Modrinth APIへの接続に失敗しました。', {
        host: requestUrl.host,
        message: error instanceof Error ? error.message : String(error),
      });
      throw new ModrinthError(
        'Modrinth APIに接続できませんでした（ネットワークを確認してください）。',
        'network',
        { url: requestUrl.toString(), host: requestUrl.host },
        { cause: error },
      );
    }
    if (!response.ok) {
      const kind: ModrinthErrorKind =
        response.status === 404
          ? 'not-found'
          : response.status === 429
            ? 'rate-limited'
            : response.status >= 500
              ? 'server'
              : 'http';
      const retryAfter = response.headers.get('retry-after');
      this.log('error', 'mods', 'Modrinth APIがエラーを返しました。', {
        url: requestUrl.toString(),
        status: response.status,
        retryAfter: retryAfter ?? undefined,
      });
      throw new ModrinthError(
        kind === 'rate-limited'
          ? 'Modrinth APIのレート制限に達しました。しばらく待って再試行してください。'
          : `Modrinth APIへの接続に失敗しました（HTTP ${response.status}）。`,
        kind,
        {
          url: requestUrl.toString(),
          status: response.status,
          retryAfter: retryAfter ?? undefined,
        },
      );
    }
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new ModrinthError(
        'Modrinth APIの応答を解析できませんでした。',
        'http',
        { url: requestUrl.toString() },
        { cause: error },
      );
    }
  }

  // --- New foundation: search ---------------------------------------------

  async searchMods(
    query: string,
    options: {
      gameVersion?: string;
      loader?: ModrinthLoader;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<ModrinthSearchHit[]> {
    const url = new URL(`${this.apiBase}/search`);
    const trimmed = query.trim();
    if (trimmed) {
      url.searchParams.set('query', trimmed);
    }
    const facets: string[][] = [['project_type:mod']];
    if (options.loader) {
      facets.push([`categories:${options.loader}`]);
    }
    if (options.gameVersion) {
      facets.push([`versions:${options.gameVersion}`]);
    }
    url.searchParams.set('facets', JSON.stringify(facets));
    url.searchParams.set('index', trimmed ? 'relevance' : 'downloads');
    url.searchParams.set(
      'limit',
      String(Math.min(100, Math.max(1, Math.round(options.limit ?? 20)))),
    );
    url.searchParams.set(
      'offset',
      String(Math.max(0, Math.round(options.offset ?? 0))),
    );

    const result = await this.requestJson<SearchResponse>(url);
    const hits = result.hits.map((hit) => ({
      projectId: hit.project_id,
      slug: hit.slug,
      title: hit.title,
      description: hit.description,
      iconUrl: hit.icon_url ?? null,
      downloads: hit.downloads ?? 0,
      follows: hit.follows ?? 0,
      categories: Array.isArray(hit.categories) ? hit.categories : [],
      clientSide: sideSupport(hit.client_side),
      serverSide: sideSupport(hit.server_side),
      latestVersion: hit.latest_version ?? null,
    }));
    return trimmed ? rankModrinthNameMatches(hits, trimmed) : hits;
  }

  // --- New foundation: project details ------------------------------------

  async getProject(idOrSlug: string): Promise<ModrinthProjectDetail> {
    const id = idOrSlug.trim();
    if (!id) {
      throw new ModrinthError(
        'プロジェクトIDまたはslugを指定してください。',
        'invalid-input',
      );
    }
    const raw = await this.requestJson<RawModrinthProject>(
      `${this.apiBase}/project/${encodeURIComponent(id)}`,
    );
    return {
      projectId: raw.id,
      slug: raw.slug,
      title: raw.title,
      description: raw.description,
      iconUrl: raw.icon_url ?? null,
      downloads: raw.downloads ?? 0,
      follows: raw.followers ?? raw.follows ?? 0,
      categories: Array.isArray(raw.categories) ? raw.categories : [],
      clientSide: sideSupport(raw.client_side),
      serverSide: sideSupport(raw.server_side),
      loaders: Array.isArray(raw.loaders) ? raw.loaders : [],
      gameVersions: Array.isArray(raw.game_versions) ? raw.game_versions : [],
    };
  }

  // --- New foundation: versions -------------------------------------------

  private mapVersion(raw: RawModrinthVersion): ModrinthVersionInfo {
    return {
      id: raw.id,
      projectId: raw.project_id,
      name: raw.name,
      versionNumber: raw.version_number,
      versionType: releaseChannel(raw.version_type),
      gameVersions: Array.isArray(raw.game_versions) ? raw.game_versions : [],
      loaders: Array.isArray(raw.loaders) ? raw.loaders : [],
      datePublished: raw.date_published ?? null,
      files: (raw.files ?? []).map((file) => ({
        url: file.url,
        filename: file.filename,
        primary: Boolean(file.primary),
        size: typeof file.size === 'number' ? file.size : 0,
        sha1: file.hashes?.sha1 ?? null,
        sha512: file.hashes?.sha512 ?? null,
      })),
      dependencies: (raw.dependencies ?? []).map((dependency) => ({
        projectId: dependency.project_id ?? null,
        versionId: dependency.version_id ?? null,
        fileName: dependency.file_name ?? null,
        dependencyType: dependencyType(dependency.dependency_type),
      })),
    };
  }

  async getProjectVersions(
    idOrSlug: string,
    options: {
      loaders?: ModrinthLoader[];
      gameVersions?: string[];
    } = {},
  ): Promise<ModrinthVersionInfo[]> {
    const id = idOrSlug.trim();
    if (!id) {
      throw new ModrinthError(
        'プロジェクトIDまたはslugを指定してください。',
        'invalid-input',
      );
    }
    const url = new URL(
      `${this.apiBase}/project/${encodeURIComponent(id)}/version`,
    );
    if (options.loaders && options.loaders.length > 0) {
      url.searchParams.set('loaders', JSON.stringify(options.loaders));
    }
    if (options.gameVersions && options.gameVersions.length > 0) {
      url.searchParams.set(
        'game_versions',
        JSON.stringify(options.gameVersions),
      );
    }
    // Avoid pulling unnecessarily heavy changelog payloads.
    url.searchParams.set('include_changelog', 'false');

    const raw = await this.requestJson<RawModrinthVersion[]>(url);
    return raw
      .map((version) => this.mapVersion(version))
      .sort((left, right) => {
        const rank =
          channelRank[left.versionType] - channelRank[right.versionType];
        if (rank !== 0) {
          return rank;
        }
        const leftTime = left.datePublished
          ? Date.parse(left.datePublished)
          : NaN;
        const rightTime = right.datePublished
          ? Date.parse(right.datePublished)
          : NaN;
        if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
          return rightTime - leftTime;
        }
        return 0;
      });
  }

  async getVersionInfo(versionId: string): Promise<ModrinthVersionInfo> {
    const id = versionId.trim();
    if (!id) {
      throw new ModrinthError('バージョンIDを指定してください。', 'invalid-input');
    }
    const raw = await this.requestJson<RawModrinthVersion>(
      `${this.apiBase}/version/${encodeURIComponent(id)}`,
    );
    return this.mapVersion(raw);
  }

  /**
   * Selects the best version for a given loader / Minecraft version. Returns
   * `null` when nothing matches so callers can distinguish "no compatible
   * version" from a transport failure.
   */
  selectBestVersion(
    versions: ModrinthVersionInfo[],
    options: {
      allowedChannels?: ModrinthReleaseChannel[];
    } = {},
  ): ModrinthVersionInfo | null {
    const allowed = new Set(options.allowedChannels ?? ['release']);
    const usable = versions.filter((version) => version.files.length > 0);
    return (
      usable.find((version) => allowed.has(version.versionType)) ??
      usable[0] ??
      null
    );
  }

  // --- New foundation: download-target file selection ---------------------

  selectDownloadFile(version: ModrinthVersionInfo): ModrinthVersionFile {
    const excluded = /-(sources|javadoc|dev|deobf|api|slim)\.jar$/i;
    const jarFiles = version.files.filter(
      (file) =>
        file.filename.toLowerCase().endsWith('.jar') &&
        !excluded.test(file.filename),
    );
    const pool = jarFiles.length > 0 ? jarFiles : version.files;
    const chosen = pool.find((file) => file.primary) ?? pool[0];
    if (!chosen) {
      throw new ModrinthError(
        'このバージョンにダウンロード可能なファイルがありません。',
        'no-files',
        { versionId: version.id },
      );
    }
    return chosen;
  }

  private groupDependencies(version: ModrinthVersionInfo) {
    const byType = (type: ModrinthDependencyType) =>
      version.dependencies.filter(
        (dependency) =>
          dependency.dependencyType === type &&
          (dependency.projectId || dependency.versionId),
      );
    return {
      requiredDependencies: byType('required'),
      optionalDependencies: byType('optional'),
      incompatibleDependencies: byType('incompatible'),
      embeddedDependencies: byType('embedded'),
    };
  }

  // --- New foundation: download -------------------------------------------

  async downloadVersion(
    params: {
      instanceDirectory: string;
      version: ModrinthVersionInfo;
      loader: string;
      minecraftVersion: string;
      title?: string;
    },
    sender?: WebContents,
  ): Promise<DownloadVersionResult> {
    const { instanceDirectory, version, loader, minecraftVersion } = params;
    const file = this.selectDownloadFile(version);
    const safeFileName = this.safeModFileName(file.filename, version.id);
    if (!safeFileName.toLowerCase().endsWith('.jar')) {
      throw new ModrinthError(
        `Modrinthが返したファイル名「${file.filename}」はMOD jarとして扱えません。`,
        'no-files',
        { versionId: version.id, filename: file.filename },
      );
    }

    const modsDirectory = await ensureInstanceSubdirectory(
      instanceDirectory,
      'mods',
    );
    try {
      await fs.mkdir(modsDirectory, { recursive: true });
    } catch (error) {
      throw classifyWriteError(error, modsDirectory);
    }

    const title = params.title?.trim() || version.name || safeFileName;
    let targetName = safeFileName;
    let target = path.join(modsDirectory, targetName);
    let alreadyPresent = false;
    let renamed = false;

    const existing = await this.hashFile(target);
    if (existing) {
      if (this.matchesHashes(existing, file)) {
        alreadyPresent = true;
      } else {
        // Never overwrite an unrelated file with the same name: write the
        // new mod under a collision-safe name derived from the version id.
        const base = targetName.replace(/\.jar$/i, '');
        const safeVersionId = version.id.replace(/[^a-zA-Z0-9-]/g, '-');
        targetName = `${base}-${safeVersionId}.jar`;
        target = path.join(modsDirectory, targetName);
        renamed = true;
        const renamedExisting = await this.hashFile(target);
        if (renamedExisting && this.matchesHashes(renamedExisting, file)) {
          alreadyPresent = true;
        }
      }
    }

    let resultSha1 = file.sha1;
    let resultSha512 = file.sha512;
    if (!alreadyPresent) {
      this.log('info', 'mods', 'ModrinthからMODをダウンロードします。', {
        title,
        fileName: targetName,
        url: file.url,
        destination: target,
      });
      const hashes = await this.downloadToFile(file, target, (received, total) => {
        if (sender && !sender.isDestroyed()) {
          sender.send('modrinth:download-progress', {
            projectId: version.projectId,
            versionId: version.id,
            fileName: targetName,
            title,
            received,
            total,
            percent:
              total > 0 ? Math.round((received / total) * 100) : 0,
            phase: 'downloading',
          });
        }
      });
      resultSha1 = hashes.sha1;
      resultSha512 = hashes.sha512;
    }

    if (sender && !sender.isDestroyed()) {
      sender.send('modrinth:download-progress', {
        projectId: version.projectId,
        versionId: version.id,
        fileName: targetName,
        title,
        percent: 100,
        phase: 'complete',
      });
    }

    const record: InstalledModRecord = {
      projectId: version.projectId || null,
      versionId: version.id,
      fileName: targetName,
      title,
      sha1: resultSha1 ?? null,
      sha512: resultSha512 ?? null,
      loader,
      minecraftVersion,
      dateInstalled: new Date().toISOString(),
      source: 'modrinth',
    };
    await this.upsertInstalledMod(instanceDirectory, record);

    this.log('info', 'mods', 'MODのインストールが完了しました。', {
      title,
      fileName: targetName,
      alreadyPresent,
      renamed,
    });

    return {
      fileName: targetName,
      filePath: target,
      alreadyPresent,
      renamed,
      record,
      ...this.groupDependencies(version),
    };
  }

  private matchesHashes(
    actual: { sha1: string; sha512: string },
    file: ModrinthVersionFile,
  ) {
    if (file.sha1) {
      return actual.sha1 === file.sha1;
    }
    if (file.sha512) {
      return actual.sha512 === file.sha512;
    }
    return false;
  }

  private async hashFile(
    target: string,
  ): Promise<{ sha1: string; sha512: string } | null> {
    try {
      const data = await fs.readFile(target);
      return {
        sha1: createHash('sha1').update(data).digest('hex'),
        sha512: createHash('sha512').update(data).digest('hex'),
      };
    } catch {
      return null;
    }
  }

  private async downloadToFile(
    file: ModrinthVersionFile,
    destination: string,
    onProgress?: (received: number, total: number) => void,
  ): Promise<{ sha1: string; sha512: string; size: number }> {
    const requestedUrl = this.validateDownloadUrl(file.url);
    let response: Response;
    try {
      response = await this.fetchImpl(requestedUrl, {
        headers: { 'User-Agent': this.userAgent },
      });
    } catch (error) {
      throw new ModrinthError(
        'Failed to download the MOD due to a network error.',
        'network',
        { url: file.url, destination },
        { cause: error },
      );
    }

    this.validateDownloadUrl(response.url || requestedUrl.toString());
    if (!response.ok) {
      throw new ModrinthError(
        `Failed to download the MOD (HTTP ${response.status}).`,
        response.status === 404
          ? 'not-found'
          : response.status === 429
            ? 'rate-limited'
            : response.status >= 500
              ? 'server'
              : 'download-failed',
        { url: file.url, destination, status: response.status },
      );
    }

    const contentLength = Number(response.headers.get('content-length')) || 0;
    const declaredSize = file.size > 0 ? file.size : 0;
    const total = declaredSize || contentLength;
    if (
      declaredSize > this.maxDownloadBytes ||
      contentLength > this.maxDownloadBytes
    ) {
      throw new ModrinthError(
        'MOD file exceeds the configured download size limit.',
        'download-failed',
        {
          url: file.url,
          declaredSize,
          contentLength,
          maxDownloadBytes: this.maxDownloadBytes,
        },
      );
    }

    const temporary = `${destination}.tmp-${randomUUID()}`;
    const sha1 = createHash('sha1');
    const sha512 = createHash('sha512');
    const output = createWriteStream(temporary, { flags: 'wx' });
    let received = 0;
    try {
      if (!response.body) {
        throw new ModrinthError(
          'MOD download returned an empty response body.',
          'download-failed',
          { url: file.url, destination },
        );
      }
      for await (const value of Readable.fromWeb(response.body as never)) {
        const chunk = Buffer.from(value as Uint8Array);
        received += chunk.length;
        if (received > this.maxDownloadBytes) {
          throw new ModrinthError(
            'MOD file exceeded the configured download size limit.',
            'download-failed',
            {
              url: file.url,
              received,
              maxDownloadBytes: this.maxDownloadBytes,
            },
          );
        }
        sha1.update(chunk);
        sha512.update(chunk);
        if (!output.write(chunk)) {
          await once(output, 'drain');
        }
        onProgress?.(received, total);
      }

      const closed = once(output, 'close');
      output.end();
      await closed;

      if (declaredSize && received !== declaredSize) {
        throw new ModrinthError(
          'Downloaded MOD size does not match the Modrinth declaration.',
          'download-failed',
          { url: file.url, expected: declaredSize, actual: received },
        );
      }
      if (contentLength && received !== contentLength) {
        throw new ModrinthError(
          'Downloaded MOD size does not match the HTTP Content-Length.',
          'download-failed',
          { url: file.url, expected: contentLength, actual: received },
        );
      }

      const actualSha1 = sha1.digest('hex');
      const actualSha512 = sha512.digest('hex');
      if (file.sha1 && actualSha1 !== file.sha1) {
        throw new ModrinthError(
          'Downloaded MOD SHA-1 does not match the Modrinth declaration.',
          'hash-mismatch',
          { url: file.url, destination },
        );
      }
      if (file.sha512 && actualSha512 !== file.sha512) {
        throw new ModrinthError(
          'Downloaded MOD SHA-512 does not match the Modrinth declaration.',
          'hash-mismatch',
          { url: file.url, destination },
        );
      }

      await fs.rm(destination, { force: true });
      await fs.rename(temporary, destination);
      return { sha1: actualSha1, sha512: actualSha512, size: received };
    } catch (error) {
      output.destroy();
      await fs.rm(temporary, { force: true }).catch(() => {});
      if (error instanceof ModrinthError) {
        throw error;
      }
      throw classifyWriteError(error, destination);
    }
  }

  // --- New foundation: installed-mods.json management ---------------------

  private installedModsPath(instanceDirectory: string) {
    return path.join(instanceDirectory, installedModsFileName);
  }

  private async readInstalledModsFile(
    instanceDirectory: string,
  ): Promise<InstalledModsFile> {
    try {
      const parsed = JSON.parse(
        await fs.readFile(this.installedModsPath(instanceDirectory), 'utf8'),
      ) as Partial<InstalledModsFile>;
      const mods = Array.isArray(parsed.mods)
        ? parsed.mods.filter(
            (mod): mod is InstalledModRecord =>
              Boolean(
                mod &&
                  typeof mod.fileName === 'string' &&
                  typeof mod.versionId === 'string',
              ),
          )
        : [];
      return { version: 1, mods };
    } catch {
      // Missing or unreadable file: treat as no managed mods so launch and
      // manually-placed mods keep working.
      return { version: 1, mods: [] };
    }
  }

  private async writeInstalledModsFile(
    instanceDirectory: string,
    file: InstalledModsFile,
  ) {
    const target = this.installedModsPath(instanceDirectory);
    try {
      await fs.mkdir(instanceDirectory, { recursive: true });
      await fs.writeFile(target, JSON.stringify(file, null, 2), 'utf8');
    } catch (error) {
      throw classifyWriteError(error, target);
    }
  }

  private async upsertInstalledMod(
    instanceDirectory: string,
    record: InstalledModRecord,
  ) {
    const file = await this.readInstalledModsFile(instanceDirectory);
    const next = file.mods.filter((mod) =>
      record.projectId
        ? mod.projectId !== record.projectId
        : mod.fileName !== record.fileName,
    );
    next.push(record);
    await this.writeInstalledModsFile(instanceDirectory, {
      version: 1,
      mods: next,
    });
  }

  async listInstalledMods(
    instanceDirectory: string,
  ): Promise<InstalledModRecord[]> {
    return (await this.readInstalledModsFile(instanceDirectory)).mods;
  }

  async removeInstalledMod(
    instanceDirectory: string,
    projectIdOrFileName: string,
  ): Promise<{ removed: boolean; mods: InstalledModRecord[] }> {
    const file = await this.readInstalledModsFile(instanceDirectory);
    const target = file.mods.find(
      (mod) =>
        mod.projectId === projectIdOrFileName ||
        mod.fileName === projectIdOrFileName,
    );
    if (!target) {
      return { removed: false, mods: file.mods };
    }
    const safeFileName = path.basename(target.fileName);
    if (safeFileName === target.fileName && safeFileName.endsWith('.jar')) {
      const modsDirectory = await ensureInstanceSubdirectory(
        instanceDirectory,
        'mods',
      );
      await fs
        .rm(path.join(modsDirectory, safeFileName), {
          force: true,
        })
        .catch((error) => {
          this.log('warn', 'mods', 'MOD jarの削除に失敗しました。', {
            fileName: safeFileName,
            message: error instanceof Error ? error.message : String(error),
          });
        });
    }
    const mods = file.mods.filter((mod) => mod !== target);
    await this.writeInstalledModsFile(instanceDirectory, { version: 1, mods });
    this.log('info', 'mods', 'インストール済みMODを削除しました。', {
      fileName: target.fileName,
      projectId: target.projectId ?? undefined,
    });
    return { removed: true, mods };
  }

  // --- Legacy Forge auto-sync flow (unchanged behaviour) ------------------

  async search(
    query: string,
    gameVersion: string,
    loader: 'forge',
  ): Promise<ModrinthProject[]> {
    const hits = await this.searchMods(query, { gameVersion, loader });
    return hits.map((hit) => ({
      projectId: hit.projectId,
      slug: hit.slug,
      title: hit.title,
      description: hit.description,
      iconUrl: hit.iconUrl,
      downloads: hit.downloads,
    }));
  }

  private async getVersion(versionId: string) {
    return this.requestJson<ModrinthVersion>(
      `${this.apiBase}/version/${encodeURIComponent(versionId)}`,
    );
  }

  private async getLatestVersion(
    projectId: string,
    gameVersion: string,
    loader: 'forge',
  ) {
    const url = new URL(
      `${this.apiBase}/project/${encodeURIComponent(projectId)}/version`,
    );
    url.searchParams.set('loaders', JSON.stringify([loader]));
    url.searchParams.set('game_versions', JSON.stringify([gameVersion]));
    url.searchParams.set('include_changelog', 'false');
    const versions = await this.requestJson<ModrinthVersion[]>(url);
    const version = versions.find((candidate) => candidate.files.length > 0);
    if (!version) {
      throw new ModrinthError(
        `「${projectId}」にMinecraft ${gameVersion} / Forge対応ファイルがありません。`,
        'no-compatible-version',
        { projectId, gameVersion },
      );
    }
    return version;
  }

  private async resolveMods(
    selected: ProfileMod[],
    gameVersion: string,
  ): Promise<ResolvedMod[]> {
    const resolved = new Map<string, ResolvedMod>();
    const resolving = new Set<string>();

    const resolveProject = async (
      projectId: string,
      title: string,
      versionId?: string,
    ) => {
      if (resolved.has(projectId) || resolving.has(projectId)) {
        return;
      }
      resolving.add(projectId);
      const version = versionId
        ? await this.getVersion(versionId)
        : await this.getLatestVersion(projectId, gameVersion, 'forge');
      resolved.set(projectId, { projectId, title, version });

      for (const dependency of version.dependencies) {
        if (
          dependency.dependency_type !== 'required' ||
          (!dependency.project_id && !dependency.version_id)
        ) {
          continue;
        }
        if (dependency.version_id) {
          const dependencyVersion = await this.getVersion(
            dependency.version_id,
          );
          await resolveProject(
            dependencyVersion.project_id,
            dependencyVersion.name,
            dependency.version_id,
          );
        } else if (dependency.project_id) {
          await resolveProject(dependency.project_id, dependency.project_id);
        }
      }
      resolving.delete(projectId);
    };

    for (const mod of selected) {
      await resolveProject(mod.projectId, mod.title);
    }
    return [...resolved.values()];
  }

  private async sha1(file: string) {
    const hash = createHash('sha1');
    hash.update(await fs.readFile(file));
    return hash.digest('hex');
  }

  private async download(
    url: string,
    destination: string,
    expectedSha1?: string,
  ) {
    try {
      if (expectedSha1 && (await this.sha1(destination)) === expectedSha1) {
        return;
      }
    } catch {
      // The destination does not exist or is unreadable.
    }
    await this.downloadToFile(
      {
        url,
        filename: path.basename(destination),
        primary: true,
        size: 0,
        sha1: expectedSha1 ?? null,
        sha512: null,
      },
      destination,
    );
  }

  async syncMods(
    instanceDirectory: string,
    selected: ProfileMod[],
    gameVersion: string,
    sender: WebContents,
  ) {
    this.log('info', 'mods', 'プロファイルMODの同期を開始します。', {
      gameVersion,
      selectedMods: selected.length,
      instanceDirectory,
    });
    const modsDirectory = await ensureInstanceSubdirectory(
      instanceDirectory,
      'mods',
    );
    const managedFile = path.join(instanceDirectory, '.simple-craft-mods.json');
    await fs.mkdir(modsDirectory, { recursive: true });
    const resolved = await this.resolveMods(selected, gameVersion);
    const files: string[] = [];

    for (const [index, mod] of resolved.entries()) {
      const file =
        mod.version.files.find((candidate) => candidate.primary) ??
        mod.version.files[0];
      if (!file) {
        continue;
      }
      const safeFileName = path.basename(file.filename);
      if (safeFileName !== file.filename || !safeFileName.endsWith('.jar')) {
        throw new ModrinthError(
          `Modrinthが返したファイル名「${file.filename}」は使用できません。`,
          'no-files',
          { filename: file.filename },
        );
      }
      sender.send('minecraft:progress', {
        phase: 'mods',
        percent:
          resolved.length > 0
            ? Math.round(((index + 1) / resolved.length) * 100)
            : 100,
        message: `ModrinthからMODを同期中: ${mod.title}`,
        file: safeFileName,
      });
      await this.download(
        file.url,
        path.join(modsDirectory, safeFileName),
        file.hashes.sha1,
      );
      files.push(safeFileName);
    }

    let previous: ManagedModsFile = { files: [] };
    try {
      previous = JSON.parse(
        await fs.readFile(managedFile, 'utf8'),
      ) as ManagedModsFile;
    } catch {
      // This is the first sync for this profile.
    }
    for (const oldFile of previous.files) {
      if (
        path.basename(oldFile) === oldFile &&
        oldFile.endsWith('.jar') &&
        !files.includes(oldFile)
      ) {
        await fs.rm(path.join(modsDirectory, oldFile), { force: true });
      }
    }
    await fs.writeFile(
      managedFile,
      JSON.stringify({ files }, null, 2),
      'utf8',
    );
    this.log('info', 'mods', 'プロファイルMODの同期が完了しました。', {
      gameVersion,
      installedFiles: files.length,
    });
  }
}
