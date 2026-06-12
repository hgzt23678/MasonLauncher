import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import test from 'node:test';
import type { ChildProcess } from 'node:child_process';
import { generateArguments, type ResolvedVersion } from '@xmcl/core';
import {
  buildLaunchOptions,
  createObservedSpawn,
  normalizeLaunchProfileVersion,
  parseVersionManifest,
  resolveJavaExecutable,
  resolveLibraryPath,
  validateSpawnRequest,
} from '../src/launcher-utils';

const fixtureVersion: ResolvedVersion = {
  id: 'test-version',
  minecraftVersion: 'test-version',
  minecraftDirectory: 'C:\\Minecraft',
  inheritances: ['test-version'],
  pathChain: ['C:\\Minecraft\\versions\\test-version\\test-version.json'],
  mainClass: 'net.minecraft.client.main.Main',
  assets: 'test-assets',
  downloads: {},
  libraries: [],
  minimumLauncherVersion: 0,
  releaseTime: '2026-01-01T00:00:00Z',
  time: '2026-01-01T00:00:00Z',
  type: 'release',
  javaVersion: {
    component: 'java-runtime-test',
    majorVersion: 21,
  },
  arguments: {
    jvm: [
      '-Djava.library.path=${natives_directory}',
      '-cp',
      '${classpath}',
    ],
    game: [
      '--username',
      '${auth_player_name}',
      '--version',
      '${version_name}',
      '--gameDir',
      '${game_directory}',
      '--assetsDir',
      '${assets_root}',
      '--assetIndex',
      '${assets_index_name}',
      '--uuid',
      '${auth_uuid}',
      '--accessToken',
      '${auth_access_token}',
      '--userType',
      '${user_type}',
    ],
  },
};

test('Java実行ファイルをOS別に解決する', () => {
  assert.equal(
    resolveJavaExecutable('C:\\runtime\\java', 'win32'),
    path.join('C:\\runtime\\java', 'bin', 'javaw.exe'),
  );
  assert.equal(
    resolveJavaExecutable('/runtime/java', 'linux'),
    path.join('/runtime/java', 'bin', 'java'),
  );
});

test('Mojang manifestを解析する', () => {
  const versions = parseVersionManifest({
    versions: [
      {
        id: '1.21.11',
        type: 'release',
        url: 'https://example.invalid/1.21.11.json',
        time: '2025-12-09T12:23:30Z',
        releaseTime: '2025-12-09T12:23:30Z',
      },
    ],
  });
  assert.equal(versions.length, 1);
  assert.equal(versions[0].id, '1.21.11');
  assert.throws(() => parseVersionManifest({}), /versions 配列/);
});

test('ライブラリパスをゲームディレクトリ配下へ固定する', () => {
  const gameDirectory = 'C:\\Users\\Player Name\\AppData\\Roaming\\.minecraft';
  assert.equal(
    resolveLibraryPath(
      gameDirectory,
      'com/mojang/authlib/1.0/authlib-1.0.jar',
    ),
    path.resolve(
      gameDirectory,
      'libraries',
      'com/mojang/authlib/1.0/authlib-1.0.jar',
    ),
  );
  assert.throws(
    () => resolveLibraryPath(gameDirectory, '../outside.jar'),
    /ゲームディレクトリ外/,
  );
});

test('Forge継承versionを検出して冗長フィールドを同期する', () => {
  const normalized = normalizeLaunchProfileVersion(
    {
      versionId: '1.20.1-forge-47.2.0',
      minecraftVersion: 'stale',
      resolvedVersionId: 'stale',
      loader: 'vanilla',
      loaderType: 'vanilla',
      profileType: 'vanilla',
      loaderVersion: null,
    },
    {
      id: '1.20.1-forge-47.2.0',
      inheritsFrom: '1.20.1',
    },
  );

  assert.deepEqual(normalized, {
    versionId: '1.20.1',
    minecraftVersion: '1.20.1',
    resolvedVersionId: '1.20.1-forge-47.2.0',
    loader: 'forge',
    loaderType: 'forge',
    profileType: 'forge',
    loaderVersion: '47.2.0',
  });
});

