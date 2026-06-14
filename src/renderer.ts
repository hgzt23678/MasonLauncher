import './index.css';
import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/progress/linear-progress.js';
import '@material/web/textfield/filled-text-field.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/select/filled-select.js';
import '@material/web/select/select-option.js';
import '@material/web/switch/switch.js';
import '@material/web/tabs/tabs.js';
import '@material/web/tabs/primary-tab.js';
import {
  compareVersionsByRelease,
  filterSelectableVersions,
  formatVersionLabel,
} from './renderer-logic';
import { isMicrosoftClientId } from './auth-config';
import type { BuildConfiguration } from './build-configuration';
import {
  resolveLanguage,
  translate,
  type LanguagePreference,
  type SupportedLanguage,
  type TranslationKey,
} from './i18n';

// Minimal interface for accessing md-* Web Component properties not on HTMLElement
interface MdEl extends HTMLElement {
  value: string | number;
  disabled: boolean;
  active: boolean;
  activeTabIndex: number;
  selected: boolean;
}

type MinecraftVersion = {
  id: string;
  type: string;
  releaseTime: string | null;
};

type AvailableVersion = MinecraftVersion & {
  installed: boolean;
};

type AuthState = {
  configured: boolean;
  signedIn: boolean;
  secureStorageAvailable: boolean;
  diagnostic: EntraDiagnostic;
  offline: {
    allowed: boolean;
    reason: string;
    message: string;
    ownershipVerifiedAt: string | null;
    expiresAt: string | null;
  };
  profile: {
    id: string;
    name: string;
    skinUrl?: string;
  } | null;
};

type EntraDiagnostic = {
  status:
    | 'not-configured'
    | 'invalid-format'
    | 'unchecked'
    | 'ready'
    | 'personal-account-disabled'
    | 'public-client-disabled'
    | 'invalid-scope'
    | 'network-error'
    | 'unknown-error';
  message: string;
  action: string;
  checkedAt: string | null;
  technicalCode?: string;
  correlationId?: string;
};

type DeviceCodeInfo = {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  expiresAt: number;
  message: string;
};

type AuthFlowState = {
  status:
    | 'idle'
    | 'requesting-code'
    | 'waiting-for-user'
    | 'exchanging'
    | 'success'
    | 'cancelled'
    | 'error';
  deviceCode: DeviceCodeInfo | null;
  message: string;
  errorCode?: string;
  diagnostic?: EntraDiagnostic;
};

type ProfileMod = {
  projectId: string;
  slug: string;
  title: string;
  iconUrl: string | null;
};

type ProfileLoader = 'vanilla' | 'forge' | 'neoforge' | 'fabric';
type ModLoader = Exclude<ProfileLoader, 'vanilla'>;

type JavaDistributionId = 'liberica-lite' | 'liberica' | 'zulu' | 'temurin';

type ProfileJavaSettings = {
  mode: 'auto' | 'fixed' | 'customPath';
  runtimeId: string | null;
  customPath: string | null;
  preferredDistributions: JavaDistributionId[];
  jvmArgs: string[];
};

type JavaRuntimeInfo = {
  id: string;
  source: 'managed' | 'custom' | 'system' | 'mojang';
  distribution: string;
  majorVersion: number | null;
  versionString: string | null;
  arch: string | null;
  path: string;
  verified: boolean;
  verifiedAt: string | null;
  error?: string;
};

const defaultJavaSettings = (): ProfileJavaSettings => ({
  mode: 'auto',
  runtimeId: null,
  customPath: null,
  preferredDistributions: ['temurin', 'liberica-lite', 'liberica', 'zulu'],
  jvmArgs: [],
});

const javaDistributionLabels: Record<string, string> = {
  'liberica-lite': 'Liberica Lite',
  liberica: 'Liberica Standard',
  zulu: 'Azul Zulu',
  temurin: 'Eclipse Temurin',
  mojang: 'Mojang',
  openjdk: 'OpenJDK',
  oracle: 'Oracle',
  microsoft: 'Microsoft',
  corretto: 'Amazon Corretto',
  graalvm: 'GraalVM',
  unknown: '不明',
};

type LaunchProfile = {
  id: string;
  name: string;
  profileType: ProfileLoader;
  loaderType: ProfileLoader;
  minecraftVersion: string;
  loaderVersion: string | null;
  resolvedVersionId: string;
  versionId: string;
  loader: ProfileLoader;
  minMemory: number;
  maxMemory: number;
  mods: ProfileMod[];
  java: ProfileJavaSettings;
  instanceDir: string;
};

type ModLoaderBuild = {
  loader: ModLoader;
  minecraftVersion: string;
  loaderVersion: string;
  resolvedVersionId: string;
  stable: boolean;
};

type ModrinthSearchHit = ProfileMod & {
  description: string;
  downloads: number;
  follows: number;
  categories: string[];
  clientSide: string;
  serverSide: string;
  latestVersion: string | null;
};

type ModrinthVersionInfo = {
  id: string;
  projectId: string;
  name: string;
  versionNumber: string;
  versionType: 'release' | 'beta' | 'alpha';
  gameVersions: string[];
  loaders: string[];
  datePublished: string | null;
};

type InstalledModRecord = {
  projectId: string | null;
  versionId: string;
  fileName: string;
  title: string;
  loader: string;
  minecraftVersion: string;
  dateInstalled: string;
};

type LauncherState = {
  buildConfiguration: BuildConfiguration;
  gameDirectory: string;
  directoryExists: boolean;
  versions: MinecraftVersion[];
  availableVersions: AvailableVersion[];
  mojangAvailable: boolean;
  worlds: number;
  mods: number;
  screenshots: number;
  auth: AuthState;
  settings: {
    minMemory: number;
    maxMemory: number;
    showDeveloperLogs: boolean;
    language: LanguagePreference;
    microsoftClientId: string | null;
  };
  profiles: LaunchProfile[];
  selectedProfileId: string;
  gameRunning: boolean;
};

type ActionResult = {
  ok: boolean;
  message: string;
};

type LauncherLogEntry = {
  id: number;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  stage: string;
  message: string;
  detail?: Record<string, unknown>;
};

const failureLabels: Record<string, TranslationKey> = {
  authentication: 'failure.authentication',
  ownership: 'failure.ownership',
  manifest: 'failure.download',
  download: 'failure.download',
  network: 'failure.download',
  verification: 'failure.verification',
  json: 'failure.verification',
  java: 'failure.java',
  arguments: 'failure.arguments',
  spawn: 'failure.process',
  crash: 'failure.crash',
  'window-unverified': 'failure.windowUnverified',
  graphics: 'failure.crash',
  memory: 'failure.java',
  natives: 'failure.verification',
  'forge-installer': 'failure.forge',
  'forge-profile': 'failure.forge',
  'forge-version-json': 'failure.forge',
  'forge-library': 'failure.forge',
  'forge-processor': 'failure.forge',
  'offline-auth': 'failure.authentication',
  'offline-files': 'failure.verification',
};

const formatCategorizedMessage = (
  message: string,
  category: unknown,
) => {
  const label =
    typeof category === 'string' ? failureLabels[category] : undefined;
  return label ? `[${t(label)}] ${message}` : message;
};

const demoState: LauncherState = {
  buildConfiguration: 'debug',
  gameDirectory: 'C:\\Users\\Player\\AppData\\Roaming\\.minecraft',
  directoryExists: true,
  versions: [{ id: '1.21.11', type: 'installed', releaseTime: null }],
  availableVersions: [
    {
      id: '26.1.2',
      type: 'release',
      releaseTime: '2026-04-09T10:12:23Z',
      installed: false,
    },
    {
      id: '1.21.11',
      type: 'release',
      releaseTime: '2025-12-09T12:00:00Z',
      installed: true,
    },
    {
      id: '1.20.1',
      type: 'release',
      releaseTime: '2023-06-12T12:00:00Z',
      installed: true,
    },
  ],
  mojangAvailable: true,
  worlds: 7,
  mods: 24,
  screenshots: 18,
  auth: {
    configured: true,
    signedIn: true,
    secureStorageAvailable: true,
    offline: {
      allowed: true,
      reason: 'allowed',
      message:
        'Cached authenticated offline launch is available for single-player use.',
      ownershipVerifiedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    },
    diagnostic: {
      status: 'ready',
      message: 'Microsoftはデバイスコードを発行できます。',
      action: '登録の基本設定は有効です。',
      checkedAt: new Date().toISOString(),
    },
    profile: {
      id: '00000000000000000000000000000000',
      name: 'Steve',
    },
  },
  settings: {
    minMemory: 1024,
    maxMemory: 4096,
    showDeveloperLogs: true,
    language: 'system',
    microsoftClientId: '00000000-0000-0000-0000-000000000001',
  },
  profiles: [
    {
      id: 'default-profile',
      profileType: 'vanilla',
      loaderType: 'vanilla',
      minecraftVersion: '1.21.11',
      loaderVersion: null,
      resolvedVersionId: '1.21.11',
      name: '最新バニラ',
      versionId: '1.21.11',
      loader: 'vanilla',
      minMemory: 1024,
      maxMemory: 4096,
      mods: [],
      java: defaultJavaSettings(),
      instanceDir: 'C:\\Users\\Player\\AppData\\Roaming\\.minecraft\\mason-launcher\\profiles\\default-profile',
    },
    {
      id: 'forge-profile',
      profileType: 'forge',
      loaderType: 'forge',
      minecraftVersion: '1.20.1',
      loaderVersion: '47.4.0',
      resolvedVersionId: '1.20.1-forge-47.4.0',
      name: 'Forge Adventure',
      versionId: '1.20.1',
      loader: 'forge',
      minMemory: 1024,
      maxMemory: 6144,
      mods: [
        {
          projectId: 'AANobbMI',
          slug: 'sodium',
          title: 'Sodium',
          iconUrl: null,
        },
        {
          projectId: 'P7dR8mSH',
          slug: 'fabric-api',
          title: 'JourneyMap',
          iconUrl: null,
        },
      ],
      java: defaultJavaSettings(),
      instanceDir: 'C:\\Users\\Player\\AppData\\Roaming\\.minecraft\\mason-launcher\\profiles\\forge-profile',
    },
  ],
  selectedProfileId: 'forge-profile',
  gameRunning: false,
};

const demoAction = async (): Promise<ActionResult> => ({
  ok: true,
  message: 'プレビューモードです。',
});

const previewParameters = new URLSearchParams(window.location.search);
if (previewParameters.has('release')) {
  demoState.buildConfiguration = 'release';
  demoState.settings.microsoftClientId = null;
}
if (previewParameters.has('signed-out')) {
  demoState.auth.signedIn = false;
  demoState.auth.profile = null;
  demoState.auth.offline.allowed = false;
}
if (previewParameters.has('client-id-missing')) {
  demoState.auth.configured = false;
  demoState.settings.microsoftClientId = '';
}
const previewAuthError =
  'Minecraft Services がこのApp IDを拒否しました。\n' +
  '原因: Application ID が Minecraft API 利用許可を受けていません。\n' +
  'この状態ではMinecraftを起動できません。\n' +
  'Minecraft Servicesの利用には AppID review の承認が必要です。';

