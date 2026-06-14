import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  shell,
} from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import started from 'electron-squirrel-startup';
import { Version } from '@xmcl/core';
import {
  isMicrosoftClientId,
  resolveMicrosoftClientId,
} from './auth-config';
import { classifyAuthFailure } from './auth-errors';
import { AuthService } from './auth-service';
import {
  clientIdConfigurationEnabled,
  developerLogsVisibleByDefault,
  normalizeBuildConfiguration,
} from './build-configuration';
import { LauncherDiagnostics } from './diagnostics';
import {
  JavaRuntimeService,
  normalizeJavaSettings,
  type ProfileJavaSettings,
} from './java-runtime-service';
import {
  ensureInstanceSubdirectory,
  ensureLauncherLogsDirectory,
  ensureManagedInstanceDirectory,
  managedInstanceDirectory,
} from './instance-paths';
import {
  normalizeLaunchProfileVersion,
  resolveLibraryPath,
} from './launcher-utils';
import { MinecraftService } from './minecraft-service';
import {
  ModrinthService,
  type ModrinthLoader,
  type ModrinthProject,
  type ProfileMod,
} from './modrinth-service';
import {
  resolvedModLoaderVersionId,
  type ModLoaderType,
} from './mod-loader-service';
import {
  normalizeLanguagePreference,
  type LanguagePreference,
} from './i18n';

type ProfileLoader = 'vanilla' | ModLoaderType;

type LauncherSettings = {
  gameDirectory: string;
  minMemory: number;
  maxMemory: number;
  showDeveloperLogs: boolean;
  language: LanguagePreference;
  microsoftClientId: string;
  profiles: LaunchProfile[];
  selectedProfileId: string;
};

type LaunchProfile = {
  id: string;
  name: string;
  profileType: ProfileLoader;
  loaderType: ProfileLoader;
  minecraftVersion: string;
  loaderVersion: string | null;
  resolvedVersionId: string;
  // Compatibility aliases for settings written by versions before 1.5.
  versionId: string;
  loader: ProfileLoader;
  minMemory: number;
  maxMemory: number;
  mods: ProfileMod[];
  java: ProfileJavaSettings;
  // Per-profile game directory. Saves, mods, config etc. are isolated here.
  instanceDir: string;
};

let authService: AuthService;
let minecraftService: MinecraftService;
let javaRuntimeService: JavaRuntimeService;
let launchWorkflowInProgress = false;
const buildConfiguration = normalizeBuildConfiguration(
  __BUILD_CONFIGURATION__,
);
const isReleaseBuild = buildConfiguration === 'release';
const canConfigureClientId = clientIdConfigurationEnabled(buildConfiguration);
const diagnostics = new LauncherDiagnostics((entry) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('launcher:log', entry);
  }
});
const log = diagnostics.log.bind(diagnostics);
const modrinthService = new ModrinthService(log);
const appName = 'Mason Launcher';
const legacyAppDataName = 'Simple Craft Launcher';
const legacyInstanceStorageName = 'simple-craft';

if (started) {
  app.quit();
}

const defaultGameDirectory = () => {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? os.homedir(), '.minecraft');
  }
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'minecraft',
    );
  }
  return path.join(os.homedir(), '.minecraft');
};

const settingsFile = () =>
  path.join(app.getPath('userData'), 'launcher-settings.json');

const migrateLegacyUserData = async () => {
  const currentDirectory = app.getPath('userData');
  const legacyDirectory = path.join(
    path.dirname(currentDirectory),
    legacyAppDataName,
  );
  const currentSettings = path.join(currentDirectory, 'launcher-settings.json');
  const legacySettings = path.join(legacyDirectory, 'launcher-settings.json');

  if (
    currentDirectory === legacyDirectory ||
    (await pathExists(currentSettings)) ||
    !(await pathExists(legacySettings))
  ) {
    return;
  }

  await fs.mkdir(currentDirectory, { recursive: true });
  await fs.cp(legacyDirectory, currentDirectory, {
    recursive: true,
    force: false,
    errorOnExist: false,
  });
  log('info', 'settings', '旧アプリ名の設定データを移行しました。', {
    destination: currentDirectory,
  });
};

// New instances use an isolated directory under Electron userData so that the
// shared Minecraft cache (.minecraft or settings.gameDirectory) is never the
// game working directory.  The `instance/` leaf is the actual --gameDir value;
// the parent directory can hold per-instance metadata later.
const managedInstancesRoot = () =>
  path.join(app.getPath('userData'), 'instances');

const defaultInstanceDir = (profileId: string) =>
  managedInstanceDirectory(managedInstancesRoot(), profileId);

const migrateKnownProfileInstances = async () => {
  let raw: Partial<LauncherSettings>;
  try {
    raw = JSON.parse(await fs.readFile(settingsFile(), 'utf8')) as Partial<LauncherSettings>;
  } catch {
    return;
  }
  if (!Array.isArray(raw.profiles)) return;
  const gameDirectory =
    typeof raw.gameDirectory === 'string' && raw.gameDirectory.trim()
      ? raw.gameDirectory.trim()
      : defaultGameDirectory();
  let changed = false;
  for (const profile of raw.profiles) {
    if (
      !profile ||
      typeof profile.id !== 'string' ||
      !/^[a-zA-Z0-9-]+$/.test(profile.id)
    ) {
      continue;
    }
    const target = defaultInstanceDir(profile.id);
    const configured =
      typeof profile.instanceDir === 'string' ? profile.instanceDir.trim() : '';
    const knownSources = [
      path.join(gameDirectory, 'mason-launcher', 'profiles', profile.id),
      path.join(
        gameDirectory,
        legacyInstanceStorageName,
        'profiles',
        profile.id,
      ),
    ];
    const source = knownSources.find(
      (candidate) =>
        configured &&
        path.resolve(candidate) === path.resolve(configured),
    );
    if (source && (await pathExists(source)) && !(await pathExists(target))) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.cp(source, target, { recursive: true, errorOnExist: true });
      log('info', 'settings', 'Migrated an instance into managed storage.', {
        profileId: profile.id,
        source,
        target,
      });
    }
    if (configured !== target) {
      profile.instanceDir = target;
      changed = true;
    }
  }
  if (changed) {
    await writeSettings(raw as LauncherSettings);
  }
};

