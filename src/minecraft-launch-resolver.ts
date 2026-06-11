import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  Version,
  generateArguments,
  type LaunchOption,
  type ResolvedVersion,
} from '@xmcl/core';
import type { MinecraftSession } from './auth-service';
import type {
  LauncherLogLevel,
  LauncherLogStage,
} from './diagnostics';
import { MinecraftError } from './minecraft-errors';
import { buildLaunchOptions } from './launcher-utils';

const execFileAsync = promisify(execFile);

type LaunchSettings = {
  minMemory: number;
  maxMemory: number;
};

type LogWriter = (
  level: LauncherLogLevel,
  stage: LauncherLogStage,
  message: string,
  detail?: Record<string, unknown>,
) => void;

export type ResolvedMinecraftLaunch = {
  command: string;
  args: string[];
  cwd: string;
  version: ResolvedVersion;
  mainClass: string;
  nativesDirectory: string;
  classpathEntries: number;
  javaVersion: string;
  options: LaunchOption;
};

const findUnresolvedPlaceholder = (values: readonly string[]) =>
  values.find((value) => /\$\{[^}]+\}/.test(value));

const readJavaVersion = async (javaPath: string) => {
  const probe =
    process.platform === 'win32' &&
    path.basename(javaPath).toLowerCase() === 'javaw.exe'
      ? path.join(path.dirname(javaPath), 'java.exe')
      : javaPath;
  try {
    const { stdout, stderr } = await execFileAsync(probe, ['-version'], {
      windowsHide: true,
      timeout: 10_000,
    });
    return `${stderr}\n${stdout}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? 'unknown';
  } catch (error) {
    throw new MinecraftError(
      `Java実行ファイルを起動できません: ${javaPath}`,
      'java',
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'JAVA_PROBE_FAILED',
      { javaPath },
      { cause: error },
    );
  }
};

export class MinecraftLaunchResolver {
  constructor(private readonly log: LogWriter = () => undefined) {}

  async resolve(input: {
    versionId: string;
    session: MinecraftSession;
    settings: LaunchSettings;
    gamePath: string;
    resourcePath: string;
    javaPath: string;
    nativesDirectory?: string;
  }): Promise<ResolvedMinecraftLaunch> {
    if (input.session.mode !== 'online') {
      throw new MinecraftError(
        'Minecraftの起動にはMicrosoft/Minecraft Services認証が必要です。',
        'authentication',
        'ONLINE_SESSION_REQUIRED',
      );
    }
    try {
      await fs.access(input.javaPath);
    } catch (error) {
      throw new MinecraftError(
        `Java実行ファイルが見つかりません: ${input.javaPath}`,
        'java',
        'JAVA_NOT_FOUND',
        { javaPath: input.javaPath },
        { cause: error },
      );
    }

    let version: ResolvedVersion;
    try {
      version = await Version.parse(input.resourcePath, input.versionId);
    } catch (error) {
      throw new MinecraftError(
        `Minecraftバージョン ${input.versionId} を解析できません。`,
        'json',
        'VERSION_PARSE_ERROR',
        { versionId: input.versionId },
        { cause: error },
      );
    }
    const nativesDirectory =
      input.nativesDirectory ??
      path.join(
        input.resourcePath,
        'versions',
        version.id,
        `${version.id}-natives`,
      );
    const options = buildLaunchOptions({
      version,
      session: input.session,
      settings: input.settings,
      gamePath: input.gamePath,
      resourcePath: input.resourcePath,
      javaPath: input.javaPath,
      nativesDirectory,
    });

    let generated: string[];
    try {
      generated = await generateArguments(options);
    } catch (error) {
      throw new MinecraftError(
        'Minecraft起動引数の生成に失敗しました。',
        'arguments',
        'ARGUMENT_GENERATION_FAILED',
        { versionId: input.versionId },
        { cause: error },
      );
    }
    const [command, ...args] = generated;
    if (!command || args.length === 0) {
      throw new MinecraftError(
        'Minecraft起動コマンドまたは引数が空です。',
        'arguments',
        'EMPTY_ARGUMENTS',
      );
    }
    const unresolved = findUnresolvedPlaceholder(generated);
    if (unresolved) {
      throw new MinecraftError(
        `未解決の起動引数プレースホルダがあります: ${unresolved}`,
        'arguments',
        'UNRESOLVED_PLACEHOLDER',
      );
    }
    const javaVersion = await readJavaVersion(command);
    const classpathEntries =
      version.libraries.filter((library) => !library.isNative).length + 1;
    this.log('info', 'java', 'Minecraftで使用するJavaを確認しました。', {
      executable: command,
      version: javaVersion,
      requiredMajorVersion: version.javaVersion.majorVersion,
    });
    this.log('info', 'arguments', 'Minecraft起動引数を生成しました。', {
      versionId: version.id,
      mainClass: version.mainClass,
      classpathEntries,
      nativesDirectory,
      argumentCount: args.length,
      cwd: input.gamePath,
    });
    return {
      command,
      args,
      cwd: input.gamePath,
      version,
      mainClass: version.mainClass,
      nativesDirectory,
      classpathEntries,
      javaVersion,
      options,
    };
  }
}
