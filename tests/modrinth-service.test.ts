import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ZipFile } from 'yazl';
import {
  ModrinthError,
  ModrinthService,
  type ModrinthVersionInfo,
} from '../src/modrinth-service';

const sha1 = (value: Buffer) => createHash('sha1').update(value).digest('hex');
const sha512 = (value: Buffer) =>
  createHash('sha512').update(value).digest('hex');

const buildZip = (entries: Record<string, Buffer | string>) =>
  new Promise<Buffer>((resolve, reject) => {
    const zip = new ZipFile();
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on('error', reject);
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    for (const [name, value] of Object.entries(entries)) {
      zip.addBuffer(
        Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8'),
        name,
      );
    }
    zip.end();
  });

type Handler = (
  request: http.IncomingMessage,
  url: URL,
) => { status?: number; json?: unknown; body?: Buffer; headers?: Record<string, string> };

const startServer = async (handler: Handler) => {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const result = handler(request, url);
    const status = result.status ?? 200;
    if (result.json !== undefined) {
      const body = Buffer.from(JSON.stringify(result.json));
      response.writeHead(status, {
        'content-type': 'application/json',
        'content-length': body.length,
        ...result.headers,
      });
      response.end(body);
      return;
    }
    const body = result.body ?? Buffer.alloc(0);
    response.writeHead(status, {
      'content-length': body.length,
      ...result.headers,
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

const makeService = (baseUrl: string) =>
  new ModrinthService(() => undefined, {
    apiBase: `${baseUrl}/v2`,
    allowInsecureDownloads: true,
  });

test('searchMods が project_type/loader/version facet を組み立てて整形する', async (t) => {
  let capturedFacets = '';
  let capturedIndex = '';
  const server = await startServer((_request, url) => {
    if (url.pathname === '/v2/search') {
      capturedFacets = url.searchParams.get('facets') ?? '';
      capturedIndex = url.searchParams.get('index') ?? '';
      return {
        json: {
          hits: [
            {
              project_id: 'AANobbMI',
              slug: 'sodium',
              title: 'Sodium',
              description: 'A rendering engine',
              icon_url: 'https://cdn/icon.png',
              downloads: 1234,
              follows: 56,
              categories: ['optimization'],
              client_side: 'required',
              server_side: 'unsupported',
              latest_version: 'abcd',
            },
          ],
        },
      };
    }
    return { status: 404, json: {} };
  });
  t.after(server.close);

  const service = makeService(server.baseUrl);
  const hits = await service.searchMods('sodium', {
    gameVersion: '1.20.1',
    loader: 'fabric',
    limit: 5,
  });

  assert.deepEqual(JSON.parse(capturedFacets), [
    ['project_type:mod'],
    ['categories:fabric'],
    ['versions:1.20.1'],
  ]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].projectId, 'AANobbMI');
  assert.equal(hits[0].clientSide, 'required');
  assert.equal(hits[0].serverSide, 'unsupported');
  assert.equal(hits[0].follows, 56);
  assert.equal(capturedIndex, 'relevance');
});

test('空検索は人気順、検索時は名前一致だけを優先して返す', async (t) => {
  const indexes: string[] = [];
  const queries: Array<string | null> = [];
  const server = await startServer((_request, url) => {
    if (url.pathname !== '/v2/search') {
      return { status: 404, json: {} };
    }
    indexes.push(url.searchParams.get('index') ?? '');
    queries.push(url.searchParams.get('query'));
    return {
      json: {
        hits: [
          {
            project_id: 'description-only',
            slug: 'render-engine',
            title: 'Render Engine',
            description: 'Sodium compatible',
            downloads: 9000,
          },
          {
            project_id: 'prefix',
            slug: 'sodium-extra',
            title: 'Sodium Extra',
            description: '',
            downloads: 5000,
          },
          {
            project_id: 'exact',
            slug: 'sodium',
            title: 'Sodium',
            description: '',
            downloads: 1000,
          },
        ],
      },
    };
  });
  t.after(server.close);

  const service = makeService(server.baseUrl);
  const popular = await service.searchMods('', { loader: 'fabric' });
  const matches = await service.searchMods('sodium', {
    loader: 'fabric',
  });

  assert.equal(popular.length, 3);
  assert.deepEqual(indexes, ['downloads', 'relevance']);
  assert.deepEqual(queries, [null, 'sodium']);
  assert.deepEqual(
    matches.map((hit) => hit.projectId),
    ['exact', 'prefix'],
  );
});

test('searchModpacks はModpackだけを人気順または検索一致順で返す', async (t) => {
  const facets: string[] = [];
  const indexes: string[] = [];
  const queries: Array<string | null> = [];
  const server = await startServer((_request, url) => {
    if (url.pathname !== '/v2/search') {
      return { status: 404, json: {} };
    }
    facets.push(url.searchParams.get('facets') ?? '');
    indexes.push(url.searchParams.get('index') ?? '');
    queries.push(url.searchParams.get('query'));
    return {
      json: {
        hits: [
          {
            project_id: 'pack',
            slug: 'mason-pack',
            title: 'Mason Pack',
            description: 'A Modrinth modpack',
            downloads: 12000,
          },
        ],
      },
    };
  });
  t.after(server.close);

  const service = makeService(server.baseUrl);
  await service.searchModpacks('');
  await service.searchModpacks('Mason');

  assert.deepEqual(
    facets.map((value) => JSON.parse(value)),
    [[['project_type:modpack']], [['project_type:modpack']]],
  );
  assert.deepEqual(indexes, ['downloads', 'relevance']);
  assert.deepEqual(queries, [null, 'Mason']);
});

test('getProject が followers と side サポートを正規化する', async (t) => {
  const server = await startServer((_request, url) => {
    if (url.pathname === '/v2/project/sodium') {
      return {
        json: {
          id: 'AANobbMI',
          slug: 'sodium',
          title: 'Sodium',
          description: 'desc',
          icon_url: null,
          downloads: 10,
          followers: 99,
          categories: ['optimization'],
          client_side: 'required',
          server_side: 'optional',
          loaders: ['fabric'],
          game_versions: ['1.20.1'],
        },
      };
    }
    return { status: 404, json: {} };
  });
  t.after(server.close);

  const project = await makeService(server.baseUrl).getProject('sodium');
  assert.equal(project.follows, 99);
  assert.equal(project.serverSide, 'optional');
  assert.deepEqual(project.loaders, ['fabric']);
});

test('getProjectVersions が release を優先しつつ新しい順に並べる', async (t) => {
  const server = await startServer((_request, url) => {
    if (url.pathname === '/v2/project/sodium/version') {
      return {
        json: [
          {
            id: 'beta-new',
            project_id: 'p',
            name: 'beta',
            version_number: '2.0-beta',
            version_type: 'beta',
            date_published: '2025-01-02T00:00:00Z',
            files: [{ url: 'u', filename: 'a.jar', primary: true }],
          },
          {
            id: 'rel-old',
            project_id: 'p',
            name: 'old',
            version_number: '1.0',
            version_type: 'release',
            date_published: '2024-01-01T00:00:00Z',
            files: [{ url: 'u', filename: 'b.jar', primary: true }],
          },
          {
            id: 'rel-new',
            project_id: 'p',
            name: 'new',
            version_number: '1.1',
            version_type: 'release',
            date_published: '2025-06-01T00:00:00Z',
            files: [{ url: 'u', filename: 'c.jar', primary: true }],
          },
        ],
      };
    }
    return { status: 404, json: {} };
  });
  t.after(server.close);

  const versions = await makeService(server.baseUrl).getProjectVersions(
    'sodium',
    { loaders: ['fabric'], gameVersions: ['1.20.1'] },
  );
  assert.deepEqual(
    versions.map((version) => version.id),
    ['rel-new', 'rel-old', 'beta-new'],
  );
});

test('.mrpackを検証して新規instanceへ展開する', async (t) => {
  const mod = Buffer.from('fabric mod');
  const skipped = Buffer.from('server only mod');
  const nestedOverride = await buildZip({
    'assets/mod-menu-helper.bin': randomBytes(72_000),
  });
  const index = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: 'pack-version',
    name: 'Fabric Adventure',
    summary: 'A test pack',
    files: [
      {
        path: 'mods/example.jar',
        hashes: { sha1: sha1(mod), sha512: sha512(mod) },
        env: { client: 'required', server: 'optional' },
        downloads: [] as string[],
        fileSize: mod.length,
      },
      {
        path: 'mods/server-only.jar',
        hashes: { sha1: sha1(skipped), sha512: sha512(skipped) },
        env: { client: 'unsupported', server: 'required' },
        downloads: [] as string[],
        fileSize: skipped.length,
      },
    ],
    dependencies: {
      minecraft: '1.20.1',
      'fabric-loader': '0.15.11',
    },
  };
  let archive: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const server = await startServer((_request, url) => {
    if (url.pathname === '/v2/version/pack-version') {
      return {
        json: {
          id: 'pack-version',
          project_id: 'pack-project',
          name: 'Fabric Adventure 1.0',
          version_number: '1.0',
          version_type: 'release',
          files: [
            {
              url: `${server.baseUrl}/download/pack.mrpack`,
              filename: 'fabric-adventure.mrpack',
              primary: true,
              size: archive.length,
              hashes: { sha1: sha1(archive), sha512: sha512(archive) },
            },
          ],
        },
      };
    }
    if (url.pathname === '/download/pack.mrpack') {
      return { body: archive };
    }
    if (url.pathname === '/download/example.jar') {
      return { body: mod };
    }
    if (url.pathname === '/download/server-only.jar') {
      return { body: skipped };
    }
    return { status: 404, json: {} };
  });
  index.files[0].downloads = [`${server.baseUrl}/download/example.jar`];
  index.files[1].downloads = [`${server.baseUrl}/download/server-only.jar`];
  const overrideEntries: Record<string, Buffer | string> = {
    'overrides/config/example.txt': 'base override',
    'client-overrides/config/example.txt': 'client override',
    'client-overrides/options.txt': 'fov:90',
  };
  for (let index = 0; index < 37; index += 1) {
    overrideEntries[`overrides/config/generated-${index}.txt`] = `value-${index}`;
  }
  overrideEntries['overrides/resourcepacks/Mod Menu Helper.zip'] =
    nestedOverride;
  for (let index = 0; index < 5; index += 1) {
    overrideEntries[`overrides/config/trailing-${index}.txt`] = `tail-${index}`;
  }
  archive = await buildZip({
    'modrinth.index.json': JSON.stringify(index),
    ...overrideEntries,
  });
  t.after(server.close);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-mrpack-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const progress: Array<Record<string, unknown>> = [];
  const sender = {
    isDestroyed: () => false,
    send: (channel: string, payload: Record<string, unknown>) => {
      assert.equal(channel, 'modrinth:modpack-install-progress');
      progress.push(payload);
    },
  };
  const result = await makeService(server.baseUrl).installModpack(
    {
      instanceDirectory: root,
      projectId: 'pack-project',
      versionId: 'pack-version',
    },
    sender as never,
  );

  assert.equal(result.name, 'Fabric Adventure');
  assert.equal(result.minecraftVersion, '1.20.1');
  assert.equal(result.loader, 'fabric');
  assert.equal(result.loaderVersion, '0.15.11');
  assert.equal(result.installedFiles, 1);
  assert.equal(result.skippedFiles, 1);
  assert.deepEqual(
    await fs.readFile(path.join(root, 'mods', 'example.jar')),
    mod,
  );
  await assert.rejects(
    fs.access(path.join(root, 'mods', 'server-only.jar')),
  );
  assert.equal(
    await fs.readFile(path.join(root, 'config', 'example.txt'), 'utf8'),
    'client override',
  );
  assert.equal(
    await fs.readFile(path.join(root, 'options.txt'), 'utf8'),
    'fov:90',
  );
  assert.deepEqual(
    await fs.readFile(
      path.join(root, 'resourcepacks', 'Mod Menu Helper.zip'),
    ),
    nestedOverride,
  );
  assert.equal(result.overrideFiles, 46);
  assert.equal(
    (await fs.readdir(path.join(root, 'resourcepacks'))).some((name) =>
      name.includes('.tmp-'),
    ),
    false,
  );
  assert.ok(
    progress.some(
      (entry) =>
        entry.phase === 'overrides' &&
        entry.percent === 99 &&
        entry.overridesComplete === true,
    ),
  );
  assert.ok(
    progress.some(
      (entry) =>
        entry.phase === 'overrides' &&
        entry.file === 'resourcepacks/Mod Menu Helper.zip' &&
        entry.percent === 98,
    ),
  );
  assert.ok(progress.some((entry) => entry.phase === 'profile'));
});

test('.mrpackのinstance外パスとQuilt依存を拒否する', async (t) => {
  const makeArchive = (
    dependencies: Record<string, string>,
    filePath: string,
    overridePath?: string,
  ) =>
    buildZip({
      'modrinth.index.json': JSON.stringify({
        formatVersion: 1,
        game: 'minecraft',
        versionId: 'unsafe-pack',
        name: 'Unsafe Pack',
        files: [
          {
            path: filePath,
            hashes: { sha1: sha1(Buffer.from('x')), sha512: sha512(Buffer.from('x')) },
            env: { client: 'unsupported' },
            downloads: ['https://cdn.modrinth.com/data/x'],
            fileSize: 1,
          },
        ],
        dependencies,
      }),
      ...(overridePath ? { [overridePath]: 'unsafe override' } : {}),
    });
  const archives = new Map<string, Buffer>();
  const server = await startServer((_request, url) => {
    const archive = archives.get(url.pathname);
    if (archive) return { body: archive };
    return { status: 404, json: {} };
  });
  t.after(server.close);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-mrpack-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  for (const [versionId, dependencies, filePath, overridePath, errorKind] of [
    [
      'traversal',
      { minecraft: '1.20.1', 'fabric-loader': '0.15.11' },
      '../escape.jar',
      undefined,
      'invalid-input',
    ],
    [
      'quilt',
      { minecraft: '1.20.1', 'quilt-loader': '0.24.0' },
      'mods/example.jar',
      undefined,
      'unsupported-loader',
    ],
    [
      'override-drive',
      { minecraft: '1.20.1', 'fabric-loader': '0.15.11' },
      'mods/example.jar',
      'client-overrides/C:/escape.txt',
      'invalid-input',
    ],
  ] as const) {
    const archive = await makeArchive(dependencies, filePath, overridePath);
    archives.set(`/download/${versionId}.mrpack`, archive);
    const service = new ModrinthService(() => undefined, {
      apiBase: `${server.baseUrl}/v2`,
      allowInsecureDownloads: true,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === `/v2/version/${versionId}`) {
          return new Response(
            JSON.stringify({
              id: versionId,
              project_id: 'pack-project',
              name: 'Unsafe Pack',
              version_number: '1',
              files: [
                {
                  url: `${server.baseUrl}/download/${versionId}.mrpack`,
                  filename: `${versionId}.mrpack`,
                  primary: true,
                  size: archive.length,
                  hashes: { sha1: sha1(archive), sha512: sha512(archive) },
                },
              ],
            }),
            { headers: { 'content-type': 'application/json' } },
          );
        }
        return fetch(input, init);
      },
    });
    await assert.rejects(
      service.installModpack({
        instanceDirectory: root,
        projectId: 'pack-project',
        versionId,
      }),
      (error: unknown) =>
        error instanceof ModrinthError && error.kind === errorKind,
    );
  }
  await assert.rejects(fs.access(path.join(path.dirname(root), 'escape.jar')));
});

