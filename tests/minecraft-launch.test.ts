import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertGameDirArgument,
  insertExtraJvmArguments,
  MinecraftLaunchResolver,
  parseJavaMajorVersion,
  resolveMicrosoftLaunchPlaceholders,
} from '../src/minecraft-launch-resolver';
import {
  buildPowerShellReproductionScript,
  classifyMinecraftRuntimeLog,
  MinecraftProcessRunner,
} from '../src/minecraft-process-runner';
import { MinecraftError } from '../src/minecraft-errors';
import type { MinecraftWindowProbe } from '../src/minecraft-window-probe';

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
  assert.equal(captured?.options?.windowsHide, false);
  assert.equal(captured?.options?.detached, false);
  assert.deepEqual(captured?.options?.stdio, ['ignore', 'pipe', 'pipe']);
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

test('PowerShell再現スクリプトはtokenを保存しない', () => {
  const script = buildPowerShellReproductionScript(
    'C:\\Java Runtime\\bin\\java.exe',
    [
      '-cp',
      'C:\\Game Path\\client.jar',
      '--accessToken',
      'top-secret-token',
    ],
    'C:\\Game Path',
  );

  assert.match(script, /\$env:MASON_MC_ACCESS_TOKEN/);
  assert.match(script, /Push-Location -LiteralPath/);
  assert.doesNotMatch(script, /top-secret-token/);
});

test('GLFW・natives・メモリ不足ログを分類する', () => {
  assert.equal(
    classifyMinecraftRuntimeLog(
      'GLFW error 65542: WGL: The driver does not appear to support OpenGL',
    )?.category,
    'graphics',
  );
  assert.equal(
    classifyMinecraftRuntimeLog(
      'java.lang.UnsatisfiedLinkError: no lwjgl64 in java.library.path',
    )?.category,
    'natives',
  );
  assert.equal(
    classifyMinecraftRuntimeLog(
      'Could not reserve enough space for object heap',
    )?.category,
    'memory',
  );
});

test('ProcessRunner rejects exit code 0 after 16 seconds when no window appeared', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-process-log-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    pid: 4321,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  let now = Date.parse('2026-01-01T00:00:00.000Z');
  const runner = new MinecraftProcessRunner(
    () => undefined,
    () => child,
    () => now,
  );
  const states: Array<{ running: boolean; category?: string }> = [];
  const launcherLogPath = path.join(root, 'launcher.log');
  await fs.mkdir(path.join(root, 'logs'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'logs', 'latest.log'),
    'Authorization: Bearer latest-log-secret\n',
  );
  runner.run(
    {
      command: 'java',
      args: [
        '-cp',
        'client.jar',
        'net.minecraft.client.main.Main',
        '--accessToken',
        'top-secret-token',
      ],
      cwd: root,
      metadata: {
        instanceId: 'test-instance',
        versionId: '1.20.1',
        minecraftVersion: '1.20.1',
        loaderType: 'vanilla',
        loaderVersion: null,
        javaPath: 'java',
        javaDistribution: 'temurin',
        javaMajor: 17,
        javaArch: 'x64',
        gameDir: root,
        assetsDir: path.join(root, 'assets'),
        nativesDir: path.join(root, 'natives'),
        mainClass: 'net.minecraft.client.main.Main',
        classpathEntries: 1,
        argumentCount: 5,
        minMemoryMb: 1024,
        maxMemoryMb: 2048,
        freeMemoryMb: 8192,
        totalMemoryMb: 16384,
        nativeFileCount: 3,
        latestLogPath: path.join(root, 'logs', 'latest.log'),
        launcherLogPath,
      },
    },
    { onState: (state) => states.push(state) },
  );
  child.stdout?.emit(
    'data',
    Buffer.from('access_token=stdout-secret-token\n'),
  );
  child.stderr?.emit(
    'data',
    Buffer.from('session=stderr-secret-token\n'),
  );
  now += 16_000;
  child.emit('exit', 0, null);
  for (let attempt = 0; attempt < 100 && states.at(-1)?.running; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(states.at(-1)?.running, false);
  assert.equal(states.at(-1)?.category, 'crash');
  const log = await fs.readFile(launcherLogPath, 'utf8');
  assert.match(log, /"windowConfirmed":false/);
  assert.match(log, /"elapsedMs":16000/);
  assert.match(log, /"javaDistribution":"temurin"/);
  assert.match(log, /"loaderType":"vanilla"/);
  assert.match(log, /"shell":false/);
  assert.match(log, /"windowsHide":false/);
  assert.match(log, /"detached":false/);
  assert.doesNotMatch(log, /top-secret-token/);
  assert.doesNotMatch(log, /latest-log-secret/);
  assert.doesNotMatch(log, /stdout-secret-token/);
  assert.doesNotMatch(log, /stderr-secret-token/);
  assert.match(log, /\[REDACTED\]/);
});

