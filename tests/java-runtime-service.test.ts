import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ZipFile } from 'yazl';
import {
  JavaRuntimeService,
  defaultJavaSettings,
  detectDistributionFromBanner,
  normalizeJavaSettings,
  requiredJavaMajor,
  type JavaProbe,
} from '../src/java-runtime-service';
import { MinecraftError } from '../src/minecraft-errors';

const exeName = process.platform === 'win32' ? 'java.exe' : 'java';

const makeProbe = (
  table: Record<string, { major: number; banner: string }>,
): JavaProbe => async (executable) => {
  const entry = Object.entries(table).find(([key]) =>
    path.resolve(executable).toLowerCase().includes(key.toLowerCase()),
  );
  if (!entry) {
    throw new Error(`probe rejected: ${executable}`);
  }
  const { major, banner } = entry[1];
  return {
    versionString: `openjdk version "${major === 8 ? '1.8.0_392' : `${major}.0.1`}"`,
    majorVersion: major,
    arch: 'amd64',
    banner,
  };
};

const makeManagedRuntime = async (
  root: string,
  directoryName: string,
) => {
  const binDirectory = path.join(
    root,
    'java',
    'managed',
    directoryName,
    'bin',
  );
  await fs.mkdir(binDirectory, { recursive: true });
  const executable = path.join(binDirectory, exeName);
  await fs.writeFile(executable, 'fake java');
  return executable;
};

test('MinecraftバージョンからJava majorを解決する（メタデータ優先）', () => {
  assert.equal(requiredJavaMajor('1.8.9'), 8);
  assert.equal(requiredJavaMajor('1.12.2'), 8);
  assert.equal(requiredJavaMajor('1.16.5'), 8);
  assert.equal(requiredJavaMajor('1.17'), 16);
  assert.equal(requiredJavaMajor('1.17.1'), 16);
  assert.equal(requiredJavaMajor('1.18'), 17);
  assert.equal(requiredJavaMajor('1.20.4'), 17);
  assert.equal(requiredJavaMajor('1.20.5'), 21);
  assert.equal(requiredJavaMajor('1.21.4'), 21);
  // Mojang version metadata always wins (future Java 25+ support).
  assert.equal(requiredJavaMajor('1.21.4', 25), 25);
  assert.equal(requiredJavaMajor('1.12.2', 8), 8);
  // Snapshots fall back to the newest rule unless metadata says otherwise.
  assert.equal(requiredJavaMajor('24w14a'), 21);
  assert.equal(requiredJavaMajor('24w14a', 21), 21);
});

test('JavaSettingsの正規化と旧javaPathマイグレーション', () => {
  const defaults = normalizeJavaSettings(undefined);
  assert.equal(defaults.mode, 'auto');
  assert.deepEqual(defaults.preferredDistributions, [
    'liberica-lite',
    'liberica',
    'zulu',
    'temurin',
  ]);

  const legacy = normalizeJavaSettings(undefined, 'C:\\jdk\\bin\\java.exe');
  assert.equal(legacy.mode, 'customPath');
  assert.equal(legacy.customPath, 'C:\\jdk\\bin\\java.exe');

  // fixed without runtimeId and customPath without path degrade to auto.
  assert.equal(normalizeJavaSettings({ mode: 'fixed' }).mode, 'auto');
  assert.equal(normalizeJavaSettings({ mode: 'customPath' }).mode, 'auto');

  const filtered = normalizeJavaSettings({
    mode: 'auto',
    preferredDistributions: ['zulu', 'not-a-dist', 'temurin'],
    jvmArgs: ['-XX:+UseG1GC', '', 42],
  });
  assert.deepEqual(filtered.preferredDistributions, ['zulu', 'temurin']);
  assert.deepEqual(filtered.jvmArgs, ['-XX:+UseG1GC']);
});

test('java -versionバナーから配布元を判別する', () => {
  assert.equal(
    detectDistributionFromBanner('OpenJDK 64-Bit Temurin-21.0.1'),
    'temurin',
  );
  assert.equal(detectDistributionFromBanner('Zulu21.30+15-CA'), 'zulu');
  assert.equal(
    detectDistributionFromBanner('OpenJDK (BellSoft Liberica)'),
    'liberica',
  );
  assert.equal(
    detectDistributionFromBanner('BellSoft Liberica', 'C:\\liberica-lite-21\\java.exe'),
    'liberica-lite',
  );
  assert.equal(
    detectDistributionFromBanner('Java(TM) SE Runtime Environment'),
    'oracle',
  );
  assert.equal(detectDistributionFromBanner('something else'), 'unknown');
});

