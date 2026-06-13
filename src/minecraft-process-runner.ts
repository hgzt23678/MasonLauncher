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
import path from 'node:path';
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
  minMemoryMb: number;
  maxMemoryMb: number;
  freeMemoryMb: number;
  totalMemoryMb: number;
  nativeFileCount: number;
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

export type MinecraftRuntimeDiagnosis = {
  category: Extract<
    MinecraftErrorCategory,
    'graphics' | 'memory' | 'natives'
  >;
  code: string;
  message: string;
  matchedLine: string;
};

export const classifyMinecraftRuntimeLog = (
  line: string,
): MinecraftRuntimeDiagnosis | undefined => {
  const sanitized = sanitizeLogText(line);
  if (
    /GLFW error 6554[23]|Failed to create (?:the )?window|Could not create (?:OpenGL )?context|WGL:|GLX:|OpenGL.*(?:not supported|failed)|Pixel format (?:not accelerated|not supported)/i.test(
      sanitized,
    )
  ) {
    return {
      category: 'graphics',
      code: /65542/.test(sanitized)
        ? 'GLFW_OPENGL_UNAVAILABLE'
        : /65543/.test(sanitized)
          ? 'GLFW_OPENGL_VERSION_UNAVAILABLE'
          : 'GRAPHICS_INITIALIZATION_FAILED',
      message:
        'Minecraftのグラフィック初期化に失敗しました。GPUドライバとOpenGL対応状況を確認してください。',
      matchedLine: sanitized,
    };
  }
  if (
    /Could not reserve enough space for object heap|java\.lang\.OutOfMemoryError|Java heap space|GC overhead limit exceeded|Metaspace|Out of swap space\?|unable to create native thread|os::commit_memory failed/i.test(
      sanitized,
    )
  ) {
    return {
      category: 'memory',
      code: 'JAVA_MEMORY_ALLOCATION_FAILED',
      message:
        'Minecraftのメモリ確保に失敗しました。Xmx/Xmsを下げ、空き物理メモリを確認してください。',
      matchedLine: sanitized,
    };
  }
  if (
    /UnsatisfiedLinkError|no .+ in java\.library\.path|Failed to load .*(?:dll|native)|LWJGL.*(?:failed|error)/i.test(
      sanitized,
    )
  ) {
    return {
      category: 'natives',
      code: 'NATIVE_LIBRARY_LOAD_FAILED',
      message:
        'MinecraftのLWJGL/native library読み込みに失敗しました。nativesを再展開してください。',
      matchedLine: sanitized,
    };
  }
  return undefined;
};

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