test('selectDownloadFile が sources を除外し primary jar を選ぶ', () => {
  const service = makeService('http://127.0.0.1:1');
  const file = service.selectDownloadFile({
    id: 'v',
    projectId: 'p',
    name: 'n',
    versionNumber: '1',
    versionType: 'release',
    gameVersions: [],
    loaders: [],
    datePublished: null,
    dependencies: [],
    files: [
      {
        url: 'u1',
        filename: 'mod-sources.jar',
        primary: false,
        size: 1,
        sha1: null,
        sha512: null,
      },
      {
        url: 'u2',
        filename: 'mod-1.0.jar',
        primary: true,
        size: 2,
        sha1: null,
        sha512: null,
      },
    ],
  });
  assert.equal(file.filename, 'mod-1.0.jar');
});

test('downloadVersion が jar を保存し installed-mods.json を作成し依存を返す', async (t) => {
  const jar = Buffer.from('mod jar contents');
  const server = await startServer((_request, url) => {
    if (url.pathname === '/download/mod.jar') {
      return { body: jar };
    }
    return { status: 404, json: {} };
  });
  t.after(server.close);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scl-modrinth-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const service = makeService(server.baseUrl);
  const version: ModrinthVersionInfo = {
    id: 'ver1',
    projectId: 'proj1',
    name: 'Test Mod 1.0',
    versionNumber: '1.0',
    versionType: 'release' as const,
    gameVersions: ['1.20.1'],
    loaders: ['fabric'],
    datePublished: '2025-01-01T00:00:00Z',
    files: [
      {
        url: `${server.baseUrl}/download/mod.jar`,
        filename: 'mod.jar',
        primary: true,
        size: jar.length,
        sha1: sha1(jar),
        sha512: sha512(jar),
      },
    ],
    dependencies: [
      {
        projectId: 'dep1',
        versionId: null,
        fileName: null,
        dependencyType: 'required' as const,
      },
      {
        projectId: 'opt1',
        versionId: null,
        fileName: null,
        dependencyType: 'optional' as const,
      },
    ],
  };

  const result = await service.downloadVersion({
    instanceDirectory: root,
    version,
    loader: 'fabric',
    minecraftVersion: '1.20.1',
    title: 'Test Mod',
  });

  assert.equal(result.alreadyPresent, false);
  assert.equal(result.requiredDependencies.length, 1);
  assert.equal(result.optionalDependencies.length, 1);
  assert.equal(
    await fs.readFile(path.join(root, 'mods', 'mod.jar'), 'utf8'),
    jar.toString(),
  );

  const installed = await service.listInstalledMods(root);
  assert.equal(installed.length, 1);
  assert.equal(installed[0].projectId, 'proj1');
  assert.equal(installed[0].sha1, sha1(jar));
  assert.equal(installed[0].minecraftVersion, '1.20.1');

  // Second download of the same content is idempotent (no re-write needed).
  const again = await service.downloadVersion({
    instanceDirectory: root,
    version,
    loader: 'fabric',
    minecraftVersion: '1.20.1',
  });
  assert.equal(again.alreadyPresent, true);
  assert.equal((await service.listInstalledMods(root)).length, 1);

  // removeInstalledMod deletes the jar and the record.
  const removed = await service.removeInstalledMod(root, 'proj1');
  assert.equal(removed.removed, true);
  assert.equal(removed.mods.length, 0);
  await assert.rejects(fs.access(path.join(root, 'mods', 'mod.jar')));
});

