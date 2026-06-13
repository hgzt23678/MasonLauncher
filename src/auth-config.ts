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