const findHotSpotErrorLogs = async (gameDirectory: string) => {
  try {
    const files = await fs.readdir(gameDirectory, { withFileTypes: true });
    return await Promise.all(
      files
        .filter(
          (entry) =>
            entry.isFile() && /^hs_err_pid\d+\.log$/i.test(entry.name),
        )
        .map(async (entry) => {
          const target = path.join(gameDirectory, entry.name);
          const stat = await fs.stat(target);
          return {
            path: target,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          };
        }),
    );
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
    private readonly windowConfirmationDurationMs = 2_000,
    private readonly windowProbeIntervalMs = 1_000,
    private readonly windowProbeTimeoutMs = 300_000,
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
      // STARTF_USESHOWWINDOW/SW_HIDE also hides LWJGL's first GUI window.
      // Minecraft uses javaw.exe on Windows to avoid a console window instead.
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    const validated = validateSpawnRequest({
      command: request.command,
      args: request.args,
      options,
    });
    const redactedArgs = redactArguments(validated.args);
    const effectiveXms =
      [...validated.args].reverse().find((argument) => /^-Xms/i.test(argument)) ??
      null;
    const effectiveXmx =
      [...validated.args].reverse().find((argument) => /^-Xmx/i.test(argument)) ??
      null;
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
        effectiveXms,
        effectiveXmx,
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
      effectiveXms,
      effectiveXmx,
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
    let pendingWindow:
      | { pid: number; handle: number; firstSeenAt: number }
      | undefined;
    let runtimeDiagnosis: MinecraftRuntimeDiagnosis | undefined;
    let stopped = false;
    let probeTimer: NodeJS.Timeout | undefined;
    let latestLogTimer: NodeJS.Timeout | undefined;
    let latestLogSeen = false;
    let windowCandidateSeen = false;
    let windowUnverifiedWarningSent = false;
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
        if (!runtimeDiagnosis) {
          runtimeDiagnosis = classifyMinecraftRuntimeLog(line);
          if (runtimeDiagnosis) {
            writeLaunchLog('runtime-diagnosis', runtimeDiagnosis);
            this.log(
              'error',
              'process',
              runtimeDiagnosis.message,
              runtimeDiagnosis,
            );
            callbacks.onState({
              running: true,
              pid: processHandle.pid,
              category: runtimeDiagnosis.category,
              message: runtimeDiagnosis.message,
            });
          }
        }
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
        const checkedAt = this.now();
        if (
          !pendingWindow ||
          pendingWindow.pid !== candidate.pid ||
          pendingWindow.handle !== candidate.handle
        ) {
          pendingWindow = {
            pid: candidate.pid,
            handle: candidate.handle,
            firstSeenAt: checkedAt,
          };
          writeLaunchLog('window-visible-candidate', {
            window: candidate,
            firstSeenAt: new Date(checkedAt).toISOString(),
            requiredDurationMs: this.windowConfirmationDurationMs,
          });
        } else if (
          checkedAt - pendingWindow.firstSeenAt >=
          this.windowConfirmationDurationMs
        ) {
          windowConfirmed = true;
          windowConfirmedAt = checkedAt;
          confirmedWindow = candidate;
          this.log('info', 'process', 'Minecraft画面を確認しました。', {
            pid,
            window: candidate,
            visibleDurationMs: checkedAt - pendingWindow.firstSeenAt,
            elapsedMs: checkedAt - spawnedAt,
          });
          callbacks.onState({
            running: true,
            pid,
            message: 'Minecraft画面を確認しました。プレイ中です。',
          });
          return;
        }
      } else {
        pendingWindow = undefined;
      }
      if (result.error) {
        this.log('warn', 'process', 'Minecraft画面の確認に失敗しました。', {
          pid,
          message: result.error,
        });
      }
      const elapsedMs = this.now() - spawnedAt;
      if (!windowUnverifiedWarningSent && elapsedMs >= 30_000) {
        windowUnverifiedWarningSent = true;
        writeLaunchLog('window-unverified-warning', {
          pid,
          elapsedMs,
          candidates: result.candidates,
        });
        callbacks.onState({
          running: true,
          pid,
          category: 'window-unverified',
          message:
            'Minecraftプロセスは起動していますが、画面表示をまだ確認できません。',
        });
      }
      if (result.supported && elapsedMs < this.windowProbeTimeoutMs) {
        probeTimer = setTimeout(
          () => void pollForWindow(),
          this.windowProbeIntervalMs,
        );
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
      runtimeDiagnosis ??= latestLogTail
        .map(classifyMinecraftRuntimeLog)
        .find((diagnosis) => diagnosis !== undefined);
      const hotSpotErrorLogs = request.metadata?.gameDir
        ? await findHotSpotErrorLogs(request.metadata.gameDir)
        : [];
      const logMessage = runtimeDiagnosis
        ? runtimeDiagnosis.message
        : abnormalCode
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
        runtimeDiagnosis: runtimeDiagnosis ?? null,
        hotSpotErrorLogs,
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
        runtimeDiagnosis || crashed
          ? 'error'
          : windowUnverified
            ? 'warn'
            : 'info',
        'process',
        logMessage,
        exitDetail,
      );
      callbacks.onState({
        running: false,
        code,
        signal: signal || null,
        category: runtimeDiagnosis?.category ?? category,
        message:
          runtimeDiagnosis || category
            ? logMessage
            : 'Minecraftを終了しました。',
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
