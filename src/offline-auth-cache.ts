export const OFFLINE_AUTH_CACHE_DAYS = 30;
export const OFFLINE_AUTH_CACHE_TTL_MS =
  OFFLINE_AUTH_CACHE_DAYS * 24 * 60 * 60 * 1000;

export type OfflineAuthCache = {
  schemaVersion: 1;
  clientId: string;
  xuid: string;
  profile: {
    id: string;
    name: string;
    skins: Array<{
      id: string;
      state: string;
      url: string;
      variant: string;
    }>;
    capes: Array<{
      id: string;
      state: string;
      url: string;
      alias: string;
    }>;
  };
  microsoftAuthenticatedAt: string;
  minecraftServicesAuthenticatedAt: string;
  ownershipVerifiedAt: string;
  profileVerifiedAt: string;
  expiresAt: string;
};

export type OfflineEligibility = {
  allowed: boolean;
  reason:
    | 'allowed'
    | 'not-configured'
    | 'missing-cache'
    | 'client-id-mismatch'
    | 'invalid-profile'
    | 'ownership-unverified'
    | 'cache-expired';
  message: string;
  ownershipVerifiedAt: string | null;
  expiresAt: string | null;
};

export const createOfflineAuthCache = (
  input: Pick<OfflineAuthCache, 'clientId' | 'xuid' | 'profile'>,
  now = new Date(),
): OfflineAuthCache => {
  const verifiedAt = now.toISOString();
  return {
    schemaVersion: 1,
    ...input,
    microsoftAuthenticatedAt: verifiedAt,
    minecraftServicesAuthenticatedAt: verifiedAt,
    ownershipVerifiedAt: verifiedAt,
    profileVerifiedAt: verifiedAt,
    expiresAt: new Date(now.getTime() + OFFLINE_AUTH_CACHE_TTL_MS).toISOString(),
  };
};

export const evaluateOfflineEligibility = (
  cache: OfflineAuthCache | null,
  clientId: string,
  now = new Date(),
): OfflineEligibility => {
  if (!clientId.trim()) {
    return {
      allowed: false,
      reason: 'not-configured',
      message: 'Microsoft Application ID is not configured.',
      ownershipVerifiedAt: null,
      expiresAt: null,
    };
  }
  if (!cache) {
    return {
      allowed: false,
      reason: 'missing-cache',
      message: 'A completed Microsoft login and ownership check is required.',
      ownershipVerifiedAt: null,
      expiresAt: null,
    };
  }
  const base = {
    ownershipVerifiedAt: cache.ownershipVerifiedAt || null,
    expiresAt: cache.expiresAt || null,
  };
  if (cache.clientId !== clientId) {
    return {
      allowed: false,
      reason: 'client-id-mismatch',
      message: 'The cached authorization belongs to another Application ID.',
      ...base,
    };
  }
  if (
    !cache.profile?.id ||
    !cache.profile?.name ||
    !cache.xuid ||
    !cache.profileVerifiedAt
  ) {
    return {
      allowed: false,
      reason: 'invalid-profile',
      message: 'The cached official Minecraft profile is incomplete.',
      ...base,
    };
  }
  if (!cache.ownershipVerifiedAt) {
    return {
      allowed: false,
      reason: 'ownership-unverified',
      message: 'Minecraft Java ownership has not been verified.',
      ...base,
    };
  }
  const expiresAt = Date.parse(cache.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    return {
      allowed: false,
      reason: 'cache-expired',
      message: `The cached ownership check expired after ${OFFLINE_AUTH_CACHE_DAYS} days.`,
      ...base,
    };
  }
  return {
    allowed: true,
    reason: 'allowed',
    message:
      'Cached authenticated offline launch is available for single-player use.',
    ...base,
  };
};

