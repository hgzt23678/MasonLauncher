import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

type EventCallback = (payload: Record<string, unknown>) => void;

const subscribe = (channel: string, callback: EventCallback) => {
  const listener = (
    _event: IpcRendererEvent,
    payload: Record<string, unknown>,
  ) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('launcher', {
  getState: () => ipcRenderer.invoke('launcher:get-state'),
  getLogs: () => ipcRenderer.invoke('launcher:get-logs'),
  clearLogs: () => ipcRenderer.invoke('launcher:clear-logs'),
  chooseDirectory: () => ipcRenderer.invoke('launcher:choose-directory'),
  openDirectory: () => ipcRenderer.invoke('launcher:open-directory'),
  openInstanceFolder: (profileId: string) =>
    ipcRenderer.invoke('launcher:open-instance-folder', profileId),
  openInstanceLogs: (profileId: string) =>
    ipcRenderer.invoke('launcher:open-instance-logs', profileId),
  openLatestLog: (profileId: string) =>
    ipcRenderer.invoke('launcher:open-latest-log', profileId),
  copyReproductionScript: (profileId: string) =>
    ipcRenderer.invoke('launcher:copy-reproduction-script', profileId),
  saveSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke('launcher:save-settings', settings),
  saveProfile: (profile: Record<string, unknown>) =>
    ipcRenderer.invoke('profile:save', profile),
  getForgeBuilds: (minecraftVersion: string) =>
    ipcRenderer.invoke('forge:list-builds', minecraftVersion),
  getModLoaderBuilds: (loader: string, minecraftVersion: string) =>
    ipcRenderer.invoke('loader:list-builds', loader, minecraftVersion),
  listJavaRuntimes: (options?: Record<string, unknown>) =>
    ipcRenderer.invoke('java:list-runtimes', options ?? {}),
  addCustomJavaRuntime: () => ipcRenderer.invoke('java:add-custom'),
  removeJavaRuntime: (runtimeId: string) =>
    ipcRenderer.invoke('java:remove-runtime', runtimeId),
  chooseJavaExecutable: () => ipcRenderer.invoke('java:choose-executable'),
  selectProfile: (profileId: string) =>
    ipcRenderer.invoke('profile:select', profileId),
  deleteProfile: (profileId: string) =>
    ipcRenderer.invoke('profile:delete', profileId),
  searchModrinth: (profileId: string, query: string) =>
    ipcRenderer.invoke('modrinth:search', profileId, query),
  modrinthSearchMods: (
    profileId: string,
    query: string,
    options?: Record<string, unknown>,
  ) =>
    ipcRenderer.invoke('modrinth:search-mods', profileId, query, options ?? {}),
  modrinthGetProject: (idOrSlug: string) =>
    ipcRenderer.invoke('modrinth:get-project', idOrSlug),
  modrinthGetVersions: (
    profileId: string,
    idOrSlug: string,
    options?: Record<string, unknown>,
  ) =>
    ipcRenderer.invoke(
      'modrinth:get-versions',
      profileId,
      idOrSlug,
      options ?? {},
    ),
  modrinthDownloadVersion: (profileId: string, versionId: string) =>
    ipcRenderer.invoke('modrinth:download-version', profileId, versionId),
  modrinthListInstalledMods: (profileId: string) =>
    ipcRenderer.invoke('modrinth:list-installed-mods', profileId),
  modrinthRemoveInstalledMod: (
    profileId: string,
    projectIdOrFileName: string,
  ) =>
    ipcRenderer.invoke(
      'modrinth:remove-installed-mod',
      profileId,
      projectIdOrFileName,
    ),
  addMod: (profileId: string, project: Record<string, unknown>) =>
    ipcRenderer.invoke('profile:add-mod', profileId, project),
  removeMod: (profileId: string, projectId: string) =>
    ipcRenderer.invoke('profile:remove-mod', profileId, projectId),
  login: () => ipcRenderer.invoke('auth:login'),
  getDeviceCode: () => ipcRenderer.invoke('auth:get-device-code'),
  getAuthFlowState: () => ipcRenderer.invoke('auth:get-flow-state'),
  cancelLogin: () => ipcRenderer.invoke('auth:cancel-login'),
  openVerification: () => ipcRenderer.invoke('auth:open-verification'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  installVersion: (versionId: string) =>
    ipcRenderer.invoke('minecraft:install-version', versionId),
  launchVersion: (versionId: string) =>
    ipcRenderer.invoke('minecraft:launch-version', versionId),
  launchProfile: (profileId: string) =>
    ipcRenderer.invoke('minecraft:launch-profile', profileId),
  onProgress: (callback: EventCallback) =>
    subscribe('minecraft:progress', callback),
  onProcessState: (callback: EventCallback) =>
    subscribe('minecraft:process-state', callback),
  onDeviceCode: (callback: EventCallback) =>
    subscribe('auth:device-code', callback),
  onAuthFlowState: (callback: EventCallback) =>
    subscribe('auth:flow-state', callback),
  onLog: (callback: EventCallback) => subscribe('launcher:log', callback),
  onModrinthDownloadProgress: (callback: EventCallback) =>
    subscribe('modrinth:download-progress', callback),
});
