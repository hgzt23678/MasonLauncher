import {
  createWriteStream,
  promises as fs,
  type WriteStream,
} from 'node:fs';
import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import { createMinecraftProcessWatcher } from '@xmcl/core';
import {
  sanitizeDetail,
  sanitizeLogText,
  type LauncherLogLevel,
  type LauncherLogStage,
} from './diagnostics';
import {
  MinecraftError,
  type MinecraftErrorCategory,
} from './minecraft-errors';
import {
  validateSpawnRequest,
  type SpawnFunction,
} from './launcher-utils';

type LogWriter = (
  level: LauncherLogLevel,
  stage: LauncherLogStage,
  message: string,
  detail?: Record<string, unknown>,
) => void;

export type MinecraftProcessState = {
  running: boolean;
  pid?: number;
  code?: number | null;
  signal?: string | null;
  message: string;
  category?: MinecraftErrorCategory;
  crashReportLocation?: string;
};

type ProcessCallbacks = {
  onState: (state: MinecraftProcessState) => void;
};

export type MinecraftLaunchLogMetadata = {
  instanceId: string;
  versionId: string;
  javaPath: string;
  javaMajor: number | null;
  javaArch: string;
  gameDir: string;
  assetsDir: string;
  nativesDir: string;
  mainClass: string;
  classpathEntries: number;
  argumentCount: number;
  latestLogPath: string;
  launcherLogPath: string;
};

const redactArguments = (args: readonly string[]) => {
  let redactNext = false;
  return args.map((argument) => {
    if (redactNext) {
      redactNext = false;
      return '[REDACTED]';
    }
    if (/^--?(?:access[-_]?token|auth[-_]?access[-_]?token|session)$/i.test(argument)) {
      redactNext = true;
      return argument;
    }
    return sanitizeLogText(argument);
  });
};

