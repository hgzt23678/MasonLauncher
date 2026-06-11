import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ZipFile } from 'yazl';
import { MinecraftDownloader } from '../src/minecraft-downloader';
import { MinecraftError } from '../src/minecraft-errors';

const sha1 = (value: Buffer) =>
  createHash('sha1').update(value).digest('hex');

const createZip = () =>
  new Promise<Buffer>((resolve, reject) => {
    const zip = new ZipFile();
    const chunks: Buffer[] = [];
    zip.addBuffer(Buffer.from('native fixture'), 'fixture-native.dll');
    zip.addBuffer(Buffer.from('ignored'), 'META-INF/MANIFEST.MF');
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once('error', reject);
    zip.outputStream.once('end', () => resolve(Buffer.concat(chunks)));
    zip.end();
  });

test('公式メタデータ構造から全ファイルを取得・再利用し、破損clientを再取得する', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scl-download-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const routes = new Map<string, Buffer>();
  const requests = new Map<string, number>();
  const server = http.createServer((request, response) => {
    const requestPath = request.url ?? '/';
    requests.set(requestPath, (requests.get(requestPath) ?? 0) + 1);
    const body = routes.get(requestPath);
    if (!body) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'content-length': body.length,
      'content-type': requestPath.endsWith('.json')
        ? 'application/json'
        : 'application/octet-stream',
    });
    response.end(body);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', resolve),
  );
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const client = Buffer.from('client jar fixture');
  const library = Buffer.from('library jar fixture');
  const native = await createZip();
  const logging = Buffer.from('<Configuration />');
  const asset = Buffer.from('asset fixture');
  const assetHash = sha1(asset);
  const assetIndex = Buffer.from(
    JSON.stringify({
      objects: {
        'minecraft/test.txt': {
          hash: assetHash,
          size: asset.length,
        },
        'minecraft/test-copy.txt': {
          hash: assetHash,
          size: asset.length,
        },
      },
    }),
  );
  const versionJson = Buffer.from(
    JSON.stringify({
      id: 'test-version',
      type: 'release',
      time: '2026-01-01T00:00:00Z',
      releaseTime: '2026-01-01T00:00:00Z',
      mainClass: 'net.minecraft.client.main.Main',
      minimumLauncherVersion: 0,
      javaVersion: {
        component: 'java-runtime-test',
        majorVersion: 17,
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
      assetIndex: {
        id: 'test-assets',
        sha1: sha1(assetIndex),
        size: assetIndex.length,
        totalSize: asset.length,
        url: `${baseUrl}/assets/index.json`,
      },
      assets: 'test-assets',
      downloads: {
        client: {
          sha1: sha1(client),
          size: client.length,
          url: `${baseUrl}/client.jar`,
        },
      },
      libraries: [
        {
          name: 'example:library:1.0',
          downloads: {
            artifact: {
              path: 'example/library/1.0/library-1.0.jar',
              sha1: sha1(library),
              size: library.length,
              url: `${baseUrl}/library.jar`,
            },
          },
        },
        {
          name: 'example:native:1.0',
          natives: {
            windows: 'natives-windows-${arch}',
          },
          extract: {
            exclude: ['META-INF/'],
          },
          downloads: {
            classifiers: {
              'natives-windows-64': {
                path: 'example/native/1.0/native-1.0-natives-windows-64.jar',
                sha1: sha1(native),
                size: native.length,
                url: `${baseUrl}/native.jar`,
              },
            },
          },
        },
      ],
      logging: {
        client: {
          argument: '-Dlog4j.configurationFile=${path}',
          file: {
            id: 'client-test.xml',
            sha1: sha1(logging),
            size: logging.length,
            url: `${baseUrl}/client-test.xml`,
          },
          type: 'log4j2-xml',
        },
      },
    }),
  );
  const manifest = Buffer.from(
    JSON.stringify({
      latest: { release: 'test-version', snapshot: 'test-version' },
      versions: [
        {
          id: 'test-version',
          type: 'release',
          url: `${baseUrl}/version.json`,
          sha1: sha1(versionJson),
          time: '2026-01-01T00:00:00Z',
          releaseTime: '2026-01-01T00:00:00Z',
        },
      ],
    }),
  );
  routes.set('/manifest.json', manifest);
  routes.set('/version.json', versionJson);
  routes.set('/client.jar', client);
  routes.set('/library.jar', library);
  routes.set('/native.jar', native);
  routes.set('/client-test.xml', logging);
  routes.set('/assets/index.json', assetIndex);
  routes.set(`/objects/${assetHash.slice(0, 2)}/${assetHash}`, asset);

  const downloader = new MinecraftDownloader(
    async () => root,
    () => undefined,
    {
      manifestUrl: `${baseUrl}/manifest.json`,
      assetObjectBaseUrl: `${baseUrl}/objects`,
      platform: { name: 'windows', version: '11', arch: 'x64' },
      retries: 1,
    },
  );

  const staleTemporary = path.join(
    root,
    'versions',
    'test-version',
    'test-version.jar.tmp-stale',
  );
  await fs.mkdir(path.dirname(staleTemporary), { recursive: true });
  await fs.writeFile(staleTemporary, 'partial');
  const first = await downloader.prepareVersion('test-version');
  await assert.rejects(fs.access(staleTemporary));
  assert.equal(first.client.downloaded, true);
  assert.equal(first.libraries.downloaded, 2);
  assert.equal(first.assets.downloaded, 1);
  assert.equal(
    await fs.readFile(
      path.join(root, 'versions', 'test-version', 'test-version.jar'),
      'utf8',
    ),
    client.toString(),
  );
  assert.equal(
    await fs.readFile(
      path.join(first.nativesDirectory, 'fixture-native.dll'),
      'utf8',
    ),
    'native fixture',
  );
  await assert.rejects(
    fs.access(path.join(first.nativesDirectory, 'MANIFEST.MF')),
  );

  const clientRequests = requests.get('/client.jar');
  const libraryRequests = requests.get('/library.jar');
  const assetRequests =
    requests.get(`/objects/${assetHash.slice(0, 2)}/${assetHash}`);
  const second = await downloader.prepareVersion('test-version');
  assert.equal(second.client.downloaded, false);
  assert.equal(second.libraries.skipped, 2);
  assert.equal(second.assets.skipped, 1);
  assert.equal(requests.get('/client.jar'), clientRequests);
  assert.equal(requests.get('/library.jar'), libraryRequests);
  assert.equal(
    requests.get(`/objects/${assetHash.slice(0, 2)}/${assetHash}`),
    assetRequests,
  );

  await fs.writeFile(
    path.join(root, 'versions', 'test-version', 'test-version.jar'),
    Buffer.alloc(client.length),
  );
  const third = await downloader.prepareVersion('test-version');
  assert.equal(third.client.downloaded, true);
  assert.equal(requests.get('/client.jar'), (clientRequests ?? 0) + 1);

  const libraryPath = path.join(
    root,
    'libraries',
    'example',
    'library',
    '1.0',
    'library-1.0.jar',
  );
  await fs.rm(libraryPath, { force: true });
  const requestsBeforeOfflineCheck = [...requests.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  await assert.rejects(
    downloader.prepareInstalledVersion('test-version', undefined, {
      offlineOnly: true,
    }),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.category === 'offline-files' &&
      error.code === 'LOCAL_FILE_MISSING_OR_INVALID',
  );
  assert.equal(
    [...requests.values()].reduce((sum, count) => sum + count, 0),
    requestsBeforeOfflineCheck,
  );
});

