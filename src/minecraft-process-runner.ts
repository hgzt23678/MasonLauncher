import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import { createMinecraftProcessWatcher } from '@xmcl/core';
import {
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
  ) {}

  run(
    request: {
      command: string;
      args: readonly string[];
      cwd: string;
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
      throw spawnFailure(error, validated.command);
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
        .filter(Boolean)
        .slice(0, 50);
      for (const line of lines) {
        this.log(level, 'process', line, { stream });
      }
    };
    processHandle.stdout?.on('data', (chunk: Buffer) =>
      forward('debug', 'stdout', chunk),
    );
    processHandle.stderr?.on('data', (chunk: Buffer) =>
      forward('warn', 'stderr', chunk),
    );

    const watcher = createMinecraftProcessWatcher(processHandle);
    watcher.on('minecraft-window-ready', () => {
      this.log('info', 'process', 'Minecraftウィンドウの準備を検出しました。', {
        pid: processHandle.pid ?? null,
      });
      callbacks.onState({
        running: true,
        pid: processHandle.pid,
        message: 'Minecraftウィンドウを検出しました。',
      });
    });
    watcher.on(
      'minecraft-exit',
      ({ code, signal, crashReportLocation }) => {
        this.processHandle = undefined;
        const crashed = code !== 0;
        this.log(
          crashed ? 'error' : 'info',
          'process',
          crashed
            ? 'Minecraftが異常終了しました。'
            : 'Minecraftが正常終了しました。',
          {
            pid: processHandle.pid ?? null,
            exitCode: code,
            signal: signal || null,
            crashReportLocation: crashReportLocation || null,
          },
        );
        callbacks.onState({
          running: false,
          code,
          signal: signal || null,
          category: crashed ? 'crash' : undefined,
          message: crashed
            ? `Minecraftがコード ${code} で終了しました。`
            : 'Minecraftを終了しました。',
          crashReportLocation,
        });
      },
    );
    watcher.on('error', (error) => {
      this.processHandle = undefined;
      const failure = spawnFailure(error, validated.command);
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
