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
  saveSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke('launcher:save-settings', settings),
  saveProfile: (profile: Record<string, unknown>) =>
    ipcRenderer.invoke('profile:save', profile),
  selectProfile: (profileId: string) =>
    ipcRenderer.invoke('profile:select', profileId),
  deleteProfile: (profileId: string) =>
    ipcRenderer.invoke('profile:delete', profileId),
  searchModrinth: (profileId: string, query: string) =>
    ipcRenderer.invoke('modrinth:search', profileId, query),
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
});