test('同名で内容が異なる場合は上書きせず別名で保存する', async (t) => {
  const jar = Buffer.from('new contents');
  const server = await startServer((_request, url) => {
    if (url.pathname === '/download/mod.jar') {
      return { body: jar };
    }
    return { status: 404, json: {} };
  });
  t.after(server.close);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scl-modrinth-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'mods'), { recursive: true });
  await fs.writeFile(path.join(root, 'mods', 'mod.jar'), 'pre-existing');

  const result = await makeService(server.baseUrl).downloadVersion({
    instanceDirectory: root,
    version: {
      id: 'ver9',
      projectId: 'proj9',
      name: 'Mod',
      versionNumber: '1.0',
      versionType: 'release',
      gameVersions: [],
      loaders: [],
      datePublished: null,
      dependencies: [],
      files: [
        {
          url: `${server.baseUrl}/download/mod.jar`,
          filename: 'mod.jar',
          primary: true,
          size: jar.length,
          sha1: sha1(jar),
          sha512: sha512(jar),
        },
      ],
    },
    loader: 'forge',
    minecraftVersion: '1.20.1',
  });

  assert.equal(result.renamed, true);
  assert.equal(result.fileName, 'mod-ver9.jar');
  assert.equal(
    await fs.readFile(path.join(root, 'mods', 'mod.jar'), 'utf8'),
    'pre-existing',
  );
  assert.equal(
    await fs.readFile(path.join(root, 'mods', 'mod-ver9.jar'), 'utf8'),
    jar.toString(),
  );
});

