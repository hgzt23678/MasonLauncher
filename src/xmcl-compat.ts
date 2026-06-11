import { errors } from 'undici';

type LegacyResponseStatusCodeErrorConstructor = new (
  message: string,
  statusCode: number,
  headers: Record<string, string | string[] | undefined>,
  body: string,
) => Error;

type UndiciErrorsWithLegacyStatus = typeof errors & {
  ResponseStatusCodeError?: LegacyResponseStatusCodeErrorConstructor;
};

export const installXmclUndiciCompatibility = () => {
  const compatibleErrors = errors as UndiciErrorsWithLegacyStatus;
  if (compatibleErrors.ResponseStatusCodeError) return;

  compatibleErrors.ResponseStatusCodeError = class
    extends Error {
    readonly statusCode: number;
    readonly headers: Record<string, string | string[] | undefined>;
    readonly body: string;

    constructor(
      message: string,
      statusCode: number,
      headers: Record<string, string | string[] | undefined>,
      body: string,
    ) {
      super(message || `HTTP ${statusCode}`);
      this.name = 'ResponseStatusCodeError';
      this.statusCode = statusCode;
      this.headers = headers;
      this.body = body;
    }
  };
};
