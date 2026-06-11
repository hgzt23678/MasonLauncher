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

type LaunchProfile = {
  id: string;
  name: string;
  versionId: string;
  loader: 'vanilla' | 'forge';
  minMemory: number;
  maxMemory: number;
  mods: Array<{
    projectId: string;
    slug: string;
    title: string;
    iconUrl: string | null;
  }>;
};

type LauncherState = {
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
      saveSettings: (
        settings: Record<string, unknown>,
      ) => Promise<LauncherState>;
      saveProfile: (
        profile: Record<string, unknown>,
      ) => Promise<LauncherState>;
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
    };
  }
}
