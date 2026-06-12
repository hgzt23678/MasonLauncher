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
  jvmArgs?: string[];
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

export const parseJavaMajorVersion = (versionLine: string) => {
  const match = versionLine.match(/version\s+"([^"]+)"/i);
  if (!match) return undefined;
  const parts = match[1].split(/[._+-]/);
  const first = Number.parseInt(parts[0], 10);
  if (!Number.isFinite(first)) return undefined;
  if (first === 1) {
    const legacy = Number.parseInt(parts[1], 10);
    return Number.isFinite(legacy) ? legacy : undefined;
  }
  return first;
};

export const resolveMicrosoftLaunchPlaceholders = (
  values: readonly string[],
  session: Pick<MinecraftSession, 'clientId' | 'xuid'>,
) => {
  if (!session.clientId.trim()) {
    throw new MinecraftError(
      'Microsoft Application IDが起動セッションにありません。',
      'arguments',
      'MISSING_CLIENT_ID',
    );
  }
  if (!session.xuid.trim()) {
    throw new MinecraftError(
      'Xbox User IDが起動セッションにありません。',
      'arguments',
      'MISSING_XUID',
    );
  }
  return values.map((value) =>
    value
      .replaceAll('${clientid}', session.clientId)
      .replaceAll('${auth_xuid}', session.xuid),
  );
};

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
    if (
      input.session.mode !== 'online' &&
      input.session.mode !== 'authenticated-offline'
    ) {
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
    if (!version.mainClass?.trim()) {
      throw new MinecraftError(
        `Minecraft version ${input.versionId} does not define a mainClass.`,
        'arguments',
        'MAIN_CLASS_MISSING',
        { versionId: input.versionId },
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
      generated = resolveMicrosoftLaunchPlaceholders(
        generated,
        input.session,
      );
    } catch (error) {
      if (error instanceof MinecraftError) throw error;
      throw new MinecraftError(
        'Minecraft起動引数の生成に失敗しました。',
        'arguments',
        'ARGUMENT_GENERATION_FAILED',
        { versionId: input.versionId },
        { cause: error },
      );
    }
    const [command, ...args] = generated;
    // Profile-level extra JVM arguments go right before the main class so
    // they participate in JVM startup without disturbing game arguments.
    const extraJvmArgs = (input.settings.jvmArgs ?? []).filter((argument) =>
      argument.trim(),
    );
    if (extraJvmArgs.length > 0) {
      const mainClassIndex = args.indexOf(version.mainClass);
      if (mainClassIndex >= 0) {
        args.splice(mainClassIndex, 0, ...extraJvmArgs);
      }
    }
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
    const classpathFlag = args.findIndex(
      (argument) => argument === '-cp' || argument === '-classpath',
    );
    const generatedClasspath =
      classpathFlag >= 0 ? args[classpathFlag + 1] : undefined;
    if (!generatedClasspath?.trim()) {
      throw new MinecraftError(
        `Minecraft version ${input.versionId} did not produce a classpath.`,
        'arguments',
        'CLASSPATH_BUILD_FAILED',
        { versionId: input.versionId },
      );
    }
    const javaVersion = await readJavaVersion(command);
    const javaMajorVersion = parseJavaMajorVersion(javaVersion);
    // javaVersion may be absent for very old MC versions; skip check when absent.
    const requiredMajorVersion = version.javaVersion?.majorVersion;
    if (
      javaMajorVersion !== undefined &&
      requiredMajorVersion !== undefined &&
      requiredMajorVersion > 0 &&
      javaMajorVersion !== requiredMajorVersion
    ) {
      throw new MinecraftError(
        `Java ${requiredMajorVersion} is required, but Java ${javaMajorVersion} was selected.\n` +
          `必要Java: Java ${requiredMajorVersion}\n現在選択Java: Java ${javaMajorVersion} (${command})\n` +
          '解決方法: プロファイルのJava設定を「自動」へ戻すか、必要なJavaを「Javaランタイム管理」からインストールしてください。',
        'java',
        'JAVA_VERSION_MISMATCH',
        {
          javaPath: command,
          requiredMajorVersion,
          actualMajorVersion: javaMajorVersion,
        },
      );
    }
    const classpathEntries = generatedClasspath
      .split(path.delimiter)
      .filter(Boolean).length;
    this.log('info', 'java', 'Minecraftで使用するJavaを確認しました。', {
      executable: command,
      version: javaVersion,
      requiredMajorVersion: version.javaVersion?.majorVersion,
    });
    this.log('info', 'arguments', 'Minecraft起動引数を生成しました。', {
      versionId: version.id,
      mainClass: version.mainClass,
      classpathEntries,
      nativesDirectory,
      argumentCount: args.length,
      cwd: input.gamePath,
      sessionMode: input.session.mode,
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