const defaultSettings = (): LauncherSettings => ({
  gameDirectory: defaultGameDirectory(),
  minMemory: 1024,
  maxMemory: 4096,
  showDeveloperLogs: developerLogsVisibleByDefault(buildConfiguration),
  language: 'system',
  microsoftClientId: __MICROSOFT_CLIENT_ID__.trim(),
  profiles: [
    {
      id: 'default-profile',
      profileType: 'vanilla',
      loaderType: 'vanilla',
      minecraftVersion: '',
      loaderVersion: null,
      resolvedVersionId: '',
      name: 'メインプロファイル',
      versionId: '',
      loader: 'vanilla',
      minMemory: 1024,
      maxMemory: 4096,
      mods: [],
      java: normalizeJavaSettings(undefined),
      instanceDir: defaultInstanceDir('default-profile'),
    },
  ],
  selectedProfileId: 'default-profile',
});

const readSettings = async (): Promise<LauncherSettings> => {
  try {
    const value = JSON.parse(
      await fs.readFile(settingsFile(), 'utf8'),
    ) as Partial<LauncherSettings>;
    const defaults = defaultSettings();
    const minMemory =
      typeof value.minMemory === 'number'
        ? Math.max(512, Math.round(value.minMemory))
        : defaults.minMemory;
    const maxMemory =
      typeof value.maxMemory === 'number'
        ? Math.max(minMemory, Math.round(value.maxMemory))
        : defaults.maxMemory;
    const profiles = Array.isArray(value.profiles)
      ? value.profiles
          .filter(
            (profile): profile is LaunchProfile =>
              Boolean(
                profile &&
                  typeof profile.id === 'string' &&
                  /^[a-zA-Z0-9-]+$/.test(profile.id) &&
                  typeof profile.name === 'string' &&
                  (typeof profile.versionId === 'string' ||
                    typeof profile.minecraftVersion === 'string'),
              ),
          )
          .map((profile): LaunchProfile => {
            const profileMin =
              typeof profile.minMemory === 'number'
                ? Math.max(512, Math.round(profile.minMemory))
                : minMemory;
            const rawLoader =
              typeof profile.loaderType === 'string'
                ? profile.loaderType
                : profile.loader;
            const loaderType: ProfileLoader =
              rawLoader === 'forge' ||
              rawLoader === 'neoforge' ||
              rawLoader === 'fabric'
                ? rawLoader
                : 'vanilla';
            const minecraftVersion =
              typeof profile.minecraftVersion === 'string'
                ? profile.minecraftVersion
                : profile.versionId;
            const loaderVersion =
              loaderType !== 'vanilla' &&
              typeof profile.loaderVersion === 'string' &&
              profile.loaderVersion.trim()
                ? profile.loaderVersion.trim()
                : null;
            const savedResolvedVersionId =
              typeof profile.resolvedVersionId === 'string' &&
              /^[a-zA-Z0-9._+-]+$/.test(profile.resolvedVersionId)
                ? profile.resolvedVersionId
                : '';
            const resolvedVersionId =
              loaderType !== 'vanilla' && loaderVersion
                ? savedResolvedVersionId ||
                  resolvedModLoaderVersionId(
                    loaderType,
                    minecraftVersion,
                    loaderVersion,
                  )
                : minecraftVersion;
            // Profiles saved before instanceDir was added get the path that
            // the launcher already uses at runtime, so saves are not lost.
            const configuredInstanceDir =
              typeof (profile as { instanceDir?: unknown }).instanceDir === 'string'
                ? ((profile as { instanceDir?: unknown }).instanceDir as string).trim()
                : '';
            const instanceDir = defaultInstanceDir(profile.id);
            if (
              configuredInstanceDir &&
              path.resolve(configuredInstanceDir) !== path.resolve(instanceDir)
            ) {
              log(
                'warn',
                'settings',
                'An instanceDir outside the launcher-managed directory was ignored.',
                {
                  profileId: profile.id,
                  configuredInstanceDir,
                  managedInstanceDir: instanceDir,
                },
              );
            }
            return {
              id: profile.id,
              name: profile.name.trim() || 'プロファイル',
              profileType: loaderType,
              loaderType,
              minecraftVersion,
              loaderVersion,
              resolvedVersionId,
              versionId: minecraftVersion,
              loader: loaderType,
              minMemory: profileMin,
              maxMemory:
                typeof profile.maxMemory === 'number'
                  ? Math.max(profileMin, Math.round(profile.maxMemory))
                  : maxMemory,
              mods: Array.isArray(profile.mods)
                ? profile.mods.filter(
                    (mod): mod is ProfileMod =>
                      Boolean(
                        mod &&
                          typeof mod.projectId === 'string' &&
                          typeof mod.slug === 'string' &&
                          typeof mod.title === 'string' &&
                          (typeof mod.iconUrl === 'string' ||
                            mod.iconUrl === null),
                      ),
                  )
                : [],
              // Profiles saved before the Java runtime feature migrate to
              // auto; a legacy plain javaPath is preserved as customPath.
              java: normalizeJavaSettings(
                profile.java,
                (profile as { javaPath?: unknown }).javaPath,
              ),
              instanceDir,
            };
          })
      : defaults.profiles;
    const normalizedProfiles =
      profiles.length > 0 ? profiles : defaults.profiles;
    return {
      gameDirectory:
        typeof value.gameDirectory === 'string'
          ? value.gameDirectory
          : defaults.gameDirectory,
      minMemory,
      maxMemory,
      showDeveloperLogs:
        typeof value.showDeveloperLogs === 'boolean'
          ? value.showDeveloperLogs
          : defaults.showDeveloperLogs,
      language: normalizeLanguagePreference(value.language),
      microsoftClientId: resolveMicrosoftClientId(
        value.microsoftClientId,
        defaults.microsoftClientId,
      ),
      profiles: normalizedProfiles,
      selectedProfileId:
        typeof value.selectedProfileId === 'string' &&
        normalizedProfiles.some(
          (profile) => profile.id === value.selectedProfileId,
        )
          ? value.selectedProfileId
          : normalizedProfiles[0].id,
    };
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : undefined;
    log(
      code === 'ENOENT' ? 'debug' : 'warn',
      'settings',
      code === 'ENOENT'
        ? '設定ファイルがないため初期設定を使用します。'
        : '設定ファイルを読み込めないため初期設定を使用します。',
      {
        file: settingsFile(),
        code,
        message: error instanceof Error ? error.message : String(error),
      },
    );
    return defaultSettings();
  }
};

const writeSettings = async (settings: LauncherSettings) => {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
  log('debug', 'settings', 'ランチャー設定を保存しました。', {
    file: settingsFile(),
    profiles: settings.profiles.length,
  });
};

const pathExists = async (target: string) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

// Each profile has its own instance directory.  For profiles persisted before
// this field was introduced, instanceDir was already computed the same way at
// launch time so nothing moves.
const resolveInstanceDirectory = async (profile: LaunchProfile) =>
  ensureManagedInstanceDirectory(managedInstancesRoot(), profile.id);

const isTrustedRendererUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      return url.origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
    }
    return url.protocol === 'file:';
  } catch {
    return false;
  }
};

const assertTrustedIpcSender = (event: IpcMainInvokeEvent) => {
  const frame = event.senderFrame;
  if (
    !frame ||
    frame !== event.sender.mainFrame ||
    !isTrustedRendererUrl(frame.url)
  ) {
    throw new Error('IPC request rejected: untrusted renderer frame.');
  }
};

const trustedIpc = {
  handle<TArgs extends unknown[]>(
    channel: string,
    listener: (
      event: IpcMainInvokeEvent,
      ...args: TArgs
    ) => unknown | Promise<unknown>,
  ) {
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedIpcSender(event);
      return listener(event, ...(args as TArgs));
    });
  },
};

const openTrustedExternal = async (value: string) => {
  const url = new URL(value);
  const trustedHost =
    url.hostname === 'microsoft.com' ||
    url.hostname.endsWith('.microsoft.com') ||
    url.hostname === 'microsoftonline.com' ||
    url.hostname.endsWith('.microsoftonline.com') ||
    url.hostname === 'live.com' ||
    url.hostname.endsWith('.live.com');
  if (url.protocol !== 'https:' || !trustedHost) {
    throw new Error('External URL rejected by the launcher security policy.');
  }
  await shell.openExternal(url.toString());
};

// Maps a profile loader onto a Modrinth loader facet. Vanilla profiles have no
// mod loader, so they cannot host Modrinth mods.
const profileModrinthLoader = (
  profile: LaunchProfile,
): ModrinthLoader | null =>
  profile.loader === 'vanilla' ? null : profile.loader;

const findProfileOrThrow = (
  settings: LauncherSettings,
  profileId: unknown,
): LaunchProfile => {
  if (typeof profileId !== 'string') {
    throw new Error('プロファイル指定が不正です。');
  }
  const profile = settings.profiles.find(
    (candidate) => candidate.id === profileId,
  );
  if (!profile) {
    throw new Error('プロファイルが見つかりません。');
  }
  return profile;
};

const countEntries = async (
  target: string,
  kind: 'directory' | 'file' = 'directory',
) => {
  try {
    const entries = await fs.readdir(target, { withFileTypes: true });
    return entries.filter((entry) =>
      kind === 'directory' ? entry.isDirectory() : entry.isFile(),
    ).length;
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : undefined;
    if (code !== 'ENOENT') {
      log('warn', 'files', 'ディレクトリの件数取得に失敗しました。', {
        target,
        code,
      });
    }
    return 0;
  }
};

type InstalledVersion = {
  id: string;
  type: string;
  releaseTime: string | null;
  inheritsFrom: string | null;
};