test('HTTP ステータスを ModrinthError の kind に分類する', async (t) => {
  const server = await startServer((_request, url) => {
    if (url.pathname === '/v2/project/missing') {
      return { status: 404, json: { error: 'not found' } };
    }
    if (url.pathname === '/v2/project/limited') {
      return { status: 429, json: {}, headers: { 'retry-after': '30' } };
    }
    if (url.pathname === '/v2/project/broken') {
      return { status: 503, json: {} };
    }
    return { status: 200, json: {} };
  });
  t.after(server.close);

  const service = makeService(server.baseUrl);
  await assert.rejects(
    service.getProject('missing'),
    (error: unknown) =>
      error instanceof ModrinthError && error.kind === 'not-found',
  );
  await assert.rejects(
    service.getProject('limited'),
    (error: unknown) =>
      error instanceof ModrinthError && error.kind === 'rate-limited',
  );
  await assert.rejects(
    service.getProject('broken'),
    (error: unknown) =>
      error instanceof ModrinthError && error.kind === 'server',
  );
});

test('ネットワーク失敗を network kind として分類する', async () => {
  const service = new ModrinthService(() => undefined, {
    apiBase: 'http://127.0.0.1:9/v2',
    fetchImpl: (async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      });
    }) as typeof fetch,
  });
  await assert.rejects(
    service.getProject('whatever'),
    (error: unknown) =>
      error instanceof ModrinthError && error.kind === 'network',
  );
});