const api = window.launcher ?? {
  getState: async () => demoState,
  getLogs: async (): Promise<LauncherLogEntry[]> => [
    {
      id: 1,
      timestamp: new Date().toISOString(),
      level: 'info',
      stage: 'app',
      message: 'プレビューモードで開発者ログを表示しています。',
    },
  ],
  clearLogs: async (): Promise<LauncherLogEntry[]> => [],
  chooseDirectory: async () => demoState,
  openDirectory: demoAction,
  openInstanceFolder: demoAction,
  openInstanceLogs: demoAction,
  openLatestLog: demoAction,
  copyReproductionScript: demoAction,
  saveSettings: async (settings: Record<string, unknown>) => {
    if (typeof settings.minMemory === 'number') {
      demoState.settings.minMemory = settings.minMemory;
    }
    if (typeof settings.maxMemory === 'number') {
      demoState.settings.maxMemory = settings.maxMemory;
    }
    if (typeof settings.showDeveloperLogs === 'boolean') {
      demoState.settings.showDeveloperLogs = settings.showDeveloperLogs;
    }
    if (typeof settings.language === 'string') {
      demoState.settings.language = settings.language as LanguagePreference;
    }
    return demoState;
  },
  configureMicrosoftClientId: async (clientId: string) => {
    demoState.settings.microsoftClientId = clientId;
    demoState.auth.configured = isMicrosoftClientId(clientId);
    return demoState;
  },
  saveProfile: async () => demoState,
  getModLoaderBuilds: async (
    loader: ModLoader,
    minecraftVersion: string,
  ): Promise<ModLoaderBuild[]> => [
    {
      loader,
      minecraftVersion,
      loaderVersion:
        loader === 'forge'
          ? '47.4.0'
          : loader === 'neoforge'
            ? '21.1.200'
            : '0.16.14',
      resolvedVersionId:
        loader === 'forge'
          ? `${minecraftVersion}-forge-47.4.0`
          : loader === 'neoforge'
            ? 'neoforge-21.1.200'
            : `${minecraftVersion}-fabric0.16.14`,
      stable: true,
    },
  ],
  selectProfile: async () => demoState,
  deleteProfile: async () => demoState,
  listJavaRuntimes: async (): Promise<JavaRuntimeInfo[]> => [
    {
      id: 'managed:liberica-lite-21-x64',
      source: 'managed',
      distribution: 'liberica-lite',
      majorVersion: 21,
      versionString: 'openjdk version "21.0.3"',
      arch: 'amd64',
      path: 'C:\\launcher\\runtime\\java\\managed\\liberica-lite-21-x64\\bin\\java.exe',
      verified: true,
      verifiedAt: new Date().toISOString(),
    },
    {
      id: 'system:demo',
      source: 'system',
      distribution: 'temurin',
      majorVersion: 17,
      versionString: 'openjdk version "17.0.11"',
      arch: 'amd64',
      path: 'C:\\Program Files\\Eclipse Adoptium\\jdk-17\\bin\\java.exe',
      verified: true,
      verifiedAt: new Date().toISOString(),
    },
  ],
  addCustomJavaRuntime: async () => null,
  removeJavaRuntime: async (): Promise<JavaRuntimeInfo[]> => [],
  chooseJavaExecutable: async () => null,
  modrinthSearchMods: async (): Promise<ModrinthSearchHit[]> => [
    {
      projectId: 'demo-project',
      slug: 'example-mod',
      title: 'Example Mod',
      description: 'Modrinthから取得するMODのプレビューです。',
      iconUrl: null,
      downloads: 1250000,
      follows: 1000,
      categories: ['fabric'],
      clientSide: 'required',
      serverSide: 'optional',
      latestVersion: 'demo-version',
    },
  ],
  modrinthGetVersions: async (): Promise<ModrinthVersionInfo[]> => [
    {
      id: 'demo-version',
      projectId: 'demo-project',
      name: 'Example Mod 1.0',
      versionNumber: '1.0.0',
      versionType: 'release',
      gameVersions: ['1.20.1'],
      loaders: ['forge'],
      datePublished: new Date().toISOString(),
    },
  ],
  modrinthDownloadVersion: async () => ({
    fileName: 'example-mod.jar',
    filePath: 'C:\\demo\\mods\\example-mod.jar',
    alreadyPresent: false,
    renamed: false,
    record: {
      projectId: 'demo-project',
      versionId: 'demo-version',
      fileName: 'example-mod.jar',
      title: 'Example Mod',
      sha1: null,
      sha512: null,
      loader: 'forge',
      minecraftVersion: '1.20.1',
      dateInstalled: new Date().toISOString(),
      source: 'modrinth' as const,
    },
    requiredDependencies: [],
    optionalDependencies: [],
    incompatibleDependencies: [],
    embeddedDependencies: [],
  }),
  modrinthListInstalledMods: async (): Promise<InstalledModRecord[]> => [],
  modrinthRemoveInstalledMod: async () => ({
    removed: true,
    mods: [] as InstalledModRecord[],
  }),
  login: async () => {
    if (previewParameters.has('auth-error')) {
      throw new Error(previewAuthError);
    }
    return demoState.auth;
  },
  getDeviceCode: async () => null,
  getAuthFlowState: async (): Promise<AuthFlowState> => ({
    status: 'idle',
    deviceCode: null,
    message: '',
  }),
  cancelLogin: async () => undefined,
  openVerification: async () => undefined,
  logout: async (): Promise<AuthState> => ({
    ...demoState.auth,
    signedIn: false,
    offline: {
      allowed: false,
      reason: 'missing-cache',
      message: 'A completed Microsoft login and ownership check is required.',
      ownershipVerifiedAt: null,
      expiresAt: null,
    },
    profile: null,
  }),
  installVersion: demoAction,
  launchVersion: demoAction,
  launchProfile: demoAction,
  onProgress: () => () => undefined,
  onProcessState: () => () => undefined,
  onDeviceCode: (callback: (payload: Record<string, unknown>) => void) => {
    if (previewParameters.has('auth-code')) {
      window.setTimeout(
        () =>
          callback({
            userCode: 'ABCD-EFGH',
            verificationUri: 'https://microsoft.com/devicelogin',
            expiresIn: 900,
            expiresAt: Date.now() + 900000,
            message: 'プレビュー用コード',
          }),
        300,
      );
    }
    return () => undefined;
  },
  onAuthFlowState: () => () => undefined,
  onLog: () => () => undefined,
};

const byId = <T extends HTMLElement>(id: string) =>
  document.querySelector<T>(`#${id}`);

// Main area
const scanStatus = byId<HTMLElement>('scan-status');
const toast = byId<HTMLElement>('toast');
const openFolderNav = byId<HTMLElement>('open-folder-nav');
const refreshNav = byId<HTMLElement>('refresh-nav');
const settingsNav = byId<HTMLElement>('settings-nav');
const profilesNav = byId<HTMLElement>('profiles-nav');
const accountButton = byId<HTMLElement>('account-button');
const accountAvatar = byId<HTMLElement>('account-avatar');
const accountLabel = byId<HTMLElement>('account-label');

// Login screen (shown before the launcher when signed out / session expired)
const loginScreen = byId<HTMLElement>('login-screen');
const loginScreenBg = byId<HTMLImageElement>('login-screen-bg');
const loginScreenStatus = byId<HTMLElement>('login-screen-status');
const debugClientIdPanel = byId<HTMLElement>('debug-client-id-panel');
const debugClientIdInput = byId<HTMLElement>('debug-client-id-input');
const debugClientIdSave = byId<HTMLElement>('debug-client-id-save');
const debugClientIdStatus = byId<HTMLElement>('debug-client-id-status');
const profileGrid = byId<HTMLElement>('profile-grid');
const profilesSection = byId<HTMLElement>('profiles-section');
const addProfileButton = byId<HTMLElement>('add-profile-button');
const profileCountBadge = byId<HTMLElement>('profile-count-badge');

// Status bar (replaces hero-area progress)
const statusBar = byId<HTMLElement>('launch-status-bar');
const statusProfileName = byId<HTMLElement>('status-profile-name');
const statusStage = byId<HTMLElement>('status-stage');
const statusProgress = byId<HTMLElement>('status-progress');
const statusMessage = byId<HTMLElement>('status-message');
const statusPercent = byId<HTMLElement>('status-percent');

// Settings modal
const settingsModal = byId<HTMLElement>('settings-modal');
const modalClose = byId<HTMLElement>('modal-close');
const profileAvatar = byId<HTMLElement>('profile-avatar');
const profileName = byId<HTMLElement>('profile-name');
const profileStatus = byId<HTMLElement>('profile-status');
const logoutButton = byId<HTMLElement>('logout-button');
const settingsLoginButton = byId<HTMLElement>('settings-login-button');
const minMemoryInput = byId<HTMLElement>('min-memory-input');
const maxMemoryInput = byId<HTMLElement>('max-memory-input');
const languageSelect = byId<HTMLElement>('language-select');
const saveSettingsButton = byId<HTMLElement>('save-settings-button');
const loginButton = byId<HTMLElement>('login-button');
const deviceCodePanel = byId<HTMLElement>('device-code-panel');
const deviceCode = byId<HTMLElement>('device-code');
const deviceCodeUrl = byId<HTMLElement>('device-code-url');
const deviceCodeCopy = byId<HTMLElement>('device-code-copy');
const deviceCodeOpen = byId<HTMLElement>('device-code-open');
const deviceCodeCancel = byId<HTMLElement>('device-code-cancel');
const deviceCodeExpiry = byId<HTMLElement>('device-code-expiry');
const developerLogList = byId<HTMLElement>('developer-log-list');
const developerLogSection = byId<HTMLElement>('developer-log-section');
const developerLogToggle = byId<HTMLElement>('developer-log-toggle');
const refreshLogsButton = byId<HTMLElement>('refresh-logs-button');
const clearLogsButton = byId<HTMLElement>('clear-logs-button');
const openFolderButton = byId<HTMLElement>('open-folder-button');
const changeFolderButton = byId<HTMLElement>('change-folder-button');
const directoryPath = byId<HTMLElement>('directory-path');
const worldCount = byId<HTMLElement>('world-count');
const modCount = byId<HTMLElement>('mod-count');
const screenshotCount = byId<HTMLElement>('screenshot-count');

