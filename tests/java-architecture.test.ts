import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  JavaRuntimeService,
  defaultJavaSettings,
  type JavaProbe,
} from '../src/java-runtime-service';
import { MinecraftError } from '../src/minecraft-errors';

const exeName = process.platform === 'win32' ? 'java.exe' : 'java';

test('customPath and fixed modes reject an incompatible Java architecture', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-java-arch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const javaDirectory = path.join(root, 'jdk21-x86', 'bin');
  const executable = path.join(javaDirectory, exeName);
  await fs.mkdir(javaDirectory, { recursive: true });
  await fs.writeFile(executable, 'fake');
  const probe: JavaProbe = async () => ({
    versionString: 'openjdk version "21.0.1"',
    majorVersion: 21,
    arch: 'x86',
    banner: 'Temurin',
  });
  const service = new JavaRuntimeService(root, () => undefined, {
    arch: 'x64',
    probe,
  });
  await service.addCustomRuntime(executable);
  const runtimeId = `custom:${createHash('sha1')
    .update(path.resolve(executable).toLowerCase())
    .digest('hex')
    .slice(0, 12)}`;

  for (const settings of [
    {
      ...defaultJavaSettings(),
      mode: 'customPath' as const,
      customPath: executable,
    },
    {
      ...defaultJavaSettings(),
      mode: 'fixed' as const,
      runtimeId,
    },
  ]) {
    await assert.rejects(
      service.resolveForLaunch({
        settings,
        minecraftVersion: '1.21.4',
        metadataMajorVersion: 21,
      }),
      (error: unknown) =>
        error instanceof MinecraftError &&
        error.code === 'JAVA_ARCHITECTURE_MISMATCH',
    );
  }
});