test('downloadVersion rejects non-HTTPS download URLs in production mode', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-modrinth-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = new ModrinthService(() => undefined, {
    fetchImpl: (async () => {
      throw new Error('fetch must not be reached');
    }) as typeof fetch,
  });

  await assert.rejects(
    service.downloadVersion({
      instanceDirectory: root,
      version: {
        id: 'unsafe',
        projectId: 'project',
        name: 'Unsafe',
        versionNumber: '1',
        versionType: 'release',
        gameVersions: ['1.20.1'],
        loaders: ['fabric'],
        datePublished: null,
        dependencies: [],
        files: [{
          url: 'http://cdn.modrinth.com/data/project/versions/unsafe/mod.jar',
          filename: 'mod.jar',
          primary: true,
          size: 1,
          sha1: null,
          sha512: null,
        }],
      },
      loader: 'fabric',
      minecraftVersion: '1.20.1',
    }),
    (error: unknown) =>
      error instanceof ModrinthError && error.kind === 'invalid-input',
  );
});

test('downloadVersion validates the final redirect host', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-modrinth-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const response = new Response(Buffer.from('jar'));
  Object.defineProperty(response, 'url', {
    value: 'https://example.invalid/mod.jar',
  });
  const service = new ModrinthService(() => undefined, {
    fetchImpl: (async () => response) as typeof fetch,
  });

  await assert.rejects(
    service.downloadVersion({
      instanceDirectory: root,
      version: {
        id: 'redirected',
        projectId: 'project',
        name: 'Redirected',
        versionNumber: '1',
        versionType: 'release',
        gameVersions: ['1.20.1'],
        loaders: ['fabric'],
        datePublished: null,
        dependencies: [],
        files: [{
          url: 'https://cdn.modrinth.com/data/project/versions/id/mod.jar',
          filename: 'mod.jar',
          primary: true,
          size: 3,
          sha1: sha1(Buffer.from('jar')),
          sha512: null,
        }],
      },
      loader: 'fabric',
      minecraftVersion: '1.20.1',
    }),
    (error: unknown) =>
      error instanceof ModrinthError && error.kind === 'invalid-input',
  );
});

