import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import test from 'node:test';
import {
  assertGameDirArgument,
  insertExtraJvmArguments,
  MinecraftLaunchResolver,
  parseJavaMajorVersion,
  resolveMicrosoftLaunchPlaceholders,
} from '../src/minecraft-launch-resolver';
import { MinecraftProcessRunner } from '../src/minecraft-process-runner';
import { MinecraftError } from '../src/minecraft-errors';

test('Java未検出をjavaカテゴリとして返す', async () => {
  const resolver = new MinecraftLaunchResolver();
  await assert.rejects(
    resolver.resolve({
      versionId: 'missing',
      session: {
        accessToken: 'secret',
        clientId: '00000000-0000-0000-0000-000000000001',
        xuid: '1234567890123456',
        mode: 'online',
        profile: {
          id: '00000000000000000000000000000000',
          name: 'Player',
          skins: [],
          capes: [],
        },
      },
      settings: { minMemory: 1024, maxMemory: 2048 },
      gamePath: 'C:\\Missing Game',
      resourcePath: 'C:\\Missing Resource',
      javaPath: 'C:\\Missing Java\\javaw.exe',
    }),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.category === 'java' &&
      error.code === 'JAVA_NOT_FOUND',
  );
});

test('Java major versionを旧形式と現行形式から解析する', () => {
  assert.equal(
    parseJavaMajorVersion('openjdk version "17.0.15" 2025-04-15 LTS'),
    17,
  );
  assert.equal(
    parseJavaMajorVersion('java version "1.8.0_402"'),
    8,
  );
});

test('clientidとauth_xuidプレースホルダを認証セッションから解決する', () => {
  const resolved = resolveMicrosoftLaunchPlaceholders(
    [
      '--clientId',
      '${clientid}',
      '--xuid',
      '${auth_xuid}',
      '--unknown',
      '${future_placeholder}',
    ],
    {
      clientId: '00000000-0000-0000-0000-000000000001',
      xuid: '1234567890123456',
    },
  );
  assert.deepEqual(resolved, [
    '--clientId',
    '00000000-0000-0000-0000-000000000001',
    '--xuid',
    '1234567890123456',
    '--unknown',
    '${future_placeholder}',
  ]);
});

test('追加JVM引数をmainClassの直前へ挿入する', () => {
  const args = [
    '-cp',
    'client.jar',
    'net.minecraft.client.main.Main',
    '--username',
    'Player',
  ];

  insertExtraJvmArguments(
    args,
    'net.minecraft.client.main.Main',
    ['-XX:+UseG1GC'],
  );

  assert.deepEqual(args, [
    '-cp',
    'client.jar',
    '-XX:+UseG1GC',
    'net.minecraft.client.main.Main',
    '--username',
    'Player',
  ]);
});

test('mainClass未検出時は追加JVM引数を黙って破棄しない', () => {
  assert.throws(
    () =>
      insertExtraJvmArguments(
        ['-cp', 'client.jar'],
        'net.minecraft.client.main.Main',
        ['-XX:+UseG1GC'],
      ),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.category === 'arguments' &&
      error.code === 'JVM_ARGS_INSERTION_FAILED',
  );
});

test('--gameDirがプロファイルのinstanceDirと一致する', () => {
  assert.doesNotThrow(() =>
    assertGameDirArgument(
      ['--gameDir', 'C:\\Minecraft\\Profiles\\main'],
      'C:\\Minecraft\\Profiles\\main',
    ),
  );
});

test('--gameDirが欠落している場合は起動を中止する', () => {
  assert.throws(
    () =>
      assertGameDirArgument(
        ['--username', 'Player'],
        'C:\\Minecraft\\Profiles\\main',
      ),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.category === 'arguments' &&
      error.code === 'GAME_DIR_ARGUMENT_MISSING',
  );
});

test('--gameDirがinstanceDirと不一致の場合は起動を中止する', () => {
  assert.throws(
    () =>
      assertGameDirArgument(
        ['--gameDir', 'C:\\Minecraft\\Profiles\\other'],
        'C:\\Minecraft\\Profiles\\main',
      ),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.category === 'arguments' &&
      error.code === 'GAME_DIR_ARGUMENT_MISMATCH',
  );
});

test('認証済みオフラインセッションはローカルJava検証まで進む', async () => {
  const resolver = new MinecraftLaunchResolver();
  await assert.rejects(
    resolver.resolve({
      versionId: 'missing',
      session: {
        accessToken: '0',
        clientId: '00000000-0000-0000-0000-000000000001',
        xuid: '1234567890123456',
        mode: 'authenticated-offline',
        profile: {
          id: '00000000000000000000000000000000',
          name: 'Player',
          skins: [],
          capes: [],
        },
      },
      settings: { minMemory: 1024, maxMemory: 2048 },
      gamePath: 'C:\\Missing Game',
      resourcePath: 'C:\\Missing Resource',
      javaPath: 'C:\\Missing Java\\javaw.exe',
    }),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.category === 'java' &&
      error.code === 'JAVA_NOT_FOUND',
  );
});

test('ProcessRunnerはshellを使わずtokenをログでマスクする', () => {
  const logs: Array<Record<string, unknown> | undefined> = [];
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    pid: 1234,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  let captured:
    | {
        command: string;
        args: readonly string[];
        options: import('node:child_process').SpawnOptions | undefined;
      }
    | undefined;
  const runner = new MinecraftProcessRunner(
    (_level, _stage, _message, detail) => logs.push(detail),
    (command, args = [], options) => {
      captured = { command, args, options };
      return child;
    },
  );
  const states: Array<{ running: boolean }> = [];
  runner.run(
    {
      command: 'C:\\Java Runtime\\bin\\javaw.exe',
      args: ['-cp', 'C:\\Game Path\\client.jar', '--accessToken', 'top-secret'],
      cwd: 'C:\\Game Path',
    },
    { onState: (state) => states.push(state) },
  );

  assert.equal(captured?.command, 'C:\\Java Runtime\\bin\\javaw.exe');
  assert.equal(captured?.options?.shell, false);
  assert.equal(captured?.options?.cwd, 'C:\\Game Path');
  assert.deepEqual(captured?.args, [
    '-cp',
    'C:\\Game Path\\client.jar',
    '--accessToken',
    'top-secret',
  ]);
  assert.ok(
    logs.some((detail) =>
      String(detail?.commandLine).includes('[REDACTED]'),
    ),
  );
  assert.ok(
    logs.every((detail) => !String(detail?.commandLine).includes('top-secret')),
  );
  assert.equal(states[0]?.running, true);
});