test('管理/手動Javaを列挙し検証結果をキャッシュする', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scl-java-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await makeManagedRuntime(root, 'liberica-lite-21-x64');
  const customDirectory = path.join(root, 'custom-jdk', 'bin');
  await fs.mkdir(customDirectory, { recursive: true });
  const customExecutable = path.join(customDirectory, exeName);
  await fs.writeFile(customExecutable, 'fake custom java');

  let probeCalls = 0;
  const probe: JavaProbe = async (executable) => {
    // Count probes of our fixtures only; real system Javas on the machine
    // running the tests must not affect the cache assertion.
    const result = await makeProbe({
      'liberica-lite-21-x64': { major: 21, banner: 'BellSoft Liberica lite' },
      'custom-jdk': { major: 17, banner: 'Temurin' },
    })(executable);
    probeCalls += 1;
    return result;
  };
  const service = new JavaRuntimeService(root, () => undefined, { probe });
  await service.addCustomRuntime(customExecutable);

  const first = await service.listRuntimes();
  const managed = first.find((runtime) => runtime.source === 'managed');
  const custom = first.find((runtime) => runtime.source === 'custom');
  assert.ok(managed);
  assert.equal(managed.distribution, 'liberica-lite');
  assert.equal(managed.majorVersion, 21);
  assert.equal(managed.verified, true);
  assert.ok(custom);
  assert.equal(custom.majorVersion, 17);

  const callsAfterFirst = probeCalls;
  const second = await service.listRuntimes();
  assert.equal(
    second.filter((runtime) => runtime.source !== 'system').length,
    first.filter((runtime) => runtime.source !== 'system').length,
  );
  // mtime unchanged → cached validations, no re-probe of known paths.
  assert.equal(probeCalls, callsAfterFirst);

  // Removal: custom unregisters, managed deletes the directory.
  const afterRemove = await service.removeRuntime(custom.id);
  assert.ok(!afterRemove.some((runtime) => runtime.id === custom.id));
  const afterManagedRemove = await service.removeRuntime(managed.id);
  assert.ok(!afterManagedRemove.some((runtime) => runtime.id === managed.id));
  await assert.rejects(
    fs.access(path.join(root, 'java', 'managed', 'liberica-lite-21-x64')),
  );
});

const buildJavaZip = () =>
  new Promise<Buffer>((resolve, reject) => {
    const zip = new ZipFile();
    const chunks: Buffer[] = [];
    zip.addBuffer(Buffer.from('fake java exe'), 'jdk-21.0.1/bin/java.exe');
    zip.addBuffer(Buffer.from('fake javaw exe'), 'jdk-21.0.1/bin/javaw.exe');
    zip.addBuffer(Buffer.from('release info'), 'jdk-21.0.1/release');
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once('error', reject);
    zip.outputStream.once('end', () => resolve(Buffer.concat(chunks)));
    zip.end();
  });

test('Foojay Disco API経由でJavaをインストールしSHA-256検証する', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scl-java-install-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archive = await buildJavaZip();
  const checksum = createHash('sha256').update(archive).digest('hex');

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/disco/packages') {
      // JRE query succeeds on the first attempt.
      const respond = (body: unknown) => {
        const buffer = Buffer.from(JSON.stringify(body));
        response.writeHead(200, {
          'content-type': 'application/json',
          'content-length': buffer.length,
        });
        response.end(buffer);
      };
      if (url.searchParams.get('package_type') === 'jre') {
        assert.equal(url.searchParams.get('distribution'), 'liberica');
        assert.equal(url.searchParams.get('version'), '21');
        respond({
          result: [
            {
              id: 'pkg-standard',
              distribution: 'liberica',
              major_version: 21,
              java_version: '21.0.1',
              package_type: 'jre',
              archive_type: 'zip',
              filename: 'bellsoft-jre21.0.1-windows-amd64.zip',
              links: { pkg_info_uri: `${baseUrl}/disco/info/standard` },
            },
            {
              id: 'pkg-lite',
              distribution: 'liberica',
              major_version: 21,
              java_version: '21.0.1',
              package_type: 'jre',
              archive_type: 'zip',
              filename: 'bellsoft-jre21.0.1-windows-amd64-lite.zip',
              links: { pkg_info_uri: `${baseUrl}/disco/info/lite` },
            },
          ],
        });
        return;
      }
      respond({ result: [] });
      return;
    }
    if (url.pathname === '/disco/info/lite') {
      const buffer = Buffer.from(
        JSON.stringify({
          result: [
            {
              filename: 'bellsoft-jre21.0.1-windows-amd64-lite.zip',
              direct_download_uri: `${baseUrl}/download/java.zip`,
              checksum,
              checksum_type: 'sha256',
            },
          ],
        }),
      );
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': buffer.length,
      });
      response.end(buffer);
      return;
    }
    if (url.pathname === '/download/java.zip') {
      response.writeHead(200, { 'content-length': archive.length });
      response.end(archive);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', resolve),
  );
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const service = new JavaRuntimeService(root, () => undefined, {
    discoApiBase: `${baseUrl}/disco`,
    platform: 'win32',
    arch: 'x64',
    probe: makeProbe({
      'liberica-lite-21-x64': { major: 21, banner: 'BellSoft Liberica lite' },
    }),
  });

  const progress: number[] = [];
  const installed = await service.installRuntime('liberica-lite', 21, (event) =>
    progress.push(event.percent),
  );
  // Lite bundle is selected by filename, despite the standard one listed first.
  assert.equal(installed.distribution, 'liberica-lite');
  assert.equal(installed.majorVersion, 21);
  assert.equal(installed.id, 'managed:liberica-lite-21-x64');
  assert.equal(
    await fs.readFile(installed.path, 'utf8'),
    'fake java exe',
  );
  assert.ok(progress.includes(100));
});

