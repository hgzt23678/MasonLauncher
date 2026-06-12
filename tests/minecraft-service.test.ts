import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { JavaRuntimeManifest } from '@xmcl/installer';
import {
  isJavaRuntimeManifestComplete,
  repairJavaRuntimeManifestFiles,
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
