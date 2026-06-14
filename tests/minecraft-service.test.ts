import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { JavaRuntimeManifest } from '@xmcl/installer';
import {
  MinecraftService,
  isJavaRuntimeManifestComplete,
  repairJavaRuntimeManifestFiles,
  resolveLaunchJavaExecutable,
  validateMinecraftNatives,
  waitForJavaRuntimeManifest,
} from '../src/minecraft-service';
import { MinecraftError } from '../src/minecraft-errors';

const runtimeManifest = (
  data: string,
): Pick<JavaRuntimeManifest, 'files'> => ({
  files: {
    'bin/java.exe': {
      type: 'file',
      executable: true,
      downloads: {
        raw: {
          sha1: createHash('sha1').update(data).digest('hex'),
          size: Buffer.byteLength(data),
          url: 'https://example.invalid/java.exe',
        },
      },
    },
  },
});

test('Windowsゲーム起動ではjavaw.exeを優先する', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-javaw-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const java = path.join(root, 'bin', 'java.exe');
  const javaw = path.join(root, 'bin', 'javaw.exe');
  await fs.mkdir(path.dirname(java), { recursive: true });
  await fs.writeFile(java, '');
  assert.equal(await resolveLaunchJavaExecutable(java, 'win32'), java);
  await fs.writeFile(javaw, '');
  assert.equal(await resolveLaunchJavaExecutable(java, 'win32'), javaw);
  assert.equal(await resolveLaunchJavaExecutable(java, 'linux'), java);
});

test('nativesディレクトリの存在・nativeファイル・書き込み可否を検証する', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-natives-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(
    validateMinecraftNatives(path.join(root, 'missing'), 'win32'),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.code === 'NATIVES_DIRECTORY_MISSING',
  );
  const natives = path.join(root, 'natives');
  await fs.mkdir(natives);
  await assert.rejects(
    validateMinecraftNatives(natives, 'win32'),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.code === 'NATIVES_FILES_MISSING',
  );
  await fs.writeFile(path.join(natives, 'lwjgl64.dll'), 'native');
  assert.deepEqual(await validateMinecraftNatives(natives, 'win32'), {
    nativeFileCount: 1,
  });
});

test('Mojang Java manifestの全ファイルサイズが一致すれば完了扱いにする', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-java-manifest-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executable = path.join(root, 'bin', 'java.exe');
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(executable, 'java');

  const manifest = runtimeManifest('java');
  assert.equal(
    await isJavaRuntimeManifestComplete(root, manifest),
    true,
  );
  await waitForJavaRuntimeManifest(root, manifest, 100);

  await fs.writeFile(executable, 'broken');
  assert.equal(
    await isJavaRuntimeManifestComplete(root, manifest),
    false,
  );
  await assert.rejects(
    waitForJavaRuntimeManifest(root, manifest, 10),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.code === 'JAVA_RUNTIME_INSTALL_TIMEOUT',
  );
});

test('Mojang Java runtime rejects a same-size SHA-1 mismatch', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-java-sha1-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executable = path.join(root, 'bin', 'java.exe');
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(executable, 'evil');

  assert.equal(
    await isJavaRuntimeManifestComplete(root, runtimeManifest('java')),
    false,
  );

  await repairJavaRuntimeManifestFiles(
    root,
    runtimeManifest('java'),
    async () => new Response('java', { status: 200 }),
  );
  assert.equal(await fs.readFile(executable, 'utf8'), 'java');
});

test('停止したMojang Javaダウンロードの不完全ファイルを補修する', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-java-repair-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executable = path.join(root, 'bin', 'java.exe');
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(executable, '');
  const manifest = runtimeManifest('repaired-java');

  await repairJavaRuntimeManifestFiles(
    root,
    manifest,
    async () => new Response('repaired-java', { status: 200 }),
  );

  assert.equal(await fs.readFile(executable, 'utf8'), 'repaired-java');
  assert.equal(
    await isJavaRuntimeManifestComplete(root, manifest),
    true,
  );
});

test('Mojang version manifestは同時取得を共有して10分間再利用する', async () => {
  const service = new MinecraftService(async () => 'unused', 'unused');
  const versions = [{ id: '1.21.1' }];
  let requests = 0;
  let resolveRequest: ((value: unknown[]) => void) | undefined;
  const downloader = (
    service as unknown as {
      downloader: { getManifest: () => Promise<unknown[]> };
    }
  ).downloader;
  downloader.getManifest = () => {
    requests += 1;
    return new Promise((resolve) => {
      resolveRequest = resolve;
    });
  };

  const first = service.getRemoteVersions();
  const second = service.getRemoteVersions();
  assert.equal(requests, 1);
  assert.strictEqual(first, second);
  resolveRequest?.(versions);
  assert.strictEqual(await first, versions);
  assert.strictEqual(await second, versions);
  assert.strictEqual(await service.getRemoteVersions(), versions);
  assert.equal(requests, 1);

  (
    service as unknown as {
      manifestCache: { expiresAt: number; versions: unknown[] };
    }
  ).manifestCache.expiresAt = Date.now() - 1;
  downloader.getManifest = async () => {
    requests += 1;
    return [{ id: '1.21.2' }];
  };
  assert.deepEqual(await service.getRemoteVersions(), [{ id: '1.21.2' }]);
  assert.equal(requests, 2);
});

test('Mojang version manifest取得失敗後は次回再試行する', async () => {
  const service = new MinecraftService(async () => 'unused', 'unused');
  const downloader = (
    service as unknown as {
      downloader: { getManifest: () => Promise<unknown[]> };
    }
  ).downloader;
  let requests = 0;
  downloader.getManifest = async () => {
    requests += 1;
    if (requests === 1) throw new Error('temporary failure');
    return [{ id: '1.21.1' }];
  };

  await assert.rejects(service.getRemoteVersions(), /temporary failure/);
  assert.deepEqual(await service.getRemoteVersions(), [{ id: '1.21.1' }]);
  assert.equal(requests, 2);
});