test('autoモードはpreferredDistributions順でJavaを選ぶ', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scl-java-auto-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await makeManagedRuntime(root, 'temurin-21-x64');
  await makeManagedRuntime(root, 'liberica-lite-21-x64');
  await makeManagedRuntime(root, 'liberica-lite-17-x64');

  const service = new JavaRuntimeService(root, () => undefined, {
    probe: makeProbe({
      'temurin-21-x64': { major: 21, banner: 'Temurin' },
      'liberica-lite-21-x64': { major: 21, banner: 'BellSoft Liberica lite' },
      'liberica-lite-17-x64': { major: 17, banner: 'BellSoft Liberica lite' },
    }),
  });

  const selection = await service.resolveForLaunch({
    settings: defaultJavaSettings(),
    minecraftVersion: '1.21.4',
    metadataMajorVersion: 21,
    offlineOnly: true,
  });
  assert.equal(selection.distribution, 'liberica-lite');
  assert.ok(selection.javaPath.includes('liberica-lite-21-x64'));
  assert.equal(selection.requiredMajorVersion, 21);

  // Preferring Temurin flips the choice.
  const temurinFirst = await service.resolveForLaunch({
    settings: {
      ...defaultJavaSettings(),
      preferredDistributions: ['temurin', 'liberica-lite'],
    },
    minecraftVersion: '1.21.4',
    metadataMajorVersion: 21,
    offlineOnly: true,
  });
  assert.equal(temurinFirst.distribution, 'temurin');

  // 1.18–1.20.4 (metadata 17) resolves the Java 17 runtime.
  const java17 = await service.resolveForLaunch({
    settings: defaultJavaSettings(),
    minecraftVersion: '1.20.1',
    metadataMajorVersion: 17,
    offlineOnly: true,
  });
  assert.ok(java17.javaPath.includes('liberica-lite-17-x64'));
});

test('customPath/fixedの不正・不一致は分かりやすいエラーになる', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scl-java-err-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const customDirectory = path.join(root, 'jdk17', 'bin');
  await fs.mkdir(customDirectory, { recursive: true });
  const java17 = path.join(customDirectory, exeName);
  await fs.writeFile(java17, 'fake');

  const service = new JavaRuntimeService(root, () => undefined, {
    probe: makeProbe({ jdk17: { major: 17, banner: 'Temurin' } }),
  });

  // Major mismatch (17 selected, 21 required).
  await assert.rejects(
    service.resolveForLaunch({
      settings: {
        ...defaultJavaSettings(),
        mode: 'customPath',
        customPath: java17,
      },
      minecraftVersion: '1.21.4',
      metadataMajorVersion: 21,
    }),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.category === 'java' &&
      error.code === 'JAVA_VERSION_MISMATCH' &&
      error.message.includes('必要Java: Java 21') &&
      error.message.includes('解決方法'),
  );

  // Nonexistent custom path.
  await assert.rejects(
    service.resolveForLaunch({
      settings: {
        ...defaultJavaSettings(),
        mode: 'customPath',
        customPath: path.join(root, 'missing', exeName),
      },
      minecraftVersion: '1.21.4',
      metadataMajorVersion: 21,
    }),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.code === 'JAVA_CUSTOM_PATH_INVALID',
  );

  // Fixed runtime that no longer exists.
  await assert.rejects(
    service.resolveForLaunch({
      settings: {
        ...defaultJavaSettings(),
        mode: 'fixed',
        runtimeId: 'managed:deleted-runtime',
      },
      minecraftVersion: '1.21.4',
      metadataMajorVersion: 21,
    }),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.code === 'JAVA_FIXED_RUNTIME_NOT_FOUND',
  );
});

test('候補もダウンロードもない場合はMojangフォールバック→失敗で明示エラー', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scl-java-fb-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = new JavaRuntimeService(root, () => undefined, {
    probe: makeProbe({}),
  });

  const fallbackPath = path.join(root, 'mojang', 'bin', exeName);
  const selection = await service.resolveForLaunch({
    settings: defaultJavaSettings(),
    minecraftVersion: '1.21.4',
    metadataMajorVersion: 21,
    offlineOnly: true,
    mojangFallback: async () => fallbackPath,
  });
  assert.equal(selection.source, 'mojang-fallback');
  assert.equal(selection.javaPath, fallbackPath);

  await assert.rejects(
    service.resolveForLaunch({
      settings: defaultJavaSettings(),
      minecraftVersion: '1.21.4',
      metadataMajorVersion: 21,
      offlineOnly: true,
    }),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.code === 'JAVA_AUTO_RESOLUTION_FAILED' &&
      error.message.includes('必要Java: Java 21'),
  );
});