test('DNS失敗をnetworkカテゴリとして分類する', async () => {
  const failure = Object.assign(new Error('getaddrinfo ENOTFOUND'), {
    code: 'ENOTFOUND',
  });
  const downloader = new MinecraftDownloader(
    async () => os.tmpdir(),
    () => undefined,
    {
      fetch: (async () => {
        throw failure;
      }) as typeof fetch,
      retries: 0,
    },
  );
  await assert.rejects(
    downloader.getManifest(),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.category === 'network' &&
      error.code === 'ENOTFOUND',
  );
});

test('HTTP、JSON、タイムアウトを別のエラーとして分類する', async () => {
  const httpDownloader = new MinecraftDownloader(
    async () => os.tmpdir(),
    () => undefined,
    {
      fetch: (async () =>
        new Response('forbidden', {
          status: 403,
          statusText: 'Forbidden',
        })) as typeof fetch,
      retries: 0,
    },
  );
  await assert.rejects(
    httpDownloader.getManifest(),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.category === 'download' &&
      error.code === 'HTTP_403',
  );

  const jsonDownloader = new MinecraftDownloader(
    async () => os.tmpdir(),
    () => undefined,
    {
      fetch: (async () =>
        new Response('{invalid', { status: 200 })) as typeof fetch,
      retries: 0,
    },
  );
  await assert.rejects(
    jsonDownloader.getManifest(),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.category === 'json' &&
      error.code === 'JSON_PARSE_ERROR',
  );

  const timeoutDownloader = new MinecraftDownloader(
    async () => os.tmpdir(),
    () => undefined,
    {
      fetch: ((_, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        })) as typeof fetch,
      timeoutMs: 5,
      retries: 0,
    },
  );
  await assert.rejects(
    timeoutDownloader.getManifest(),
    (error: unknown) =>
      error instanceof MinecraftError &&
      error.category === 'network' &&
      error.code === 'ETIMEDOUT',
  );
});
