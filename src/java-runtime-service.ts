import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { open, readEntry, walkEntriesGenerator } from '@xmcl/unzip';
import type {
  LauncherLogLevel,
  LauncherLogStage,
} from './diagnostics';
import { MinecraftError } from './minecraft-errors';
import { parseJavaMajorVersion } from './minecraft-launch-resolver';

const execFileAsync = promisify(execFile);

const discoApiBase = 'https://api.foojay.io/disco/v3.0';
const userAgent =
  'hgzt23678/MasonLauncher/1.4.1 (https://github.com/hgzt23678)';

type LogWriter = (
  level: LauncherLogLevel,
  stage: LauncherLogStage,
  message: string,
  detail?: Record<string, unknown>,
) => void;

// --- Distributions ---------------------------------------------------------

export const knownDistributions = [
  'liberica-lite',
  'liberica',
  'zulu',
  'temurin',
] as const;

export type JavaDistributionId = (typeof knownDistributions)[number];

export const defaultPreferredDistributions: JavaDistributionId[] = [
  'liberica-lite',
  'liberica',
  'zulu',
  'temurin',
];

export const distributionLabels: Record<JavaDistributionId, string> = {
  'liberica-lite': 'Liberica Lite',
  liberica: 'Liberica Standard',
  zulu: 'Azul Zulu',
  temurin: 'Eclipse Temurin',
};

type DistributionSpec = {
  /** Foojay Disco API distribution parameter. */
  discoName: string;
  /** Narrows the Disco package list (e.g. Liberica "lite" bundles). */
  packageFilter: (filename: string) => boolean;
};

const distributionSpecs: Record<JavaDistributionId, DistributionSpec> = {
  'liberica-lite': {
    discoName: 'liberica',
    packageFilter: (filename) => filename.includes('-lite'),
  },
  liberica: {
    discoName: 'liberica',
    packageFilter: (filename) => !filename.includes('-lite'),
  },
  zulu: {
    discoName: 'zulu',
    packageFilter: () => true,
  },
  temurin: {
    discoName: 'temurin',
    packageFilter: () => true,
  },
};

const isKnownDistribution = (value: unknown): value is JavaDistributionId =>
  typeof value === 'string' &&
  (knownDistributions as readonly string[]).includes(value);

// --- Minecraft version → Java major rules ----------------------------------

export type JavaVersionRule = {
  /** Inclusive lower bound such as '1.17'. Unbounded when omitted. */
  from?: string;
  /** Inclusive upper bound such as '1.16.5'. Unbounded when omitted. */
  until?: string;
  major: number;
};

/**
 * Release-version fallback rules. Mojang version metadata
 * (javaVersion.majorVersion) always wins when available, so future versions
 * requiring Java 25+ are handled without touching this table. Append new
 * entries here for offline/metadata-less cases.
 */
export const defaultJavaVersionRules: readonly JavaVersionRule[] = [
  { until: '1.16.5', major: 8 },
  { from: '1.17', until: '1.17.1', major: 16 },
  { from: '1.18', until: '1.20.4', major: 17 },
  { from: '1.20.5', until: '1.21.11', major: 21 },
  { from: '26.1', major: 25 },
];