const readInstalledVersions = async (
  gameDirectory: string,
): Promise<InstalledVersion[]> => {
  const versionsDirectory = path.join(gameDirectory, 'versions');
  try {
    const entries = await fs.readdir(versionsDirectory, {
      withFileTypes: true,
    });
    const metadata = new Map<
      string,
      {
        type?: string;
        releaseTime?: string;
        time?: string;
        inheritsFrom?: string;
        jar?: string;
      }
    >();
    const readMetadata = async (id: string) => {
      if (metadata.has(id)) return metadata.get(id);
      try {
        const value = JSON.parse(
          await fs.readFile(
            path.join(versionsDirectory, id, `${id}.json`),
            'utf8',
          ),
        ) as {
          type?: string;
          releaseTime?: string;
          time?: string;
          inheritsFrom?: string;
          jar?: string;
        };
        metadata.set(id, value);
        return value;
      } catch (error) {
        log('warn', 'files', 'ローカルバージョンJSONを解析できません。', {
          versionId: id,
          message: error instanceof Error ? error.message : String(error),
        });
        metadata.set(id, {});
        return undefined;
      }
    };
    const hasRunnableJar = async (
      id: string,
      visited = new Set<string>(),
    ): Promise<boolean> => {
      if (visited.has(id)) return false;
      visited.add(id);
      if (await pathExists(path.join(versionsDirectory, id, `${id}.jar`))) {
        return true;
      }
      const value = await readMetadata(id);
      const parent = value?.jar ?? value?.inheritsFrom;
      return parent ? hasRunnableJar(parent, visited) : false;
    };
    const installed = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const value = await readMetadata(entry.name);
          if (!value || !(await hasRunnableJar(entry.name))) {
            return null;
          }
          return {
            id: entry.name,
            type: value.type ?? 'custom',
            releaseTime: value.releaseTime ?? value.time ?? null,
            inheritsFrom: value.inheritsFrom ?? null,
          };
        }),
    );
    return installed.filter(
      (version): version is InstalledVersion => version !== null,
    );
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : undefined;
    if (code !== 'ENOENT') {
      log('warn', 'files', 'インストール済みバージョンを列挙できません。', {
        versionsDirectory,
        code,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return [];
  }
};

const compareAvailableVersions = (
  left: { id: string; type: string; releaseTime: string | null },
  right: { id: string; type: string; releaseTime: string | null },
) => {
  const leftTime = left.releaseTime ? Date.parse(left.releaseTime) : NaN;
  const rightTime = right.releaseTime ? Date.parse(right.releaseTime) : NaN;
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    if (leftTime !== rightTime) return rightTime - leftTime;
  } else if (Number.isFinite(leftTime)) {
    return -1;
  } else if (Number.isFinite(rightTime)) {
    return 1;
  }
  return right.id.localeCompare(left.id, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
};

const withLaunchWorkflow = async <T>(operation: () => Promise<T>) => {
  if (launchWorkflowInProgress || minecraftService.isRunning()) {
    throw new Error('Minecraft の起動処理はすでに進行中です。');
  }
  launchWorkflowInProgress = true;
  log('info', 'app', 'Minecraft起動ワークフローを開始します。');
  try {
    return await operation();
  } finally {
    launchWorkflowInProgress = false;
    log('debug', 'app', 'Minecraft起動ワークフローの準備処理を終了しました。');
  }
};

const requireMinecraftSession = async (sender: Electron.WebContents) => {
  try {
    return await authService.getMinecraftSession();
  } catch (error) {
    const failure = classifyAuthFailure(error);
    if (failure.category === 'network') {
      try {
        const offlineSession = await authService.getCachedOfflineSession();
        if (!sender.isDestroyed()) {
          sender.send('minecraft:progress', {
            phase: 'authentication',
            percent: 100,
            category: 'offline-auth',
            message:
              'Authenticated offline mode: single-player only. Online servers and Realms may be unavailable.',
          });
        }
        log('warn', 'auth:ownership', 'Using authenticated offline session.', {
          profileId: offlineSession.profile.id,
          sessionMode: offlineSession.mode,
        });
        return offlineSession;
      } catch (offlineError) {
        diagnostics.error(
          'auth:ownership',
          'Authenticated offline launch was denied.',
          offlineError,
        );
        throw offlineError;
      }
    }
    const category =
      failure.category === 'ownership' ? 'ownership' : 'authentication';
    if (!sender.isDestroyed()) {
      sender.send('minecraft:progress', {
        phase: 'error',
        percent: 0,
        category,
        message: failure.message,
      });
    }
    log(
      'error',
      failure.stage === 'ownership'
        ? 'auth:ownership'
        : `auth:${failure.stage === 'minecraft-services' ? 'minecraft' : failure.stage}`,
      failure.message,
      {
        category: failure.category,
        code: failure.code,
        status: failure.status,
      },
    );
    throw error;
  }
};

const ensureVersionInstalled = async (
  versionId: string,
  sender: Electron.WebContents,
) => {
  const settings = await readSettings();
  const installed = await readInstalledVersions(settings.gameDirectory);
  if (installed.some((version) => version.id === versionId)) {
    try {
      const resolved = await Version.parse(settings.gameDirectory, versionId);
      const librariesReady = await Promise.all(
        resolved.libraries.map((library) =>
          pathExists(
            resolveLibraryPath(
              settings.gameDirectory,
              library.download.path,
            ),
          ),
        ),
      );
      if (librariesReady.every(Boolean)) {
        log('info', 'files', '起動対象のclient jarとlibrariesを確認しました。', {
          versionId,
          libraries: resolved.libraries.length,
        });
        return;
      }
      log('warn', 'files', '不足ライブラリを検出したため再取得します。', {
        versionId,
        missingLibraries: librariesReady.filter((ready) => !ready).length,
      });
    } catch (error) {
      log('warn', 'files', 'ローカルバージョンの検証に失敗したため再取得します。', {
        versionId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const remoteVersions = await minecraftService.getRemoteVersions();
  const version = remoteVersions.find((candidate) => candidate.id === versionId);
  if (!version) {
    throw new Error(
      `${versionId} はローカルに完全な状態で存在せず、Mojangからも取得できません。`,
    );
  }
  await minecraftService.installVersion(version, sender);
};

const getLauncherState = async () => {
  const settings = await readSettings();
  const selectedProfile =
    settings.profiles.find(
      (profile) => profile.id === settings.selectedProfileId,
    ) ?? settings.profiles[0];
  const selectedInstanceDirectory = await resolveInstanceDirectory(
    selectedProfile,
  );
  const [savesDirectory, modsDirectory, screenshotsDirectory] =
    await Promise.all([
      ensureInstanceSubdirectory(selectedInstanceDirectory, 'saves'),
      ensureInstanceSubdirectory(selectedInstanceDirectory, 'mods'),
      ensureInstanceSubdirectory(selectedInstanceDirectory, 'screenshots'),
    ]);
  const [
    directoryExists,
    installedVersions,
    remoteVersions,
    worlds,
    mods,
    screenshots,
    auth,
  ] = await Promise.all([
    pathExists(settings.gameDirectory),
    readInstalledVersions(settings.gameDirectory),
    minecraftService
      .getRemoteVersions()
      .catch((error): import('@xmcl/installer').MinecraftVersion[] => {
        diagnostics.error(
          'manifest',
          'ランチャー状態の取得中にMojang manifestを取得できませんでした。',
          error,
        );
        return [];
      }),
    countEntries(savesDirectory),
    countEntries(modsDirectory, 'file'),
    countEntries(screenshotsDirectory, 'file'),
    authService.getState(),
  ]);

  const installedIds = new Set(installedVersions.map((version) => version.id));
  const availableVersionMap = new Map<string, {
    id: string;
    type: string;
    releaseTime: string | null;
    installed: boolean;
  }>();
  for (const version of remoteVersions) {
    availableVersionMap.set(version.id, {
      id: version.id,
      type: version.type,
      releaseTime: version.releaseTime,
      installed: installedIds.has(version.id),
    });
  }

  for (const installedVersion of installedVersions) {
    const existing = availableVersionMap.get(installedVersion.id);
    if (existing) {
      existing.installed = true;
      existing.releaseTime ??= installedVersion.releaseTime;
    } else if (!installedVersion.inheritsFrom) {
      availableVersionMap.set(installedVersion.id, {
        id: installedVersion.id,
        type: installedVersion.type,
        releaseTime: installedVersion.releaseTime,
        installed: true,
      });
    }
  }
  const availableVersions = [...availableVersionMap.values()].sort(
    compareAvailableVersions,
  );

  const fallbackVersion =
    availableVersions.find(
      (version) => version.type === 'release' && version.installed,
    )?.id ??
    availableVersions.find((version) => version.type === 'release')?.id ??
    availableVersions.find((version) => version.installed)?.id ??
    availableVersions[0]?.id ??
    '';
  let settingsChanged = false;
  for (const profile of settings.profiles) {
    const profileWithFallback =
      !profile.versionId && fallbackVersion
        ? { ...profile, versionId: fallbackVersion }
        : profile;
    const installedProfileVersion = installedVersions.find(
      (version) =>
        version.id === profileWithFallback.resolvedVersionId ||
        version.id === profileWithFallback.versionId,
    );
    const normalized = normalizeLaunchProfileVersion(
      profileWithFallback,
      installedProfileVersion,
    );
    const changed =
      profile.versionId !== normalized.versionId ||
      profile.minecraftVersion !== normalized.minecraftVersion ||
      profile.resolvedVersionId !== normalized.resolvedVersionId ||
      profile.loader !== normalized.loader ||
      profile.loaderType !== normalized.loaderType ||
      profile.profileType !== normalized.profileType ||
      profile.loaderVersion !== normalized.loaderVersion;
    Object.assign(profile, normalized);
    settingsChanged ||= changed;
  }
  if (settingsChanged) {
    await writeSettings(settings);
  }

  return {
    buildConfiguration,
    gameDirectory: settings.gameDirectory,
    directoryExists,
    versions: installedVersions
      .sort(compareAvailableVersions)
      .map(({ id, type, releaseTime }) => ({ id, type, releaseTime })),
    availableVersions,
    mojangAvailable: remoteVersions.length > 0,
    worlds,
    mods,
    screenshots,
    auth,
    settings: {
      minMemory: settings.minMemory,
      maxMemory: settings.maxMemory,
      showDeveloperLogs: settings.showDeveloperLogs,
      language: settings.language,
      microsoftClientId: canConfigureClientId
        ? settings.microsoftClientId
        : null,
    },
    profiles: settings.profiles,
    selectedProfileId: settings.selectedProfileId,
    gameRunning: minecraftService.isRunning(),
  };
};

const registerIpcHandlers = () => {
  trustedIpc.handle('launcher:get-state', getLauncherState);
  trustedIpc.handle('launcher:get-logs', () => diagnostics.getEntries());
  trustedIpc.handle('launcher:clear-logs', () => {
    diagnostics.clear();
    return diagnostics.getEntries();
  });

  trustedIpc.handle('launcher:choose-directory', async () => {
    const settings = await readSettings();
    const result = await dialog.showOpenDialog({
      title: 'Minecraft のゲームディレクトリを選択',
      defaultPath: settings.gameDirectory,
      properties: ['openDirectory'],
    });

    if (!result.canceled && result.filePaths[0]) {
      settings.gameDirectory = result.filePaths[0];
      await writeSettings(settings);
    }
    return getLauncherState();
  });

  trustedIpc.handle('launcher:open-directory', async () => {
    const settings = await readSettings();
    await fs.mkdir(settings.gameDirectory, { recursive: true });
    const error = await shell.openPath(settings.gameDirectory);
    return error
      ? { ok: false, message: error }
      : { ok: true, message: 'ゲームフォルダーを開きました。' };
  });

  trustedIpc.handle('launcher:open-instance-folder', async (_event, profileId: unknown) => {
    if (typeof profileId !== 'string') {
      throw new Error('プロファイル指定が不正です。');
    }
    const settings = await readSettings();
    const profile = findProfileOrThrow(settings, profileId);
    const instanceDir = await resolveInstanceDirectory(profile);
    await fs.mkdir(instanceDir, { recursive: true });
    const error = await shell.openPath(instanceDir);
    return error
      ? { ok: false, message: error }
      : { ok: true, message: 'インスタンスフォルダを開きました。' };
  });

  trustedIpc.handle('launcher:open-instance-logs', async (_event, profileId: unknown) => {
    if (typeof profileId !== 'string') {
      throw new Error('プロファイル指定が不正です。');
    }
    const settings = await readSettings();
    const profile = findProfileOrThrow(settings, profileId);
    await resolveInstanceDirectory(profile);
    const logsDir = await ensureLauncherLogsDirectory(
      managedInstancesRoot(),
      profile.id,
    );
    const error = await shell.openPath(logsDir);
    return error
      ? { ok: false, message: error }
      : { ok: true, message: 'ログフォルダを開きました。' };
  });

  trustedIpc.handle('launcher:open-latest-log', async (_event, profileId: unknown) => {
    if (typeof profileId !== 'string') {
      throw new Error('プロファイル指定が不正です。');
    }
    const settings = await readSettings();
    const profile = findProfileOrThrow(settings, profileId);
    const instanceDir = await resolveInstanceDirectory(profile);
    const latestLog = path.join(instanceDir, 'logs', 'latest.log');
    if (!(await pathExists(latestLog))) {
      return { ok: false, message: 'latest.logはまだ作成されていません。' };
    }
    const error = await shell.openPath(latestLog);
    return error
      ? { ok: false, message: error }
      : { ok: true, message: 'latest.logを開きました。' };
  });

  trustedIpc.handle('launcher:copy-reproduction-script', async (_event, profileId: unknown) => {
    if (typeof profileId !== 'string') {
      throw new Error('プロファイル指定が不正です。');
    }
    const settings = await readSettings();
    const profile = findProfileOrThrow(settings, profileId);
    await resolveInstanceDirectory(profile);
    const logsDir = await ensureLauncherLogsDirectory(
      managedInstancesRoot(),
      profile.id,
    );
    const scripts = (await fs.readdir(logsDir, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith('.log.repro.ps1'),
      )
      .map((entry) => path.join(logsDir, entry.name));
    const newest = (
      await Promise.all(
        scripts.map(async (scriptPath) => ({
          scriptPath,
          modifiedAt: (await fs.stat(scriptPath)).mtimeMs,
        })),
      )
    ).sort((left, right) => right.modifiedAt - left.modifiedAt)[0];
    if (!newest) {
      return {
        ok: false,
        message: 'PowerShell再現スクリプトはまだ生成されていません。',
      };
    }
    clipboard.writeText(await fs.readFile(newest.scriptPath, 'utf8'));
    return {
      ok: true,
      message:
        'PowerShell再現スクリプトをコピーしました。アクセストークンは含まれていません。',
    };
  });

  trustedIpc.handle('launcher:save-settings', async (_event, input: unknown) => {
    const settings = await readSettings();
    const update = input as Partial<LauncherSettings>;

    if (typeof update.minMemory === 'number') {
      settings.minMemory = Math.max(512, Math.round(update.minMemory));
    }
    if (typeof update.maxMemory === 'number') {
      settings.maxMemory = Math.max(
        settings.minMemory,
        Math.round(update.maxMemory),
      );
    }
    if (typeof update.showDeveloperLogs === 'boolean') {
      settings.showDeveloperLogs = update.showDeveloperLogs;
    }
    if (typeof update.language === 'string') {
      settings.language = normalizeLanguagePreference(update.language);
    }
    await writeSettings(settings);
    return getLauncherState();
  });

  trustedIpc.handle(
    'auth:configure-client-id',
    async (_event, input: unknown) => {
      if (!canConfigureClientId) {
        throw new Error(
          'Microsoft Client IDはDebugビルドからのみ変更できます。',
        );
      }
      const clientId = typeof input === 'string' ? input.trim() : '';
      if (!isMicrosoftClientId(clientId)) {
        throw new Error(
          'Microsoft Entraのアプリケーション（クライアント）IDをGUID形式で入力してください。',
        );
      }
      const settings = await readSettings();
      await authService.configure(clientId);
      settings.microsoftClientId = clientId;
      await writeSettings(settings);
      log('info', 'auth:microsoft', 'Debug UIからClient IDを更新しました。', {
        configured: true,
      });
      return getLauncherState();
    },
  );

  trustedIpc.handle('profile:save', async (_event, input: unknown) => {
    const settings = await readSettings();
    const update = input as Partial<LaunchProfile>;
    const name = typeof update.name === 'string' ? update.name.trim() : '';
    const minecraftVersion =
      typeof update.minecraftVersion === 'string'
        ? update.minecraftVersion.trim()
        : typeof update.versionId === 'string'
          ? update.versionId.trim()
          : '';

    if (!name || name.length > 40) {
      throw new Error('プロファイル名は1〜40文字で入力してください。');
    }
    if (!minecraftVersion || minecraftVersion.length > 100) {
      throw new Error('Minecraftバージョンを選択してください。');
    }

    const minMemory =
      typeof update.minMemory === 'number'
        ? Math.max(512, Math.round(update.minMemory))
        : settings.minMemory;
    const maxMemory =
      typeof update.maxMemory === 'number'
        ? Math.max(minMemory, Math.round(update.maxMemory))
        : settings.maxMemory;
    const requestedLoader = update.loaderType ?? update.loader;
    const loader: ProfileLoader =
      requestedLoader === 'forge' ||
      requestedLoader === 'neoforge' ||
      requestedLoader === 'fabric'
        ? requestedLoader
        : 'vanilla';
    const loaderVersion =
      loader !== 'vanilla' && typeof update.loaderVersion === 'string'
        ? update.loaderVersion.trim()
        : null;
    if (loader !== 'vanilla' && !loaderVersion) {
      throw new Error(`${loader} build must be selected.`);
    }
    const resolvedVersionId =
      loader !== 'vanilla'
        ? resolvedModLoaderVersionId(
            loader,
            minecraftVersion,
            loaderVersion as string,
          )
        : minecraftVersion;
    const existing = settings.profiles.find(
      (profile) => profile.id === update.id,
    );

    const javaSettings =
      update.java !== undefined
        ? normalizeJavaSettings(update.java)
        : undefined;

    if (existing) {
      Object.assign(existing, {
        name,
        profileType: loader,
        loaderType: loader,
        minecraftVersion,
        loaderVersion,
        resolvedVersionId,
        versionId: minecraftVersion,
        loader,
        minMemory,
        maxMemory,
        mods: loader !== 'vanilla' ? existing.mods : [],
        java: javaSettings ?? existing.java,
        // instanceDir is intentionally not changed on edit to preserve existing saves.
      });
      settings.selectedProfileId = existing.id;
    } else {
      const newId = randomUUID();
      const profile: LaunchProfile = {
        id: newId,
        name,
        profileType: loader,
        loaderType: loader,
        minecraftVersion,
        loaderVersion,
        resolvedVersionId,
        versionId: minecraftVersion,
        loader,
        minMemory,
        maxMemory,
        mods: [],
        java: javaSettings ?? normalizeJavaSettings(undefined),
        instanceDir: defaultInstanceDir(newId),
      };
      settings.profiles.push(profile);
      settings.selectedProfileId = profile.id;
    }

    await writeSettings(settings);
    return getLauncherState();
  });

  trustedIpc.handle(
    'forge:list-builds',
    async (_event, minecraftVersion: unknown) => {
      if (
        typeof minecraftVersion !== 'string' ||
        !minecraftVersion.trim()
      ) {
        throw new Error('Minecraft version is required.');
      }
      return minecraftService.getForgeBuilds(minecraftVersion.trim());
    },
  );

  trustedIpc.handle(
    'loader:list-builds',
    async (_event, loader: unknown, minecraftVersion: unknown) => {
      if (
        (loader !== 'forge' &&
          loader !== 'neoforge' &&
          loader !== 'fabric') ||
        typeof minecraftVersion !== 'string' ||
        !minecraftVersion.trim()
      ) {
        throw new Error('MOD loader and Minecraft version are required.');
      }
      if (loader === 'forge') {
        return (await minecraftService.getForgeBuilds(
          minecraftVersion.trim(),
        )).map((build) => ({
          loader,
          minecraftVersion: build.minecraftVersion,
          loaderVersion: build.loaderVersion,
          resolvedVersionId: build.resolvedVersionId,
          stable: true,
        }));
      }
      return minecraftService.getModLoaderBuilds(
        loader,
        minecraftVersion.trim(),
      );
    },
  );

  trustedIpc.handle(
    'java:list-runtimes',
    async (_event, options: unknown) => {
      const input = (options ?? {}) as {
        refresh?: boolean;
        includeMojang?: boolean;
      };
      return javaRuntimeService.listRuntimes({
        refresh: input.refresh === true,
        includeMojang: input.includeMojang === true,
      });
    },
  );

  trustedIpc.handle('java:add-custom', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Java実行ファイルを選択',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'Java実行ファイル', extensions: ['exe'] }]
          : [],
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return javaRuntimeService.addCustomRuntime(result.filePaths[0]);
  });

  trustedIpc.handle('java:remove-runtime', async (_event, runtimeId: unknown) => {
    if (typeof runtimeId !== 'string' || !runtimeId.trim()) {
      throw new Error('Javaランタイム指定が不正です。');
    }
    return javaRuntimeService.removeRuntime(runtimeId.trim());
  });

  trustedIpc.handle('java:choose-executable', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Java実行ファイルを選択',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'Java実行ファイル', extensions: ['exe'] }]
          : [],
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    const baseName = path.basename(result.filePaths[0]).toLowerCase();
    if (!/^javaw?(\.exe)?$/.test(baseName)) {
      throw new Error('java / javaw 実行ファイルを選択してください。');
    }
    return result.filePaths[0];
  });

  trustedIpc.handle(
    'modrinth:search',
    async (_event, profileId: unknown, query: unknown) => {
      if (typeof profileId !== 'string' || typeof query !== 'string') {
        throw new Error('MOD検索の指定が不正です。');
      }
      const settings = await readSettings();
      const profile = settings.profiles.find(
        (candidate) => candidate.id === profileId,
      );
      if (!profile) {
        throw new Error('プロファイルが見つかりません。');
      }
      if (profile.loader !== 'forge') {
        throw new Error('Modrinth MODを追加するにはForgeを選択してください。');
      }
      return modrinthService.search(query, profile.versionId, 'forge');
    },
  );

  trustedIpc.handle(
    'profile:add-mod',
    async (_event, profileId: unknown, input: unknown) => {
      if (typeof profileId !== 'string') {
        throw new Error('プロファイル指定が不正です。');
      }
      const project = input as Partial<ModrinthProject>;
      if (
        typeof project.projectId !== 'string' ||
        typeof project.slug !== 'string' ||
        typeof project.title !== 'string'
      ) {
        throw new Error('MOD情報が不正です。');
      }
      const settings = await readSettings();
      const profile = settings.profiles.find(
        (candidate) => candidate.id === profileId,
      );
      if (!profile) {
        throw new Error('プロファイルが見つかりません。');
      }
      if (profile.loader !== 'forge') {
        throw new Error('Modrinth MODを追加するにはForgeを選択してください。');
      }
      if (!profile.mods.some((mod) => mod.projectId === project.projectId)) {
        profile.mods.push({
          projectId: project.projectId,
          slug: project.slug,
          title: project.title,
          iconUrl:
            typeof project.iconUrl === 'string' ? project.iconUrl : null,
        });
      }
      await writeSettings(settings);
      return getLauncherState();
    },
  );

  trustedIpc.handle(
    'profile:remove-mod',
    async (_event, profileId: unknown, projectId: unknown) => {
      if (typeof profileId !== 'string' || typeof projectId !== 'string') {
        throw new Error('MOD指定が不正です。');
      }
      const settings = await readSettings();
      const profile = settings.profiles.find(
        (candidate) => candidate.id === profileId,
      );
      if (!profile) {
        throw new Error('プロファイルが見つかりません。');
      }
      profile.mods = profile.mods.filter(
        (mod) => mod.projectId !== projectId,
      );
      await writeSettings(settings);
      return getLauncherState();
    },
  );

  trustedIpc.handle(
    'modrinth:search-mods',
    async (_event, profileId: unknown, query: unknown, input: unknown) => {
      if (typeof query !== 'string') {
        throw new Error('検索キーワードの指定が不正です。');
      }
      const settings = await readSettings();
      const profile = findProfileOrThrow(settings, profileId);
      const options = (input ?? {}) as {
        loader?: ModrinthLoader;
        gameVersion?: string;
        limit?: number;
        offset?: number;
      };
      const loader = profileModrinthLoader(profile);
      if (!loader) {
        throw new Error('Modrinth MOD requires a mod-loader profile.');
      }
      return modrinthService.searchMods(query, {
        loader,
        gameVersion: profile.minecraftVersion,
        limit: options.limit,
        offset: options.offset,
      });
    },
  );

  trustedIpc.handle('modrinth:get-project', async (_event, idOrSlug: unknown) => {
    if (typeof idOrSlug !== 'string') {
      throw new Error('プロジェクト指定が不正です。');
    }
    return modrinthService.getProject(idOrSlug);
  });

  trustedIpc.handle(
    'modrinth:get-versions',
    async (_event, profileId: unknown, idOrSlug: unknown) => {
      if (typeof idOrSlug !== 'string') {
        throw new Error('プロジェクト指定が不正です。');
      }
      const settings = await readSettings();
      const profile = findProfileOrThrow(settings, profileId);
      const loader = profileModrinthLoader(profile);
      if (!loader) {
        throw new Error('Modrinth MOD requires a mod-loader profile.');
      }
      return modrinthService.getProjectVersions(idOrSlug, {
        loaders: [loader],
        gameVersions: [profile.minecraftVersion],
      });
    },
  );

  trustedIpc.handle(
    'modrinth:download-version',
    async (event, profileId: unknown, versionId: unknown) => {
      if (typeof versionId !== 'string') {
        throw new Error('バージョン指定が不正です。');
      }
      if (launchWorkflowInProgress || minecraftService.isRunning()) {
        throw new Error('Minecraft の起動処理中はMODをダウンロードできません。');
      }
      const settings = await readSettings();
      const profile = findProfileOrThrow(settings, profileId);
      const loader = profileModrinthLoader(profile);
      if (!loader) {
        throw new Error(
          'このプロファイルにはMODローダーがありません（Forgeプロファイルを選択してください）。',
        );
      }
      const version = await modrinthService.getVersionInfo(versionId);
      if (
        !version.loaders.includes(loader) ||
        !version.gameVersions.includes(profile.minecraftVersion)
      ) {
        throw new Error(
          `The selected MOD version is not compatible with ${loader} / Minecraft ${profile.minecraftVersion}.`,
        );
      }
      const instanceDirectory = await resolveInstanceDirectory(profile);
      return modrinthService.downloadVersion(
        {
          instanceDirectory,
          version,
          loader,
          minecraftVersion: profile.minecraftVersion,
        },
        event.sender,
      );
    },
  );

  trustedIpc.handle(
    'modrinth:list-installed-mods',
    async (_event, profileId: unknown) => {
      const settings = await readSettings();
      const profile = findProfileOrThrow(settings, profileId);
      const instanceDirectory = await resolveInstanceDirectory(profile);
      return modrinthService.listInstalledMods(instanceDirectory);
    },
  );

  trustedIpc.handle(
    'modrinth:remove-installed-mod',
    async (_event, profileId: unknown, projectIdOrFileName: unknown) => {
      if (typeof projectIdOrFileName !== 'string') {
        throw new Error('MOD指定が不正です。');
      }
      const settings = await readSettings();
      const profile = findProfileOrThrow(settings, profileId);
      const instanceDirectory = await resolveInstanceDirectory(profile);
      return modrinthService.removeInstalledMod(
        instanceDirectory,
        projectIdOrFileName,
      );
    },
  );

  trustedIpc.handle('profile:select', async (_event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new Error('プロファイル指定が不正です。');
    }
    const settings = await readSettings();
    if (!settings.profiles.some((profile) => profile.id === id)) {
      throw new Error('プロファイルが見つかりません。');
    }
    settings.selectedProfileId = id;
    await writeSettings(settings);
    return getLauncherState();
  });

  trustedIpc.handle('profile:delete', async (_event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new Error('プロファイル指定が不正です。');
    }
    const settings = await readSettings();
    if (settings.profiles.length <= 1) {
      throw new Error('少なくとも1つのプロファイルが必要です。');
    }
    const nextProfiles = settings.profiles.filter(
      (profile) => profile.id !== id,
    );
    if (nextProfiles.length === settings.profiles.length) {
      throw new Error('プロファイルが見つかりません。');
    }
    settings.profiles = nextProfiles;
    if (settings.selectedProfileId === id) {
      settings.selectedProfileId = nextProfiles[0].id;
    }
    await writeSettings(settings);
    return getLauncherState();
  });

  trustedIpc.handle('auth:login', (event) => authService.login(event.sender));
  trustedIpc.handle('auth:get-device-code', () =>
    authService.getActiveDeviceCode(),
  );
  trustedIpc.handle('auth:get-flow-state', () => authService.getFlowState());
  trustedIpc.handle('auth:cancel-login', () => {
    authService.cancelLogin();
  });
  trustedIpc.handle('auth:open-verification', async () => {
    const verificationUri =
      authService.getActiveDeviceCode()?.verificationUri;
    if (!verificationUri) {
      throw new Error('有効なMicrosoft認証ページがありません。');
    }
    await openTrustedExternal(verificationUri);
  });
  trustedIpc.handle('auth:logout', () => authService.logout());

  trustedIpc.handle('minecraft:install-version', async (event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new Error('バージョン指定が不正です。');
    }
    if (launchWorkflowInProgress || minecraftService.isRunning()) {
      throw new Error('Minecraft の起動処理中は追加ダウンロードできません。');
    }
    await requireMinecraftSession(event.sender);
    const versions = await minecraftService.getRemoteVersions();
    const version = versions.find((candidate) => candidate.id === id);
    if (!version) {
      throw new Error('Mojang のマニフェストにないバージョンです。');
    }
    await minecraftService.installVersion(version, event.sender);
    return { ok: true, message: `${id} のインストールが完了しました。` };
  });

  trustedIpc.handle('minecraft:launch-version', async (event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new Error('バージョン指定が不正です。');
    }
    return withLaunchWorkflow(async () => {
      const settings = await readSettings();
      log('info', 'settings', '起動設定を読み込みました。', {
        versionId: id,
        minMemory: settings.minMemory,
        maxMemory: settings.maxMemory,
      });
      const session = await requireMinecraftSession(event.sender);
      if (session.mode === 'online') {
        await ensureVersionInstalled(id, event.sender);
      }
      return minecraftService.launchVersion(
        id,
        session,
        {
          minMemory: settings.minMemory,
          maxMemory: settings.maxMemory,
        },
        event.sender,
      );
    });
  });

  trustedIpc.handle('minecraft:launch-profile', async (event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new Error('プロファイル指定が不正です。');
    }
    return withLaunchWorkflow(async () => {
      const settings = await readSettings();
      const profile = settings.profiles.find(
        (candidate) => candidate.id === id,
      );
      if (!profile) {
        throw new Error('プロファイルが見つかりません。');
      }
      log('info', 'settings', '起動プロファイルを読み込みました。', {
        profileId: profile.id,
        versionId: profile.versionId,
        loader: profile.loader,
        minMemory: profile.minMemory,
        maxMemory: profile.maxMemory,
      });
      const installedVersions = await readInstalledVersions(
        settings.gameDirectory,
      );
      const selectedInstalledVersion = installedVersions.find(
        (version) =>
          version.id === profile.resolvedVersionId ||
          version.id === profile.versionId,
      );
      const normalizedProfile = normalizeLaunchProfileVersion(
        profile,
        selectedInstalledVersion,
      );
      if (
        profile.versionId !== normalizedProfile.versionId ||
        profile.minecraftVersion !== normalizedProfile.minecraftVersion ||
        profile.resolvedVersionId !== normalizedProfile.resolvedVersionId ||
        profile.loader !== normalizedProfile.loader ||
        profile.loaderType !== normalizedProfile.loaderType ||
        profile.profileType !== normalizedProfile.profileType ||
        profile.loaderVersion !== normalizedProfile.loaderVersion
      ) {
        Object.assign(profile, normalizedProfile);
        await writeSettings(settings);
      }
      const session = await requireMinecraftSession(event.sender);
      const offlineOnly = session.mode === 'authenticated-offline';
      if (!offlineOnly) {
        await ensureVersionInstalled(
          profile.minecraftVersion,
          event.sender,
        );
      }
      if (profile.loader !== 'vanilla' && !profile.loaderVersion) {
        throw new Error(
          `${profile.loader} build is not selected for this profile.`,
        );
      }
      const versionId =
        profile.loader !== 'vanilla'
          ? await minecraftService.ensureModLoader(
              profile.loader,
              profile.minecraftVersion,
              profile.loaderVersion as string,
              profile.resolvedVersionId,
              event.sender,
              offlineOnly,
              { javaSettings: profile.java, instanceId: profile.id },
            )
          : profile.minecraftVersion;
      if (profile.resolvedVersionId !== versionId) {
        profile.resolvedVersionId = versionId;
        await writeSettings(settings);
      }
      const instanceDirectory = await resolveInstanceDirectory(profile);
      if (profile.loader === 'forge' && !offlineOnly) {
        await modrinthService.syncMods(
          instanceDirectory,
          profile.mods,
          profile.minecraftVersion,
          event.sender,
        );
      }
      const result = await minecraftService.launchVersion(
        versionId,
        session,
        {
          minMemory: profile.minMemory,
          maxMemory: profile.maxMemory,
          jvmArgs: profile.java.jvmArgs,
        },
        event.sender,
        instanceDirectory,
        {
          javaSettings: profile.java,
          instanceId: profile.id,
          minecraftVersion: profile.minecraftVersion,
          loaderType: profile.loaderType,
          loaderVersion: profile.loaderVersion,
        },
      );
      return offlineOnly
        ? {
            ...result,
            message:
              'Minecraft started in authenticated offline mode. Single-player is supported; online servers and Realms may be unavailable.',
          }
        : result;
    });
  });

};

