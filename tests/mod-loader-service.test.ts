import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ModLoaderService,
  neoForgeMinecraftPrefix,
  parseNeoForgeMavenMetadata,
  resolvedModLoaderVersionId,
} from '../src/mod-loader-service';
import { MinecraftError } from '../src/minecraft-errors';

const temporaryDirectory = async (t: test.TestContext) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-loader-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
};

test('各MODローダーのversion IDを安定して生成する', () => {
  assert.equal(
    resolvedModLoaderVersionId('forge', '1.20.1', '47.4.0'),
    '1.20.1-forge-47.4.0',
  );
  assert.equal(
    resolvedModLoaderVersionId('fabric', '1.21.1', '0.16.14'),
    '1.21.1-fabric0.16.14',
  );
  assert.equal(
    resolvedModLoaderVersionId('neoforge', '1.21.1', '21.1.200'),
    'neoforge-21.1.200',
  );
});

test('NeoForgeの版体系をMinecraft版のprefixへ変換する', () => {
  assert.equal(neoForgeMinecraftPrefix('1.20.4'), '20.4.');
  assert.equal(neoForgeMinecraftPrefix('1.21.1'), '21.1.');
  assert.equal(neoForgeMinecraftPrefix('26.1'), '26.1.');
});

test('NeoForge Maven metadataをMinecraft版で絞り新しい順にする', () => {
  const builds = parseNeoForgeMavenMetadata(
    `
      <metadata><versioning><versions>
        <version>21.0.100</version>
        <version>21.1.20-beta</version>
        <version>21.1.200</version>
        <version>21.1.99</version>
      </versions></versioning></metadata>
    `,
    '1.21.1',
  );
  assert.deepEqual(
    builds.map((build) => build.loaderVersion),
    ['21.1.200', '21.1.99', '21.1.20-beta'],
  );
  assert.equal(builds[0].stable, true);
  assert.equal(builds[2].stable, false);
});

test('Fabric build一覧を公式Meta API形式から解決する', async () => {
  const requested: string[] = [];
  const service = new ModLoaderService(
    async () => 'unused',
    () => undefined,
    {
      fetch: async (input) => {
        requested.push(String(input));
        return new Response(
          JSON.stringify([
            { loader: { version: '0.16.14', stable: true } },
            { loader: { version: '0.17.0-beta.1', stable: false } },
          ]),
          { status: 200 },
        );
      },
      prepareInstalledVersion: async () => {
        throw new Error('not used');
      },
    },
  );

  const builds = await service.getBuilds('fabric', '1.21.1');
  assert.equal(
    requested[0],
    'https://meta.fabricmc.net/v2/versions/loader/1.21.1',
  );
  assert.deepEqual(
    builds.map((build) => [build.loaderVersion, build.stable]),
    [
      ['0.16.14', true],
      ['0.17.0-beta.1', false],
    ],
  );
});

test('Fabric profile JSONをversions配下へ保存して検証処理へ渡す', async (t) => {
  const root = await temporaryDirectory(t);
  const prepared: Array<[string, boolean]> = [];
  const service = new ModLoaderService(
    async () => root,
    () => undefined,
    {
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: 'fabric-loader-original',
            inheritsFrom: '1.21.1',
            mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
            libraries: [
              {
                name: 'net.fabricmc:fabric-loader:0.16.14',
                url: 'https://maven.fabricmc.net/',
              },
            ],
            arguments: { game: [], jvm: [] },
          }),
          { status: 200 },
        ),
      prepareInstalledVersion: async (versionId, offlineOnly) => {
        prepared.push([versionId, offlineOnly]);
        return { version: {} as never };
      },
    },
  );

  const versionId = await service.ensureInstalled({
    loader: 'fabric',
    minecraftVersion: '1.21.1',
    loaderVersion: '0.16.14',
    resolvedVersionId: 'unused',
    offlineOnly: false,
  });
  const saved = JSON.parse(
    await fs.readFile(
      path.join(root, 'versions', versionId, `${versionId}.json`),
      'utf8',
    ),
  ) as Record<string, unknown>;

  assert.equal(versionId, '1.21.1-fabric0.16.14');
  assert.equal(saved.id, versionId);
  assert.equal(saved.inheritsFrom, '1.21.1');
  assert.deepEqual(prepared, [[versionId, false]]);
});