// Profile editor modal
const profileModal = byId<HTMLElement>('profile-modal');
const profileModalTitle = byId<HTMLElement>('profile-modal-title');
const profileModalClose = byId<HTMLElement>('profile-modal-close');
const profileNameInput = byId<HTMLElement>('profile-name-input');
const profileVersionSelect = byId<HTMLElement>('profile-version-select');
const profileVanillaPanel = byId<HTMLElement>('profile-vanilla-panel');
const profileForgePanel = byId<HTMLElement>('profile-forge-panel');
const profileForgeMinecraftSelect = byId<HTMLElement>('profile-forge-minecraft-select');
const profileForgeVersionSelect = byId<HTMLElement>('profile-forge-version-select');
const profileForgeBuildStatus = byId<HTMLElement>('profile-forge-build-status');
const profileMinMemoryInput = byId<HTMLElement>('profile-min-memory-input');
const profileMaxMemoryInput = byId<HTMLElement>('profile-max-memory-input');
const profileModsSection = byId<HTMLElement>('profile-mods-section');
const profileModSearchDescription = byId<HTMLElement>(
  'profile-mod-search-description',
);
const profileModCount = byId<HTMLElement>('profile-mod-count');
const selectedModList = byId<HTMLElement>('selected-mod-list');
const modSearchInput = byId<HTMLElement>('mod-search-input');
const modSearchButton = byId<HTMLElement>('mod-search-button');
const modSearchResults = byId<HTMLElement>('mod-search-results');
const deleteProfileButton = byId<HTMLElement>('delete-profile-button');
const cancelProfileButton = byId<HTMLElement>('cancel-profile-button');
const saveProfileButton = byId<HTMLElement>('save-profile-button');

// Java runtime management (settings modal)
const javaRuntimeList = byId<HTMLElement>('java-runtime-list');
const javaRefreshButton = byId<HTMLElement>('java-refresh-button');
const javaAddCustomButton = byId<HTMLElement>('java-add-custom-button');
const javaInstallStatus = byId<HTMLElement>('java-install-status');

// Java settings (profile editor)
const profileJavaSelect = byId<HTMLElement>('profile-java-select');
const profileJavaStatus = byId<HTMLElement>('profile-java-status');
const profileJvmArgsInput = byId<HTMLElement>('profile-jvm-args-input');

let currentState: LauncherState | undefined;
let busy = false;
let toastTimer: number | undefined;
let deviceCodeTimer: number | undefined;
let developerLogs: LauncherLogEntry[] = [];
let modLoaderBuilds: ModLoaderBuild[] = [];
let installedMods: InstalledModRecord[] = [];
let javaRuntimes: JavaRuntimeInfo[] = [];
let javaRuntimesLoaded = false;
let pendingCustomJavaPath: string | null = null;
let showSnapshots = false;
let activeProfileLoader: ProfileLoader = 'vanilla';
let editingProfileId = '';
const popularModsCache = new Map<
  string,
  { expiresAt: number; projects: ModrinthSearchHit[] }
>();
const popularModsCacheTtlMs = 60_000;
let modSearchHadQuery = false;
let currentLanguage: SupportedLanguage = resolveLanguage(
  'system',
  navigator.languages,
);

const t = (
  key: TranslationKey,
  parameters?: Record<string, string | number>,
) => translate(currentLanguage, key, parameters);

const applyDocumentTranslations = () => {
  document.documentElement.lang = currentLanguage;
  const translateAttribute = (
    selector: string,
    attribute: string,
    dataAttribute: keyof DOMStringMap,
  ) => {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      const key = element.dataset[dataAttribute] as TranslationKey | undefined;
      if (key) element.setAttribute(attribute, t(key));
    }
  };
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = element.dataset.i18n as TranslationKey | undefined;
    if (key) element.textContent = t(key);
  }
  translateAttribute('[data-i18n-label]', 'label', 'i18nLabel');
  translateAttribute(
    '[data-i18n-placeholder]',
    'placeholder',
    'i18nPlaceholder',
  );
  translateAttribute(
    '[data-i18n-aria-label]',
    'aria-label',
    'i18nAriaLabel',
  );
  translateAttribute('[data-i18n-title]', 'title', 'i18nTitle');
};

const isModLoader = (loader: ProfileLoader): loader is ModLoader =>
  loader !== 'vanilla';

const loaderLabel = (loader: ProfileLoader) =>
  loader === 'neoforge'
    ? 'NeoForge'
    : loader === 'fabric'
      ? 'Fabric'
      : loader === 'forge'
        ? 'Forge'
        : 'Vanilla';

const resolvedVersionIdFor = (
  loader: ProfileLoader,
  minecraftVersion: string,
  loaderVersion: string | null,
) => {
  if (!loaderVersion || loader === 'vanilla') return minecraftVersion;
  if (loader === 'forge') {
    return `${minecraftVersion}-forge-${loaderVersion}`;
  }
  if (loader === 'fabric') {
    return `${minecraftVersion}-fabric${loaderVersion}`;
  }
  return `neoforge-${loaderVersion}`;
};

const renderDeveloperLogs = (entries: LauncherLogEntry[]) => {
  developerLogs = entries.slice(-500);
  if (!developerLogList) return;
  developerLogList.replaceChildren();
  if (developerLogs.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'developer-log-empty';
    empty.textContent = t('logs.empty');
    developerLogList.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of developerLogs.slice().reverse()) {
    const row = document.createElement('article');
    row.className = `developer-log-row ${entry.level}`;
    const time = document.createElement('time');
    time.dateTime = entry.timestamp;
    time.textContent = new Intl.DateTimeFormat(currentLanguage, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(entry.timestamp));
    const stage = document.createElement('span');
    stage.textContent = entry.stage;
    const message = document.createElement('p');
    message.textContent = entry.message;
    row.append(time, stage, message);
    if (entry.detail && Object.keys(entry.detail).length > 0) {
      const detail = document.createElement('pre');
      detail.textContent = JSON.stringify(entry.detail, null, 2);
      row.append(detail);
    }
    fragment.append(row);
  }
  developerLogList.append(fragment);
};

const refreshDeveloperLogs = async () => {
  renderDeveloperLogs(await api.getLogs());
};

const setDeveloperLogsVisible = (visible: boolean) => {
  if (developerLogToggle) {
    (developerLogToggle as MdEl).selected = visible;
  }
  developerLogSection?.toggleAttribute('hidden', !visible);
};

const showToast = (message: string, isError = false) => {
  if (!toast) {
    return;
  }
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3600);
};

const setLoading = (loading: boolean) => {
  refreshNav?.classList.toggle('spinning', loading);
  scanStatus?.classList.toggle('loading', loading);
};

const openSettingsModal = () => {
  settingsModal?.removeAttribute('hidden');
  void api.getAuthFlowState().then(renderAuthFlow);
  if (currentState?.settings.showDeveloperLogs) {
    void refreshDeveloperLogs();
  }
  void loadJavaRuntimes();
};
const closeSettingsModal = () => settingsModal?.setAttribute('hidden', '');
const closeProfileModal = () => profileModal?.setAttribute('hidden', '');

const createSelectOption = (label: string, value: string) => {
  const option = document.createElement('md-select-option');
  option.setAttribute('value', value);
  option.textContent = label;
  return option;
};

const selectedProfile = () =>
  currentState?.profiles.find(
    (profile) => profile.id === currentState?.selectedProfileId,
  );

// A signed-in Microsoft session OR a valid offline cache lets the user reach
// the launcher; otherwise the login screen blocks access. Builds without a
// configured Client ID cannot log in at all, so they bypass the gate (login
// stays optional, matching the documented "auth disabled" build).
const hasLauncherAccess = (auth: AuthState) =>
  auth.signedIn ||
  auth.offline.allowed ||
  (!auth.configured && currentState?.buildConfiguration !== 'debug');

const showLoginScreen = () => {
  loginScreen?.removeAttribute('hidden');
  document.body.classList.add('login-active');
};

const hideLoginScreen = () => {
  loginScreen?.setAttribute('hidden', '');
  document.body.classList.remove('login-active');
};

const syncLoginScreen = (auth: AuthState) => {
  if (hasLauncherAccess(auth)) {
    hideLoginScreen();
  } else {
    showLoginScreen();
  }
};

const renderAuth = (auth: AuthState) => {
  const name = auth.profile?.name ?? t('auth.signedOut');
  const initial = name.slice(0, 1) || '?';
  if (accountAvatar) accountAvatar.textContent = initial;
  if (accountLabel) {
    accountLabel.textContent = auth.signedIn
      ? name
      : t('auth.signIn');
  }
  if (profileAvatar) profileAvatar.textContent = initial;
  if (profileName) profileName.textContent = name;
  if (profileStatus) {
    profileStatus.textContent = auth.signedIn
      ? auth.offline.allowed
        ? `${t('auth.verified')} / ${new Intl.DateTimeFormat(
            currentLanguage,
          ).format(new Date(
            auth.offline.expiresAt ?? '',
          ))}`
        : t('auth.verified')
      : auth.offline.allowed
        ? t('auth.offlineAvailable')
      : auth.configured
        ? t('auth.deviceAvailable')
        : t('auth.notConfigured');
  }
  if (logoutButton) {
    logoutButton.hidden = !auth.signedIn && !auth.offline.allowed;
  }
  // Settings re-login link: only useful for going online from an offline cache.
  if (settingsLoginButton) {
    settingsLoginButton.hidden = !(
      auth.configured &&
      !auth.signedIn &&
      auth.offline.allowed
    );
  }
  if (loginButton) {
    loginButton.hidden = auth.signedIn;
    (loginButton as MdEl).disabled = !auth.configured;
    loginButton.textContent = auth.configured
      ? t('auth.signInAccount')
      : t('auth.configurationMissing');
  }
  if (loginScreenStatus) {
    loginScreenStatus.textContent = auth.configured
      ? t('login.lead')
      : t('auth.configurationHelp');
  }
  syncLoginScreen(auth);
};

