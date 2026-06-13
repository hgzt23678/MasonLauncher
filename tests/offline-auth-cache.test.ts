import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOfflineAuthCache,
  evaluateOfflineEligibility,
  OFFLINE_AUTH_CACHE_TTL_MS,
  type OfflineAuthCache,
} from '../src/offline-auth-cache';

const profile: OfflineAuthCache['profile'] = {
  id: '00000000000000000000000000000000',
  name: 'Player',
  skins: [],
  capes: [],
};

test('official ownership cache is valid for 30 days', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');
  const cache = createOfflineAuthCache(
    {
      clientId: '00000000-0000-0000-0000-000000000001',
      xuid: '1234567890123456',
      profile,
    },
    now,
  );
  const eligibility = evaluateOfflineEligibility(
    cache,
    cache.clientId,
    new Date(now.getTime() + OFFLINE_AUTH_CACHE_TTL_MS - 1),
  );
  assert.equal(eligibility.allowed, true);
  assert.equal(eligibility.reason, 'allowed');
});

test('unverified, mismatched, and expired caches are denied', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');
  const cache = createOfflineAuthCache(
    {
      clientId: '00000000-0000-0000-0000-000000000001',
      xuid: '1234567890123456',
      profile,
    },
    now,
  );
  assert.equal(
    evaluateOfflineEligibility(null, cache.clientId, now).reason,
    'missing-cache',
  );
  assert.equal(
    evaluateOfflineEligibility(
      cache,
      '00000000-0000-0000-0000-000000000002',
      now,
    ).reason,
    'client-id-mismatch',
  );
  assert.equal(
    evaluateOfflineEligibility(
      cache,
      cache.clientId,
      new Date(now.getTime() + OFFLINE_AUTH_CACHE_TTL_MS),
    ).reason,
    'cache-expired',
  );
});
