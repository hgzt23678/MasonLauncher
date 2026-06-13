import assert from 'node:assert/strict';
import test from 'node:test';
import {
  developerLogsVisibleByDefault,
  normalizeBuildConfiguration,
} from '../src/build-configuration';

test('normalizes release builds explicitly', () => {
  assert.equal(normalizeBuildConfiguration('release'), 'release');
  assert.equal(normalizeBuildConfiguration('Release'), 'release');
});

test('uses debug as the safe fallback configuration', () => {
  assert.equal(normalizeBuildConfiguration('debug'), 'debug');
  assert.equal(normalizeBuildConfiguration(undefined), 'debug');
  assert.equal(normalizeBuildConfiguration('unexpected'), 'debug');
});

test('developer logs default on only in debug builds', () => {
  assert.equal(developerLogsVisibleByDefault('debug'), true);
  assert.equal(developerLogsVisibleByDefault('release'), false);
});