const createProfileCard = (profile: LaunchProfile) => {
  const isActive = profile.id === currentState?.selectedProfileId;
  const modded = isModLoader(profile.loaderType);
  const displayLoader = loaderLabel(profile.loaderType);
  const versionInfo = currentState?.availableVersions.find(
    (v) => v.id === profile.minecraftVersion,
  );
  const isInstalled = versionInfo?.installed ?? false;
  const isRunning = currentState?.gameRunning ?? false;
  const canAuth =
    (currentState?.auth.signedIn || currentState?.auth.offline.allowed) ?? false;

  const card = document.createElement('article');
  card.className = `profile-card${isActive ? ' active' : ''}`;
  card.dataset.profileId = profile.id;

  // ── Art area ──
  const art = document.createElement('div');
  art.className = `profile-card-art ${modded ? 'forge' : 'vanilla'}`;
  art.setAttribute('aria-hidden', 'true');
  const artGrid = document.createElement('div');
  artGrid.className = 'profile-art-grid';
  const artIcon = document.createElement('div');
  artIcon.className = 'profile-art-icon';
  artIcon.textContent = displayLoader.slice(0, 1);
  art.append(artGrid, artIcon);

  // ── Body ──
  const body = document.createElement('div');
  body.className = 'profile-card-body';

  const badges = document.createElement('div');
  badges.className = 'profile-badges';
  const loaderBadge = document.createElement('span');
  loaderBadge.className = `badge badge-loader${modded ? ' forge' : ''}`;
  loaderBadge.textContent = displayLoader.toUpperCase();
  badges.append(loaderBadge);
  if (profile.mods.length > 0) {
    const modBadge = document.createElement('span');
    modBadge.className = 'badge badge-mods';
    modBadge.textContent = `${profile.mods.length} MOD`;
    badges.append(modBadge);
  }

  const name = document.createElement('h3');
  name.className = 'profile-card-name';
  name.textContent = profile.name;

  const version = document.createElement('p');
  version.className = 'profile-card-version';
  version.textContent =
    modded
      ? `Minecraft ${profile.minecraftVersion} / ${displayLoader} ${profile.loaderVersion ?? t('status.notSelected')}`
      : `Minecraft ${profile.minecraftVersion}`;

  const memory = document.createElement('p');
  memory.className = 'profile-card-memory';
  memory.textContent = `RAM: ${profile.minMemory}–${profile.maxMemory} MB`;

  const installStatus = document.createElement('div');
  installStatus.className = 'profile-install-status';
  const installDot = document.createElement('span');
  installDot.className = `install-dot${isInstalled ? ' installed' : ''}`;
  const installLabel = document.createElement('span');
  installLabel.textContent = isInstalled
    ? t('profiles.installed')
    : t('profiles.notInstalled');
  installStatus.append(installDot, installLabel);

  body.append(badges, name, version, memory, installStatus);

  // ── Actions ──
  const actions = document.createElement('div');
  actions.className = 'profile-card-actions';

  const playBtn = document.createElement('md-filled-button') as HTMLElement;
  playBtn.dataset.action = 'launch';
  playBtn.setAttribute('type', 'button');

  let playLabel: string;
  let playDisabled = false;

  if (isRunning) {
    playLabel = 'RUNNING';
    playDisabled = true;
  } else if (!canAuth) {
    playLabel = 'LOGIN';
  } else if (!isInstalled) {
    playLabel = currentState?.mojangAvailable ? 'DOWNLOAD' : 'OFFLINE';
    playDisabled = !currentState?.mojangAvailable;
  } else {
    playLabel = '▶ PLAY';
  }

  playBtn.textContent = playLabel;
  if (playDisabled) playBtn.setAttribute('disabled', '');

  const editBtn = document.createElement('md-icon-button') as HTMLElement;
  editBtn.dataset.action = 'edit';
  editBtn.setAttribute('type', 'button');
  editBtn.setAttribute('aria-label', t('common.edit'));
  const editSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  editSvg.setAttribute('viewBox', '0 0 24 24');
  editSvg.setAttribute('width', '20');
  editSvg.setAttribute('height', '20');
  editSvg.setAttribute('fill', 'currentColor');
  editSvg.innerHTML =
    '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>';
  editBtn.append(editSvg);

  const folderBtn = document.createElement('md-icon-button') as HTMLElement;
  folderBtn.dataset.action = 'open-folder';
  folderBtn.setAttribute('type', 'button');
  folderBtn.setAttribute('aria-label', t('profiles.openInstance'));
  const folderSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  folderSvg.setAttribute('viewBox', '0 0 24 24');
  folderSvg.setAttribute('width', '20');
  folderSvg.setAttribute('height', '20');
  folderSvg.setAttribute('fill', 'currentColor');
  folderSvg.innerHTML = '<path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/>';
  folderBtn.append(folderSvg);

  const logsBtn = document.createElement('md-icon-button') as HTMLElement;
  logsBtn.dataset.action = 'open-logs';
  logsBtn.setAttribute('type', 'button');
  logsBtn.setAttribute('aria-label', t('profiles.openLogs'));
  const logsSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  logsSvg.setAttribute('viewBox', '0 0 24 24');
  logsSvg.setAttribute('width', '20');
  logsSvg.setAttribute('height', '20');
  logsSvg.setAttribute('fill', 'currentColor');
  logsSvg.innerHTML = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM8 13h8v2H8v-2zm0-4h5v2H8V9zm0 8h8v2H8v-2z"/>';
  logsBtn.append(logsSvg);

  const latestLogBtn = document.createElement('md-icon-button') as HTMLElement;
  latestLogBtn.dataset.action = 'open-latest-log';
  latestLogBtn.setAttribute('type', 'button');
  latestLogBtn.setAttribute('aria-label', t('profiles.openLatestLog'));
  const latestLogSvg = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'svg',
  );
  latestLogSvg.setAttribute('viewBox', '0 0 24 24');
  latestLogSvg.setAttribute('width', '20');
  latestLogSvg.setAttribute('height', '20');
  latestLogSvg.setAttribute('fill', 'currentColor');
  latestLogSvg.innerHTML =
    '<path d="M4 4h16v16H4V4zm3 4v2h10V8H7zm0 4v2h10v-2H7zm0 4v2h7v-2H7z"/>';
  latestLogBtn.append(latestLogSvg);

  const reproBtn = document.createElement('md-icon-button') as HTMLElement;
  reproBtn.dataset.action = 'copy-repro';
  reproBtn.setAttribute('type', 'button');
  reproBtn.setAttribute(
    'aria-label',
    t('profiles.copyRepro'),
  );
  const reproSvg = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'svg',
  );
  reproSvg.setAttribute('viewBox', '0 0 24 24');
  reproSvg.setAttribute('width', '20');
  reproSvg.setAttribute('height', '20');
  reproSvg.setAttribute('fill', 'currentColor');
  reproSvg.innerHTML =
    '<path d="M4 4h16v16H4V4zm3 4 3 3-3 3 1.4 1.4L12.8 11 8.4 6.6 7 8zm6 7h4v-2h-4v2z"/>';
  reproBtn.append(reproSvg);

  actions.append(
    playBtn,
    editBtn,
    folderBtn,
    logsBtn,
    latestLogBtn,
    reproBtn,
  );
  card.append(art, body, actions);
  return card;
};

const renderProfileGrid = () => {
  if (!profileGrid || !currentState) return;
  profileGrid.replaceChildren(
    ...currentState.profiles.map(createProfileCard),
  );
};

const updateProfileCards = () => {
  if (!profileGrid || !currentState) return;
  renderProfileGrid();
};

const populateVersionSelect = (
  select: HTMLElement | null,
  value: string,
) => {
  if (!select || !currentState) return;
  select.replaceChildren();
  const eligible = filterSelectableVersions(
    currentState.availableVersions,
    showSnapshots,
    value,
  );
  for (const version of [...eligible].sort(compareVersionsByRelease)) {
    const suffix = version.installed ? '  /  INSTALLED' : '';
    const option = createSelectOption(
      `${formatVersionLabel(version)}${suffix}`,
      version.id,
    );
    select.append(option);
  }
  (select as MdEl).disabled = eligible.length === 0;
  if (eligible.some((version) => version.id === value)) {
    (select as MdEl).value = value;
  }
};

const renderState = (state: LauncherState) => {
  currentLanguage = resolveLanguage(state.settings.language, navigator.languages);
  applyDocumentTranslations();
  currentState = state;
  if (directoryPath) {
    directoryPath.textContent = state.gameDirectory;
    directoryPath.title = state.gameDirectory;
  }
  if (worldCount) worldCount.textContent = String(state.worlds);
  if (modCount) modCount.textContent = String(state.mods);
  if (screenshotCount) screenshotCount.textContent = String(state.screenshots);
  if (profileCountBadge) {
    profileCountBadge.textContent = `${state.profiles.length}`;
  }
  if (scanStatus) {
    const label = scanStatus.querySelector('span:last-child');
    if (label) {
      label.textContent = state.mojangAvailable
        ? t('profiles.scanConnected', { count: state.profiles.length })
        : t('profiles.scanFailed');
    }
    scanStatus.classList.toggle('warning', !state.mojangAvailable);
  }
  if (minMemoryInput) {
    (minMemoryInput as MdEl).value = String(state.settings.minMemory);
  }
  if (maxMemoryInput) {
    (maxMemoryInput as MdEl).value = String(state.settings.maxMemory);
  }
  if (languageSelect) {
    (languageSelect as MdEl).value = state.settings.language;
  }
  const showDebugClientId = state.buildConfiguration === 'debug';
  debugClientIdPanel?.toggleAttribute('hidden', !showDebugClientId);
  if (debugClientIdInput && document.activeElement !== debugClientIdInput) {
    (debugClientIdInput as MdEl).value =
      state.settings.microsoftClientId ?? '';
  }
  setDeveloperLogsVisible(state.settings.showDeveloperLogs);
  renderProfileGrid();
  renderAuth(state.auth);
  if (javaRuntimesLoaded) {
    renderJavaRuntimeList();
    updateProfileJavaStatus();
  }
  if (!profileModal?.hidden) {
    renderSelectedMods();
  }
};

const refreshState = async () => {
  setLoading(true);
  try {
    renderState(await api.getState());
  } catch (error) {
    showToast(
      error instanceof Error
        ? error.message
        : t('profiles.loadFailed'),
      true,
    );
  } finally {
    setLoading(false);
  }
};

const updateProfileSaveAvailability = () => {
  if (!saveProfileButton) return;
  const loader = activeProfileLoader;
  const loaderVersion = (profileForgeVersionSelect as MdEl)?.value as
    | string
    | undefined;
  (saveProfileButton as MdEl).disabled =
    isModLoader(loader) && !loaderVersion;
};

const populateForgeMinecraftSelect = (value: string) => {
  if (!profileForgeMinecraftSelect || !currentState) return;
  profileForgeMinecraftSelect.replaceChildren();
  for (const version of [...currentState.availableVersions]
    .filter((candidate) => candidate.type === 'release')
    .sort(compareVersionsByRelease)) {
    const option = createSelectOption(`Minecraft ${version.id}`, version.id);
    profileForgeMinecraftSelect.append(option);
  }
  if (
    currentState.availableVersions.some(
      (version) => version.id === value && version.type === 'release',
    )
  ) {
    (profileForgeMinecraftSelect as MdEl).value = value;
  }
};

