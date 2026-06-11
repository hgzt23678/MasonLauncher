import './index.css';

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

type LaunchProfile = {
  id: string;
  name: string;
  versionId: string;
  loader: 'vanilla' | 'forge';
  minMemory: number;
  maxMemory: number;
  mods: ProfileMod[];
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
      name: '最新バニラ',
      versionId: '1.21.11',
      loader: 'vanilla',
      minMemory: 1024,
      maxMemory: 4096,
      mods: [],
    },
    {
      id: 'forge-profile',
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
  selectProfile: async () => demoState,
  deleteProfile: async () => demoState,
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

const versionSelect = byId<HTMLSelectElement>('version-select');
const playButton = byId<HTMLButtonElement>('play-button');
const scanStatus = byId<HTMLElement>('scan-status');
const directoryPath = byId<HTMLElement>('directory-path');
const directoryPill = byId<HTMLElement>('directory-pill');
const worldCount = byId<HTMLElement>('world-count');
const modCount = byId<HTMLElement>('mod-count');
const screenshotCount = byId<HTMLElement>('screenshot-count');
const toast = byId<HTMLElement>('toast');
const openFolderButton = byId<HTMLButtonElement>('open-folder-button');
const openFolderNav = byId<HTMLButtonElement>('open-folder-nav');
const changeFolderButton = byId<HTMLButtonElement>('change-folder-button');
const refreshNav = byId<HTMLButtonElement>('refresh-nav');
const settingsNav = byId<HTMLButtonElement>('settings-nav');
const profilesNav = byId<HTMLButtonElement>('profiles-nav');
const footerSettingsButton =
  byId<HTMLButtonElement>('footer-settings-button');
const accountButton = byId<HTMLButtonElement>('account-button');
const accountAvatar = byId<HTMLElement>('account-avatar');
const accountLabel = byId<HTMLElement>('account-label');
const downloadProgress = byId<HTMLElement>('download-progress');
const progressBar = byId<HTMLElement>('progress-bar');
const progressLabel = byId<HTMLElement>('progress-label');
const progressPercent = byId<HTMLElement>('progress-percent');
const activeProfileName = byId<HTMLElement>('active-profile-name');
const profileGrid = byId<HTMLElement>('profile-grid');
const profilesSection = byId<HTMLElement>('profiles-section');
const addProfileButton = byId<HTMLButtonElement>('add-profile-button');

const settingsModal = byId<HTMLElement>('settings-modal');
const modalClose = byId<HTMLButtonElement>('modal-close');
const profileAvatar = byId<HTMLElement>('profile-avatar');
const profileName = byId<HTMLElement>('profile-name');
const profileStatus = byId<HTMLElement>('profile-status');
const logoutButton = byId<HTMLButtonElement>('logout-button');
const minMemoryInput = byId<HTMLInputElement>('min-memory-input');
const maxMemoryInput = byId<HTMLInputElement>('max-memory-input');
const saveSettingsButton =
  byId<HTMLButtonElement>('save-settings-button');
const loginButton = byId<HTMLButtonElement>('login-button');
const deviceCodePanel = byId<HTMLElement>('device-code-panel');
const deviceCode = byId<HTMLElement>('device-code');
const deviceCodeUrl = byId<HTMLElement>('device-code-url');
const deviceCodeCopy = byId<HTMLButtonElement>('device-code-copy');
const deviceCodeOpen = byId<HTMLButtonElement>('device-code-open');
const deviceCodeCancel = byId<HTMLButtonElement>('device-code-cancel');
const deviceCodeExpiry = byId<HTMLElement>('device-code-expiry');
const developerLogList = byId<HTMLElement>('developer-log-list');
const refreshLogsButton =
  byId<HTMLButtonElement>('refresh-logs-button');
const clearLogsButton = byId<HTMLButtonElement>('clear-logs-button');

const profileModal = byId<HTMLElement>('profile-modal');
const profileModalTitle = byId<HTMLElement>('profile-modal-title');
const profileModalClose = byId<HTMLButtonElement>('profile-modal-close');
const profileIdInput = byId<HTMLInputElement>('profile-id-input');
const profileNameInput = byId<HTMLInputElement>('profile-name-input');
const profileVersionSelect =
  byId<HTMLSelectElement>('profile-version-select');
const profileLoaderSelect =
  byId<HTMLSelectElement>('profile-loader-select');
const profileMinMemoryInput =
  byId<HTMLInputElement>('profile-min-memory-input');
const profileMaxMemoryInput =
  byId<HTMLInputElement>('profile-max-memory-input');
const profileModsSection = byId<HTMLElement>('profile-mods-section');
const profileModCount = byId<HTMLElement>('profile-mod-count');
const selectedModList = byId<HTMLElement>('selected-mod-list');
const modSearchInput = byId<HTMLInputElement>('mod-search-input');
const modSearchButton = byId<HTMLButtonElement>('mod-search-button');
const modSearchResults = byId<HTMLElement>('mod-search-results');
const deleteProfileButton =
  byId<HTMLButtonElement>('delete-profile-button');
const cancelProfileButton =
  byId<HTMLButtonElement>('cancel-profile-button');
const saveProfileButton = byId<HTMLButtonElement>('save-profile-button');

let currentState: LauncherState | undefined;
let busy = false;
let toastTimer: number | undefined;
let deviceCodeTimer: number | undefined;
let developerLogs: LauncherLogEntry[] = [];

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

const selectedVersion = () => {
  const profile = selectedProfile();
  return currentState?.availableVersions.find(
    (version) => version.id === profile?.versionId,
  );
};

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
      ? 'Minecraft: Java Edition 認証済み'
      : auth.configured
        ? 'Microsoftデバイスコードでログインできます'
        : 'このビルドにはMicrosoft認証設定がありません';
  }
  if (logoutButton) logoutButton.hidden = !auth.signedIn;
  if (loginButton) {
    loginButton.hidden = auth.signedIn;
    loginButton.disabled = !auth.configured;
    loginButton.textContent = auth.configured
      ? 'Microsoftアカウントでログイン'
      : 'Microsoft認証が未設定です';
  }
};