const createWindow = () => {
  if (isReleaseBuild) {
    Menu.setApplicationMenu(null);
  }

  const mainWindow = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#10150f',
    title: appName,
    autoHideMenuBar: isReleaseBuild,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  if (isReleaseBuild) {
    mainWindow.setMenu(null);
    mainWindow.setMenuBarVisibility(false);
  } else {
    mainWindow.setAutoHideMenuBar(false);
    mainWindow.setMenuBarVisibility(true);
  }

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl)) {
      event.preventDefault();
      log('warn', 'app', 'Blocked renderer navigation.', { targetUrl });
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    log('warn', 'app', 'Blocked renderer window.open request.', { url });
    return { action: 'deny' };
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

app.whenReady().then(async () => {
  log('info', 'app', 'Electron main processが起動しました。', {
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
  });
  try {
    await migrateLegacyUserData();
    await migrateKnownProfileInstances();
  } catch (error) {
    diagnostics.error(
      'settings',
      '旧アプリ名の設定データを移行できませんでした。新しい設定で起動します。',
      error,
    );
  }
  const startupSettings = await readSettings();
  await writeSettings(startupSettings);
  authService = new AuthService(app.getPath('userData'), log);
  try {
    await authService.configure(startupSettings.microsoftClientId);
  } catch (error) {
    diagnostics.error(
      'auth:microsoft',
      'Microsoft認証サービスの初期化に失敗しました。アプリは認証なしで起動します。',
      error,
    );
  }
  javaRuntimeService = new JavaRuntimeService(
    path.join(app.getPath('userData'), 'runtime'),
    log,
  );
  minecraftService = new MinecraftService(
    async () => (await readSettings()).gameDirectory,
    path.join(app.getPath('userData'), 'runtime'),
    log,
    javaRuntimeService,
  );
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