test('XMCL init log does not count as a confirmed Minecraft window', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-process-log-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    pid: 4322,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  const noWindowProbe: MinecraftWindowProbe = async (rootPid) => ({
    supported: true,
    rootPid,
    checkedAt: new Date().toISOString(),
    processTree: [],
    candidates: [],
  });
  const states: Array<{
    running: boolean;
    category?: string;
    message: string;
  }> = [];
  const launcherLogPath = path.join(root, 'launcher.log');
  const runner = new MinecraftProcessRunner(
    () => undefined,
    () => child,
    Date.now,
    noWindowProbe,
  );
  runner.run(
    {
      command: 'java',
      args: ['-cp', 'client.jar', 'net.minecraft.client.main.Main'],
      cwd: root,
      metadata: {
        instanceId: 'test-instance',
        versionId: '1.12.2',
        minecraftVersion: '1.12.2',
        loaderType: 'vanilla',
        loaderVersion: null,
        javaPath: 'java',
        javaDistribution: 'temurin',
        javaMajor: 8,
        javaArch: 'x64',
        gameDir: root,
        assetsDir: path.join(root, 'assets'),
        nativesDir: path.join(root, 'natives'),
        mainClass: 'net.minecraft.client.main.Main',
        classpathEntries: 1,
        argumentCount: 3,
        minMemoryMb: 1024,
        maxMemoryMb: 2048,
        freeMemoryMb: 8192,
        totalMemoryMb: 16384,
        nativeFileCount: 3,
        latestLogPath: path.join(root, 'logs', 'latest.log'),
        launcherLogPath,
      },
    },
    { onState: (state) => states.push(state) },
  );
  child.stdout?.emit('data', Buffer.from('LWJGL Version: 2.9.4\n'));
  child.emit('exit', 0, null);
  for (let attempt = 0; attempt < 100 && states.at(-1)?.running; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.match(
    states.find((state) => state.running && state.message.includes('初期化ログ'))
      ?.message ?? '',
    /画面表示は未確認/,
  );
  assert.equal(states.at(-1)?.category, 'window-unverified');
  assert.doesNotMatch(
    states.map((state) => state.message).join('\n'),
    /Minecraft画面を確認しました/,
  );
  const log = await fs.readFile(launcherLogPath, 'utf8');
  assert.match(log, /"event":"client-init-log"/);
  assert.match(log, /LWJGL Version: 2\.9\.4/);
  assert.match(log, /"windowConfirmed":false/);
});

