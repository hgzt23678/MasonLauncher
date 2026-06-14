export {};

type MinecraftVersion = {
  id: string;
  type: string;
  releaseTime: string | null;
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

type LaunchProfile = {
  id: string;
  name: string;
  profileType: 'vanilla' | 'forge' | 'neoforge' | 'fabric';
  loaderType: 'vanilla' | 'forge' | 'neoforge' | 'fabric';
  minecraftVersion: string;
  loaderVersion: string | null;
  resolvedVersionId: string;
  versionId: string;
  loader: 'vanilla' | 'forge' | 'neoforge' | 'fabric';
  minMemory: number;
  maxMemory: number;
  mods: Array<{
    projectId: string;
    slug: string;
    title: string;
    iconUrl: string | null;
  }>;
  modCount?: number;
  java: ProfileJavaSettings;
  /** Absolute path to the profile's isolated game directory. */
  instanceDir: string;
};

type LauncherState = {
  buildConfiguration: import('./build-configuration').BuildConfiguration;
  canShowDeveloperSettings: boolean;
  gameDirectory: string;
  directoryExists: boolean;
  versions: MinecraftVersion[];
  availableVersions: Array<
    MinecraftVersion & {
      installed: boolean;
    }
  >;
  mojangAvailable: boolean;
  worlds: number;
  mods: number;
  screenshots: number;
  auth: AuthState;
  settings: {
    minMemory: number;
    maxMemory: number;
    developerMode: boolean;
    showDeveloperLogs: boolean;
    language: import('./i18n').LanguagePreference;
    themeColor: string;
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

type DeviceCodeInfo = {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  expiresAt: number;
  message: string;
};

type ModrinthSideSupport =
  | 'required'
  | 'optional'
  | 'unsupported'
  | 'unknown';

type ModrinthLoader = 'forge' | 'fabric' | 'quilt' | 'neoforge';

type ModrinthReleaseChannel = 'release' | 'beta' | 'alpha';

type ModrinthDependencyType =
  | 'required'
  | 'optional'
  | 'incompatible'
  | 'embedded';

type ModrinthSearchHit = {
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

type ModrinthProjectDetail = {
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

type ModrinthDependency = {
  projectId: string | null;
  versionId: string | null;
  fileName: string | null;
  dependencyType: ModrinthDependencyType;
};

type ModrinthVersionFile = {
  url: string;
  filename: string;
  primary: boolean;
  size: number;
  sha1: string | null;
  sha512: string | null;
};

type ModrinthVersionInfo = {
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

type InstalledModRecord = {
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

type DownloadVersionResult = {
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

type ModpackInstallIpcResult = {
  profileId: string;
  profileName: string;
  state: LauncherState;
};

type ModrinthSearchOptions = {
  loader?: ModrinthLoader;
  gameVersion?: string;
  limit?: number;
  offset?: number;
};

type ModrinthVersionOptions = {
  loader?: ModrinthLoader;
  gameVersion?: string;
};

type LauncherEvent = Record<string, unknown>;

type LauncherLogEntry = {
  id: number;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  stage: string;
  message: string;
  detail?: Record<string, unknown>;
};

declare global {
  interface Window {
    launcher?: {
      getState: () => Promise<LauncherState>;
      getLogs: () => Promise<LauncherLogEntry[]>;
      clearLogs: () => Promise<LauncherLogEntry[]>;
      chooseDirectory: () => Promise<LauncherState>;
      openDirectory: () => Promise<ActionResult>;
      openInstanceFolder: (profileId: string) => Promise<ActionResult>;
      openInstanceLogs: (profileId: string) => Promise<ActionResult>;
      openLatestLog: (profileId: string) => Promise<ActionResult>;
      copyReproductionScript: (profileId: string) => Promise<ActionResult>;
      saveSettings: (
        settings: Record<string, unknown>,
      ) => Promise<LauncherState>;
      configureMicrosoftClientId: (
        clientId: string,
      ) => Promise<LauncherState>;
      saveProfile: (
        profile: Record<string, unknown>,
      ) => Promise<LauncherState>;
      getForgeBuilds: (
        minecraftVersion: string,
      ) => Promise<
        Array<{
          minecraftVersion: string;
          loaderVersion: string;
          artifactVersion: string;
          resolvedVersionId: string;
          installerUrl: string;
        }>
      >;
      getModLoaderBuilds: (
        loader: 'forge' | 'neoforge' | 'fabric',
        minecraftVersion: string,
      ) => Promise<
        Array<{
          loader: 'forge' | 'neoforge' | 'fabric';
          minecraftVersion: string;
          loaderVersion: string;
          resolvedVersionId: string;
          stable: boolean;
        }>
      >;
      listJavaRuntimes: (options?: {
        refresh?: boolean;
        includeMojang?: boolean;
      }) => Promise<JavaRuntimeInfo[]>;
      addCustomJavaRuntime: () => Promise<JavaRuntimeInfo[] | null>;
      removeJavaRuntime: (runtimeId: string) => Promise<JavaRuntimeInfo[]>;
      chooseJavaExecutable: () => Promise<string | null>;
      selectProfile: (profileId: string) => Promise<LauncherState>;
      deleteProfile: (profileId: string) => Promise<LauncherState>;
      searchModrinth: (
        profileId: string,
        query: string,
      ) => Promise<
        Array<{
          projectId: string;
          slug: string;
          title: string;
          description: string;
          iconUrl: string | null;
          downloads: number;
        }>
      >;
      addMod: (
        profileId: string,
        project: Record<string, unknown>,
      ) => Promise<LauncherState>;
      removeMod: (
        profileId: string,
        projectId: string,
      ) => Promise<LauncherState>;
      modrinthSearchMods: (
        profileId: string,
        query: string,
        options?: ModrinthSearchOptions,
      ) => Promise<ModrinthSearchHit[]>;
      modrinthSearchModpacks: (
        query: string,
        options?: Pick<ModrinthSearchOptions, 'limit' | 'offset'>,
      ) => Promise<ModrinthSearchHit[]>;
      modrinthInstallModpack: (
        projectId: string,
        versionId?: string,
      ) => Promise<ModpackInstallIpcResult>;
      modrinthGetProject: (
        idOrSlug: string,
      ) => Promise<ModrinthProjectDetail>;
      modrinthGetVersions: (
        profileId: string,
        idOrSlug: string,
        options?: ModrinthVersionOptions,
      ) => Promise<ModrinthVersionInfo[]>;
      modrinthDownloadVersion: (
        profileId: string,
        versionId: string,
      ) => Promise<DownloadVersionResult>;
      modrinthListInstalledMods: (
        profileId: string,
      ) => Promise<InstalledModRecord[]>;
      modrinthRemoveInstalledMod: (
        profileId: string,
        projectIdOrFileName: string,
      ) => Promise<{ removed: boolean; mods: InstalledModRecord[] }>;
      login: () => Promise<AuthState>;
      getDeviceCode: () => Promise<DeviceCodeInfo | null>;
      getAuthFlowState: () => Promise<AuthFlowState>;
      cancelLogin: () => Promise<void>;
      openVerification: () => Promise<void>;
      logout: () => Promise<AuthState>;
      installVersion: (versionId: string) => Promise<ActionResult>;
      launchVersion: (versionId: string) => Promise<ActionResult>;
      launchProfile: (profileId: string) => Promise<ActionResult>;
      onProgress: (callback: (payload: LauncherEvent) => void) => () => void;
      onProcessState: (
        callback: (payload: LauncherEvent) => void,
      ) => () => void;
      onDeviceCode: (
        callback: (payload: LauncherEvent) => void,
      ) => () => void;
      onAuthFlowState: (
        callback: (payload: LauncherEvent) => void,
      ) => () => void;
      onLog: (callback: (payload: LauncherEvent) => void) => () => void;
      onModrinthDownloadProgress: (
        callback: (payload: LauncherEvent) => void,
      ) => () => void;
      onModrinthModpackInstallProgress: (
        callback: (payload: LauncherEvent) => void,
      ) => () => void;
    };
  }
}
