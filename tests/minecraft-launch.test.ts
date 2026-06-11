import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import test from 'node:test';
import { MinecraftLaunchResolver } from '../src/minecraft-launch-resolver';
import { MinecraftProcessRunner } from '../src/minecraft-process-runner';
import { MinecraftError } from '../src/minecraft-errors';

test('Java未検出をjavaカテゴリとして返す', async () => {
  const resolver = new MinecraftLaunchResolver();
  await assert.rejects(
    resolver.resolve({
      versionId: 'missing',
      session: {
        accessToken: 'secret',
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