const createProfileCard = (profile: LaunchProfile) => {
  const card = document.createElement('article');
  card.className = 'profile-card';
  card.classList.toggle(
    'active',
    profile.id === currentState?.selectedProfileId,
  );
  card.dataset.profileId = profile.id;

  const top = document.createElement('div');
  top.className = 'profile-card-top';
  const icon = document.createElement('span');
  icon.className = `profile-card-icon ${profile.loader}`;
  icon.textContent = profile.loader === 'forge' ? 'F' : 'V';
  const badges = document.createElement('div');
  badges.className = 'profile-badges';
  const loader = document.createElement('span');
  loader.textContent = profile.loader.toUpperCase();
  badges.append(loader);
  if (profile.mods.length > 0) {
    const mods = document.createElement('span');
    mods.textContent = `${profile.mods.length} MOD`;
    badges.append(mods);
  }
  top.append(icon, badges);

  const title = document.createElement('h4');
  title.textContent = profile.name;
  const version = document.createElement('p');
  version.textContent = `Minecraft ${profile.versionId}`;
  const memory = document.createElement('small');
  memory.textContent = `${profile.minMemory}–${profile.maxMemory} MB`;

  const actions = document.createElement('div');
  actions.className = 'profile-card-actions';
  const selectButton = document.createElement('button');
  selectButton.type = 'button';
  selectButton.className = 'profile-select-button';
  selectButton.dataset.action = 'select';
  selectButton.textContent =
    profile.id === currentState?.selectedProfileId ? '選択中' : '選択';
  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.className = 'profile-edit-button';
  editButton.dataset.action = 'edit';
  editButton.textContent = '編集';
  actions.append(selectButton, editButton);
  card.append(top, title, version, memory, actions);
  return card;
};

const renderProfileGrid = () => {
  if (!profileGrid || !currentState) return;
  profileGrid.replaceChildren(
    ...currentState.profiles.map(createProfileCard),
  );
};