const parseMinecraftVersion = (value: string): number[] | null => {
  const segments = value.trim().split('.');
  const parsed = segments.map((segment) => Number.parseInt(segment, 10));
  if (parsed.length === 0 || parsed.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return parsed;
};

export const compareMinecraftVersions = (left: string, right: string) => {
  const a = parseMinecraftVersion(left);
  const b = parseMinecraftVersion(right);
  if (!a || !b) return undefined;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
};

const snapshotJavaMajor = (minecraftVersion: string) => {
  const preRelease = minecraftVersion.match(/^1\.18-pre(\d+)$/i);
  if (preRelease) {
    return Number.parseInt(preRelease[1], 10) <= 1 ? 16 : 17;
  }

  const weekly = minecraftVersion.match(
    /^(\d{2})w(\d{2})([a-z]|potato)$/i,
  );
  if (!weekly) return undefined;
  if (weekly[3].toLowerCase() === 'potato') return 17;

  const weekKey =
    Number.parseInt(weekly[1], 10) * 100 +
    Number.parseInt(weekly[2], 10);
  if (weekKey < 2119) return 8;
  if (weekKey < 2200) return 16;
  if (weekKey < 2414) return 17;
  if (weekKey < 2600) return 21;
  return 25;
};

/**
 * Resolves the Java major version required by a Minecraft version. Mojang
 * version JSON metadata takes priority; the rule table covers metadata-less
 * lookups; known snapshot transition points mirror Mojang metadata.
 */
export const requiredJavaMajor = (
  minecraftVersion: string,
  metadataMajorVersion?: number,
  rules: readonly JavaVersionRule[] = defaultJavaVersionRules,
): number => {
  if (
    typeof metadataMajorVersion === 'number' &&
    Number.isFinite(metadataMajorVersion) &&
    metadataMajorVersion > 0
  ) {
    return Math.round(metadataMajorVersion);
  }
  const snapshotMajor = snapshotJavaMajor(minecraftVersion);
  if (snapshotMajor !== undefined) return snapshotMajor;
  const fallback = rules.reduce(
    (latest, rule) => Math.max(latest, rule.major),
    8,
  );
  for (const rule of rules) {
    const aboveFrom =
      rule.from === undefined
        ? true
        : compareMinecraftVersions(minecraftVersion, rule.from);
    const belowUntil =
      rule.until === undefined
        ? true
        : compareMinecraftVersions(rule.until, minecraftVersion);
    if (aboveFrom === undefined || belowUntil === undefined) {
      return fallback;
    }
    if (
      (aboveFrom === true || aboveFrom >= 0) &&
      (belowUntil === true || belowUntil >= 0)
    ) {
      return rule.major;
    }
  }
  return fallback;
};

// --- Profile Java settings ---------------------------------------------------

export type ProfileJavaSettings = {
  mode: 'auto' | 'fixed' | 'customPath';
  runtimeId: string | null;
  customPath: string | null;
  preferredDistributions: JavaDistributionId[];
  jvmArgs: string[];
};

export const defaultJavaSettings = (): ProfileJavaSettings => ({
  mode: 'auto',
  runtimeId: null,
  customPath: null,
  preferredDistributions: [...defaultPreferredDistributions],
  jvmArgs: [],
});

export const normalizeJavaSettings = (
  input: unknown,
  legacyJavaPath?: unknown,
): ProfileJavaSettings => {
  const defaults = defaultJavaSettings();
  // Older settings files stored a plain javaPath: keep it as customPath.
  if (
    (!input || typeof input !== 'object') &&
    typeof legacyJavaPath === 'string' &&
    legacyJavaPath.trim()
  ) {
    return { ...defaults, mode: 'customPath', customPath: legacyJavaPath.trim() };
  }
  if (!input || typeof input !== 'object') {
    return defaults;
  }
  const value = input as Partial<ProfileJavaSettings>;
  const mode =
    value.mode === 'fixed' || value.mode === 'customPath' ? value.mode : 'auto';
  const runtimeId =
    typeof value.runtimeId === 'string' && value.runtimeId.trim()
      ? value.runtimeId.trim()
      : null;
  const customPath =
    typeof value.customPath === 'string' && value.customPath.trim()
      ? value.customPath.trim()
      : null;
  const preferredDistributions = Array.isArray(value.preferredDistributions)
    ? value.preferredDistributions.filter(isKnownDistribution)
    : [];
  const jvmArgs = Array.isArray(value.jvmArgs)
    ? value.jvmArgs.filter(
        (argument): argument is string =>
          typeof argument === 'string' && argument.trim().length > 0,
      )
    : [];
  return {
    mode: mode === 'fixed' && !runtimeId ? 'auto' : mode === 'customPath' && !customPath ? 'auto' : mode,
    runtimeId,
    customPath,
    preferredDistributions:
      preferredDistributions.length > 0
        ? preferredDistributions
        : defaults.preferredDistributions,
    jvmArgs,
  };
};

// --- Runtime info -------------------------------------------------------------

export type JavaRuntimeSource = 'managed' | 'custom' | 'system' | 'mojang';

export type JavaRuntimeInfo = {
  id: string;
  source: JavaRuntimeSource;
  distribution: string;
  majorVersion: number | null;
  versionString: string | null;
  arch: string | null;
  path: string;
  verified: boolean;
  verifiedAt: string | null;
  error?: string;
};

export type ResolvedJavaSelection = {
  javaPath: string;
  majorVersion: number | null;
  distribution: string;
  runtimeId: string | null;
  source: JavaRuntimeSource | 'mojang-fallback';
  requiredMajorVersion: number;
};

type RegistryValidation = {
  versionString: string;
  majorVersion: number | null;
  distribution: string;
  arch: string | null;
  verifiedAt: string;
  mtimeMs: number;
};

type RegistryFile = {
  version: number;
  customPaths: string[];
  validations: Record<string, RegistryValidation>;
};

type ProbeResult = {
  versionString: string;
  majorVersion: number | null;
  arch: string | null;
  banner: string;
};

export type JavaProbe = (executable: string) => Promise<ProbeResult>;

type DiscoPackage = {
  id: string;
  distribution: string;
  major_version: number;
  java_version: string;
  package_type: string;
  archive_type: string;
  filename: string;
  links: {
    pkg_info_uri?: string;
    pkg_download_redirect?: string;
  };
};

type DiscoPackageInfo = {
  filename: string;
  direct_download_uri?: string;
  checksum?: string;
  checksum_type?: string;
};

export type JavaInstallProgress = {
  percent: number;
  message: string;
  file?: string;
};

const pathExists = async (target: string) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const shortHash = (value: string) =>
  createHash('sha1').update(value.toLowerCase()).digest('hex').slice(0, 12);

export const detectDistributionFromBanner = (
  banner: string,
  executablePath = '',
): string => {
  const haystack = `${banner}\n${executablePath}`;
  if (/temurin|adoptium/i.test(haystack)) return 'temurin';
  if (/zulu/i.test(haystack)) return 'zulu';
  if (/bellsoft|liberica/i.test(haystack)) {
    return /lite/i.test(haystack) ? 'liberica-lite' : 'liberica';
  }
  if (/graalvm/i.test(haystack)) return 'graalvm';
  if (/microsoft/i.test(haystack)) return 'microsoft';
  if (/corretto/i.test(haystack)) return 'corretto';
  if (/java\(tm\)/i.test(banner)) return 'oracle';
  if (/openjdk/i.test(banner)) return 'openjdk';
  return 'unknown';
};

const normalizeJavaArchitecture = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (['amd64', 'x86_64', 'x64'].includes(normalized)) return 'x64';
  if (['x86', 'i386', 'i486', 'i586', 'i686'].includes(normalized)) {
    return 'ia32';
  }
  if (['aarch64', 'arm64'].includes(normalized)) return 'arm64';
  return normalized;
};

export const isJavaArchitectureCompatible = (
  hostArchitecture: string,
  javaArchitecture: string | null,
) => {
  if (!javaArchitecture) return true;
  return (
    normalizeJavaArchitecture(hostArchitecture) ===
    normalizeJavaArchitecture(javaArchitecture)
  );
};