test('オフライン時は保存済みMODローダーversionだけを検証する', async () => {
  const prepared: Array<[string, boolean]> = [];
  const service = new ModLoaderService(
    async () => 'unused',
    () => undefined,
    {
      fetch: async () => {
        throw new Error('network must not be used');
      },
      prepareInstalledVersion: async (versionId, offlineOnly) => {
        prepared.push([versionId, offlineOnly]);
        return { version: {} as never };
      },
    },
  );

  const versionId = await service.ensureInstalled({
    loader: 'neoforge',
    minecraftVersion: '1.21.1',
    loaderVersion: '21.1.200',
    resolvedVersionId: 'neoforge-21.1.200',
    offlineOnly: true,
  });
  assert.equal(versionId, 'neoforge-21.1.200');
  assert.deepEqual(prepared, [['neoforge-21.1.200', true]]);
});

test('NeoForgeは公式client installerをJava指定で実行する', async () => {
  const prepared: Array<[string, boolean]> = [];
  const calls: Array<Record<string, unknown>> = [];
  const service = new ModLoaderService(
    async () => 'C:\\Minecraft Data',
    () => undefined,
    {
      installNeoForge: async (project, version, minecraft, options) => {
        calls.push({
          project,
          version,
          minecraft,
          java: options.java,
          side: options.side,
        });
        return `neoforge-${version}`;
      },
      prepareInstalledVersion: async (versionId, offlineOnly) => {
        prepared.push([versionId, offlineOnly]);
        return { version: {} as never };
      },
    },
  );

  const versionId = await service.ensureInstalled({
    loader: 'neoforge',
    minecraftVersion: '1.21.1',
    loaderVersion: '21.1.233',
    resolvedVersionId: 'neoforge-21.1.233',
    javaPath: 'C:\\Java\\bin\\java.exe',
    offlineOnly: false,
  });

  assert.equal(versionId, 'neoforge-21.1.233');
  assert.deepEqual(calls, [
    {
      project: 'neoforge',
      version: '21.1.233',
      minecraft: 'C:\\Minecraft Data',
      java: 'C:\\Java\\bin\\java.exe',
      side: 'client',
    },
  ]);
  assert.deepEqual(prepared, [['neoforge-21.1.233', false]]);
});

test('NeoForge非対応Minecraft版はUNSUPPORTED_COMBINATIONになる', async () => {
  const service = new ModLoaderService(
    async () => 'unused',
    () => undefined,
    {
      // Metadata only contains 1.21.1-era builds (21.1.x); 1.16.5 -> prefix
      // '16.5.' matches nothing, so the combination is unsupported.
      fetch: async () =>
        new Response(
          `
            <metadata><versioning><versions>
              <version>21.1.200</version>
              <version>21.1.99</version>
            </versions></versioning></metadata>
          `,
          { status: 200 },
        ),
      prepareInstalledVersion: async () => {
        throw new Error('not used');
      },
    },
  );

  await assert.rejects(
    service.getBuilds('neoforge', '1.16.5'),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.category === 'manifest' &&
      error.code === 'UNSUPPORTED_COMBINATION' &&
      error.detail?.loader === 'neoforge' &&
      error.detail?.minecraftVersion === '1.16.5',
  );
});

test('Fabric非対応Minecraft版もUNSUPPORTED_COMBINATIONになる', async () => {
  const service = new ModLoaderService(
    async () => 'unused',
    () => undefined,
    {
      // Fabric meta returns an empty array for an unsupported Minecraft version.
      fetch: async () => new Response(JSON.stringify([]), { status: 200 }),
      prepareInstalledVersion: async () => {
        throw new Error('not used');
      },
    },
  );

  await assert.rejects(
    service.getBuilds('fabric', '1.0.0'),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.code === 'UNSUPPORTED_COMBINATION' &&
      error.detail?.loader === 'fabric',
  );
});