test('downloadVersion rejects declared size mismatches and removes temporary files', async (t) => {
  const jar = Buffer.from('jar');
  const server = await startServer((_request, url) =>
    url.pathname === '/download/mod.jar'
      ? { body: jar }
      : { status: 404, json: {} },
  );
  t.after(server.close);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-modrinth-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await assert.rejects(
    makeService(server.baseUrl).downloadVersion({
      instanceDirectory: root,
      version: {
        id: 'wrong-size',
        projectId: 'project',
        name: 'Wrong size',
        versionNumber: '1',
        versionType: 'release',
        gameVersions: ['1.20.1'],
        loaders: ['fabric'],
        datePublished: null,
        dependencies: [],
        files: [{
          url: `${server.baseUrl}/download/mod.jar`,
          filename: 'mod.jar',
          primary: true,
          size: jar.length + 1,
          sha1: sha1(jar),
          sha512: null,
        }],
      },
      loader: 'fabric',
      minecraftVersion: '1.20.1',
    }),
    (error: unknown) =>
      error instanceof ModrinthError && error.kind === 'download-failed',
  );
  assert.deepEqual(await fs.readdir(path.join(root, 'mods')), []);
});

test('downloadVersion normalizes traversal file names into instance mods', async (t) => {
  const jar = Buffer.from('jar');
  const server = await startServer((_request, url) =>
    url.pathname === '/download/mod.jar'
      ? { body: jar }
      : { status: 404, json: {} },
  );
  t.after(server.close);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mason-modrinth-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await makeService(server.baseUrl).downloadVersion({
    instanceDirectory: root,
    version: {
      id: 'safe-name',
      projectId: 'project',
      name: 'Safe name',
      versionNumber: '1',
      versionType: 'release',
      gameVersions: ['1.20.1'],
      loaders: ['fabric'],
      datePublished: null,
      dependencies: [],
      files: [{
        url: `${server.baseUrl}/download/mod.jar`,
        filename: '../../outside.jar',
        primary: true,
        size: jar.length,
        sha1: sha1(jar),
        sha512: null,
      }],
    },
    loader: 'fabric',
    minecraftVersion: '1.20.1',
  });

  assert.equal(result.fileName, 'outside.jar');
  assert.equal(
    await fs.readFile(path.join(root, 'mods', 'outside.jar'), 'utf8'),
    'jar',
  );
  await assert.rejects(fs.access(path.join(root, '..', 'outside.jar')));
});
