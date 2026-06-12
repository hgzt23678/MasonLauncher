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

// Minimal interface for accessing md-* Web Component properties not on HTMLElement
interface MdEl extends HTMLElement {
  value: string | number;
  disabled: boolean;
  active: boolean;
  activeTabIndex: number;
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
  preferredDistributions: ['liberica-lite', 'liberica', 'zulu', 'temurin'],
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
  profileType: 'vanilla' | 'forge';
  loaderType: 'vanilla' | 'forge';
  minecraftVersion: string;
  loaderVersion: string | null;
  resolvedVersionId: string;
  versionId: string;
  loader: 'vanilla' | 'forge';
  minMemory: number;
  maxMemory: number;
  mods: ProfileMod[];
  java: ProfileJavaSettings;
  instanceDir: string;
};

type ForgeBuild = {
  minecraftVersion: string;
  loaderVersion: string;
  artifactVersion: string;
  resolvedVersionId: string;
  installerUrl: string;
};

type ModrinthProject = ProfileMod & {
  description: string;
  downloads: number;
};

type LauncherState = {
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

const failureLabels: Record<string, string> = {
  authentication: '認証失敗',
  ownership: '所有権確認失敗',
  manifest: 'manifest取得失敗',
  download: 'ダウンロード失敗',
  network: 'ネットワーク失敗',
  verification: 'ファイル検証失敗',
  json: 'メタデータ解析失敗',
  java: 'Java未検出',
  arguments: '起動引数生成失敗',
  spawn: 'プロセス起動失敗',
  crash: 'Minecraftクラッシュ',
  'forge-installer': 'Forge installer取得失敗',
  'forge-profile': 'Forge install_profile解析失敗',
  'forge-version-json': 'Forge version JSON抽出失敗',
  'forge-library': 'Forge library取得失敗',
  'forge-processor': 'Forge processor失敗',
  'offline-auth': 'オフライン起動認可失敗',
  'offline-files': 'ローカルファイル不足',
};

const formatCategorizedMessage = (
  message: string,
  category: unknown,
) => {
  const label =
    typeof category === 'string' ? failureLabels[category] : undefined;
  return label ? `[${label}] ${message}` : message;
};

const demoState: LauncherState = {
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
      instanceDir: 'C:\\Users\\Player\\AppData\\Roaming\\.minecraft\\simple-craft\\profiles\\default-profile',
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
      instanceDir: 'C:\\Users\\Player\\AppData\\Roaming\\.minecraft\\simple-craft\\profiles\\forge-profile',
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
  saveSettings: async (settings: Record<string, unknown>) => {
    if (typeof settings.minMemory === 'number') {
      demoState.settings.minMemory = settings.minMemory;
    }
    if (typeof settings.maxMemory === 'number') {
      demoState.settings.maxMemory = settings.maxMemory;
    }
    return demoState;
  },
  saveProfile: async () => demoState,
  getForgeBuilds: async (minecraftVersion: string): Promise<ForgeBuild[]> => [
    {
      minecraftVersion,
      loaderVersion: '47.4.0',
      artifactVersion: `${minecraftVersion}-47.4.0`,
      resolvedVersionId: `${minecraftVersion}-forge-47.4.0`,
      installerUrl:
        `https://maven.minecraftforge.net/net/minecraftforge/forge/` +
        `${minecraftVersion}-47.4.0/forge-${minecraftVersion}-47.4.0-installer.jar`,
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
  installJavaRuntime: async (): Promise<JavaRuntimeInfo> => ({
    id: 'managed:demo',
    source: 'managed',
    distribution: 'liberica-lite',
    majorVersion: 21,
    versionString: 'openjdk version "21.0.3"',
    arch: 'amd64',
    path: 'C:\\demo\\java.exe',
    verified: true,
    verifiedAt: new Date().toISOString(),
  }),
  chooseJavaExecutable: async () => null,
  onJavaInstallProgress: () => () => undefined,
  searchModrinth: async (): Promise<ModrinthProject[]> => [
    {
      projectId: 'demo-project',
      slug: 'example-mod',
      title: 'Example Mod',
      description: 'Modrinthから取得するMODのプレビューです。',
      iconUrl: null,
      downloads: 1250000,
    },
  ],
  addMod: async () => demoState,
  removeMod: async () => demoState,
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
const openFolderNav = byId<HTMLButtonElement>('open-folder-nav');
const refreshNav = byId<HTMLButtonElement>('refresh-nav');
const settingsNav = byId<HTMLButtonElement>('settings-nav');
const profilesNav = byId<HTMLButtonElement>('profiles-nav');
const accountButton = byId<HTMLButtonElement>('account-button');
const accountAvatar = byId<HTMLElement>('account-avatar');
const accountLabel = byId<HTMLElement>('account-label');
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
const minMemoryInput = byId<HTMLElement>('min-memory-input');
const maxMemoryInput = byId<HTMLElement>('max-memory-input');
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
const profileIdInput = byId<HTMLInputElement>('profile-id-input');
const profileNameInput = byId<HTMLElement>('profile-name-input');
const profileVersionSelect = byId<HTMLElement>('profile-version-select');
const profileLoaderSelect = byId<HTMLSelectElement>('profile-loader-select');
const profileVanillaPanel = byId<HTMLElement>('profile-vanilla-panel');
const profileForgePanel = byId<HTMLElement>('profile-forge-panel');
const profileForgeMinecraftSelect = byId<HTMLElement>('profile-forge-minecraft-select');
const profileForgeVersionSelect = byId<HTMLElement>('profile-forge-version-select');
const profileForgeBuildStatus = byId<HTMLElement>('profile-forge-build-status');
const profileMinMemoryInput = byId<HTMLElement>('profile-min-memory-input');
const profileMaxMemoryInput = byId<HTMLElement>('profile-max-memory-input');
const profileModsSection = byId<HTMLElement>('profile-mods-section');
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
const javaInstallDistribution = byId<HTMLElement>('java-install-distribution');
const javaInstallMajor = byId<HTMLElement>('java-install-major');
const javaInstallButton = byId<HTMLElement>('java-install-button');
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
let forgeBuilds: ForgeBuild[] = [];
let javaRuntimes: JavaRuntimeInfo[] = [];
let javaRuntimesLoaded = false;
let pendingCustomJavaPath: string | null = null;
let showSnapshots = false;
let profileEditorMode: 'create' | 'edit' = 'create';

const renderDeveloperLogs = (entries: LauncherLogEntry[]) => {
  developerLogs = entries.slice(-500);
  if (!developerLogList) return;
  developerLogList.replaceChildren();
  if (developerLogs.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'developer-log-empty';
    empty.textContent = 'ログはまだありません。';
    developerLogList.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of developerLogs.slice().reverse()) {
    const row = document.createElement('article');
    row.className = `developer-log-row ${entry.level}`;
    const time = document.createElement('time');
    time.dateTime = entry.timestamp;
    time.textContent = new Date(entry.timestamp).toLocaleTimeString('ja-JP');
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
  void refreshDeveloperLogs();
  void loadJavaRuntimes();
};
const closeSettingsModal = () => settingsModal?.setAttribute('hidden', '');
const closeProfileModal = () => profileModal?.setAttribute('hidden', '');

const formatVersionLabel = (version: MinecraftVersion) => {
  if (version.type === 'snapshot') {
    return `${version.id}  /  SNAPSHOT`;
  }
  if (version.type !== 'release') {
    return `${version.id}  /  CUSTOM`;
  }
  return `${version.id}  /  RELEASE`;
};

const compareVersionsByRelease = (
  left: MinecraftVersion,
  right: MinecraftVersion,
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

const selectedProfile = () =>
  currentState?.profiles.find(
    (profile) => profile.id === currentState?.selectedProfileId,
  );

const renderAuth = (auth: AuthState) => {
  const name = auth.profile?.name ?? '未ログイン';
  const initial = name.slice(0, 1) || '?';
  if (accountAvatar) accountAvatar.textContent = initial;
  if (accountLabel) {
    accountLabel.textContent = auth.signedIn
      ? name
      : 'Microsoftでログイン';
  }
  if (profileAvatar) profileAvatar.textContent = initial;
  if (profileName) profileName.textContent = name;
  if (profileStatus) {
    profileStatus.textContent = auth.signedIn
      ? auth.offline.allowed
        ? `Minecraft: Java Edition 認証済み / キャッシュ期限 ${new Date(
            auth.offline.expiresAt ?? '',
          ).toLocaleDateString('ja-JP')}`
        : 'Minecraft: Java Edition 認証済み'
      : auth.offline.allowed
        ? '認証済みオフライン起動が利用できます。シングルプレイ向けです。'
      : auth.configured
        ? 'Microsoftデバイスコードでログインできます'
        : 'このビルドにはMicrosoft認証設定がありません';
  }
  if (logoutButton) {
    logoutButton.hidden = !auth.signedIn && !auth.offline.allowed;
  }
  if (loginButton) {
    loginButton.hidden = auth.signedIn;
    (loginButton as MdEl).disabled = !auth.configured;
    loginButton.textContent = auth.configured
      ? 'Microsoftアカウントでログイン'
      : 'Microsoft認証が未設定です';
  }
};

const createProfileCard = (profile: LaunchProfile) => {
  const isActive = profile.id === currentState?.selectedProfileId;
  const isForge = profile.loaderType === 'forge';
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
  art.className = `profile-card-art ${isForge ? 'forge' : 'vanilla'}`;
  art.setAttribute('aria-hidden', 'true');
  const artGrid = document.createElement('div');
  artGrid.className = 'profile-art-grid';
  const artIcon = document.createElement('div');
  artIcon.className = 'profile-art-icon';
  artIcon.textContent = isForge ? 'F' : 'V';
  art.append(artGrid, artIcon);

  // ── Body ──
  const body = document.createElement('div');
  body.className = 'profile-card-body';

  const badges = document.createElement('div');
  badges.className = 'profile-badges';
  const loaderBadge = document.createElement('span');
  loaderBadge.className = `badge badge-loader${isForge ? ' forge' : ''}`;
  loaderBadge.textContent = isForge ? 'FORGE' : 'VANILLA';
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
    isForge
      ? `Minecraft ${profile.minecraftVersion} / Forge ${profile.loaderVersion ?? '未選択'}`
      : `Minecraft ${profile.minecraftVersion}`;

  const memory = document.createElement('p');
  memory.className = 'profile-card-memory';
  memory.textContent = `RAM: ${profile.minMemory}–${profile.maxMemory} MB`;

  const installStatus = document.createElement('div');
  installStatus.className = 'profile-install-status';
  const installDot = document.createElement('span');
  installDot.className = `install-dot${isInstalled ? ' installed' : ''}`;
  const installLabel = document.createElement('span');
  installLabel.textContent = isInstalled ? 'インストール済み' : '未インストール';
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
  editBtn.setAttribute('aria-label', '編集');
  const editSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  editSvg.setAttribute('viewBox', '0 0 24 24');
  editSvg.setAttribute('width', '20');
  editSvg.setAttribute('height', '20');
  editSvg.setAttribute('fill', 'currentColor');
  editSvg.innerHTML =
    '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>';
  editBtn.append(editSvg);

  actions.append(playBtn, editBtn);
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
  // Snapshots are hidden by default; old_beta/old_alpha are never shown.
  const eligible = currentState.availableVersions.filter((v) => {
    if (v.type === 'old_beta' || v.type === 'old_alpha') return false;
    if (v.type === 'snapshot') return showSnapshots;
    return true;
  });
  for (const version of [...eligible].sort(compareVersionsByRelease)) {
    const suffix = version.installed ? '  /  INSTALLED' : '';
    const option = document.createElement('md-select-option');
    option.setAttribute('value', version.id);
    option.textContent = `${formatVersionLabel(version)}${suffix}`;
    select.append(option);
  }
  (select as MdEl).disabled = eligible.length === 0;
  // Keep previously selected value even if it's a snapshot that's now hidden.
  if (currentState.availableVersions.some((v) => v.id === value)) {
    (select as MdEl).value = value;
  }
};

const renderState = (state: LauncherState) => {
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
        ? `${state.profiles.length} プロファイル / Mojang 接続済み`
        : 'Mojang に接続できません';
    }
    scanStatus.classList.toggle('warning', !state.mojangAvailable);
  }
  if (minMemoryInput) {
    (minMemoryInput as MdEl).value = String(state.settings.minMemory);
  }
  if (maxMemoryInput) {
    (maxMemoryInput as MdEl).value = String(state.settings.maxMemory);
  }
  renderProfileGrid();
  renderAuth(state.auth);
};

const refreshState = async () => {
  setLoading(true);
  try {
    renderState(await api.getState());
  } catch (error) {
    showToast(
      error instanceof Error
        ? error.message
        : 'ランチャー情報の読み込みに失敗しました。',
      true,
    );
  } finally {
    setLoading(false);
  }
};

const updateProfileSaveAvailability = () => {
  if (!saveProfileButton) return;
  const forgeSelected = profileLoaderSelect?.value === 'forge';
  const forgeVersionVal = (profileForgeVersionSelect as MdEl)?.value as string | undefined;
  (saveProfileButton as MdEl).disabled = forgeSelected && !forgeVersionVal;
};

const populateForgeMinecraftSelect = (value: string) => {
  if (!profileForgeMinecraftSelect || !currentState) return;
  profileForgeMinecraftSelect.replaceChildren();
  for (const version of [...currentState.availableVersions]
    .filter((candidate) => candidate.type === 'release')
    .sort(compareVersionsByRelease)) {
    const option = document.createElement('md-select-option');
    option.setAttribute('value', version.id);
    option.textContent = `Minecraft ${version.id}`;
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

const loadForgeBuilds = async (
  minecraftVersion: string,
  selectedLoaderVersion = '',
) => {
  if (!profileForgeVersionSelect || !profileForgeBuildStatus) return;
  (profileForgeVersionSelect as MdEl).disabled = true;
  profileForgeVersionSelect.replaceChildren();
  profileForgeBuildStatus.textContent = 'Forge build一覧を取得しています...';
  updateProfileSaveAvailability();
  try {
    forgeBuilds = await api.getForgeBuilds(minecraftVersion);
    const placeholder = document.createElement('md-select-option');
    placeholder.setAttribute('value', '');
    placeholder.textContent = 'Forge buildを選択してください';
    profileForgeVersionSelect.append(placeholder);
    for (const build of forgeBuilds) {
      const option = document.createElement('md-select-option');
      option.setAttribute('value', build.loaderVersion);
      option.textContent = `Minecraft ${build.minecraftVersion} / Forge ${build.loaderVersion}`;
      profileForgeVersionSelect.append(option);
    }
    if (
      selectedLoaderVersion &&
      forgeBuilds.some((build) => build.loaderVersion === selectedLoaderVersion)
    ) {
      (profileForgeVersionSelect as MdEl).value = selectedLoaderVersion;
    }
    (profileForgeVersionSelect as MdEl).disabled = forgeBuilds.length === 0;
    const currentVal = (profileForgeVersionSelect as MdEl).value as string;
    profileForgeBuildStatus.textContent =
      forgeBuilds.length > 0
        ? selectedLoaderVersion
          ? `${forgeBuilds.length} builds / 選択中: Forge ${currentVal}`
          : `${forgeBuilds.length} builds / Forge buildを選択してください。`
        : `Minecraft ${minecraftVersion} に対応するForge buildがありません。`;
  } catch (error) {
    forgeBuilds = [];
    profileForgeBuildStatus.textContent =
      error instanceof Error
        ? error.message
        : 'Forge build一覧を取得できませんでした。';
    showToast(profileForgeBuildStatus.textContent, true);
  } finally {
    updateProfileSaveAvailability();
  }
};

const setProfileTab = (
  tab: 'vanilla' | 'forge' | 'modrinth',
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
  if (profileForgePanel) profileForgePanel.hidden = tab !== 'forge';
  if (profileModsSection) profileModsSection.hidden = tab !== 'modrinth';

  if (updateLoader && profileLoaderSelect) {
    if (tab === 'vanilla') profileLoaderSelect.value = 'vanilla';
    if (tab === 'forge') profileLoaderSelect.value = 'forge';
  }
  renderSelectedMods(editorProfile());
  updateProfileSaveAvailability();
};

const renderSelectedMods = (profile: LaunchProfile | undefined) => {
  if (!selectedModList || !profileModCount || !profileModsSection) return;
  const forge = profileLoaderSelect?.value === 'forge';
  profileModsSection.classList.toggle('disabled', !forge);
  profileModCount.textContent = `${profile?.mods.length ?? 0} MOD`;
  selectedModList.replaceChildren();

  if (!profile?.id) {
    const note = document.createElement('p');
    note.className = 'empty-mod-message';
    note.textContent =
      'MODを追加するには、先にプロファイルを保存してください。';
    selectedModList.append(note);
    return;
  }
  if (profile.mods.length === 0) {
    const note = document.createElement('p');
    note.className = 'empty-mod-message';
    note.textContent = forge
      ? '追加済みのMODはありません。'
      : 'Forgeを選択するとMODを追加できます。';
    selectedModList.append(note);
    return;
  }

  for (const mod of profile.mods) {
    const row = document.createElement('div');
    row.className = 'selected-mod-row';
    const icon = document.createElement('span');
    icon.className = 'mod-icon';
    if (mod.iconUrl) {
      const image = document.createElement('img');
      image.src = mod.iconUrl;
      image.alt = '';
      icon.append(image);
    } else {
      icon.textContent = mod.title.slice(0, 1);
    }
    const name = document.createElement('strong');
    name.textContent = mod.title;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'mod-remove-button';
    remove.dataset.projectId = mod.projectId;
    remove.textContent = '削除';
    row.append(icon, name, remove);
    selectedModList.append(row);
  }
};

// --- Java runtime management -------------------------------------------------

const describeJavaRuntime = (runtime: JavaRuntimeInfo) => {
  const distribution =
    javaDistributionLabels[runtime.distribution] ?? runtime.distribution;
  const major =
    runtime.majorVersion !== null ? `Java ${runtime.majorVersion}` : 'Java ?';
  return `${distribution} / ${major}${runtime.arch ? ` / ${runtime.arch}` : ''}`;
};

const javaSourceLabels: Record<JavaRuntimeInfo['source'], string> = {
  managed: 'ランチャー管理',
  custom: '手動追加',
  system: 'システム',
  mojang: 'Mojang互換',
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
      'Javaが見つかりません。下の「インストール」から取得するか、手動で追加してください。';
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
    meta.textContent = `${javaSourceLabels[runtime.source]} / ${
      runtime.verified
        ? runtime.versionString ?? '検証済み'
        : `検証失敗: ${runtime.error ?? '不明'}`
    }`;
    const pathLine = document.createElement('small');
    pathLine.className = 'java-runtime-path';
    pathLine.textContent = runtime.path;
    pathLine.title = runtime.path;
    info.append(title, meta, pathLine);
    row.append(info);
    if (runtime.source === 'managed' || runtime.source === 'custom') {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mod-remove-button';
      remove.dataset.javaRuntimeId = runtime.id;
      remove.textContent = '削除';
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
        : 'Javaランタイム一覧を取得できませんでした。',
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
      : 'Java実行ファイルが未選択です。';
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
  profileJavaStatus.textContent =
    'Minecraftバージョンに応じて必要なJavaを自動選択・自動取得します。';
};

const javaSettingsToSelectValue = (java: ProfileJavaSettings) => {
  if (java.mode === 'customPath') return 'custom';
  if (java.mode === 'fixed' && java.runtimeId) return `fixed:${java.runtimeId}`;
  const preferred = java.preferredDistributions[0] ?? 'liberica-lite';
  return preferred === 'liberica-lite' ? 'auto' : `auto:${preferred}`;
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
  appendOption('auto', '自動（推奨: Liberica Lite）');
  appendOption('auto:liberica', '自動 / Liberica Standard');
  appendOption('auto:zulu', '自動 / Azul Zulu');
  appendOption('auto:temurin', '自動 / Eclipse Temurin');
  for (const runtime of javaRuntimes) {
    if (runtime.source === 'mojang' || !runtime.verified) continue;
    appendOption(
      `fixed:${runtime.id}`,
      `${describeJavaRuntime(runtime)}（${javaSourceLabels[runtime.source]}）`,
    );
  }
  appendOption('custom', '手動選択...');

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
      throw new Error('Java実行ファイルを選択してください。');
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
  profileEditorMode = profile ? 'edit' : 'create';
  if (profileModalTitle) {
    profileModalTitle.textContent = profile
      ? 'プロファイルを編集'
      : 'プロファイルを作成';
  }
  // Modrinth search is only available in edit mode (profile must exist first).
  const modrinthTab = document.querySelector<HTMLElement>(
    '[data-profile-tab="modrinth"]',
  );
  if (modrinthTab) {
    modrinthTab.hidden = profileEditorMode === 'create';
  }
  if (profileIdInput) profileIdInput.value = profile?.id ?? '';
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
  if (profileLoaderSelect) {
    profileLoaderSelect.value = profile?.loaderType ?? 'vanilla';
  }
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
  forgeBuilds = [];
  if (profileForgeVersionSelect) {
    profileForgeVersionSelect.replaceChildren(
      new Option('Forge buildを選択してください', ''),
    );
    (profileForgeVersionSelect as MdEl).disabled = true;
  }
  if (profileForgeBuildStatus) {
    profileForgeBuildStatus.textContent =
      'Forge buildを選択してください。';
  }
  const javaSettings = profile?.java ?? defaultJavaSettings();
  populateProfileJavaSelect(javaSettings);
  if (!javaRuntimesLoaded) {
    void loadJavaRuntimes().then(() =>
      populateProfileJavaSelect(javaSettings),
    );
  }
  renderSelectedMods(profile);
  profileModal?.removeAttribute('hidden');
  const initialTab =
    profile?.loaderType === 'forge' ? 'forge' : 'vanilla';
  setProfileTab(initialTab, false);
  if (initialTab === 'forge' && minecraftVersion) {
    void loadForgeBuilds(
      minecraftVersion,
      profile?.loaderVersion ?? '',
    );
  }
};

const editorProfile = () =>
  currentState?.profiles.find(
    (profile) => profile.id === profileIdInput?.value,
  );

const saveProfileEditor = async (close = true) => {
  if (!saveProfileButton) return undefined;
  (saveProfileButton as MdEl).disabled = true;
  try {
    const loader =
      profileLoaderSelect?.value === 'forge' ? 'forge' : 'vanilla';
    const minecraftVersion =
      loader === 'forge'
        ? ((profileForgeMinecraftSelect as MdEl)?.value as string) ?? ''
        : ((profileVersionSelect as MdEl)?.value as string) ?? '';
    const loaderVersion =
      loader === 'forge'
        ? ((profileForgeVersionSelect as MdEl)?.value as string) ?? ''
        : null;
    if (loader === 'forge' && !loaderVersion) {
      throw new Error('Forge buildを選択してください。');
    }
    // Snapshot warning (non-blocking — toast only).
    if (loader === 'vanilla') {
      const selectedVersion = currentState?.availableVersions.find(
        (v) => v.id === minecraftVersion,
      );
      if (selectedVersion?.type === 'snapshot') {
        showToast('Snapshot版は不安定な可能性があります。', false);
      }
    }
    const state = await api.saveProfile({
      id: profileIdInput?.value || undefined,
      name: ((profileNameInput as MdEl)?.value as string) ?? '',
      profileType: loader,
      loaderType: loader,
      minecraftVersion,
      loaderVersion,
      resolvedVersionId:
        loader === 'forge'
          ? `${minecraftVersion}-forge-${loaderVersion}`
          : minecraftVersion,
      versionId: minecraftVersion,
      loader,
      minMemory: Number((profileMinMemoryInput as MdEl)?.value ?? 1024),
      maxMemory: Number((profileMaxMemoryInput as MdEl)?.value ?? 4096),
      java: collectProfileJavaSettings(),
    });
    renderState(state);
    if (profileIdInput) profileIdInput.value = state.selectedProfileId;
    if (close) {
      closeProfileModal();
      showToast('プロファイルを保存しました。');
    } else {
      renderSelectedMods(selectedProfile());
    }
    return state;
  } catch (error) {
    showToast(
      error instanceof Error
        ? error.message
        : 'プロファイルを保存できませんでした。',
      true,
    );
    return undefined;
  } finally {
    updateProfileSaveAvailability();
  }
};

const renderModSearchResults = (projects: ModrinthProject[]) => {
  if (!modSearchResults) return;
  modSearchResults.replaceChildren();
  if (projects.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-mod-message';
    empty.textContent = '対応するMODが見つかりませんでした。';
    modSearchResults.append(empty);
    return;
  }
  const installedIds = new Set(editorProfile()?.mods.map((mod) => mod.projectId));
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
    downloads.textContent = `${project.downloads.toLocaleString()} downloads`;
    copy.append(title, description, downloads);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'secondary-button';
    add.dataset.project = JSON.stringify(project);
    const installed = installedIds.has(project.projectId);
    add.disabled = installed;
    add.textContent = installed ? '追加済み' : '追加';
    item.append(icon, copy, add);
    modSearchResults.append(item);
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
  if (statusStage) statusStage.textContent = '準備中';

  // Disable this card's launch button while running
  const card = profileGrid?.querySelector<HTMLElement>(
    `[data-profile-id="${profile.id}"] [data-action="launch"]`,
  );
  if (card) {
    card.setAttribute('disabled', '');
    card.textContent = '起動中...';
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
      error instanceof Error ? error.message : '処理に失敗しました。',
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
  const id = profileIdInput?.value;
  if (!id) return;
  (deleteProfileButton as MdEl).disabled = true;
  try {
    renderState(await api.deleteProfile(id));
    closeProfileModal();
    showToast('プロファイルを削除しました。');
  } catch (error) {
    showToast(
      error instanceof Error
        ? error.message
        : 'プロファイルを削除できませんでした。',
      true,
    );
  } finally {
    (deleteProfileButton as MdEl).disabled = false;
  }
});

profileLoaderSelect?.addEventListener('change', () => {
  renderSelectedMods(editorProfile());
});

document.getElementById('profile-type-tabs')?.addEventListener('change', () => {
  const tabsEl = document.getElementById('profile-type-tabs');
  const allTabs = [...(tabsEl?.querySelectorAll('[data-profile-tab]') ?? [])];
  const active = allTabs.find((t) => (t as MdEl).active);
  const tab = (active as HTMLElement | undefined)?.dataset.profileTab;
  if (tab !== 'vanilla' && tab !== 'forge' && tab !== 'modrinth') return;
  setProfileTab(tab);
  if (
    tab === 'forge' &&
    (profileForgeMinecraftSelect as MdEl)?.value &&
    forgeBuilds.length === 0
  ) {
    void loadForgeBuilds(
      (profileForgeMinecraftSelect as MdEl).value as string,
      editorProfile()?.loaderVersion ?? '',
    );
  }
});

profileForgeMinecraftSelect?.addEventListener('change', () => {
  const val = (profileForgeMinecraftSelect as MdEl).value as string;
  if (!val) return;
  void loadForgeBuilds(val);
});

profileForgeVersionSelect?.addEventListener('change', () => {
  const forgeVal = (profileForgeVersionSelect as MdEl).value as string;
  const mcVal = (profileForgeMinecraftSelect as MdEl)?.value as string;
  if (profileForgeBuildStatus) {
    profileForgeBuildStatus.textContent = forgeVal
      ? `Minecraft ${mcVal} / Forge ${forgeVal}`
      : 'Forge buildを選択してください。';
  }
  updateProfileSaveAvailability();
});

modSearchButton?.addEventListener('click', async () => {
  if (profileLoaderSelect?.value !== 'forge') {
    showToast('MODを追加するにはForgeを選択してください。', true);
    return;
  }
  (modSearchButton as MdEl).disabled = true;
  modSearchButton.textContent = '検索中...';
  try {
    const state = await saveProfileEditor(false);
    if (!state) return;
    const projects = await api.searchModrinth(
      state.selectedProfileId,
      ((modSearchInput as MdEl)?.value as string) ?? '',
    );
    renderModSearchResults(projects);
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : 'MODを検索できませんでした。',
      true,
    );
  } finally {
    (modSearchButton as MdEl).disabled = false;
    modSearchButton.textContent = '検索';
  }
});

modSearchInput?.addEventListener('keydown', (event) => {
  if ((event as KeyboardEvent).key === 'Enter') modSearchButton?.click();
});

modSearchResults?.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    'button[data-project]',
  );
  const profileId = profileIdInput?.value;
  if (!button?.dataset.project || !profileId) return;
  button.disabled = true;
  try {
    const project = JSON.parse(button.dataset.project) as ModrinthProject;
    const state = await api.addMod(profileId, project);
    renderState(state);
    renderSelectedMods(
      state.profiles.find((profile) => profile.id === profileId),
    );
    button.textContent = '追加済み';
    showToast(`${project.title}をプロファイルへ追加しました。`);
  } catch (error) {
    button.disabled = false;
    showToast(
      error instanceof Error ? error.message : 'MODを追加できませんでした。',
      true,
    );
  }
});

selectedModList?.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    'button[data-project-id]',
  );
  const profileId = profileIdInput?.value;
  if (!button?.dataset.projectId || !profileId) return;
  try {
    const state = await api.removeMod(profileId, button.dataset.projectId);
    renderState(state);
    renderSelectedMods(
      state.profiles.find((profile) => profile.id === profileId),
    );
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : 'MODを削除できませんでした。',
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
    showToast('ゲームディレクトリを更新しました。');
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : 'フォルダーを変更できませんでした。',
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
  });
  renderState(state);
  return state;
};