const loadModLoaderBuilds = async (
  loader: ModLoader,
  minecraftVersion: string,
  selectedLoaderVersion = '',
) => {
  if (!profileForgeVersionSelect || !profileForgeBuildStatus) return;
  const label = loaderLabel(loader);
  (profileForgeVersionSelect as MdEl).disabled = true;
  profileForgeVersionSelect.replaceChildren();
  profileForgeBuildStatus.textContent = `${label} build一覧を取得しています...`;
  updateProfileSaveAvailability();
  try {
    modLoaderBuilds = await api.getModLoaderBuilds(
      loader,
      minecraftVersion,
    );
    const placeholder = createSelectOption(
      `${label} buildを選択してください`,
      '',
    );
    profileForgeVersionSelect.append(placeholder);
    for (const build of modLoaderBuilds) {
      const option = createSelectOption(
        `Minecraft ${build.minecraftVersion} / ${label} ${build.loaderVersion}${
          build.stable ? '' : ' (preview)'
        }`,
        build.loaderVersion,
      );
      profileForgeVersionSelect.append(option);
    }
    if (
      selectedLoaderVersion &&
      modLoaderBuilds.some(
        (build) => build.loaderVersion === selectedLoaderVersion,
      )
    ) {
      (profileForgeVersionSelect as MdEl).value = selectedLoaderVersion;
    }
    (profileForgeVersionSelect as MdEl).disabled =
      modLoaderBuilds.length === 0;
    const currentVal = (profileForgeVersionSelect as MdEl).value as string;
    profileForgeBuildStatus.textContent =
      modLoaderBuilds.length > 0
        ? selectedLoaderVersion
          ? `${modLoaderBuilds.length} builds / 選択中: ${label} ${currentVal}`
          : `${modLoaderBuilds.length} builds / ${label} buildを選択してください。`
        : `Minecraft ${minecraftVersion} に対応する${label} buildがありません。`;
  } catch (error) {
    modLoaderBuilds = [];
    profileForgeBuildStatus.textContent =
      error instanceof Error
        ? error.message
        : `${label} build一覧を取得できませんでした。`;
    showToast(profileForgeBuildStatus.textContent, true);
  } finally {
    updateProfileSaveAvailability();
  }
};

const setProfileTab = (
  tab: ProfileLoader,
  updateLoader = true,
) => {
  // Drive md-tabs active index
  const tabsEl = document.getElementById('profile-type-tabs');
  if (tabsEl) {
    const allTabEls = [...tabsEl.querySelectorAll('[data-profile-tab]')];
    const idx = allTabEls.findIndex(
      (t) => (t as HTMLElement).dataset.profileTab === tab,
    );
    if (idx >= 0) (tabsEl as MdEl).activeTabIndex = idx;
  }

  if (profileVanillaPanel) profileVanillaPanel.hidden = tab !== 'vanilla';
  if (profileForgePanel) profileForgePanel.hidden = tab === 'vanilla';

  if (updateLoader) {
    activeProfileLoader = tab;
  }
  if (profileModSearchDescription && tab !== 'vanilla') {
    profileModSearchDescription.textContent =
      `${t('mods.description')} ${t('mods.popularHint')}`;
  }
  renderSelectedMods();
  updateProfileSaveAvailability();
};

const renderSelectedMods = () => {
  if (!selectedModList || !profileModCount || !profileModsSection) return;
  const loader = activeProfileLoader;
  const modded = isModLoader(loader);
  profileModsSection.classList.toggle('disabled', !modded);
  profileModCount.textContent = `${installedMods.length} MOD`;
  selectedModList.replaceChildren();

  if (!editingProfileId) {
    const note = document.createElement('p');
    note.className = 'empty-mod-message';
    note.textContent = t('mods.addProfileFirst');
    selectedModList.append(note);
    return;
  }
  if (installedMods.length === 0) {
    const note = document.createElement('p');
    note.className = 'empty-mod-message';
    note.textContent = modded
      ? t('mods.noneInstalled')
      : t('mods.selectLoader');
    selectedModList.append(note);
    return;
  }

  for (const mod of installedMods) {
    const row = document.createElement('div');
    row.className = 'selected-mod-row';
    const icon = document.createElement('span');
    icon.className = 'mod-icon';
    icon.textContent = mod.title.slice(0, 1);
    const name = document.createElement('strong');
    name.textContent = mod.title;
    const remove = document.createElement('md-text-button') as unknown as HTMLButtonElement;
    remove.dataset.projectId = mod.projectId ?? mod.fileName;
    remove.textContent = t('common.delete');
    row.append(icon, name, remove);
    selectedModList.append(row);
  }
};

const loadInstalledMods = async (profileId: string) => {
  try {
    installedMods = await api.modrinthListInstalledMods(profileId);
  } catch (error) {
    installedMods = [];
    showToast(
      error instanceof Error
        ? error.message
        : t('mods.installedLoadFailed'),
      true,
    );
  }
  renderSelectedMods();
};

// --- Java runtime management -------------------------------------------------

const describeJavaRuntime = (runtime: JavaRuntimeInfo) => {
  const distribution =
    javaDistributionLabels[runtime.distribution] ?? runtime.distribution;
  const major =
    runtime.majorVersion !== null ? `Java ${runtime.majorVersion}` : 'Java ?';
  return `${distribution} / ${major}${runtime.arch ? ` / ${runtime.arch}` : ''}`;
};

const javaSourceLabelKeys: Record<
  JavaRuntimeInfo['source'],
  TranslationKey
> = {
  managed: 'java.source.managed',
  custom: 'java.source.custom',
  system: 'java.source.system',
  mojang: 'java.source.mojang',
};

const renderJavaRuntimeList = () => {
  if (!javaRuntimeList) return;
  javaRuntimeList.replaceChildren();
  // Mojang runtimes stay hidden here: they are a compatibility fallback, not
  // a user-facing choice.
  const visible = javaRuntimes.filter((runtime) => runtime.source !== 'mojang');
  if (visible.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'java-runtime-empty';
    empty.textContent =
      t('java.notFound');
    javaRuntimeList.append(empty);
    return;
  }
  for (const runtime of visible) {
    const row = document.createElement('article');
    row.className = `java-runtime-row${runtime.verified ? '' : ' invalid'}`;
    const info = document.createElement('div');
    info.className = 'java-runtime-info';
    const title = document.createElement('strong');
    title.textContent = describeJavaRuntime(runtime);
    const meta = document.createElement('small');
    meta.textContent = `${t(javaSourceLabelKeys[runtime.source])} / ${
      runtime.verified
        ? runtime.versionString ?? t('java.verified')
        : `${t('failure.verification')}: ${runtime.error ?? t('common.unknown')}`
    }`;
    const pathLine = document.createElement('small');
    pathLine.className = 'java-runtime-path';
    pathLine.textContent = runtime.path;
    pathLine.title = runtime.path;
    info.append(title, meta, pathLine);
    row.append(info);
    if (runtime.source === 'managed' || runtime.source === 'custom') {
      const remove = document.createElement('md-text-button') as unknown as HTMLButtonElement;
      remove.dataset.javaRuntimeId = runtime.id;
      remove.textContent = t('common.delete');
      row.append(remove);
    }
    javaRuntimeList.append(row);
  }
};

const loadJavaRuntimes = async (refresh = false) => {
  try {
    javaRuntimes = await api.listJavaRuntimes({ refresh });
    javaRuntimesLoaded = true;
    renderJavaRuntimeList();
  } catch (error) {
    showToast(
      error instanceof Error
        ? error.message
        : t('java.listFailed'),
      true,
    );
  }
};

const setJavaInstallStatus = (message: string) => {
  if (!javaInstallStatus) return;
  javaInstallStatus.hidden = !message;
  javaInstallStatus.textContent = message;
};

const updateProfileJavaStatus = () => {
  if (!profileJavaStatus) return;
  const value = String((profileJavaSelect as MdEl)?.value ?? 'auto');
  if (value === 'custom') {
    profileJavaStatus.hidden = false;
    profileJavaStatus.textContent = pendingCustomJavaPath
      ? `使用するJava: ${pendingCustomJavaPath}`
      : t('java.selectExecutable');
    return;
  }
  if (value.startsWith('fixed:')) {
    const runtime = javaRuntimes.find(
      (candidate) => candidate.id === value.slice('fixed:'.length),
    );
    profileJavaStatus.hidden = !runtime;
    if (runtime) profileJavaStatus.textContent = runtime.path;
    return;
  }
  profileJavaStatus.hidden = false;
  profileJavaStatus.textContent = t('java.autoDescription');
};

const javaSettingsToSelectValue = (java: ProfileJavaSettings) => {
  if (java.mode === 'customPath') return 'custom';
  if (java.mode === 'fixed' && java.runtimeId) return `fixed:${java.runtimeId}`;
  const preferred = java.preferredDistributions[0] ?? 'temurin';
  return preferred === 'temurin' ? 'auto' : `auto:${preferred}`;
};

const populateProfileJavaSelect = (java: ProfileJavaSettings) => {
  if (!profileJavaSelect) return;
  profileJavaSelect.replaceChildren();
  const appendOption = (value: string, label: string) => {
    const option = document.createElement('md-select-option');
    option.setAttribute('value', value);
    option.textContent = label;
    profileJavaSelect.append(option);
    return option;
  };
  appendOption('auto', t('java.autoOption'));
  for (const runtime of javaRuntimes) {
    if (runtime.source === 'mojang' || !runtime.verified) continue;
    appendOption(
      `fixed:${runtime.id}`,
      `${describeJavaRuntime(runtime)} (${t(javaSourceLabelKeys[runtime.source])})`,
    );
  }
  appendOption('custom', t('java.manualOption'));

  const value = javaSettingsToSelectValue(java);
  if (
    value.startsWith('fixed:') &&
    !javaRuntimes.some((runtime) => `fixed:${runtime.id}` === value)
  ) {
    // The fixed runtime disappeared; keep the reference visible so saving
    // without touching the field does not silently change the setting.
    appendOption(value, `不明なJavaランタイム（${java.runtimeId}）`);
  }
  (profileJavaSelect as MdEl).value = value;
  pendingCustomJavaPath = java.customPath;
  if (profileJvmArgsInput) {
    (profileJvmArgsInput as MdEl).value = java.jvmArgs.join(' ');
  }
  updateProfileJavaStatus();
};

const collectProfileJavaSettings = (): ProfileJavaSettings => {
  const defaults = defaultJavaSettings();
  const value = String((profileJavaSelect as MdEl)?.value ?? 'auto');
  const jvmArgs = String((profileJvmArgsInput as MdEl)?.value ?? '')
    .split(/\s+/)
    .map((argument) => argument.trim())
    .filter(Boolean);
  if (value === 'custom') {
    if (!pendingCustomJavaPath) {
      throw new Error(t('java.selectExecutable'));
    }
    return {
      ...defaults,
      mode: 'customPath',
      customPath: pendingCustomJavaPath,
      jvmArgs,
    };
  }
  if (value.startsWith('fixed:')) {
    return {
      ...defaults,
      mode: 'fixed',
      runtimeId: value.slice('fixed:'.length),
      jvmArgs,
    };
  }
  if (value.startsWith('auto:')) {
    const preferred = value.slice('auto:'.length) as JavaDistributionId;
    return {
      ...defaults,
      preferredDistributions: [
        preferred,
        ...defaults.preferredDistributions.filter(
          (candidate) => candidate !== preferred,
        ),
      ],
      jvmArgs,
    };
  }
  return { ...defaults, jvmArgs };
};