const updateLaunchButton = () => {
  if (!playButton || busy || !currentState) return;
  const profile = selectedProfile();
  const version = selectedVersion();
  const title = playButton.querySelector('strong');
  const sublabel = playButton.querySelector('small');

  if (!profile || !version) {
    playButton.disabled = true;
    return;
  }
  if (!currentState.auth.signedIn) {
    playButton.disabled = false;
    if (title) title.textContent = 'LOGIN';
    if (sublabel) sublabel.textContent = '正規アカウントを接続';
    return;
  }
  if (!version.installed) {
    playButton.disabled = !currentState.mojangAvailable;
    if (title) title.textContent = 'DOWNLOAD';
    if (sublabel) sublabel.textContent = 'ゲームとJavaを準備';
    return;
  }
  playButton.disabled = currentState.gameRunning;
  if (title) title.textContent = currentState.gameRunning ? 'RUNNING' : 'PLAY';
  if (sublabel) {
    sublabel.textContent = currentState.gameRunning
      ? 'Minecraft は起動中です'
      : profile.loader === 'forge'
        ? `Forge / ${profile.mods.length} MOD`
        : 'Vanillaを直接起動';
  }
};

const populateVersionSelect = (
  select: HTMLSelectElement | null,
  value: string,
) => {
  if (!select || !currentState) return;
  select.replaceChildren();
  for (const version of [...currentState.availableVersions].sort(
    compareVersionsByRelease,
  )) {
    const suffix = version.installed ? '  /  INSTALLED' : '';
    select.add(
      new Option(`${formatVersionLabel(version)}${suffix}`, version.id),
    );
  }
  select.disabled = currentState.availableVersions.length === 0;
  if (currentState.availableVersions.some((version) => version.id === value)) {
    select.value = value;
  }
};

const renderState = (state: LauncherState) => {
  currentState = state;
  const profile = selectedProfile();
  populateVersionSelect(versionSelect, profile?.versionId ?? '');
  if (activeProfileName) {
    activeProfileName.textContent = profile?.name ?? 'プロファイル未選択';
  }
  if (directoryPath) {
    directoryPath.textContent = state.gameDirectory;
    directoryPath.title = state.gameDirectory;
  }
  if (directoryPill) {
    directoryPill.textContent = state.directoryExists ? '検出済み' : '新規';
    directoryPill.classList.toggle('warning', !state.directoryExists);
  }
  if (worldCount) worldCount.textContent = String(state.worlds);
  if (modCount) modCount.textContent = String(state.mods);
  if (screenshotCount) screenshotCount.textContent = String(state.screenshots);
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
    minMemoryInput.value = String(state.settings.minMemory);
  }
  if (maxMemoryInput) {
    maxMemoryInput.value = String(state.settings.maxMemory);
  }
  renderProfileGrid();
  renderAuth(state.auth);
  updateLaunchButton();
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

const openProfileEditor = (profile?: LaunchProfile) => {
  if (!currentState) return;
  if (profileModalTitle) {
    profileModalTitle.textContent = profile
      ? 'プロファイルを編集'
      : 'プロファイルを作成';
  }
  if (profileIdInput) profileIdInput.value = profile?.id ?? '';
  if (profileNameInput) profileNameInput.value = profile?.name ?? '';
  populateVersionSelect(
    profileVersionSelect,
    profile?.versionId ??
      selectedProfile()?.versionId ??
      currentState.availableVersions[0]?.id ??
      '',
  );
  if (profileLoaderSelect) {
    profileLoaderSelect.value = profile?.loader ?? 'vanilla';
  }
  if (profileMinMemoryInput) {
    profileMinMemoryInput.value = String(
      profile?.minMemory ?? currentState.settings.minMemory,
    );
  }
  if (profileMaxMemoryInput) {
    profileMaxMemoryInput.value = String(
      profile?.maxMemory ?? currentState.settings.maxMemory,
    );
  }
  if (deleteProfileButton) deleteProfileButton.hidden = !profile;
  modSearchResults?.replaceChildren();
  if (modSearchInput) modSearchInput.value = '';
  renderSelectedMods(profile);
  profileModal?.removeAttribute('hidden');
};

const editorProfile = () =>
  currentState?.profiles.find(
    (profile) => profile.id === profileIdInput?.value,
  );