test('a verified visible window is the only event that confirms the screen', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-process-log-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    pid: 4323,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  const visibleWindowProbe: MinecraftWindowProbe = async (rootPid) => ({
    supported: true,
    rootPid,
    checkedAt: new Date().toISOString(),
    processTree: [{
      pid: rootPid,
      parentPid: null,
      executablePath: 'C:\\Java\\bin\\java.exe',
    }],
    candidates: [{
      pid: rootPid,
      parentPid: null,
      pidInTree: true,
      handle: 100,
      title: 'Minecraft 1.20.1',
      className: 'LWJGL',
      executablePath: 'C:\\Java\\bin\\java.exe',
      visible: true,
      minimized: false,
      cloaked: false,
      ownerHandle: 0,
      bounds: { x: 100, y: 100, width: 1280, height: 720 },
      intersectsVirtualScreen: true,
    }],
  });
  const states: Array<{
    running: boolean;
    category?: string;
    message: string;
  }> = [];
  const runner = new MinecraftProcessRunner(
    () => undefined,
    () => child,
    Date.now,
    visibleWindowProbe,
    20,
    10,
  );
  runner.run(
    {
      command: 'java',
      args: ['-cp', 'client.jar', 'net.minecraft.client.main.Main'],
      cwd: root,
      metadata: {
        instanceId: 'test-instance',
        versionId: '1.20.1',
        minecraftVersion: '1.20.1',
        loaderType: 'vanilla',
        loaderVersion: null,
        javaPath: 'java',
        javaDistribution: 'temurin',
        javaMajor: 17,
        javaArch: 'x64',
        gameDir: root,
        assetsDir: path.join(root, 'assets'),
        nativesDir: path.join(root, 'natives'),
        mainClass: 'net.minecraft.client.main.Main',
        classpathEntries: 1,
        argumentCount: 3,
        minMemoryMb: 1024,
        maxMemoryMb: 2048,
        freeMemoryMb: 8192,
        totalMemoryMb: 16384,
        nativeFileCount: 3,
        latestLogPath: path.join(root, 'logs', 'latest.log'),
        launcherLogPath: path.join(root, 'launcher.log'),
      },
    },
    { onState: (state) => states.push(state) },
  );
  for (
    let attempt = 0;
    attempt < 100 &&
    !states.some((state) => state.message.includes('Minecraft画面を確認しました'));
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await new Promise((resolve) => setTimeout(resolve, 3_100));
  child.emit('exit', 0, null);
  for (let attempt = 0; attempt < 100 && states.at(-1)?.running; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.ok(
    states.some((state) => state.message.includes('Minecraft画面を確認しました')),
  );
  assert.equal(states.at(-1)?.category, undefined);
});

test('a window that disappears immediately is not treated as a successful launch', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-process-log-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    pid: 4324,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  const visibleWindowProbe: MinecraftWindowProbe = async (rootPid) => ({
    supported: true,
    rootPid,
    checkedAt: new Date().toISOString(),
    processTree: [{
      pid: rootPid,
      parentPid: null,
      executablePath: 'C:\\Java\\bin\\java.exe',
    }],
    candidates: [{
      pid: rootPid,
      parentPid: null,
      pidInTree: true,
      handle: 101,
      title: 'Minecraft',
      className: 'LWJGL',
      executablePath: 'C:\\Java\\bin\\java.exe',
      visible: true,
      minimized: false,
      cloaked: false,
      ownerHandle: 0,
      bounds: { x: 10, y: 10, width: 800, height: 600 },
      intersectsVirtualScreen: true,
    }],
  });
  const states: Array<{
    running: boolean;
    category?: string;
    message: string;
  }> = [];
  const runner = new MinecraftProcessRunner(
    () => undefined,
    () => child,
    Date.now,
    visibleWindowProbe,
    20,
    10,
  );
  runner.run(
    {
      command: 'java',
      args: ['net.minecraft.client.main.Main'],
      cwd: root,
      metadata: {
        instanceId: 'test-instance',
        versionId: '1.20.1',
        minecraftVersion: '1.20.1',
        loaderType: 'vanilla',
        loaderVersion: null,
        javaPath: 'java',
        javaDistribution: 'temurin',
        javaMajor: 17,
        javaArch: 'x64',
        gameDir: root,
        assetsDir: path.join(root, 'assets'),
        nativesDir: path.join(root, 'natives'),
        mainClass: 'net.minecraft.client.main.Main',
        classpathEntries: 1,
        argumentCount: 1,
        minMemoryMb: 1024,
        maxMemoryMb: 2048,
        freeMemoryMb: 8192,
        totalMemoryMb: 16384,
        nativeFileCount: 3,
        latestLogPath: path.join(root, 'logs', 'latest.log'),
        launcherLogPath: path.join(root, 'launcher.log'),
      },
    },
    { onState: (state) => states.push(state) },
  );
  for (
    let attempt = 0;
    attempt < 100 &&
    !states.some((state) => state.message.includes('Minecraft画面を確認しました'));
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  child.emit('exit', 0, null);
  for (let attempt = 0; attempt < 100 && states.at(-1)?.running; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(states.at(-1)?.category, 'crash');
  assert.match(states.at(-1)?.message ?? '', /直後にプロセスが終了/);
});
