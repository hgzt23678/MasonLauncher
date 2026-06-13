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
import {
  isConfirmedMinecraftWindow,
  probeMinecraftWindow,
  type MinecraftWindowProbe,
  type WindowProbeCandidate,
} from './minecraft-window-probe';

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

const clientInitPatterns = [
  'Missing metadata in pack',
  'Registering resource reload listener',
  'Reloading ResourceManager',
  'LWJGL Version: ',
  'OpenAL initialized.',
  ' Preparing level ',
];

const mainClassPatterns = [
  'Launching wrapped minecraft',
  'Setting user:',
  'LWJGL Version:',
  'Backend library:',
];

const appendRingLine = (lines: string[], line: string, limit = 200) => {
  lines.push(sanitizeLogText(line));
  if (lines.length > limit) {
    lines.splice(0, lines.length - limit);
  }
};

const readLogTail = async (target: string, lineLimit = 100) => {
  try {
    const handle = await fs.open(target, 'r');
    try {
      const stat = await handle.stat();
      const length = Math.min(stat.size, 64 * 1024);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, stat.size - length);
      return buffer
        .toString('utf8')
        .split(/\r?\n/u)
        .filter(Boolean)
        .slice(-lineLimit)
        .map(sanitizeLogText);
    } finally {
      await handle.close();
    }
  } catch {
    return [];
  }
};

const quotePowerShellLiteral = (value: string) =>
  `'${value.replaceAll("'", "''")}'`;

