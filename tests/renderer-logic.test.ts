import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareVersionsByRelease,
  filterSelectableVersions,
  formatVersionLabel,
  type MinecraftVersionInfo,
} from '../src/renderer-logic';

const versions: MinecraftVersionInfo[] = [
  {
    id: '1.21.1',
    type: 'release',
    releaseTime: '2024-08-08T12:00:00Z',
  },
  {
    id: '24w33a',
    type: 'snapshot',
    releaseTime: '2024-08-15T12:00:00Z',
  },
  {
    id: 'b1.7.3',
    type: 'old_beta',
    releaseTime: '2011-07-08T12:00:00Z',
  },
  {
    id: 'a1.2.6',
    type: 'old_alpha',
    releaseTime: '2010-12-03T12:00:00Z',
  },
];

test('snapshotトグルOFFではsnapshotを除外しONでは含める', () => {
  assert.deepEqual(
    filterSelectableVersions(versions, false, '').map((version) => version.id),
    ['1.21.1'],
  );
  assert.deepEqual(
    filterSelectableVersions(versions, true, '').map((version) => version.id),
    ['1.21.1', '24w33a'],
  );
});

test('old_betaとold_alphaは常に除外する', () => {
  const filtered = filterSelectableVersions(versions, true, 'b1.7.3');
  assert.equal(filtered.some((version) => version.type === 'old_beta'), false);
  assert.equal(filtered.some((version) => version.type === 'old_alpha'), false);
});

test('選択中snapshotはトグルOFFでも残す', () => {
  assert.deepEqual(
    filterSelectableVersions(versions, false, '24w33a').map(
      (version) => version.id,
    ),
    ['1.21.1', '24w33a'],
  );
});

test('releaseTimeが新しい順に並べる', () => {
  assert.deepEqual(
    [...versions.slice(0, 2)]
      .sort(compareVersionsByRelease)
      .map((version) => version.id),
    ['24w33a', '1.21.1'],
  );
});

test('バージョン種別を表示ラベルへ整形する', () => {
  assert.equal(formatVersionLabel(versions[0]), '1.21.1  /  RELEASE');
  assert.equal(formatVersionLabel(versions[1]), '24w33a  /  SNAPSHOT');
});
