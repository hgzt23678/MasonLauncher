const microsoftClientIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULT_MICROSOFT_CLIENT_ID =
  '3e5f960a-e06a-45a3-88c4-82c9288dacaf';

export const resolveBuildMicrosoftClientId = (
  ...configuredClientIds: unknown[]
) =>
  configuredClientIds
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .find(Boolean) ?? DEFAULT_MICROSOFT_CLIENT_ID;

export const isMicrosoftClientId = (value: unknown): value is string =>
  typeof value === 'string' && microsoftClientIdPattern.test(value.trim());

export const resolveMicrosoftClientId = (
  configuredClientId: unknown,
  embeddedClientId: string,
) =>
  typeof configuredClientId === 'string'
    ? configuredClientId.trim()
    : embeddedClientId.trim();

export const shouldResetAuthCache = (
  activeClientId: string,
  persistedClientId: string,
  nextClientId: string,
) =>
  (activeClientId.length > 0 && activeClientId !== nextClientId) ||
  (persistedClientId.length > 0 && persistedClientId !== nextClientId);