export const probeJavaExecutable: JavaProbe = async (executable) => {
  // javaw.exe has no console output; probe its java.exe sibling instead.
  const probeTarget =
    process.platform === 'win32' &&
    path.basename(executable).toLowerCase() === 'javaw.exe'
      ? path.join(path.dirname(executable), 'java.exe')
      : executable;
  const { stdout, stderr } = await execFileAsync(
    probeTarget,
    ['-XshowSettings:properties', '-version'],
    { windowsHide: true, timeout: 10_000 },
  );
  const banner = `${stderr}\n${stdout}`;
  const versionLine =
    banner
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /version\s+"/i.test(line)) ?? '';
  const archMatch = banner.match(/os\.arch\s*=\s*(\S+)/);
  return {
    versionString: versionLine || 'unknown',
    majorVersion: parseJavaMajorVersion(versionLine) ?? null,
    arch: archMatch ? archMatch[1] : null,
    banner,
  };
};

const javaErrorWithRemedy = (input: {
  message: string;
  requiredMajor: number;
  selected?: string;
  code: string;
  detail?: Record<string, unknown>;
  cause?: unknown;
}) =>
  new MinecraftError(
    `${input.message}\n必要Java: Java ${input.requiredMajor}\n現在選択Java: ${
      input.selected ?? 'なし'
    }\n解決方法: プロファイルのJava設定を「自動」へ戻すか、設定画面の「Javaランタイム管理」からJava ${
      input.requiredMajor
    } をインストールしてください。`,
    'java',
    input.code,
    { requiredMajorVersion: input.requiredMajor, ...input.detail },
    input.cause ? { cause: input.cause } : undefined,
  );

export class JavaRuntimeService {
  private readonly javaRoot: string;
  private readonly managedRoot: string;
  private readonly registryFile: string;
  private readonly fetchImpl: typeof fetch;
  private readonly probe: JavaProbe;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly discoBase: string;
  private installInProgress = false;

  constructor(
    private readonly runtimeRoot: string,
    private readonly log: LogWriter = () => undefined,
    options: {
      fetchImpl?: typeof fetch;
      probe?: JavaProbe;
      platform?: NodeJS.Platform;
      arch?: string;
      discoApiBase?: string;
    } = {},
  ) {
    this.javaRoot = path.join(runtimeRoot, 'java');
    this.managedRoot = path.join(this.javaRoot, 'managed');
    this.registryFile = path.join(this.javaRoot, 'java-runtimes.json');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.probe = options.probe ?? probeJavaExecutable;
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.discoBase = options.discoApiBase ?? discoApiBase;
  }

  private javaExecutableName() {
    return this.platform === 'win32' ? 'java.exe' : 'java';
  }

  // --- registry -------------------------------------------------------------

  private async readRegistry(): Promise<RegistryFile> {
    try {
      const parsed = JSON.parse(
        await fs.readFile(this.registryFile, 'utf8'),
      ) as Partial<RegistryFile>;
      return {
        version: 1,
        customPaths: Array.isArray(parsed.customPaths)
          ? parsed.customPaths.filter(
              (value): value is string => typeof value === 'string',
            )
          : [],
        validations:
          parsed.validations && typeof parsed.validations === 'object'
            ? (parsed.validations as Record<string, RegistryValidation>)
            : {},
      };
    } catch {
      return { version: 1, customPaths: [], validations: {} };
    }
  }

  private async writeRegistry(registry: RegistryFile) {
    await fs.mkdir(this.javaRoot, { recursive: true });
    await fs.writeFile(
      this.registryFile,
      JSON.stringify(registry, null, 2),
      'utf8',
    );
  }

  // --- validation -------------------------------------------------------------