const openProfileEditor = (profile?: LaunchProfile) => {
  if (!currentState) return;
  if (profileModalTitle) {
    profileModalTitle.textContent = profile
      ? t('profile.editTitle')
      : t('profile.newTitle');
  }
  editingProfileId = profile?.id ?? '';
  if (profileNameInput) (profileNameInput as MdEl).value = profile?.name ?? '';
  // Sync snapshot toggle UI state before populating the select.
  const snapshotToggle = byId<HTMLElement>('snapshot-toggle');
  if (snapshotToggle) (snapshotToggle as MdEl & { selected?: boolean }).selected = showSnapshots;
  populateVersionSelect(
    profileVersionSelect,
    profile?.minecraftVersion ??
      selectedProfile()?.minecraftVersion ??
      currentState.availableVersions[0]?.id ??
      '',
  );
  const minecraftVersion =
    profile?.minecraftVersion ??
    selectedProfile()?.minecraftVersion ??
    currentState.availableVersions.find(
      (version) => version.type === 'release',
    )?.id ??
    '';
  populateForgeMinecraftSelect(minecraftVersion);
  activeProfileLoader = profile?.loaderType ?? 'vanilla';
  if (profileMinMemoryInput) {
    (profileMinMemoryInput as MdEl).value = String(
      profile?.minMemory ?? currentState.settings.minMemory,
    );
  }
  if (profileMaxMemoryInput) {
    (profileMaxMemoryInput as MdEl).value = String(
      profile?.maxMemory ?? currentState.settings.maxMemory,
    );
  }
  if (deleteProfileButton) deleteProfileButton.hidden = !profile;
  modSearchResults?.replaceChildren();
  if (modSearchInput) (modSearchInput as MdEl).value = '';
  modSearchHadQuery = false;
  modLoaderBuilds = [];
  installedMods = [];
  if (profileForgeVersionSelect) {
    profileForgeVersionSelect.replaceChildren(
      createSelectOption(t('profile.loaderRequired'), ''),
    );
    (profileForgeVersionSelect as MdEl).disabled = true;
  }
  if (profileForgeBuildStatus) {
    profileForgeBuildStatus.textContent = t('profile.loaderRequired');
  }
  const javaSettings = profile?.java ?? defaultJavaSettings();
  populateProfileJavaSelect(javaSettings);
  if (!javaRuntimesLoaded) {
    void loadJavaRuntimes().then(() =>
      populateProfileJavaSelect(javaSettings),
    );
  }
  renderSelectedMods();
  profileModal?.removeAttribute('hidden');
  const initialTab = profile?.loaderType ?? 'vanilla';
  setProfileTab(initialTab, false);
  if (isModLoader(initialTab) && minecraftVersion) {
    void loadModLoaderBuilds(
      initialTab,
      minecraftVersion,
      profile?.loaderVersion ?? '',
    );
    if (profile?.id) {
      void loadInstalledMods(profile.id);
      void loadPopularModsForCurrentInstance(profile.id);
    }
  }
};

const editorProfile = () =>
  currentState?.profiles.find(
    (profile) => profile.id === editingProfileId,
  );

const saveProfileEditor = async (close = true) => {
  if (!saveProfileButton) return undefined;
  (saveProfileButton as MdEl).disabled = true;
  try {
    const loader = activeProfileLoader;
    const minecraftVersion =
      isModLoader(loader)
        ? ((profileForgeMinecraftSelect as MdEl)?.value as string) ?? ''
        : ((profileVersionSelect as MdEl)?.value as string) ?? '';
    const loaderVersion =
      isModLoader(loader)
        ? ((profileForgeVersionSelect as MdEl)?.value as string) ?? ''
        : null;
    if (isModLoader(loader) && !loaderVersion) {
      throw new Error(`${loaderLabel(loader)} buildを選択してください。`);
    }
    // Snapshot warning (non-blocking — toast only).
    if (loader === 'vanilla') {
      const selectedVersion = currentState?.availableVersions.find(
        (v) => v.id === minecraftVersion,
      );
      if (selectedVersion?.type === 'snapshot') {
      showToast(t('profile.snapshotWarning'), false);
      }
    }
    const state = await api.saveProfile({
      id: editingProfileId || undefined,
      name: ((profileNameInput as MdEl)?.value as string) ?? '',
      profileType: loader,
      loaderType: loader,
      minecraftVersion,
      loaderVersion,
      resolvedVersionId:
        resolvedVersionIdFor(loader, minecraftVersion, loaderVersion),
      versionId: minecraftVersion,
      loader,
      minMemory: Number((profileMinMemoryInput as MdEl)?.value ?? 1024),
      maxMemory: Number((profileMaxMemoryInput as MdEl)?.value ?? 4096),
      java: collectProfileJavaSettings(),
    });
    renderState(state);
    editingProfileId = state.selectedProfileId;
    if (close) {
      closeProfileModal();
      showToast(t('profile.saved'));
    } else {
      await loadInstalledMods(state.selectedProfileId);
    }
    return state;
  } catch (error) {
    showToast(
      error instanceof Error
        ? error.message
        : t('settings.saveFailed'),
      true,
    );
    return undefined;
  } finally {
    updateProfileSaveAvailability();
  }
};

const renderModSearchResults = (projects: ModrinthSearchHit[]) => {
  if (!modSearchResults) return;
  modSearchResults.replaceChildren();
  if (projects.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-mod-message';
    empty.textContent = t('mods.noResults');
    modSearchResults.append(empty);
    return;
  }
  const installedIds = new Set(
    installedMods
      .map((mod) => mod.projectId)
      .filter((projectId): projectId is string => Boolean(projectId)),
  );
  for (const project of projects) {
    const item = document.createElement('article');
    item.className = 'mod-result';
    const icon = document.createElement('span');
    icon.className = 'mod-icon large';
    if (project.iconUrl) {
      const image = document.createElement('img');
      image.src = project.iconUrl;
      image.alt = '';
      icon.append(image);
    } else {
      icon.textContent = project.title.slice(0, 1);
    }
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = project.title;
    const description = document.createElement('p');
    description.textContent = project.description;
    const downloads = document.createElement('small');
    downloads.textContent = `${new Intl.NumberFormat(currentLanguage).format(project.downloads)} downloads`;
    copy.append(title, description, downloads);
    const add = document.createElement('md-outlined-button') as unknown as HTMLButtonElement;
    add.dataset.project = JSON.stringify(project);
    const installed = installedIds.has(project.projectId);
    add.disabled = installed;
    add.textContent = installed ? t('profiles.installed') : t('mods.download');
    item.append(icon, copy, add);
    modSearchResults.append(item);
  }
};

const renderModSearchStatus = (message: string, retry = false) => {
  if (!modSearchResults) return;
  modSearchResults.replaceChildren();
  const status = document.createElement('p');
  status.className = 'empty-mod-message';
  status.textContent = message;
  modSearchResults.append(status);
  if (retry) {
    const button = document.createElement(
      'md-outlined-button',
    ) as unknown as HTMLButtonElement;
    button.dataset.action = 'retry-popular';
    button.textContent = t('common.retry');
    modSearchResults.append(button);
  }
};

const loadPopularModsForCurrentInstance = async (
  profileId: string,
  force = false,
) => {
  const profile = currentState?.profiles.find(
    (candidate) => candidate.id === profileId,
  );
  if (!profile || !isModLoader(profile.loaderType)) return;
  const cacheKey =
    `${profile.id}:${profile.loaderType}:${profile.minecraftVersion}`;
  const cached = popularModsCache.get(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) {
    renderModSearchResults(cached.projects);
    return;
  }
  renderModSearchStatus(t('mods.loadingPopular'));
  try {
    const projects = await api.modrinthSearchMods(profile.id, '');
    popularModsCache.set(cacheKey, {
      expiresAt: Date.now() + popularModsCacheTtlMs,
      projects,
    });
    renderModSearchResults(projects);
  } catch {
    renderModSearchStatus(t('mods.popularFailed'), true);
  }
};

const handleProfileLaunch = async (profile: LaunchProfile) => {
  if (!currentState || busy) return;
  if (!currentState.auth.signedIn && !currentState.auth.offline.allowed) {
    openSettingsModal();
    return;
  }
  const version = currentState.availableVersions.find(
    (v) => v.id === profile.minecraftVersion,
  );
  statusBar?.removeAttribute('hidden');
  if (statusProfileName) statusProfileName.textContent = profile.name;
  if (statusStage) statusStage.textContent = t('process.preparing');

  // Disable this card's launch button while running
  const card = profileGrid?.querySelector<HTMLElement>(
    `[data-profile-id="${profile.id}"] [data-action="launch"]`,
  );
  if (card) {
    card.setAttribute('disabled', '');
    card.textContent = t('process.launching');
  }
  busy = true;
  try {
    if (version && !version.installed) {
      const installResult = await api.installVersion(version.id);
      showToast(installResult.message, !installResult.ok);
    }
    const result = await api.launchProfile(profile.id);
    showToast(result.message, !result.ok);
    await refreshState();
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : t('common.operationFailed'),
      true,
    );
  } finally {
    busy = false;
    updateProfileCards();
  }
};

profileGrid?.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-action]',
  );
  const card = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-profile-id]',
  );
  if (!button || !card?.dataset.profileId || !currentState) return;
  const profile = currentState.profiles.find(
    (candidate) => candidate.id === card.dataset.profileId,
  );
  if (!profile) return;
  if (button.dataset.action === 'edit') {
    openProfileEditor(profile);
    return;
  }
  if (button.dataset.action === 'launch') {
    void handleProfileLaunch(profile);
    return;
  }
  if (button.dataset.action === 'open-folder') {
    try {
      const result = await api.openInstanceFolder(profile.id);
      showToast(result.message, !result.ok);
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('common.openFolderFailed'), true);
    }
    return;
  }
  if (button.dataset.action === 'open-logs') {
    try {
      const result = await api.openInstanceLogs(profile.id);
      showToast(result.message, !result.ok);
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('profiles.openLogsFailed'), true);
    }
    return;
  }
  if (button.dataset.action === 'open-latest-log') {
    try {
      const result = await api.openLatestLog(profile.id);
      showToast(result.message, !result.ok);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t('profiles.openLatestLogFailed'),
        true,
      );
    }
    return;
  }
  if (button.dataset.action === 'copy-repro') {
    try {
      const result = await api.copyReproductionScript(profile.id);
      showToast(result.message, !result.ok);
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : t('profiles.copyReproFailed'),
        true,
      );
    }
    return;
  }
});