const quoteForLog = (value: string) =>
  /[\s"]/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;

const spawnFailure = (error: unknown, command: string) => {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : undefined;
  if (code === 'ENOENT') {
    return new MinecraftError(
      `Java実行ファイルが見つかりません: ${command}`,
      'spawn',
      code,
      { command },
      { cause: error },
    );
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new MinecraftError(
      `Java実行ファイルを起動する権限がありません: ${command}`,
      'spawn',
      code,
      { command },
      { cause: error },
    );
  }
  return new MinecraftError(
    `Javaプロセスの起動に失敗しました: ${
      error instanceof Error ? error.message : String(error)
    }`,
    'spawn',
    code ?? 'SPAWN_FAILED',
    { command },
    { cause: error },
  );
};

export class MinecraftProcessRunner {
  private processHandle: ChildProcess | undefined;

  constructor(
    private readonly log: LogWriter = () => undefined,
    private readonly spawnProcess: SpawnFunction = (
      command,
      args = [],
      options,
    ) => spawn(command, args, options),
    private readonly now: () => number = Date.now,
  ) {}

  run(
    request: {
      command: string;
      args: readonly string[];
      cwd: string;
      metadata?: MinecraftLaunchLogMetadata;
    },
    callbacks: ProcessCallbacks,
  ) {
    if (this.processHandle) {
      throw new MinecraftError(
        'Minecraftはすでに起動中です。',
        'spawn',
        'PROCESS_ALREADY_RUNNING',
      );
    }
    const options: SpawnOptions = {
      cwd: request.cwd,
      shell: false,
      // java.exe runtimes would otherwise flash a console window on Windows.
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    const validated = validateSpawnRequest({
      command: request.command,
      args: request.args,
      options,
    });
    const redactedArgs = redactArguments(validated.args);
    let launchLog: WriteStream | undefined;
    const writeLaunchLog = (event: string, detail: Record<string, unknown>) => {
      if (!launchLog) return;
      launchLog.write(
        `${JSON.stringify({
          timestamp: new Date(this.now()).toISOString(),
          event,
          ...sanitizeDetail(detail),
        })}\n`,
      );
    };
    if (request.metadata) {
      launchLog = createWriteStream(request.metadata.launcherLogPath, {
        flags: 'a',
        encoding: 'utf8',
      });
      launchLog.on('error', (error) => {
        this.log('error', 'process', 'Failed to write the instance launch log.', {
          launcherLogPath: request.metadata?.launcherLogPath,
          message: error.message,
        });
      });
      writeLaunchLog('launch', {
        ...request.metadata,
        command: validated.command,
        commandLine: [validated.command, ...redactedArgs]
          .map(quoteForLog)
          .join(' '),
      });
    }
    this.log('info', 'spawn', 'Javaプロセスを起動します。', {
      command: validated.command,
      commandLine: [validated.command, ...redactedArgs]
        .map(quoteForLog)
        .join(' '),
      argumentCount: validated.args.length,
      cwd: validated.options?.cwd,
    });

    let processHandle: ChildProcess;
    try {
      processHandle = this.spawnProcess(
        validated.command,
        validated.args,
        validated.options,
      );
    } catch (error) {
      const failure = spawnFailure(error, validated.command);
      writeLaunchLog('spawn-error', {
        code: failure.code,
        message: failure.message,
      });
      launchLog?.end();
      throw failure;
    }
    this.processHandle = processHandle;

    const forward = (
      level: LauncherLogLevel,
      stream: 'stdout' | 'stderr',
      chunk: Buffer | string,
    ) => {
      const lines = chunk
        .toString()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      for (const line of lines) {
        this.log(level, 'process', line, { stream });
        writeLaunchLog(stream, { message: line });
      }
    };
    processHandle.stdout?.on('data', (chunk: Buffer) =>
      forward('debug', 'stdout', chunk),
    );
    processHandle.stderr?.on('data', (chunk: Buffer) =>
      forward('warn', 'stderr', chunk),
    );

    let windowEverAppeared = false;
    const spawnedAt = this.now();

    const watcher = createMinecraftProcessWatcher(processHandle);
    watcher.on('minecraft-window-ready', () => {
      windowEverAppeared = true;
      writeLaunchLog('minecraft-window-ready', {
        pid: processHandle.pid ?? null,
        detectedAt: new Date(this.now()).toISOString(),
        elapsedMs: this.now() - spawnedAt,
      });
      this.log('info', 'process', 'Minecraftウィンドウの準備を検出しました。', {
        pid: processHandle.pid ?? null,
        elapsedMs: this.now() - spawnedAt,
      });
      callbacks.onState({
        running: true,
        pid: processHandle.pid,
        message: 'Minecraftウィンドウを検出しました。',
      });
    });
    watcher.on(
      'minecraft-exit',
      async ({ code, signal, crashReportLocation }) => {
        this.processHandle = undefined;
        const elapsed = this.now() - spawnedAt;
        const abnormalCode = code !== 0 && code !== null;
        const killedBySignal = code === null && signal != null;
        const windowlessExit = !windowEverAppeared;
        const crashed = abnormalCode || killedBySignal || windowlessExit;
        const latestLogPath = request.metadata?.latestLogPath;
        const latestLog = latestLogPath
          ? await fs.stat(latestLogPath).then(
              (stat) => ({
                path: latestLogPath,
                exists: stat.isFile(),
                size: stat.size,
                modifiedAt: stat.mtime.toISOString(),
              }),
              () => ({ path: latestLogPath, exists: false, size: 0 }),
            )
          : undefined;
        const logMessage = abnormalCode
          ? `Minecraftが異常終了しました（コード ${code}）。`
          : killedBySignal
            ? `Minecraftがシグナル ${signal} で終了しました。`
            : windowlessExit
              ? 'Minecraftがウィンドウを表示せずに終了しました。正常起動ではない可能性が高いため、起動失敗として扱います。'
              : 'Minecraftが正常終了しました。';
        writeLaunchLog('exit', {
          pid: processHandle.pid ?? null,
          exitCode: code,
          signal: signal || null,
          elapsedMs: elapsed,
          windowEverAppeared,
          crashReportLocation: crashReportLocation || null,
          latestLog,
        });
        launchLog?.end();
        this.log(
          crashed ? 'error' : 'info',
          'process',
          logMessage,
          {
            pid: processHandle.pid ?? null,
            exitCode: code,
            signal: signal || null,
            crashReportLocation: crashReportLocation || null,
            elapsedMs: elapsed,
            windowEverAppeared,
            latestLog,
          },
        );
        callbacks.onState({
          running: false,
          code,
          signal: signal || null,
          category: crashed ? 'crash' : undefined,
          message: crashed ? logMessage : 'Minecraftを終了しました。',
          crashReportLocation,
        });
      },
    );
    watcher.on('error', (error) => {
      this.processHandle = undefined;
      const failure = spawnFailure(error, validated.command);
      writeLaunchLog('spawn-error', {
        code: failure.code,
        message: failure.message,
      });
      launchLog?.end();
      this.log('error', 'spawn', failure.message, {
        code: failure.code,
        command: validated.command,
      });
      callbacks.onState({
        running: false,
        category: failure.category,
        message: failure.message,
      });
    });

    this.log('info', 'spawn', 'Javaプロセスを起動しました。', {
      pid: processHandle.pid ?? null,
    });
    writeLaunchLog('spawn', { pid: processHandle.pid ?? null });
    callbacks.onState({
      running: true,
      pid: processHandle.pid,
      message: 'Minecraftを起動しました。',
    });
    return processHandle;
  }

  isRunning() {
    return Boolean(this.processHandle);
  }
}
