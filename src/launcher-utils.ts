import path from 'node:path';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { LaunchOption, ResolvedVersion } from '@xmcl/core';
import type { MinecraftSession } from './auth-service';

export type RuntimePlatform = NodeJS.Platform;
export type RuntimeArch = NodeJS.Architecture;

export const resolveJavaExecutable = (
  runtimeDirectory: string,
  platform: RuntimePlatform = process.platform,
) =>
  path.join(
    runtimeDirectory,
    'bin',
    platform === 'win32' ? 'javaw.exe' : 'java',
  );

export const resolveRuntimePlatformKey = (
  platform: RuntimePlatform = process.platform,
  arch: RuntimeArch = process.arch,
) => {
  if (platform === 'win32') {
    if (arch === 'arm64') return 'windows-arm64';
    return arch === 'ia32' ? 'windows-x86' : 'windows-x64';
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  }
  return arch === 'ia32' ? 'linux-i386' : 'linux';
};

export const resolveLibraryPath = (
  gameDirectory: string,
  downloadPath: string,
) => {
  if (!downloadPath || path.isAbsolute(downloadPath)) {
    throw new Error('ライブラリの相対パスが不正です。');
  }
  const librariesRoot = path.resolve(gameDirectory, 'libraries');
  const candidate = path.resolve(librariesRoot, downloadPath);
  if (
    candidate !== librariesRoot &&
    !candidate.startsWith(`${librariesRoot}${path.sep}`)
  ) {
    throw new Error('ライブラリパスがゲームディレクトリ外を指しています。');
  }
  return candidate;
};

export type ParsedManifestVersion = {
  id: string;
  type: string;
  url: string;
  time: string;
  releaseTime: string;
};

export const parseVersionManifest = (input: unknown) => {
  if (!input || typeof input !== 'object') {
    throw new Error('Mojang version manifest がオブジェクトではありません。');
  }
  const versions = (input as { versions?: unknown }).versions;
  if (!Array.isArray(versions)) {
    throw new Error('Mojang version manifest に versions 配列がありません。');
  }
  return versions.map((value, index): ParsedManifestVersion => {
    if (!value || typeof value !== 'object') {
      throw new Error(`manifest versions[${index}] が不正です。`);
    }
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.type !== 'string' ||
      typeof candidate.url !== 'string' ||
      typeof candidate.time !== 'string' ||
      typeof candidate.releaseTime !== 'string'
    ) {
      throw new Error(`manifest versions[${index}] の必須項目が不足しています。`);
    }
    return {
      ...candidate,
      id: candidate.id,
      type: candidate.type,
      url: candidate.url,
      time: candidate.time,
      releaseTime: candidate.releaseTime,
    } as ParsedManifestVersion;
  });
};

type LaunchSettings = {
  minMemory: number;
  maxMemory: number;
};

export const buildLaunchOptions = (input: {
  version: ResolvedVersion;
  session: MinecraftSession;
  settings: LaunchSettings;
  gamePath: string;
  resourcePath: string;
  javaPath: string;
  nativesDirectory?: string;
}): LaunchOption => ({
  gameProfile: {
    id: input.session.profile.id,
    name: input.session.profile.name,
  },
  accessToken: input.session.accessToken,
  properties: {},
  launcherName: 'Mason Launcher',
  launcherBrand: 'mason-launcher',
  gamePath: input.gamePath,
  resourcePath: input.resourcePath,
  javaPath: input.javaPath,
  nativeRoot: input.nativesDirectory,
  minMemory: input.settings.minMemory,
  maxMemory: input.settings.maxMemory,
  version: input.version,
  extraExecOption: {
    cwd: input.gamePath,
    windowsHide: true,
  },
});

export type SpawnRequest = {
  command: string;
  args: readonly string[];
  options: SpawnOptions | undefined;
};

export type SpawnFunction = (
  command: string,
  args?: readonly string[],
  options?: SpawnOptions,
) => ChildProcess;

export const validateSpawnRequest = (request: SpawnRequest) => {
  if (!request.command.trim()) {
    throw new Error('Java実行ファイルのパスが空です。');
  }
  if (!Array.isArray(request.args) || request.args.length === 0) {
    throw new Error('Minecraft起動引数が空です。');
  }
  if (
    typeof request.options?.cwd !== 'string' ||
    request.options.cwd.trim() === ''
  ) {
    throw new Error('Minecraftの作業ディレクトリが空です。');
  }
  return request;
};

export const createObservedSpawn = (
  spawnProcess: SpawnFunction,
  observe: (request: SpawnRequest) => void,
): SpawnFunction => (command, args = [], options) => {
  const request = validateSpawnRequest({ command, args, options });
  observe(request);
  return spawnProcess(request.command, request.args, request.options);
};