saveSettingsButton?.addEventListener('click', async () => {
  (saveSettingsButton as MdEl).disabled = true;
  try {
    await saveLauncherSettings();
    showToast('設定を保存しました。');
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : '設定を保存できませんでした。',
      true,
    );
  } finally {
    (saveSettingsButton as MdEl).disabled = false;
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
          ? `有効期限 ${minutes}:${seconds}`
          : 'コードの有効期限が切れました';
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
    if (deviceCode) deviceCode.textContent = '発行中...';
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
    if (deviceCode) deviceCode.textContent = '認証完了';
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
        flow.status === 'cancelled' ? '認証キャンセル' : '認証失敗';
    }
    if (deviceCodeUrl) deviceCodeUrl.textContent = flow.message;
    if (deviceCodeCopy) deviceCodeCopy.hidden = true;
    if (deviceCodeOpen) deviceCodeOpen.hidden = true;
    if (deviceCodeCancel) deviceCodeCancel.hidden = true;
  }
};

loginButton?.addEventListener('click', async () => {
  if (!currentState?.auth.configured) {
    showToast('このビルドにはMicrosoft認証設定がありません。', true);
    return;
  }
  (loginButton as MdEl).disabled = true;
  loginButton.textContent = '認証を待っています...';
  renderAuthFlow({
    status: 'requesting-code',
    deviceCode: null,
    message: 'Microsoftへ接続しています。',
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
      `${auth.profile?.name ?? 'Minecraftアカウント'}でログインしました。`,
    );
    closeSettingsModal();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Microsoft認証に失敗しました。';
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

logoutButton?.addEventListener('click', async () => {
  try {
    const auth = await api.logout();
    renderAuth(auth);
    if (currentState) currentState.auth = auth;
    updateProfileCards();
    showToast('ログアウトしました。');
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : 'ログアウトできませんでした。',
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
  if (!code || code === '発行中...' || code === 'コード発行失敗') return;
  try {
    await navigator.clipboard.writeText(code);
    showToast('アクセス許可コードをコピーしました。');
  } catch {
    showToast('コードをコピーできませんでした。', true);
  }
});

deviceCodeOpen?.addEventListener('click', async () => {
  try {
    await api.openVerification();
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : '認証ページを開けませんでした。',
      true,
    );
  }
});

deviceCodeCancel?.addEventListener('click', async () => {
  await api.cancelLogin();
  renderAuthFlow({
    status: 'cancelled',
    deviceCode: null,
    message: 'Microsoft認証をキャンセルしました。',
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
  setJavaInstallStatus('Javaを再検出しています...');
  void loadJavaRuntimes(true).then(() => setJavaInstallStatus(''));
});

javaAddCustomButton?.addEventListener('click', async () => {
  try {
    const runtimes = await api.addCustomJavaRuntime();
    if (!runtimes) return;
    javaRuntimes = runtimes;
    javaRuntimesLoaded = true;
    renderJavaRuntimeList();
    showToast('Javaランタイムを追加しました。');
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : 'Javaを追加できませんでした。',
      true,
    );
  }
});

javaInstallButton?.addEventListener('click', async () => {
  const distribution = String(
    (javaInstallDistribution as MdEl)?.value ?? 'liberica-lite',
  ) as JavaDistributionId;
  const major = Number((javaInstallMajor as MdEl)?.value ?? 21);
  (javaInstallButton as MdEl).disabled = true;
  setJavaInstallStatus('インストールを開始しています...');
  try {
    await api.installJavaRuntime(distribution, major);
    await loadJavaRuntimes();
    setJavaInstallStatus('');
    showToast('Javaランタイムをインストールしました。');
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Javaをインストールできませんでした。';
    setJavaInstallStatus(message);
    showToast(message, true);
  } finally {
    (javaInstallButton as MdEl).disabled = false;
  }
});

javaRuntimeList?.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    'button[data-java-runtime-id]',
  );
  if (!button?.dataset.javaRuntimeId) return;
  button.disabled = true;
  try {
    javaRuntimes = await api.removeJavaRuntime(button.dataset.javaRuntimeId);
    javaRuntimesLoaded = true;
    renderJavaRuntimeList();
    showToast('Javaランタイムを削除しました。');
  } catch (error) {
    button.disabled = false;
    showToast(
      error instanceof Error ? error.message : 'Javaを削除できませんでした。',
      true,
    );
  }
});

api.onJavaInstallProgress((payload) => {
  const message =
    typeof payload.message === 'string' ? payload.message : '処理中...';
  const percent = typeof payload.percent === 'number' ? payload.percent : 0;
  setJavaInstallStatus(`${message} (${percent}%)`);
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
          : 'Java実行ファイルを選択できませんでした。',
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
    typeof payload.message === 'string' ? payload.message : '処理中...';
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
  if (message) {
    showToast(
      formatCategorizedMessage(message, payload.category),
      !running &&
        (payload.category === 'crash' ||
          payload.category === 'spawn' ||
          (typeof payload.code === 'number' && payload.code !== 0)),
    );
  }
});

void refreshState();
