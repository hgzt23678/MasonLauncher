export type LauncherLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LauncherLogStage =
  | 'app'
  | 'settings'
  | 'java'
  | 'manifest'
  | 'files'
  | 'auth:microsoft'
  | 'auth:xbox'
  | 'auth:xsts'
  | 'auth:minecraft'
  | 'auth:ownership'
  | 'auth:profile'
  | 'arguments'
  | 'spawn'
  | 'process'
  | 'forge'
  | 'mods';

export type LauncherLogEntry = {
  id: number;
  timestamp: string;
  level: LauncherLogLevel;
  stage: LauncherLogStage;
  message: string;
  detail?: Record<string, unknown>;
};

type ErrorWithMetadata = Error & {
  code?: unknown;
  errno?: unknown;
  syscall?: unknown;
  path?: unknown;
  status?: unknown;
  stage?: unknown;
  error?: unknown;
};

const sensitiveKey = /token|authorization|password|secret|credential/i;

export const sanitizeLogText = (value: string) =>
  value
    .replace(
      /\b(access[_-]?token|token|authorization|password|secret)\s*[:=]\s*[^\s"'<>]+/gi,
      '$1=[REDACTED]',
    )
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/XBL3\.0\s+x=[^;\s]+;[^\s"'<>]+/gi, 'XBL3.0 [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[REDACTED]');

const sanitizeValue = (key: string, value: unknown): unknown => {
  if (sensitiveKey.test(key)) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    const sanitized = sanitizeLogText(value);
    return sanitized.length > 1000
      ? `${sanitized.slice(0, 1000)}...`
      : sanitized;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue('', item));
  }
  if (value && typeof value === 'object') {
    return sanitizeDetail(value as Record<string, unknown>);
  }
  return value;
};

export const sanitizeDetail = (
  detail: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(detail).map(([key, value]) => [
      key,
      sanitizeValue(key, value),
    ]),
  );

export const describeError = (error: unknown): Record<string, unknown> => {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }
  const value = error as ErrorWithMetadata;
  return sanitizeDetail({
    name: error.name,
    message: error.message,
    code: value.code,
    errno: value.errno,
    syscall: value.syscall,
    path: value.path,
    status: value.status,
    stage: value.stage,
    errorType: value.error,
  });
};

export class LauncherDiagnostics {
  private entries: LauncherLogEntry[] = [];
  private nextId = 1;

  constructor(
    private readonly broadcast: (entry: LauncherLogEntry) => void,
    private readonly limit = 500,
  ) {}

  log(
    level: LauncherLogLevel,
    stage: LauncherLogStage,
    message: string,
    detail?: Record<string, unknown>,
  ) {
    const entry: LauncherLogEntry = {
      id: this.nextId++,
      timestamp: new Date().toISOString(),
      level,
      stage,
      message: sanitizeLogText(message),
      detail: detail ? sanitizeDetail(detail) : undefined,
    };
    this.entries.push(entry);
    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit);
    }
    this.broadcast(entry);

    const output = `[${entry.stage}] ${entry.message}`;
    if (level === 'error') {
      console.error(output, entry.detail ?? '');
    } else if (level === 'warn') {
      console.warn(output, entry.detail ?? '');
    } else if (level === 'debug') {
      console.debug(output, entry.detail ?? '');
    } else {
      console.info(output, entry.detail ?? '');
    }
    return entry;
  }

  error(
    stage: LauncherLogStage,
    message: string,
    error: unknown,
    detail?: Record<string, unknown>,
  ) {
    return this.log('error', stage, message, {
      ...detail,
      error: describeError(error),
    });
  }

  getEntries() {
    return [...this.entries];
  }

  clear() {
    this.entries = [];
  }
}