test('Vanilla profileはversionを維持して冗長フィールドを同期する', () => {
  const normalized = normalizeLaunchProfileVersion(
    {
      versionId: '1.21.1',
      minecraftVersion: 'stale',
      resolvedVersionId: 'stale',
      loader: 'vanilla',
      loaderType: 'forge',
      profileType: 'forge',
      loaderVersion: 'stale',
    },
    {
      id: '1.21.1',
      inheritsFrom: null,
    },
  );

  assert.deepEqual(normalized, {
    versionId: '1.21.1',
    minecraftVersion: '1.21.1',
    resolvedVersionId: '1.21.1',
    loader: 'vanilla',
    loaderType: 'vanilla',
    profileType: 'vanilla',
    loaderVersion: null,
  });
});

test('inheritsFromなしの明示Forge profileは設定済みloader情報を維持する', () => {
  const normalized = normalizeLaunchProfileVersion(
    {
      versionId: '1.20.1',
      minecraftVersion: '1.20.1',
      resolvedVersionId: 'stale',
      loader: 'forge',
      loaderType: 'vanilla',
      profileType: 'vanilla',
      loaderVersion: '47.2.0',
    },
    undefined,
  );

  assert.deepEqual(normalized, {
    versionId: '1.20.1',
    minecraftVersion: '1.20.1',
    resolvedVersionId: '1.20.1-forge-47.2.0',
    loader: 'forge',
    loaderType: 'forge',
    profileType: 'forge',
    loaderVersion: '47.2.0',
  });
});

test('オンラインセッションから起動引数を生成する', async () => {
  const options = buildLaunchOptions({
    version: fixtureVersion,
    session: {
      accessToken: 'test-token',
      clientId: '00000000-0000-0000-0000-000000000001',
      xuid: '1234567890123456',
      mode: 'online',
      profile: {
        id: '00000000000000000000000000000000',
        name: 'Developer',
        skins: [],
        capes: [],
      },
    },
    settings: { minMemory: 1024, maxMemory: 4096 },
    gamePath: 'C:\\Minecraft Profiles\\日本語 Profile',
    resourcePath: 'C:\\Minecraft Data',
    javaPath: 'C:\\Java Runtime\\bin\\javaw.exe',
  });
  const generated = await generateArguments(options);

  assert.equal(generated[0], 'C:\\Java Runtime\\bin\\javaw.exe');
  assert.equal(generated[generated.indexOf('--username') + 1], 'Developer');
  assert.equal(generated[generated.indexOf('--userType') + 1], 'msa');
  assert.ok(generated.includes('-Xms1024M'));
  assert.ok(generated.includes('-Xmx4096M'));
});

test('spawnへ渡すcommand/args/cwdを検証する', async () => {
  const options = buildLaunchOptions({
    version: fixtureVersion,
    session: {
      accessToken: 'test-token',
      clientId: '00000000-0000-0000-0000-000000000001',
      xuid: '1234567890123456',
      mode: 'online',
      profile: {
        id: '00000000000000000000000000000000',
        name: 'Developer',
        skins: [],
        capes: [],
      },
    },
    settings: { minMemory: 1024, maxMemory: 2048 },
    gamePath: 'C:\\Game Path',
    resourcePath: 'C:\\Resource Path',
    javaPath: 'C:\\Java Path\\javaw.exe',
  });
  const generated = await generateArguments(options);
  const request = validateSpawnRequest({
    command: generated[0],
    args: generated.slice(1),
    options: options.extraExecOption,
  });

  assert.equal(request.command, 'C:\\Java Path\\javaw.exe');
  assert.equal(request.options?.cwd, 'C:\\Game Path');
  assert.ok(request.args.includes('net.minecraft.client.main.Main'));
  const calls: Array<{
    command: string;
    args: readonly string[];
    cwd: unknown;
  }> = [];
  const fakeProcess = new EventEmitter() as ChildProcess;
  const observedSpawn = createObservedSpawn(
    (command, args = [], spawnOptions) => {
      calls.push({ command, args, cwd: spawnOptions?.cwd });
      return fakeProcess;
    },
    () => undefined,
  );
  assert.equal(
    observedSpawn(request.command, request.args, request.options),
    fakeProcess,
  );
  assert.deepEqual(calls, [
    {
      command: 'C:\\Java Path\\javaw.exe',
      args: request.args,
      cwd: 'C:\\Game Path',
    },
  ]);
  assert.throws(
    () =>
      validateSpawnRequest({
        command: '',
        args: [],
        options: { cwd: '' },
      }),
    /Java実行ファイル/,
  );
});