const saveProfileEditor = async (close = true) => {
  if (!saveProfileButton) return undefined;
  saveProfileButton.disabled = true;
  try {
    const state = await api.saveProfile({
      id: profileIdInput?.value || undefined,
      name: profileNameInput?.value ?? '',
      versionId: profileVersionSelect?.value ?? '',
      loader: profileLoaderSelect?.value ?? 'vanilla',
      minMemory: Number(profileMinMemoryInput?.value ?? 1024),
      maxMemory: Number(profileMaxMemoryInput?.value ?? 4096),
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
    saveProfileButton.disabled = false;
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

playButton?.addEventListener('click', async () => {
  const profile = selectedProfile();
  const version = selectedVersion();
  if (!profile || !version || !currentState) return;
  if (!currentState.auth.signedIn) {
    openSettingsModal();
    return;
  }

  busy = true;
  playButton.disabled = true;
  playButton.classList.add('launching');
  downloadProgress?.removeAttribute('hidden');
  try {
    if (!version.installed) {
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
    playButton.classList.remove('launching');
    updateLaunchButton();
  }
});

versionSelect?.addEventListener('change', async () => {
  const profile = selectedProfile();
  if (!profile || !versionSelect.value) return;
  try {
    renderState(
      await api.saveProfile({
        ...profile,
        versionId: versionSelect.value,
      }),
    );
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : 'バージョンを変更できませんでした。',
      true,
    );
  }
});

profileGrid?.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    'button[data-action]',
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
  try {
    renderState(await api.selectProfile(profile.id));
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : '選択を変更できませんでした。',
      true,
    );
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
  deleteProfileButton.disabled = true;
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
    deleteProfileButton.disabled = false;
  }
});

profileLoaderSelect?.addEventListener('change', () => {
  renderSelectedMods(editorProfile());
});

modSearchButton?.addEventListener('click', async () => {
  if (profileLoaderSelect?.value !== 'forge') {
    showToast('MODを追加するにはForgeを選択してください。', true);
    return;
  }
  modSearchButton.disabled = true;
  modSearchButton.textContent = '検索中...';
  try {
    const state = await saveProfileEditor(false);
    if (!state) return;
    const projects = await api.searchModrinth(
      state.selectedProfileId,
      modSearchInput?.value ?? '',
    );
    renderModSearchResults(projects);
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : 'MODを検索できませんでした。',
      true,
    );
  } finally {
    modSearchButton.disabled = false;
    modSearchButton.textContent = '検索';
  }
});

modSearchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') modSearchButton?.click();
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

for (const button of [settingsNav, footerSettingsButton, accountButton]) {
  button?.addEventListener('click', openSettingsModal);
}
modalClose?.addEventListener('click', closeSettingsModal);
settingsModal?.addEventListener('click', (event) => {
  if (event.target === settingsModal) closeSettingsModal();
});

const saveLauncherSettings = async () => {
  const state = await api.saveSettings({
    minMemory: Number(minMemoryInput?.value ?? 1024),
    maxMemory: Number(maxMemoryInput?.value ?? 4096),
  });
  renderState(state);
  return state;
};

saveSettingsButton?.addEventListener('click', async () => {
  saveSettingsButton.disabled = true;
  try {
    await saveLauncherSettings();
    showToast('設定を保存しました。');
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : '設定を保存できませんでした。',
      true,
    );
  } finally {
    saveSettingsButton.disabled = false;
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
  loginButton.disabled = true;
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
    updateLaunchButton();
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
  downloadProgress?.removeAttribute('hidden');
  const percent = typeof payload.percent === 'number' ? payload.percent : 0;
  const message =
    typeof payload.message === 'string' ? payload.message : '処理中...';
  const displayMessage = formatCategorizedMessage(
    message,
    payload.category,
  );
  const file = typeof payload.file === 'string' ? payload.file : '';
  if (progressBar) progressBar.style.width = `${percent}%`;
  if (progressPercent) progressPercent.textContent = `${percent}%`;
  if (progressLabel) {
    progressLabel.textContent = file
      ? `${displayMessage} / ${file}`
      : displayMessage;
  }
  if (payload.phase === 'error') {
    showToast(displayMessage, true);
  }
});

api.onProcessState((payload) => {
  const running = payload.running === true;
  const message =
    typeof payload.message === 'string' ? payload.message : '';
  if (currentState) currentState.gameRunning = running;
  updateLaunchButton();
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
