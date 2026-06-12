import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import started from 'electron-squirrel-startup';
import { Version } from '@xmcl/core';
import { resolveMicrosoftClientId } from './auth-config';
import { classifyAuthFailure } from './auth-errors';
import { AuthService } from './auth-service';
import { LauncherDiagnostics } from './diagnostics';
import {
  JavaRuntimeService,
  normalizeJavaSettings,
  type JavaDistributionId,
  type ProfileJavaSettings,
} from './java-runtime-service';
import { resolveLibraryPath } from './launcher-utils';
import { MinecraftService } from './minecraft-service';
import {
  ModrinthService,
  type ModrinthLoader,
  type ModrinthProject,
  type ProfileMod,
} from './modrinth-service';

type LauncherSettings = {
  gameDirectory: string;
  minMemory: number;
  maxMemory: number;
  microsoftClientId: string;
  profiles: LaunchProfile[];
  selectedProfileId: string;
};

type LaunchProfile = {
  id: string;
  name: string;
  profileType: 'vanilla' | 'forge';
  loaderType: 'vanilla' | 'forge';
  minecraftVersion: string;
  loaderVersion: string | null;
  resolvedVersionId: string;
  // Compatibility aliases for settings written by versions before 1.5.
  versionId: string;
  loader: 'vanilla' | 'forge';
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
const diagnostics = new LauncherDiagnostics((entry) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('launcher:log', entry);
  }
});
const log = diagnostics.log.bind(diagnostics);
const modrinthService = new ModrinthService(log);

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

const defaultInstanceDir = (profileId: string) =>
  path.join(defaultGameDirectory(), 'simple-craft', 'profiles', profileId);

const defaultSettings = (): LauncherSettings => ({
  gameDirectory: defaultGameDirectory(),
  minMemory: 1024,
  maxMemory: 4096,
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
            const loaderType =
              profile.loaderType === 'forge' || profile.loader === 'forge'
                ? 'forge'
                : 'vanilla';
            const minecraftVersion =
              typeof profile.minecraftVersion === 'string'
                ? profile.minecraftVersion
                : profile.versionId;
            const loaderVersion =
              loaderType === 'forge' &&
              typeof profile.loaderVersion === 'string' &&
              profile.loaderVersion.trim()
                ? profile.loaderVersion.trim()
                : null;
            const resolvedVersionId =
              loaderType === 'forge' && loaderVersion
                ? `${minecraftVersion}-forge-${loaderVersion}`
                : minecraftVersion;
            // Profiles saved before instanceDir was added get the path that
            // the launcher already uses at runtime, so saves are not lost.
            const baseDir =
              typeof value.gameDirectory === 'string' && value.gameDirectory.trim()
                ? value.gameDirectory.trim()
                : defaultGameDirectory();
            const instanceDir =
              typeof (profile as { instanceDir?: unknown }).instanceDir === 'string' &&
              ((profile as { instanceDir?: unknown }).instanceDir as string).trim()
                ? ((profile as { instanceDir?: unknown }).instanceDir as string).trim()
                : path.join(baseDir, 'simple-craft', 'profiles', profile.id);
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
const resolveInstanceDirectory = (
  gameDirectory: string,
  profile: LaunchProfile,
) =>
  profile.instanceDir ||
  path.join(gameDirectory, 'simple-craft', 'profiles', profile.id);

// Maps a profile loader onto a Modrinth loader facet. Vanilla profiles have no
// mod loader, so they cannot host Modrinth mods.
const profileModrinthLoader = (
  profile: LaunchProfile,
): ModrinthLoader | null => (profile.loader === 'forge' ? 'forge' : null);

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
    countEntries(path.join(settings.gameDirectory, 'saves')),
    countEntries(path.join(settings.gameDirectory, 'mods'), 'file'),
    countEntries(path.join(settings.gameDirectory, 'screenshots'), 'file'),
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
    const installedProfileVersion = installedVersions.find(
      (version) => version.id === profile.versionId,
    );
    if (
      installedProfileVersion?.inheritsFrom &&
      /(?:^|[-_.])forge(?:[-_.]|$)/i.test(installedProfileVersion.id)
    ) {
      profile.versionId = installedProfileVersion.inheritsFrom;
      profile.loader = 'forge';
      profile.loaderVersion =
        installedProfileVersion.id.match(/-forge-(.+)$/i)?.[1] ?? null;
      settingsChanged = true;
    }
    if (!profile.versionId && fallbackVersion) {
      profile.versionId = fallbackVersion;
      settingsChanged = true;
    }
    const loaderType = profile.loader === 'forge' ? 'forge' : 'vanilla';
    profile.profileType = loaderType;
    profile.loaderType = loaderType;
    profile.minecraftVersion = profile.versionId;
    profile.loaderVersion =
      loaderType === 'forge' ? profile.loaderVersion : null;
    profile.resolvedVersionId =
      loaderType === 'forge' && profile.loaderVersion
        ? `${profile.versionId}-forge-${profile.loaderVersion}`
        : profile.versionId;
  }
  if (settingsChanged) {
    await writeSettings(settings);
  }

  return {
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
    },
    profiles: settings.profiles,
    selectedProfileId: settings.selectedProfileId,
    gameRunning: minecraftService.isRunning(),
  };
};