  /**
   * Probes `java -version`, caching by executable path + mtime so repeated
   * listings do not spawn processes.
   */
  private async validateExecutable(
    executable: string,
    registry: RegistryFile,
    forceRefresh = false,
  ): Promise<RegistryValidation | { error: string }> {
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.stat(executable)).mtimeMs;
    } catch {
      return { error: 'Java実行ファイルが存在しません。' };
    }
    const cached = registry.validations[executable];
    if (!forceRefresh && cached && cached.mtimeMs === mtimeMs) {
      return cached;
    }
    try {
      const result = await this.probe(executable);
      const validation: RegistryValidation = {
        versionString: result.versionString,
        majorVersion: result.majorVersion,
        distribution: detectDistributionFromBanner(result.banner, executable),
        arch: result.arch,
        verifiedAt: new Date().toISOString(),
        mtimeMs,
      };
      registry.validations[executable] = validation;
      return validation;
    } catch (error) {
      delete registry.validations[executable];
      return {
        error: `java -version の実行に失敗しました: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  // --- discovery -------------------------------------------------------------

  private async listManagedExecutables() {
    const entries: Array<{ id: string; directory: string; executable: string }> =
      [];
    try {
      const directories = await fs.readdir(this.managedRoot, {
        withFileTypes: true,
      });
      for (const entry of directories) {
        if (!entry.isDirectory()) continue;
        const home = await this.findJavaHome(
          path.join(this.managedRoot, entry.name),
        );
        if (!home) continue;
        entries.push({
          id: `managed:${entry.name}`,
          directory: path.join(this.managedRoot, entry.name),
          executable: path.join(home, 'bin', this.javaExecutableName()),
        });
      }
    } catch {
      // No managed runtimes yet.
    }
    return entries;
  }

  private async listMojangExecutables() {
    const entries: Array<{ id: string; executable: string }> = [];
    try {
      const directories = await fs.readdir(this.runtimeRoot, {
        withFileTypes: true,
      });
      for (const entry of directories) {
        if (!entry.isDirectory() || entry.name === 'java') continue;
        const executable = path.join(
          this.runtimeRoot,
          entry.name,
          'bin',
          this.javaExecutableName(),
        );
        if (await pathExists(executable)) {
          entries.push({ id: `mojang:${entry.name}`, executable });
        }
      }
    } catch {
      // Mojang runtime root not present.
    }
    return entries;
  }

  private async listSystemExecutables() {
    const candidates = new Set<string>();
    const javaName = this.javaExecutableName();
    const javaHome = process.env.JAVA_HOME;
    if (javaHome?.trim()) {
      candidates.add(path.join(javaHome.trim(), 'bin', javaName));
    }
    try {
      const lookup =
        this.platform === 'win32'
          ? await execFileAsync('where', ['java'], {
              windowsHide: true,
              timeout: 5_000,
            })
          : await execFileAsync('which', ['-a', 'java'], { timeout: 5_000 });
      for (const line of lookup.stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) candidates.add(trimmed);
      }
    } catch {
      // PATH lookup is best-effort.
    }
    const vendorRoots =
      this.platform === 'win32'
        ? [
            'Java',
            'BellSoft',
            'Zulu',
            'Eclipse Adoptium',
            'Eclipse Foundation',
            'AdoptOpenJDK',
            'Microsoft',
            'Amazon Corretto',
          ].flatMap((vendor) =>
            [
              process.env.ProgramFiles,
              process.env['ProgramFiles(x86)'],
            ]
              .filter((value): value is string => Boolean(value))
              .map((programFiles) => path.join(programFiles, vendor)),
          )
        : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines'];
    for (const root of vendorRoots) {
      try {
        const entries = await fs.readdir(root, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const base = path.join(root, entry.name);
          for (const home of [
            base,
            path.join(base, 'Contents', 'Home'),
          ]) {
            const executable = path.join(home, 'bin', javaName);
            if (await pathExists(executable)) candidates.add(executable);
          }
        }
      } catch {
        // Vendor directory does not exist.
      }
    }
    // Anything inside the launcher-managed tree is not "system".
    const normalizedRoot = path.resolve(this.runtimeRoot).toLowerCase();
    return [...candidates].filter(
      (candidate) =>
        !path.resolve(candidate).toLowerCase().startsWith(normalizedRoot),
    );
  }

  async listRuntimes(
    options: {
      refresh?: boolean;
      includeMojang?: boolean;
    } = {},
  ): Promise<JavaRuntimeInfo[]> {
    const registry = await this.readRegistry();
    const runtimes: JavaRuntimeInfo[] = [];
    const seenPaths = new Set<string>();

    const append = async (
      id: string,
      source: JavaRuntimeSource,
      executable: string,
      distributionHint?: string,
    ) => {
      const normalized = path.resolve(executable);
      const dedupeKey = normalized.toLowerCase();
      if (seenPaths.has(dedupeKey)) return;
      seenPaths.add(dedupeKey);
      const validation = await this.validateExecutable(
        normalized,
        registry,
        options.refresh,
      );
      if ('error' in validation) {
        runtimes.push({
          id,
          source,
          distribution: distributionHint ?? 'unknown',
          majorVersion: null,
          versionString: null,
          arch: null,
          path: normalized,
          verified: false,
          verifiedAt: null,
          error: validation.error,
        });
        return;
      }
      runtimes.push({
        id,
        source,
        distribution:
          distributionHint && validation.distribution === 'unknown'
            ? distributionHint
            : (distributionHint ?? validation.distribution),
        majorVersion: validation.majorVersion,
        versionString: validation.versionString,
        arch: validation.arch,
        path: normalized,
        verified: true,
        verifiedAt: validation.verifiedAt,
      });
    };

    for (const managed of await this.listManagedExecutables()) {
      // Managed directory names look like 'liberica-lite-21-x64'.
      const directoryName = path.basename(managed.directory);
      const hinted = knownDistributions.find((candidate) =>
        directoryName.startsWith(`${candidate}-`),
      );
      await append(managed.id, 'managed', managed.executable, hinted);
    }
    for (const customPath of registry.customPaths) {
      await append(`custom:${shortHash(customPath)}`, 'custom', customPath);
    }
    for (const executable of await this.listSystemExecutables()) {
      await append(`system:${shortHash(executable)}`, 'system', executable);
    }
    if (options.includeMojang) {
      for (const mojang of await this.listMojangExecutables()) {
        await append(mojang.id, 'mojang', mojang.executable, 'mojang');
      }
    }
    await this.writeRegistry(registry);
    return runtimes;
  }

  async addCustomRuntime(executable: string): Promise<JavaRuntimeInfo[]> {
    const normalized = path.resolve(executable.trim());
    const baseName = path.basename(normalized).toLowerCase();
    if (!/^javaw?(\.exe)?$/.test(baseName)) {
      throw new MinecraftError(
        'java / javaw 実行ファイルを選択してください。',
        'java',
        'JAVA_INVALID_EXECUTABLE',
        { executable: normalized },
      );
    }
    const registry = await this.readRegistry();
    const validation = await this.validateExecutable(normalized, registry, true);
    if ('error' in validation) {
      throw new MinecraftError(
        `選択したJavaを検証できません: ${validation.error}`,
        'java',
        'JAVA_VALIDATION_FAILED',
        { executable: normalized },
      );
    }
    if (!registry.customPaths.some((existing) => path.resolve(existing) === normalized)) {
      registry.customPaths.push(normalized);
    }
    await this.writeRegistry(registry);
    this.log('info', 'java', '手動Javaランタイムを追加しました。', {
      executable: normalized,
      majorVersion: validation.majorVersion,
      distribution: validation.distribution,
    });
    return this.listRuntimes();
  }

  async removeRuntime(runtimeId: string): Promise<JavaRuntimeInfo[]> {
    if (runtimeId.startsWith('managed:')) {
      const directoryName = runtimeId.slice('managed:'.length);
      if (
        !directoryName ||
        directoryName !== path.basename(directoryName) ||
        directoryName === '.' ||
        directoryName === '..'
      ) {
        throw new MinecraftError(
          'Javaランタイム指定が不正です。',
          'java',
          'JAVA_INVALID_RUNTIME_ID',
          { runtimeId },
        );
      }
      await fs.rm(path.join(this.managedRoot, directoryName), {
        recursive: true,
        force: true,
      });
      this.log('info', 'java', '管理Javaランタイムを削除しました。', {
        runtimeId,
      });
      return this.listRuntimes();
    }
    if (runtimeId.startsWith('custom:')) {
      const registry = await this.readRegistry();
      registry.customPaths = registry.customPaths.filter(
        (existing) => `custom:${shortHash(existing)}` !== runtimeId &&
          `custom:${shortHash(path.resolve(existing))}` !== runtimeId,
      );
      await this.writeRegistry(registry);
      this.log('info', 'java', '手動Javaランタイムの登録を解除しました。', {
        runtimeId,
      });
      return this.listRuntimes();
    }
    throw new MinecraftError(
      'システム検出されたJavaは削除できません。',
      'java',
      'JAVA_RUNTIME_NOT_REMOVABLE',
      { runtimeId },
    );
  }

  // --- Foojay Disco install ----------------------------------------------------

  private discoOperatingSystem() {
    if (this.platform === 'win32') return 'windows';
    if (this.platform === 'darwin') return 'macos';
    return 'linux';
  }

  private discoArchitecture() {
    if (this.arch === 'arm64') return 'aarch64';
    if (this.arch === 'ia32') return 'x86';
    return 'x64';
  }

  private archiveType() {
    return this.platform === 'win32' ? 'zip' : 'tar.gz';
  }

  private async discoJson<T>(url: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': userAgent },
      });
    } catch (error) {
      throw new MinecraftError(
        'Java配布API (Foojay Disco) へ接続できません。',
        'java',
        'JAVA_DISCO_NETWORK_ERROR',
        { url },
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new MinecraftError(
        `Java配布APIがエラーを返しました (HTTP ${response.status})。`,
        'java',
        `HTTP_${response.status}`,
        { url },
      );
    }
    return (await response.json()) as T;
  }

  private async findDiscoPackage(
    distribution: JavaDistributionId,
    major: number,
  ): Promise<DiscoPackage | null> {
    const spec = distributionSpecs[distribution];
    // JRE preferred; fall back to JDK when no JRE bundle exists.
    for (const packageType of ['jre', 'jdk'] as const) {
      const url = new URL(`${this.discoBase}/packages`);
      url.searchParams.set('distribution', spec.discoName);
      url.searchParams.set('version', String(major));
      url.searchParams.set('operating_system', this.discoOperatingSystem());
      url.searchParams.set('architecture', this.discoArchitecture());
      url.searchParams.set('archive_type', this.archiveType());
      url.searchParams.set('package_type', packageType);
      url.searchParams.set('latest', 'available');
      url.searchParams.set('javafx_bundled', 'false');
      url.searchParams.set('directly_downloadable', 'true');
      const payload = await this.discoJson<{ result?: DiscoPackage[] }>(
        url.toString(),
      );
      const match = (payload.result ?? []).find((candidate) =>
        spec.packageFilter(candidate.filename),
      );
      if (match) return match;
    }
    return null;
  }

  private async extractArchive(archivePath: string, destination: string) {
    if (archivePath.endsWith('.zip')) {
      const zip = await open(archivePath, {
        lazyEntries: true,
        autoClose: false,
      });
      try {
        const root = path.resolve(destination);
        for await (const entry of walkEntriesGenerator(zip)) {
          if (entry.fileName.endsWith('/')) continue;
          const target = path.resolve(root, entry.fileName);
          if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
            throw new MinecraftError(
              'Javaアーカイブに不正なパスが含まれています。',
              'java',
              'JAVA_ARCHIVE_UNSAFE_PATH',
              { entry: entry.fileName },
            );
          }
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, await readEntry(zip, entry));
        }
      } finally {
        zip.close();
      }
      return;
    }
    if (/\.(tar\.gz|tgz)$/.test(archivePath)) {
      await fs.mkdir(destination, { recursive: true });
      // bsdtar ships with Windows 10+; mac/linux have tar natively.
      await execFileAsync('tar', ['-xzf', archivePath, '-C', destination], {
        windowsHide: true,
        timeout: 300_000,
      });
      return;
    }
    throw new MinecraftError(
      `未対応のJavaアーカイブ形式です: ${path.extname(archivePath)}（zip / tar.gz を使用してください）`,
      'java',
      'JAVA_ARCHIVE_UNSUPPORTED',
      { archivePath },
    );
  }

  private async findJavaHome(
    root: string,
    depth = 0,
  ): Promise<string | null> {
    const candidates = [
      root,
      path.join(root, 'Contents', 'Home'),
    ];
    for (const candidate of candidates) {
      if (
        await pathExists(
          path.join(candidate, 'bin', this.javaExecutableName()),
        )
      ) {
        return candidate;
      }
    }
    if (depth >= 3) return null;
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const found = await this.findJavaHome(
          path.join(root, entry.name),
          depth + 1,
        );
        if (found) return found;
      }
    } catch {
      return null;
    }
    return null;
  }

  async installRuntime(
    distribution: JavaDistributionId,
    major: number,
    onProgress: (progress: JavaInstallProgress) => void = () => undefined,
  ): Promise<JavaRuntimeInfo> {
    if (!isKnownDistribution(distribution)) {
      throw new MinecraftError(
        '未対応のJava配布元です。',
        'java',
        'JAVA_UNKNOWN_DISTRIBUTION',
        { distribution },
      );
    }
    if (!Number.isFinite(major) || major < 8 || major > 99) {
      throw new MinecraftError(
        'Javaバージョン指定が不正です。',
        'java',
        'JAVA_INVALID_MAJOR',
        { major },
      );
    }
    if (this.installInProgress) {
      throw new MinecraftError(
        '別のJavaインストールが進行中です。',
        'java',
        'JAVA_INSTALL_IN_PROGRESS',
      );
    }
    this.installInProgress = true;
    try {
      return await this.installRuntimeInternal(distribution, major, onProgress);
    } finally {
      this.installInProgress = false;
    }
  }

  private async installRuntimeInternal(
    distribution: JavaDistributionId,
    major: number,
    onProgress: (progress: JavaInstallProgress) => void,
  ): Promise<JavaRuntimeInfo> {
    const label = `${distributionLabels[distribution]} ${major}`;
    onProgress({ percent: 0, message: `${label} を検索しています` });
    const pkg = await this.findDiscoPackage(distribution, major);
    if (!pkg) {
      throw new MinecraftError(
        `${label} はこの環境 (${this.discoOperatingSystem()}/${this.discoArchitecture()}) 向けに提供されていません。`,
        'java',
        'JAVA_PACKAGE_NOT_FOUND',
        { distribution, major },
      );
    }
    let downloadUri = pkg.links.pkg_download_redirect ?? '';
    let checksum = '';
    let checksumType = '';
    if (pkg.links.pkg_info_uri) {
      const info = await this.discoJson<{ result?: DiscoPackageInfo[] }>(
        pkg.links.pkg_info_uri,
      );
      const detail = info.result?.[0];
      if (detail?.direct_download_uri) downloadUri = detail.direct_download_uri;
      checksum = detail?.checksum ?? '';
      checksumType = detail?.checksum_type ?? '';
    }
    if (!downloadUri) {
      throw new MinecraftError(
        `${label} のダウンロードURLを取得できません。`,
        'java',
        'JAVA_DOWNLOAD_URI_MISSING',
        { distribution, major },
      );
    }

    onProgress({
      percent: 10,
      message: `${label} をダウンロードしています`,
      file: pkg.filename,
    });
    this.log('info', 'java', 'Javaランタイムのダウンロードを開始します。', {
      distribution,
      major,
      filename: pkg.filename,
      javaVersion: pkg.java_version,
      packageType: pkg.package_type,
    });

    let response: Response;
    try {
      response = await this.fetchImpl(downloadUri, {
        headers: { 'User-Agent': userAgent },
      });
    } catch (error) {
      throw new MinecraftError(
        `${label} のダウンロードに失敗しました（ネットワークを確認してください）。`,
        'java',
        'JAVA_DOWNLOAD_NETWORK_ERROR',
        { url: downloadUri },
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new MinecraftError(
        `${label} のダウンロードに失敗しました (HTTP ${response.status})。`,
        'java',
        `HTTP_${response.status}`,
        { url: downloadUri },
      );
    }
    const data = Buffer.from(await response.arrayBuffer());
    if (checksum && /^sha-?256$/i.test(checksumType)) {
      const actual = createHash('sha256').update(data).digest('hex');
      if (actual !== checksum.toLowerCase()) {
        throw new MinecraftError(
          `${label} のSHA-256検証に失敗しました。`,
          'java',
          'JAVA_CHECKSUM_MISMATCH',
          { filename: pkg.filename },
        );
      }
    }

    onProgress({ percent: 60, message: `${label} を展開しています` });
    const directoryName = `${distribution}-${major}-${this.discoArchitecture()}`;
    const destination = path.join(this.managedRoot, directoryName);
    const staging = path.join(
      this.managedRoot,
      `.staging-${directoryName}-${Date.now()}`,
    );
    const archivePath = path.join(
      os.tmpdir(),
      `scl-java-${Date.now()}-${pkg.filename}`,
    );
    try {
      await fs.mkdir(this.managedRoot, { recursive: true });
      await fs.writeFile(archivePath, data);
      await this.extractArchive(archivePath, staging);
      const home = await this.findJavaHome(staging);
      if (!home) {
        throw new MinecraftError(
          `${label} のアーカイブにJava実行ファイルが見つかりません。`,
          'java',
          'JAVA_EXECUTABLE_MISSING_IN_ARCHIVE',
          { filename: pkg.filename },
        );
      }
      if (this.platform !== 'win32') {
        const binDirectory = path.join(home, 'bin');
        for (const file of await fs.readdir(binDirectory)) {
          await fs
            .chmod(path.join(binDirectory, file), 0o755)
            .catch((): void => undefined);
        }
      }
      await fs.rm(destination, { recursive: true, force: true });
      await fs.rename(staging, destination);
    } finally {
      await fs.rm(archivePath, { force: true }).catch((): void => undefined);
      await fs
        .rm(staging, { recursive: true, force: true })
        .catch((): void => undefined);
    }

    onProgress({ percent: 90, message: `${label} を検証しています` });
    const home = await this.findJavaHome(destination);
    const executable = home
      ? path.join(home, 'bin', this.javaExecutableName())
      : null;
    if (!executable || !(await pathExists(executable))) {
      throw new MinecraftError(
        `${label} のインストール後検証に失敗しました。`,
        'java',
        'JAVA_INSTALL_VERIFICATION_FAILED',
        { destination },
      );
    }
    const registry = await this.readRegistry();
    const validation = await this.validateExecutable(executable, registry, true);
    await this.writeRegistry(registry);
    if ('error' in validation) {
      throw new MinecraftError(
        `インストールした ${label} を実行できません: ${validation.error}`,
        'java',
        'JAVA_INSTALL_PROBE_FAILED',
        { executable },
      );
    }
    onProgress({ percent: 100, message: `${label} のインストールが完了しました` });
    this.log('info', 'java', 'Javaランタイムのインストールが完了しました。', {
      distribution,
      major,
      executable,
      versionString: validation.versionString,
    });
    return {
      id: `managed:${directoryName}`,
      source: 'managed',
      distribution,
      majorVersion: validation.majorVersion,
      versionString: validation.versionString,
      arch: validation.arch,
      path: executable,
      verified: true,
      verifiedAt: validation.verifiedAt,
    };
  }

  // --- launch resolution ---------------------------------------------------------

  /**
   * Resolves the Java executable for a launch. Resolution order for auto:
   * managed/custom/system runtimes matching the required major (sorted by the
   * preferred distribution order) → Disco install → locally present Mojang
   * runtime as a compatibility fallback.
   */
  async resolveForLaunch(input: {
    settings: ProfileJavaSettings;
    minecraftVersion: string;
    metadataMajorVersion?: number;
    offlineOnly?: boolean;
    instanceId?: string;
    onProgress?: (progress: JavaInstallProgress) => void;
    mojangFallback?: () => Promise<string>;
  }): Promise<ResolvedJavaSelection> {
    const requiredMajor = requiredJavaMajor(
      input.minecraftVersion,
      input.metadataMajorVersion,
    );
    const settings = input.settings;

    if (settings.mode === 'customPath') {
      return this.resolveCustomPath(settings, requiredMajor, input.instanceId);
    }
    if (settings.mode === 'fixed') {
      return this.resolveFixed(settings, requiredMajor, input.instanceId);
    }
    return this.resolveAuto(settings, requiredMajor, input);
  }

  private logSelection(
    selection: ResolvedJavaSelection,
    instanceId: string | undefined,
    mode: ProfileJavaSettings['mode'],
  ) {
    this.log('info', 'java', '起動に使用するJavaを解決しました。', {
      javaPath: selection.javaPath,
      majorVersion: selection.majorVersion,
      distribution: selection.distribution,
      requiredMajorVersion: selection.requiredMajorVersion,
      source: selection.source,
      mode,
      instanceId,
    });
  }

  private assertArchitectureCompatible(
    javaArchitecture: string | null,
    requiredMajor: number,
    selected: string,
    detail: Record<string, unknown>,
  ) {
    if (isJavaArchitectureCompatible(this.arch, javaArchitecture)) return;
    throw javaErrorWithRemedy({
      message: `Selected Java architecture (${javaArchitecture}) is incompatible with this system (${this.arch}).`,
      requiredMajor,
      selected,
      code: 'JAVA_ARCHITECTURE_MISMATCH',
      detail: {
        hostArchitecture: this.arch,
        javaArchitecture,
        ...detail,
      },
    });
  }

  private async resolveCustomPath(
    settings: ProfileJavaSettings,
    requiredMajor: number,
    instanceId?: string,
  ): Promise<ResolvedJavaSelection> {
    const customPath = settings.customPath;
    if (!customPath) {
      throw javaErrorWithRemedy({
        message: 'Javaの手動パスが設定されていません。',
        requiredMajor,
        code: 'JAVA_CUSTOM_PATH_MISSING',
      });
    }
    const registry = await this.readRegistry();
    const validation = await this.validateExecutable(customPath, registry);
    await this.writeRegistry(registry);
    if ('error' in validation) {
      throw javaErrorWithRemedy({
        message: `指定されたJavaを実行できません: ${validation.error}`,
        requiredMajor,
        selected: customPath,
        code: 'JAVA_CUSTOM_PATH_INVALID',
        detail: { javaPath: customPath },
      });
    }
    if (
      validation.majorVersion !== null &&
      validation.majorVersion !== requiredMajor
    ) {
      throw javaErrorWithRemedy({
        message: '指定されたJavaのバージョンがMinecraftの要求と一致しません。',
        requiredMajor,
        selected: `Java ${validation.majorVersion} (${customPath})`,
        code: 'JAVA_VERSION_MISMATCH',
        detail: {
          javaPath: customPath,
          actualMajorVersion: validation.majorVersion,
        },
      });
    }
    this.assertArchitectureCompatible(
      validation.arch,
      requiredMajor,
      customPath,
      { javaPath: customPath },
    );
    const selection: ResolvedJavaSelection = {
      javaPath: path.resolve(customPath),
      majorVersion: validation.majorVersion,
      distribution: validation.distribution,
      runtimeId: null,
      source: 'custom',
      requiredMajorVersion: requiredMajor,
    };
    this.logSelection(selection, instanceId, 'customPath');
    return selection;
  }

  private async resolveFixed(
    settings: ProfileJavaSettings,
    requiredMajor: number,
    instanceId?: string,
  ): Promise<ResolvedJavaSelection> {
    const runtimes = await this.listRuntimes({ includeMojang: true });
    const runtime = runtimes.find(
      (candidate) => candidate.id === settings.runtimeId,
    );
    if (!runtime) {
      throw javaErrorWithRemedy({
        message: `固定指定されたJavaランタイム (${settings.runtimeId}) が見つかりません。削除された可能性があります。`,
        requiredMajor,
        code: 'JAVA_FIXED_RUNTIME_NOT_FOUND',
        detail: { runtimeId: settings.runtimeId },
      });
    }
    if (!runtime.verified) {
      throw javaErrorWithRemedy({
        message: `固定指定されたJavaを実行できません: ${runtime.error ?? '検証失敗'}`,
        requiredMajor,
        selected: runtime.path,
        code: 'JAVA_FIXED_RUNTIME_INVALID',
        detail: { runtimeId: runtime.id, javaPath: runtime.path },
      });
    }
    if (
      runtime.majorVersion !== null &&
      runtime.majorVersion !== requiredMajor
    ) {
      throw javaErrorWithRemedy({
        message: '固定指定されたJavaのバージョンがMinecraftの要求と一致しません。',
        requiredMajor,
        selected: `Java ${runtime.majorVersion} (${runtime.path})`,
        code: 'JAVA_VERSION_MISMATCH',
        detail: {
          runtimeId: runtime.id,
          javaPath: runtime.path,
          actualMajorVersion: runtime.majorVersion,
        },
      });
    }
    this.assertArchitectureCompatible(
      runtime.arch,
      requiredMajor,
      runtime.path,
      { runtimeId: runtime.id, javaPath: runtime.path },
    );
    const selection: ResolvedJavaSelection = {
      javaPath: runtime.path,
      majorVersion: runtime.majorVersion,
      distribution: runtime.distribution,
      runtimeId: runtime.id,
      source: runtime.source,
      requiredMajorVersion: requiredMajor,
    };
    this.logSelection(selection, instanceId, 'fixed');
    return selection;
  }

  private async resolveAuto(
    settings: ProfileJavaSettings,
    requiredMajor: number,
    input: {
      offlineOnly?: boolean;
      instanceId?: string;
      onProgress?: (progress: JavaInstallProgress) => void;
      mojangFallback?: () => Promise<string>;
    },
  ): Promise<ResolvedJavaSelection> {
    const preferred =
      settings.preferredDistributions.length > 0
        ? settings.preferredDistributions
        : defaultPreferredDistributions;
    const runtimes = await this.listRuntimes({ includeMojang: true });
    const sourceRank: Record<JavaRuntimeSource, number> = {
      managed: 0,
      custom: 1,
      system: 2,
      mojang: 3,
    };
    const distributionRank = (distribution: string) => {
      const index = (preferred as string[]).indexOf(distribution);
      return index >= 0 ? index : preferred.length;
    };
    const candidates = runtimes
      .filter(
        (runtime) =>
          runtime.verified &&
          runtime.majorVersion === requiredMajor &&
          isJavaArchitectureCompatible(this.arch, runtime.arch),
      )
      .sort(
        (left, right) =>
          distributionRank(left.distribution) -
            distributionRank(right.distribution) ||
          sourceRank[left.source] - sourceRank[right.source],
      );
    if (candidates[0]) {
      const runtime = candidates[0];
      const selection: ResolvedJavaSelection = {
        javaPath: runtime.path,
        majorVersion: runtime.majorVersion,
        distribution: runtime.distribution,
        runtimeId: runtime.id,
        source: runtime.source,
        requiredMajorVersion: requiredMajor,
      };
      this.logSelection(selection, input.instanceId, 'auto');
      return selection;
    }

    // The version JSON names Mojang's matching runtime component. Prefer that
    // official runtime before trying third-party distributions.
    if (input.mojangFallback) {
      try {
        const javaPath = await input.mojangFallback();
        const selection: ResolvedJavaSelection = {
          javaPath,
          majorVersion: requiredMajor,
          distribution: 'mojang',
          runtimeId: null,
          source: 'mojang-fallback',
          requiredMajorVersion: requiredMajor,
        };
        this.logSelection(selection, input.instanceId, 'auto');
        return selection;
      } catch (error) {
        this.log('warn', 'java', 'Mojang Java runtime is not available yet.', {
          message: error instanceof Error ? error.message : String(error),
          requiredMajorVersion: requiredMajor,
        });
      }
    }

    if (!input.offlineOnly) {
      for (const distribution of preferred) {
        try {
          const installed = await this.installRuntime(
            distribution,
            requiredMajor,
            input.onProgress,
          );
          const selection: ResolvedJavaSelection = {
            javaPath: installed.path,
            majorVersion: installed.majorVersion,
            distribution: installed.distribution,
            runtimeId: installed.id,
            source: 'managed',
            requiredMajorVersion: requiredMajor,
          };
          this.logSelection(selection, input.instanceId, 'auto');
          return selection;
        } catch (error) {
          this.log(
            'warn',
            'java',
            'Javaランタイムの自動インストールに失敗したため次の配布元を試します。',
            {
              distribution,
              requiredMajorVersion: requiredMajor,
              message: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
    }

    // Compatibility fallback: a locally present (or Mojang-provisioned)
    // runtime keeps existing installs launching when Disco is unreachable.
    if (input.mojangFallback) {
      try {
        const javaPath = await input.mojangFallback();
        const selection: ResolvedJavaSelection = {
          javaPath,
          majorVersion: requiredMajor,
          distribution: 'mojang',
          runtimeId: null,
          source: 'mojang-fallback',
          requiredMajorVersion: requiredMajor,
        };
        this.log(
          'warn',
          'java',
          '優先配布元を確保できないためMojang Javaへフォールバックします。',
          { javaPath, requiredMajorVersion: requiredMajor },
        );
        this.logSelection(selection, input.instanceId, 'auto');
        return selection;
      } catch (error) {
        this.log('warn', 'java', 'Mojang Javaフォールバックにも失敗しました。', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    throw javaErrorWithRemedy({
      message: input.offlineOnly
        ? `オフライン起動に使用できるJava ${requiredMajor} がローカルにありません。`
        : `Java ${requiredMajor} を確保できませんでした。`,
      requiredMajor,
      code: 'JAVA_AUTO_RESOLUTION_FAILED',
      detail: { preferredDistributions: preferred },
    });
  }
}
