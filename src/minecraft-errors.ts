export type MinecraftErrorCategory =
  | 'authentication'
  | 'ownership'
  | 'manifest'
  | 'download'
  | 'network'
  | 'verification'
  | 'json'
  | 'java'
  | 'arguments'
  | 'spawn'
  | 'crash';

export class MinecraftError extends Error {
  constructor(
    message: string,
    readonly category: MinecraftErrorCategory,
    readonly code?: string,
    readonly detail?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MinecraftError';
  }
}

type ErrorMetadata = {
  code?: unknown;
  name?: unknown;
};

const getErrorCode = (error: unknown) => {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as ErrorMetadata).code;
  return typeof code === 'string' ? code : undefined;
};

export const classifyRequestFailure = (
  error: unknown,
  label: string,
  url: string,
) => {
  if (error instanceof MinecraftError) return error;

  const code = getErrorCode(error);
  const causeCode =
    error instanceof Error ? getErrorCode(error.cause) : undefined;
  const effectiveCode = code ?? causeCode;

  if (
    effectiveCode === 'ENOTFOUND' ||
    effectiveCode === 'EAI_AGAIN' ||
    effectiveCode === 'ENETUNREACH'
  ) {
    return new MinecraftError(
      `${label} の取得に失敗しました: DNSまたはネットワークへ接続できません。`,
      'network',
      effectiveCode,
      { url },
      { cause: error },
    );
  }
  if (
    effectiveCode === 'ETIMEDOUT' ||
    effectiveCode === 'UND_ERR_CONNECT_TIMEOUT' ||
    (error instanceof Error && error.name === 'AbortError')
  ) {
    return new MinecraftError(
      `${label} の取得がタイムアウトしました。`,
      'network',
      'ETIMEDOUT',
      { url },
      { cause: error },
    );
  }
  return new MinecraftError(
    `${label} の取得に失敗しました: ${
      error instanceof Error ? error.message : String(error)
    }`,
    'network',
    effectiveCode ?? 'NETWORK_ERROR',
    { url },
    { cause: error },
  );
};

export const toMinecraftError = (
  error: unknown,
  fallbackCategory: MinecraftErrorCategory,
  fallbackMessage: string,
) =>
  error instanceof MinecraftError
    ? error
    : new MinecraftError(
        error instanceof Error ? error.message : fallbackMessage,
        fallbackCategory,
        getErrorCode(error),
        undefined,
        { cause: error },
      );