export const buildPowerShellReproductionScript = (
  command: string,
  args: readonly string[],
  cwd: string,
) => {
  let redactNext = false;
  let requiresSecret = false;
  const argumentLines = args.map((argument) => {
    if (redactNext) {
      redactNext = false;
      return '  $env:MASON_MC_ACCESS_TOKEN';
    }
    if (/^--?(?:access[-_]?token|auth[-_]?access[-_]?token|session)$/i.test(argument)) {
      redactNext = true;
      requiresSecret = true;
    }
    return `  ${quotePowerShellLiteral(sanitizeLogText(argument))}`;
  });
  return [
    "$ErrorActionPreference = 'Stop'",
    ...(requiresSecret
      ? [
          "if (-not $env:MASON_MC_ACCESS_TOKEN) {",
          "  throw 'Set MASON_MC_ACCESS_TOKEN for the current authenticated session before running this script.'",
          '}',
        ]
      : []),
    `$java = ${quotePowerShellLiteral(command)}`,
    `$workingDirectory = ${quotePowerShellLiteral(cwd)}`,
    '$arguments = @(',
    ...argumentLines,
    ')',
    'Push-Location -LiteralPath $workingDirectory',
    'try {',
    '  & $java @arguments',
    '  exit $LASTEXITCODE',
    '} finally {',
    '  Pop-Location',
    '}',
    '',
  ].join('\r\n');
};

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
    private readonly windowProbe: MinecraftWindowProbe = probeMinecraftWindow,
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
      const reproductionScriptPath =
        `${request.metadata.launcherLogPath}.repro.ps1`;
      void fs
        .writeFile(
          reproductionScriptPath,
          buildPowerShellReproductionScript(
            validated.command,
            validated.args,
            request.cwd,
          ),
          'utf8',
        )
        .catch((error: unknown) => {
          this.log(
            'warn',
            'process',
            'PowerShell再現用スクリプトを保存できませんでした。',
            {
              path: reproductionScriptPath,
              message: error instanceof Error ? error.message : String(error),
            },
          );
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

    const stdoutTail: string[] = [];
    const stderrTail: string[] = [];
    let mainClassOutputSeen = false;
    let clientInitLogSeen = false;
    let clientInitTriggerLine: string | undefined;
    let windowConfirmed = false;
    let windowConfirmedAt: number | undefined;
    let confirmedWindow: WindowProbeCandidate | undefined;
    let stopped = false;
    let probeTimer: NodeJS.Timeout | undefined;
    let latestLogTimer: NodeJS.Timeout | undefined;
    let latestLogSeen = false;
    let windowCandidateSeen = false;
    const spawnedAt = this.now();

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
        appendRingLine(stream === 'stdout' ? stdoutTail : stderrTail, line);
        this.log(level, 'process', line, { stream });
        writeLaunchLog(stream, { message: line });
        if (
          stream === 'stdout' &&
          !mainClassOutputSeen &&
          mainClassPatterns.some((pattern) => line.includes(pattern))
        ) {
          mainClassOutputSeen = true;
          writeLaunchLog('main-class-output', {
            pid: processHandle.pid ?? null,
            mainClass: request.metadata?.mainClass ?? null,
            triggerLine: sanitizeLogText(line),
            detectedAt: new Date(this.now()).toISOString(),
            elapsedMs: this.now() - spawnedAt,
          });
          callbacks.onState({
            running: true,
            pid: processHandle.pid,
            message: 'Minecraft mainClassの実行ログを確認しました。',
          });
        }
        if (
          stream === 'stdout' &&
          !clientInitLogSeen &&
          clientInitPatterns.some((pattern) => line.includes(pattern))
        ) {
          clientInitLogSeen = true;
          clientInitTriggerLine = sanitizeLogText(line);
          writeLaunchLog('client-init-log', {
            pid: processHandle.pid ?? null,
            triggerLine: clientInitTriggerLine,
            detectedAt: new Date(this.now()).toISOString(),
            elapsedMs: this.now() - spawnedAt,
          });
          this.log(
            'info',
            'process',
            'Minecraftクライアントの初期化ログを検出しました。画面表示はまだ確認していません。',
            {
              pid: processHandle.pid ?? null,
              triggerLine: clientInitTriggerLine,
              elapsedMs: this.now() - spawnedAt,
            },
          );
          callbacks.onState({
            running: true,
            pid: processHandle.pid,
            message:
              'Minecraftクライアントの初期化ログを検出しました（画面表示は未確認）。',
          });
        }
      }
    };
    processHandle.stdout?.on('data', (chunk: Buffer) =>
      forward('debug', 'stdout', chunk),
    );
    processHandle.stderr?.on('data', (chunk: Buffer) =>
      forward('warn', 'stderr', chunk),
    );

    const stopWindowProbe = () => {
      stopped = true;
      if (probeTimer) {
        clearTimeout(probeTimer);
        probeTimer = undefined;
      }
      if (latestLogTimer) {
        clearTimeout(latestLogTimer);
        latestLogTimer = undefined;
      }
    };
    const pollForLatestLog = async (): Promise<void> => {
      const latestLogPath = request.metadata?.latestLogPath;
      if (stopped || latestLogSeen || !latestLogPath) return;
      try {
        const stat = await fs.stat(latestLogPath);
        if (
          stat.isFile() &&
          stat.size > 0 &&
          stat.mtimeMs >= spawnedAt - 1_000
        ) {
          latestLogSeen = true;
          writeLaunchLog('latest-log-detected', {
            path: latestLogPath,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            elapsedMs: this.now() - spawnedAt,
          });
          callbacks.onState({
            running: true,
            pid: processHandle.pid,
            message: 'Minecraft latest.logの更新を確認しました。',
          });
          return;
        }
      } catch {
        // The game creates latest.log after the logging subsystem starts.
      }
      if (this.now() - spawnedAt < 60_000) {
        latestLogTimer = setTimeout(() => void pollForLatestLog(), 500);
      }
    };
    const pollForWindow = async (): Promise<void> => {
      const pid = processHandle.pid;
      if (stopped || !pid || windowConfirmed) return;
      const result = await this.windowProbe(pid);
      if (stopped) return;
      const candidate = result.candidates.find(isConfirmedMinecraftWindow);
      writeLaunchLog('window-probe', {
        ...result,
        confirmed: Boolean(candidate),
      });
      if (!windowCandidateSeen && result.candidates.length > 0) {
        windowCandidateSeen = true;
        callbacks.onState({
          running: true,
          pid,
          message:
            'Minecraftウィンドウ候補を検出しました（表示条件を確認中）。',
        });
      }
      if (candidate) {
        windowConfirmed = true;
        windowConfirmedAt = this.now();
        confirmedWindow = candidate;
        this.log('info', 'process', 'Minecraft画面を確認しました。', {
          pid,
          window: candidate,
          elapsedMs: this.now() - spawnedAt,
        });
        callbacks.onState({
          running: true,
          pid,
          message: 'Minecraft画面を確認しました。プレイ中です。',
        });
        return;
      }
      if (result.error) {
        this.log('warn', 'process', 'Minecraft画面の確認に失敗しました。', {
          pid,
          message: result.error,
        });
      }
      if (result.supported && this.now() - spawnedAt < 60_000) {
        probeTimer = setTimeout(() => void pollForWindow(), 1_000);
      }
    };
    if (request.metadata && processHandle.pid) {
      void pollForWindow();
      void pollForLatestLog();
    }

    const watcher = createMinecraftProcessWatcher(processHandle);
    watcher.on('minecraft-window-ready', () => {
      writeLaunchLog('xmcl-client-init-event', {
        pid: processHandle.pid ?? null,
        detectedAt: new Date(this.now()).toISOString(),
        elapsedMs: this.now() - spawnedAt,
        triggerLine: clientInitTriggerLine ?? null,
      });
    });
    let settled = false;
    const finalizeExit = async (
      code: number | null,
      signal: NodeJS.Signals | null,
      crashReportLocation: string | undefined,
      source: 'xmcl-watcher' | 'child-exit' | 'child-close',
    ) => {
      if (settled) return;
      settled = true;
      stopWindowProbe();
      this.processHandle = undefined;
      const elapsed = this.now() - spawnedAt;
      const abnormalCode = code !== 0 && code !== null;
      const killedBySignal = code === null && signal != null;
      const windowUnverified = !windowConfirmed;
      const shortLivedConfirmedWindow =
        windowConfirmedAt !== undefined &&
        this.now() - windowConfirmedAt < 3_000;
      const crashed =
        abnormalCode ||
        killedBySignal ||
        shortLivedConfirmedWindow ||
        (windowUnverified && !clientInitLogSeen);
      const category: MinecraftErrorCategory | undefined = crashed
        ? 'crash'
        : windowUnverified
          ? 'window-unverified'
          : undefined;
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
      const latestLogTail = latestLogPath
        ? await readLogTail(latestLogPath)
        : [];
      const logMessage = abnormalCode
        ? `Minecraftが異常終了しました（コード ${code}）。`
        : killedBySignal
          ? `Minecraftがシグナル ${signal} で終了しました。`
          : shortLivedConfirmedWindow
            ? 'Minecraft画面を確認しましたが、直後にプロセスが終了しました。起動失敗として扱います。'
          : windowUnverified
            ? clientInitLogSeen
              ? 'Minecraftクライアントは初期化されましたが、画面表示を確認できないまま終了しました。正常起動として扱いません。'
              : 'Minecraftが画面を表示せずに終了しました。正常起動ではない可能性が高いため、起動失敗として扱います。'
            : 'Minecraftが正常終了しました。';
      const exitDetail = {
        pid: processHandle.pid ?? null,
        source,
        endedAt: new Date(this.now()).toISOString(),
        exitCode: code,
        signal: signal || null,
        elapsedMs: elapsed,
        mainClassOutputSeen,
        latestLogSeen,
        clientInitLogSeen,
        clientInitTriggerLine: clientInitTriggerLine ?? null,
        windowCandidateSeen,
        windowConfirmed,
        windowConfirmedAt:
          windowConfirmedAt === undefined
            ? null
            : new Date(windowConfirmedAt).toISOString(),
        shortLivedConfirmedWindow,
        confirmedWindow: confirmedWindow ?? null,
        crashReportLocation: crashReportLocation || null,
        latestLog,
        latestLogTail,
        stdoutTail,
        stderrTail,
      };
      if (launchLog) {
        const exitRecord = `${JSON.stringify({
          timestamp: new Date(this.now()).toISOString(),
          event: 'exit',
          ...sanitizeDetail(exitDetail),
        })}\n`;
        try {
          await new Promise<void>((resolve, reject) => {
            launchLog?.write(exitRecord, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
          await new Promise<void>((resolve) => launchLog?.end(resolve));
        } catch (error) {
          this.log(
            'warn',
            'process',
            '終了診断をインスタンス起動ログへ保存できませんでした。',
            {
              launcherLogPath: request.metadata?.launcherLogPath,
              message: error instanceof Error ? error.message : String(error),
            },
          );
          launchLog.destroy();
        }
      }
      this.log(
        crashed ? 'error' : windowUnverified ? 'warn' : 'info',
        'process',
        logMessage,
        exitDetail,
      );
      callbacks.onState({
        running: false,
        code,
        signal: signal || null,
        category,
        message: category ? logMessage : 'Minecraftを終了しました。',
        crashReportLocation,
      });
    };
    let xmclCrashReportLocation: string | undefined;
    watcher.on('minecraft-exit', ({ code, signal, crashReportLocation }) => {
      xmclCrashReportLocation = crashReportLocation;
      queueMicrotask(() => {
        void finalizeExit(
          code,
          signal as NodeJS.Signals | null,
          crashReportLocation,
          'xmcl-watcher',
        );
      });
    });
    const handleProcessError = (error: Error) => {
      if (settled) return;
      settled = true;
      stopWindowProbe();
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
    };
    watcher.on('error', handleProcessError);
    processHandle.once('error', handleProcessError);
    processHandle.once('exit', (code, signal) => {
      void finalizeExit(
        code,
        signal,
        xmclCrashReportLocation,
        'child-exit',
      );
    });
    processHandle.once('close', (code, signal) => {
      void finalizeExit(
        code,
        signal,
        xmclCrashReportLocation,
        'child-close',
      );
    });

    this.log('info', 'spawn', 'Javaプロセスを起動しました。', {
      pid: processHandle.pid ?? null,
    });
    writeLaunchLog('spawn', { pid: processHandle.pid ?? null });
    callbacks.onState({
      running: true,
      pid: processHandle.pid,
      message: 'Minecraft Javaプロセスを起動しました（画面表示は未確認）。',
    });
    return processHandle;
  }

  isRunning() {
    return Boolean(this.processHandle);
  }
}