addProfileButton?.addEventListener('click', () => openProfileEditor());
profilesNav?.addEventListener('click', () => {
  profilesSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
profileModalClose?.addEventListener('click', closeProfileModal);
cancelProfileButton?.addEventListener('click', closeProfileModal);
profileModal?.addEventListener('click', (event) => {
  if (event.target === profileModal) closeProfileModal();
});
saveProfileButton?.addEventListener('click', () => {
  void saveProfileEditor();
});

deleteProfileButton?.addEventListener('click', async () => {
  const id = editingProfileId;
  if (!id) return;
  (deleteProfileButton as MdEl).disabled = true;
  try {
    renderState(await api.deleteProfile(id));
    closeProfileModal();
    showToast(t('profile.deleted'));
  } catch (error) {
    showToast(
      error instanceof Error
        ? error.message
        : t('profile.deleteFailed'),
      true,
    );
  } finally {
    (deleteProfileButton as MdEl).disabled = false;
  }
});

document.getElementById('profile-type-tabs')?.addEventListener('change', () => {
  const tabsEl = document.getElementById('profile-type-tabs');
  const allTabs = [...(tabsEl?.querySelectorAll('[data-profile-tab]') ?? [])];
  const active = allTabs.find((t) => (t as MdEl).active);
  const tab = (active as HTMLElement | undefined)?.dataset.profileTab;
  if (
    tab !== 'vanilla' &&
    tab !== 'forge' &&
    tab !== 'neoforge' &&
    tab !== 'fabric'
  ) {
    return;
  }
  setProfileTab(tab);
  if (
    isModLoader(tab) &&
    (profileForgeMinecraftSelect as MdEl)?.value
  ) {
    void loadModLoaderBuilds(
      tab,
      (profileForgeMinecraftSelect as MdEl).value as string,
      editorProfile()?.loaderType === tab
        ? editorProfile()?.loaderVersion ?? ''
        : '',
    );
    const profile = editorProfile();
    if (profile?.loaderType === tab) {
      void loadPopularModsForCurrentInstance(profile.id);
    }
  }
});

profileForgeMinecraftSelect?.addEventListener('change', () => {
  const val = (profileForgeMinecraftSelect as MdEl).value as string;
  if (!val) return;
  const loader = activeProfileLoader;
  if (isModLoader(loader)) {
    void loadModLoaderBuilds(loader, val);
  }
});

profileForgeVersionSelect?.addEventListener('change', () => {
  const loaderVersion = (profileForgeVersionSelect as MdEl).value as string;
  const mcVal = (profileForgeMinecraftSelect as MdEl)?.value as string;
  const loader = activeProfileLoader;
  if (profileForgeBuildStatus) {
    profileForgeBuildStatus.textContent = loaderVersion
      ? `Minecraft ${mcVal} / ${loaderLabel(loader)} ${loaderVersion}`
      : `${loaderLabel(loader)} buildを選択してください。`;
  }
  updateProfileSaveAvailability();
});

modSearchButton?.addEventListener('click', async () => {
  const loader = activeProfileLoader;
  if (!isModLoader(loader)) {
    showToast(t('mods.selectLoaderFirst'), true);
    return;
  }
  (modSearchButton as MdEl).disabled = true;
  modSearchButton.textContent = t('mods.searching');
  try {
    const state = await saveProfileEditor(false);
    if (!state) return;
    const query = String((modSearchInput as MdEl)?.value ?? '').trim();
    modSearchHadQuery = query.length > 0;
    if (!query) {
      await loadPopularModsForCurrentInstance(state.selectedProfileId, true);
    } else {
      const projects = await api.modrinthSearchMods(
        state.selectedProfileId,
        query,
      );
      renderModSearchResults(projects);
    }
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : t('mods.searchFailed'),
      true,
    );
  } finally {
    (modSearchButton as MdEl).disabled = false;
    modSearchButton.textContent = t('mods.search');
  }
});

modSearchInput?.addEventListener('keydown', (event) => {
  if ((event as KeyboardEvent).key === 'Enter') modSearchButton?.click();
});

modSearchInput?.addEventListener('input', () => {
  const query = String((modSearchInput as MdEl)?.value ?? '').trim();
  if (query) {
    modSearchHadQuery = true;
    return;
  }
  if (modSearchHadQuery && editingProfileId) {
    modSearchHadQuery = false;
    void loadPopularModsForCurrentInstance(editingProfileId);
  }
});

modSearchResults?.addEventListener('click', async (event) => {
  const retry = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-action="retry-popular"]',
  );
  if (retry && editingProfileId) {
    void loadPopularModsForCurrentInstance(editingProfileId, true);
    return;
  }
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-project]',
  );
  const profileId = editingProfileId;
  if (!button?.dataset.project || !profileId) return;
  button.disabled = true;
  try {
    const project = JSON.parse(
      button.dataset.project,
    ) as ModrinthSearchHit;
    const versions = await api.modrinthGetVersions(
      profileId,
      project.projectId,
    );
    const version =
      versions.find((candidate) => candidate.versionType === 'release') ??
      versions[0];
    if (!version) {
      throw new Error(
        t('mods.noCompatibleVersion'),
      );
    }
    const result = await api.modrinthDownloadVersion(profileId, version.id);
    await loadInstalledMods(profileId);
    button.textContent = t('profiles.installed');
    showToast(
      result.alreadyPresent
        ? `${project.title}は既にインストール済みです。`
        : t('mods.downloaded', { name: project.title }),
    );
  } catch (error) {
    button.disabled = false;
    showToast(
      error instanceof Error ? error.message : t('mods.addFailed'),
      true,
    );
  }
});

selectedModList?.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-project-id]',
  );
  const profileId = editingProfileId;
  if (!button?.dataset.projectId || !profileId) return;
  try {
    await api.modrinthRemoveInstalledMod(
      profileId,
      button.dataset.projectId,
    );
    await loadInstalledMods(profileId);
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : t('mods.removeFailed'),
      true,
    );
  }
});

const openFolder = async () => {
  const result = await api.openDirectory();
  showToast(result.message, !result.ok);
};

openFolderButton?.addEventListener('click', openFolder);
openFolderNav?.addEventListener('click', openFolder);
refreshNav?.addEventListener('click', refreshState);
changeFolderButton?.addEventListener('click', async () => {
  try {
    renderState(await api.chooseDirectory());
    showToast(t('settings.directoryUpdated'));
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : t('settings.directoryChangeFailed'),
      true,
    );
  }
});

for (const button of [settingsNav, accountButton]) {
  button?.addEventListener('click', openSettingsModal);
}
modalClose?.addEventListener('click', closeSettingsModal);
settingsModal?.addEventListener('click', (event) => {
  if (event.target === settingsModal) closeSettingsModal();
});

const saveLauncherSettings = async () => {
  const state = await api.saveSettings({
    minMemory: Number((minMemoryInput as MdEl)?.value ?? 1024),
    maxMemory: Number((maxMemoryInput as MdEl)?.value ?? 4096),
    showDeveloperLogs:
      (developerLogToggle as MdEl)?.selected ??
      currentState?.settings.showDeveloperLogs ??
      false,
    language:
      ((languageSelect as MdEl)?.value as LanguagePreference | undefined) ??
      currentState?.settings.language ??
      'system',
  });
  renderState(state);
  return state;
};

saveSettingsButton?.addEventListener('click', async () => {
  (saveSettingsButton as MdEl).disabled = true;
  try {
    await saveLauncherSettings();
    showToast(t('settings.saved'));
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : t('settings.saveFailed'),
      true,
    );
  } finally {
    (saveSettingsButton as MdEl).disabled = false;
  }
});

languageSelect?.addEventListener('change', async () => {
  if (!currentState) return;
  const previous = currentState.settings.language;
  const language = (languageSelect as MdEl).value as LanguagePreference;
  renderState({
    ...currentState,
    settings: { ...currentState.settings, language },
  });
  try {
    renderState(await api.saveSettings({ language }));
    showToast(t('settings.saved'));
  } catch (error) {
    renderState({
      ...currentState,
      settings: { ...currentState.settings, language: previous },
    });
    showToast(
      error instanceof Error ? error.message : t('settings.saveFailed'),
      true,
    );
  }
});

const clearDeviceCodeTimer = () => {
  window.clearInterval(deviceCodeTimer);
  deviceCodeTimer = undefined;
};

const startDeviceCodeTimer = (expiresAt: number) => {
  clearDeviceCodeTimer();
  const update = () => {
    const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    const minutes = Math.floor(remaining / 60);
    const seconds = String(remaining % 60).padStart(2, '0');
    if (deviceCodeExpiry) {
      deviceCodeExpiry.textContent =
        remaining > 0
          ? t('auth.codeExpires', { time: `${minutes}:${seconds}` })
          : t('auth.codeExpired');
    }
    if (remaining <= 0) {
      clearDeviceCodeTimer();
    }
  };
  update();
  deviceCodeTimer = window.setInterval(update, 1000);
};

const renderAuthFlow = (flow: AuthFlowState) => {
  if (flow.status === 'idle') return;
  deviceCodePanel?.removeAttribute('hidden');

  if (flow.status === 'requesting-code') {
    deviceCodePanel?.classList.remove('error');
    if (deviceCode) deviceCode.textContent = t('auth.requestingCode');
    if (deviceCodeUrl) deviceCodeUrl.textContent = flow.message;
    if (deviceCodeCopy) deviceCodeCopy.hidden = true;
    if (deviceCodeOpen) deviceCodeOpen.hidden = true;
    if (deviceCodeCancel) deviceCodeCancel.hidden = false;
    if (deviceCodeExpiry) deviceCodeExpiry.textContent = '';
    return;
  }

  if (flow.status === 'waiting-for-user' && flow.deviceCode) {
    showDeviceCode(flow.deviceCode);
    return;
  }

  if (flow.status === 'exchanging') {
    deviceCodePanel?.classList.remove('error');
    if (deviceCodeUrl) deviceCodeUrl.textContent = flow.message;
    if (deviceCodeCancel) deviceCodeCancel.hidden = true;
    return;
  }

  if (flow.status === 'success') {
    clearDeviceCodeTimer();
    if (deviceCode) deviceCode.textContent = t('auth.complete');
    if (deviceCodeUrl) deviceCodeUrl.textContent = flow.message;
    if (deviceCodeCopy) deviceCodeCopy.hidden = true;
    if (deviceCodeOpen) deviceCodeOpen.hidden = true;
    if (deviceCodeCancel) deviceCodeCancel.hidden = true;
    return;
  }

  if (flow.status === 'cancelled' || flow.status === 'error') {
    clearDeviceCodeTimer();
    deviceCodePanel?.classList.add('error');
    if (deviceCode) {
      deviceCode.textContent =
        flow.status === 'cancelled'
          ? t('auth.cancelled')
          : t('failure.authentication');
    }
    if (deviceCodeUrl) deviceCodeUrl.textContent = flow.message;
    if (deviceCodeCopy) deviceCodeCopy.hidden = true;
    if (deviceCodeOpen) deviceCodeOpen.hidden = true;
    if (deviceCodeCancel) deviceCodeCancel.hidden = true;
  }
};