const registerIpcHandlers = () => {
  ipcMain.handle('launcher:get-state', getLauncherState);
  ipcMain.handle('launcher:get-logs', () => diagnostics.getEntries());
  ipcMain.handle('launcher:clear-logs', () => {
    diagnostics.clear();
    return diagnostics.getEntries();
  });

  ipcMain.handle('launcher:choose-directory', async () => {
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

  ipcMain.handle('launcher:open-directory', async () => {
    const settings = await readSettings();
    await fs.mkdir(settings.gameDirectory, { recursive: true });
    const error = await shell.openPath(settings.gameDirectory);
    return error
      ? { ok: false, message: error }
      : { ok: true, message: 'ゲームフォルダーを開きました。' };
  });

  ipcMain.handle('launcher:save-settings', async (_event, input: unknown) => {
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
    await writeSettings(settings);
    return getLauncherState();
  });

  ipcMain.handle('profile:save', async (_event, input: unknown) => {
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
    const loader =
      update.loaderType === 'forge' || update.loader === 'forge'
        ? 'forge'
        : 'vanilla';
    const loaderVersion =
      loader === 'forge' && typeof update.loaderVersion === 'string'
        ? update.loaderVersion.trim()
        : null;
    if (loader === 'forge' && !loaderVersion) {
      throw new Error('Forge build must be selected.');
    }
    const resolvedVersionId =
      loader === 'forge'
        ? `${minecraftVersion}-forge-${loaderVersion}`
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
        mods: loader === 'forge' ? existing.mods : [],
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
        instanceDir: path.join(
          settings.gameDirectory,
          'simple-craft',
          'profiles',
          newId,
        ),
      };
      settings.profiles.push(profile);
      settings.selectedProfileId = profile.id;
    }

    await writeSettings(settings);
    return getLauncherState();
  });

  ipcMain.handle(
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

  ipcMain.handle(
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

  ipcMain.handle('java:add-custom', async () => {
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

  ipcMain.handle('java:remove-runtime', async (_event, runtimeId: unknown) => {
    if (typeof runtimeId !== 'string' || !runtimeId.trim()) {
      throw new Error('Javaランタイム指定が不正です。');
    }
    return javaRuntimeService.removeRuntime(runtimeId.trim());
  });

  ipcMain.handle(
    'java:install-runtime',
    async (event, distribution: unknown, major: unknown) => {
      if (typeof distribution !== 'string' || typeof major !== 'number') {
        throw new Error('Javaインストール指定が不正です。');
      }
      if (launchWorkflowInProgress || minecraftService.isRunning()) {
        throw new Error('Minecraft の起動処理中はJavaをインストールできません。');
      }
      return javaRuntimeService.installRuntime(
        distribution as JavaDistributionId,
        Math.round(major),
        (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('java:install-progress', progress);
          }
        },
      );
    },
  );

  ipcMain.handle('java:choose-executable', async () => {
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

  ipcMain.handle(
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

  ipcMain.handle(
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

  ipcMain.handle(
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

  ipcMain.handle(
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
      return modrinthService.searchMods(query, {
        loader: options.loader ?? profileModrinthLoader(profile) ?? undefined,
        gameVersion:
          typeof options.gameVersion === 'string'
            ? options.gameVersion
            : profile.minecraftVersion,
        limit: options.limit,
        offset: options.offset,
      });
    },
  );

  ipcMain.handle('modrinth:get-project', async (_event, idOrSlug: unknown) => {
    if (typeof idOrSlug !== 'string') {
      throw new Error('プロジェクト指定が不正です。');
    }
    return modrinthService.getProject(idOrSlug);
  });

  ipcMain.handle(
    'modrinth:get-versions',
    async (_event, profileId: unknown, idOrSlug: unknown, input: unknown) => {
      if (typeof idOrSlug !== 'string') {
        throw new Error('プロジェクト指定が不正です。');
      }
      const settings = await readSettings();
      const profile = findProfileOrThrow(settings, profileId);
      const options = (input ?? {}) as {
        loader?: ModrinthLoader;
        gameVersion?: string;
      };
      const loader = options.loader ?? profileModrinthLoader(profile);
      const gameVersion =
        typeof options.gameVersion === 'string'
          ? options.gameVersion
          : profile.minecraftVersion;
      return modrinthService.getProjectVersions(idOrSlug, {
        loaders: loader ? [loader] : undefined,
        gameVersions: gameVersion ? [gameVersion] : undefined,
      });
    },
  );

  ipcMain.handle(
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
      const instanceDirectory = resolveInstanceDirectory(
        settings.gameDirectory,
        profile,
      );
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

  ipcMain.handle(
    'modrinth:list-installed-mods',
    async (_event, profileId: unknown) => {
      const settings = await readSettings();
      const profile = findProfileOrThrow(settings, profileId);
      const instanceDirectory = resolveInstanceDirectory(
        settings.gameDirectory,
        profile,
      );
      return modrinthService.listInstalledMods(instanceDirectory);
    },
  );

  ipcMain.handle(
    'modrinth:remove-installed-mod',
    async (_event, profileId: unknown, projectIdOrFileName: unknown) => {
      if (typeof projectIdOrFileName !== 'string') {
        throw new Error('MOD指定が不正です。');
      }
      const settings = await readSettings();
      const profile = findProfileOrThrow(settings, profileId);
      const instanceDirectory = resolveInstanceDirectory(
        settings.gameDirectory,
        profile,
      );
      return modrinthService.removeInstalledMod(
        instanceDirectory,
        projectIdOrFileName,
      );
    },
  );

  ipcMain.handle('profile:select', async (_event, id: unknown) => {
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

  ipcMain.handle('profile:delete', async (_event, id: unknown) => {
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

  ipcMain.handle('auth:login', (event) => authService.login(event.sender));
  ipcMain.handle('auth:get-device-code', () =>
    authService.getActiveDeviceCode(),
  );
  ipcMain.handle('auth:get-flow-state', () => authService.getFlowState());
  ipcMain.handle('auth:cancel-login', () => {
    authService.cancelLogin();
  });
  ipcMain.handle('auth:open-verification', async () => {
    const verificationUri =
      authService.getActiveDeviceCode()?.verificationUri;
    if (!verificationUri) {
      throw new Error('有効なMicrosoft認証ページがありません。');
    }
    await shell.openExternal(verificationUri);
  });
  ipcMain.handle('auth:logout', () => authService.logout());

  ipcMain.handle('minecraft:install-version', async (event, id: unknown) => {
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

  ipcMain.handle('minecraft:launch-version', async (event, id: unknown) => {
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

  ipcMain.handle('minecraft:launch-profile', async (event, id: unknown) => {
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
        (version) => version.id === profile.versionId,
      );
      if (
        selectedInstalledVersion?.inheritsFrom &&
        /(?:^|[-_.])forge(?:[-_.]|$)/i.test(selectedInstalledVersion.id)
      ) {
        profile.versionId = selectedInstalledVersion.inheritsFrom;
        profile.loader = 'forge';
        profile.profileType = 'forge';
        profile.loaderType = 'forge';
        profile.minecraftVersion = selectedInstalledVersion.inheritsFrom;
        profile.loaderVersion =
          selectedInstalledVersion.id.match(/-forge-(.+)$/i)?.[1] ?? null;
        profile.resolvedVersionId = selectedInstalledVersion.id;
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
      if (profile.loader === 'forge' && !profile.loaderVersion) {
        throw new Error('Forge build is not selected for this profile.');
      }
      const versionId =
        profile.loader === 'forge'
          ? await minecraftService.ensureForge(
              profile.minecraftVersion,
              profile.loaderVersion as string,
              event.sender,
              offlineOnly,
              { javaSettings: profile.java, instanceId: profile.id },
            )
          : profile.minecraftVersion;
      if (profile.resolvedVersionId !== versionId) {
        profile.resolvedVersionId = versionId;
        await writeSettings(settings);
      }
      const instanceDirectory = resolveInstanceDirectory(
        settings.gameDirectory,
        profile,
      );
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
        { javaSettings: profile.java, instanceId: profile.id },
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
  const mainWindow = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#10150f',
    title: 'Simple Craft Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
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