const setDebugClientIdStatus = (message: string, isError = false) => {
  if (!debugClientIdStatus) return;
  debugClientIdStatus.textContent = message;
  debugClientIdStatus.classList.toggle('error', isError);
};

const saveDebugClientId = async () => {
  if (
    !currentState ||
    currentState.buildConfiguration !== 'debug' ||
    !debugClientIdSave
  ) {
    return;
  }
  const clientId = String((debugClientIdInput as MdEl)?.value ?? '').trim();
  if (!isMicrosoftClientId(clientId)) {
    setDebugClientIdStatus(t('login.clientIdInvalid'), true);
    return;
  }
  (debugClientIdSave as MdEl).disabled = true;
  setDebugClientIdStatus('');
  try {
    renderState(await api.configureMicrosoftClientId(clientId));
    setDebugClientIdStatus(t('login.clientIdSaved'));
  } catch (error) {
    setDebugClientIdStatus(
      error instanceof Error ? error.message : t('settings.saveFailed'),
      true,
    );
  } finally {
    (debugClientIdSave as MdEl).disabled = false;
  }
};

debugClientIdSave?.addEventListener('click', () => {
  void saveDebugClientId();
});

debugClientIdInput?.addEventListener('keydown', (event) => {
  if ((event as KeyboardEvent).key === 'Enter') {
    void saveDebugClientId();
  }
});

loginButton?.addEventListener('click', async () => {
  if (!currentState?.auth.configured) {
    showToast(t('auth.notConfigured'), true);
    return;
  }
  (loginButton as MdEl).disabled = true;
  loginButton.textContent = t('auth.waiting');
  renderAuthFlow({
    status: 'requesting-code',
    deviceCode: null,
    message: t('auth.connecting'),
  });
  try {
    const loginPromise = api.login();
    window.setTimeout(() => {
      void api.getDeviceCode().then((payload) => {
        if (payload) showDeviceCode(payload);
      });
    }, 600);
    const auth = await loginPromise;
    if (currentState) {
      renderState(
        await api.saveSettings({
          minMemory: currentState.settings.minMemory,
          maxMemory: currentState.settings.maxMemory,
        }),
      );
    } else {
      renderAuth(auth);
    }
    showToast(
      t('auth.loginSuccess', {
        name: auth.profile?.name ?? 'Minecraft account',
      }),
    );
    closeSettingsModal();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : t('auth.loginFailed');
    const flow = await api.getAuthFlowState();
    renderAuthFlow(
      flow.status === 'idle' || flow.status === 'requesting-code'
        ? {
            status: 'error',
            deviceCode: null,
            message,
          }
        : flow,
    );
    showToast(message, true);
  } finally {
    if (currentState) renderAuth(currentState.auth);
  }
});

// From the settings panel (offline mode), jump back to the login screen.
settingsLoginButton?.addEventListener('click', () => {
  closeSettingsModal();
  showLoginScreen();
});

logoutButton?.addEventListener('click', async () => {
  try {
    const auth = await api.logout();
    renderAuth(auth);
    if (currentState) currentState.auth = auth;
    updateProfileCards();
    showToast(t('auth.loggedOut'));
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : t('auth.logoutFailed'),
      true,
    );
  }
});

const showDeviceCode = (payload: Record<string, unknown>) => {
  const code = typeof payload.userCode === 'string' ? payload.userCode : '';
  const url =
    typeof payload.verificationUri === 'string'
      ? payload.verificationUri
      : 'https://microsoft.com/devicelogin';
  if (!code) return;
  const expiresIn =
    typeof payload.expiresIn === 'number' ? payload.expiresIn : 900;
  const expiresAt =
    typeof payload.expiresAt === 'number'
      ? payload.expiresAt
      : Date.now() + expiresIn * 1000;
  if (deviceCode) deviceCode.textContent = code;
  if (deviceCodeUrl) deviceCodeUrl.textContent = url;
  if (deviceCodeCopy) deviceCodeCopy.hidden = false;
  if (deviceCodeOpen) deviceCodeOpen.hidden = false;
  if (deviceCodeCancel) deviceCodeCancel.hidden = false;
  startDeviceCodeTimer(expiresAt);
  deviceCodePanel?.classList.remove('error');
  deviceCodePanel?.removeAttribute('hidden');
};

deviceCodeCopy?.addEventListener('click', async () => {
  const code = deviceCode?.textContent?.trim();
  if (!code || code === t('auth.requestingCode')) return;
  try {
    await navigator.clipboard.writeText(code);
    showToast(t('auth.codeCopied'));
  } catch {
    showToast(t('auth.copyCodeFailed'), true);
  }
});

deviceCodeOpen?.addEventListener('click', async () => {
  try {
    await api.openVerification();
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : t('auth.openPageFailed'),
      true,
    );
  }
});

deviceCodeCancel?.addEventListener('click', async () => {
  await api.cancelLogin();
  renderAuthFlow({
    status: 'cancelled',
    deviceCode: null,
    message: t('auth.cancelledToast'),
  });
});

// --- Snapshot toggle -----------------------------------------------------------

document.getElementById('snapshot-toggle')?.addEventListener('change', (event) => {
  showSnapshots = (event.target as MdEl & { selected?: boolean }).selected ?? false;
  populateVersionSelect(
    profileVersionSelect,
    (profileVersionSelect as MdEl)?.value as string ?? '',
  );
});

// --- Java runtime management events -------------------------------------------

javaRefreshButton?.addEventListener('click', () => {
  setJavaInstallStatus(t('java.refreshing'));
  void loadJavaRuntimes(true).then(() => setJavaInstallStatus(''));
});

javaAddCustomButton?.addEventListener('click', async () => {
  try {
    const runtimes = await api.addCustomJavaRuntime();
    if (!runtimes) return;
    javaRuntimes = runtimes;
    javaRuntimesLoaded = true;
    renderJavaRuntimeList();
    showToast(t('java.added'));
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : t('java.addFailed'),
      true,
    );
  }
});

javaRuntimeList?.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-java-runtime-id]',
  );
  if (!button?.dataset.javaRuntimeId) return;
  button.disabled = true;
  try {
    javaRuntimes = await api.removeJavaRuntime(button.dataset.javaRuntimeId);
    javaRuntimesLoaded = true;
    renderJavaRuntimeList();
    showToast(t('java.removed'));
  } catch (error) {
    button.disabled = false;
    showToast(
      error instanceof Error ? error.message : t('java.removeFailed'),
      true,
    );
  }
});

profileJavaSelect?.addEventListener('change', async () => {
  const value = String((profileJavaSelect as MdEl)?.value ?? 'auto');
  if (value === 'custom' && !pendingCustomJavaPath) {
    try {
      const chosen = await api.chooseJavaExecutable();
      if (chosen) {
        pendingCustomJavaPath = chosen;
      } else {
        (profileJavaSelect as MdEl).value = 'auto';
      }
    } catch (error) {
      (profileJavaSelect as MdEl).value = 'auto';
      showToast(
        error instanceof Error
          ? error.message
          : t('java.selectFailed'),
        true,
      );
    }
  }
  updateProfileJavaStatus();
});

api.onDeviceCode((payload) => {
  showDeviceCode(payload);
});

api.onAuthFlowState((payload) => {
  renderAuthFlow(payload as unknown as AuthFlowState);
});

refreshLogsButton?.addEventListener('click', () => {
  void refreshDeveloperLogs();
});

clearLogsButton?.addEventListener('click', async () => {
  renderDeveloperLogs(await api.clearLogs());
});

developerLogToggle?.addEventListener('change', async () => {
  const visible = (developerLogToggle as MdEl).selected;
  setDeveloperLogsVisible(visible);
  try {
    renderState(await api.saveSettings({ showDeveloperLogs: visible }));
    if (visible) {
      await refreshDeveloperLogs();
    }
  } catch (error) {
    setDeveloperLogsVisible(
      currentState?.settings.showDeveloperLogs ?? false,
    );
    showToast(
      error instanceof Error
        ? error.message
        : t('settings.developerLogSaveFailed'),
      true,
    );
  }
});

api.onLog((payload) => {
  const entry = payload as unknown as LauncherLogEntry;
  if (
    typeof entry.id !== 'number' ||
    typeof entry.timestamp !== 'string' ||
    typeof entry.level !== 'string' ||
    typeof entry.stage !== 'string' ||
    typeof entry.message !== 'string'
  ) {
    return;
  }
  renderDeveloperLogs([...developerLogs, entry]);
});

api.onProgress((payload) => {
  statusBar?.removeAttribute('hidden');
  const percent = typeof payload.percent === 'number' ? payload.percent : 0;
  const message =
    typeof payload.message === 'string' ? payload.message : t('process.working');
  const displayMessage = formatCategorizedMessage(message, payload.category);
  const file = typeof payload.file === 'string' ? payload.file : '';
  const stage = typeof payload.phase === 'string' ? payload.phase : '';
  if (statusProgress) (statusProgress as MdEl).value = percent / 100;
  if (statusPercent) statusPercent.textContent = `${percent}%`;
  if (statusStage) statusStage.textContent = stage;
  if (statusMessage) {
    statusMessage.textContent = file
      ? `${displayMessage} / ${file}`
      : displayMessage;
  }
  if (payload.phase === 'error') {
    showToast(displayMessage, true);
  }
  if (payload.phase === 'complete') {
    window.setTimeout(() => statusBar?.setAttribute('hidden', ''), 3000);
  }
});

api.onProcessState((payload) => {
  const running = payload.running === true;
  const message =
    typeof payload.message === 'string' ? payload.message : '';
  if (currentState) currentState.gameRunning = running;
  updateProfileCards();
  if (!running) statusBar?.setAttribute('hidden', '');
  const isCrash =
    !running &&
    (payload.category === 'crash' ||
      payload.category === 'spawn' ||
      (typeof payload.code === 'number' && payload.code !== 0));
  const isWindowUnverified =
    !running && payload.category === 'window-unverified';
  if (isCrash || isWindowUnverified) {
    // Refresh logs so the Java stderr is immediately visible in the settings panel.
    void refreshDeveloperLogs();
  }
  if (message) {
    showToast(
      isCrash
        ? `${formatCategorizedMessage(message, payload.category)} - ${t('process.checkLogs')}`
        : isWindowUnverified
          ? `${formatCategorizedMessage(message, payload.category)} - ${t('process.checkInstanceLogs')}`
        : formatCategorizedMessage(message, payload.category),
      isCrash,
    );
  }
});

// No background image bundled by default: if the user has not dropped one at
// public/login-background.jpg, hide the <img> so the CSS gradient shows.
if (loginScreenBg) {
  loginScreenBg.addEventListener('error', () => {
    loginScreenBg.style.display = 'none';
  });
  if (loginScreenBg.complete && loginScreenBg.naturalWidth === 0) {
    loginScreenBg.style.display = 'none';
  }
}

void refreshState();
