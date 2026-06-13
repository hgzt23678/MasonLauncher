import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ZipFile } from 'yazl';
import {
  ForgeService,
  parseForgeMavenMetadata,
} from '../src/forge-service';

const createInstaller = () =>
  new Promise<Buffer>((resolve, reject) => {
    const zip = new ZipFile();
    const chunks: Buffer[] = [];
    zip.addBuffer(
      Buffer.from(
        JSON.stringify({
          spec: 1,
          profile: 'forge',
          version: '1.20.1-forge-47.4.0',
          minecraft: '1.20.1',
          json: '/version.json',
          path: null,
          libraries: [],
          processors: [
            {
              sides: ['client'],
              jar: 'example:processor:1.0',
              classpath: [],
              args: [],
            },
            {
              sides: ['server'],
              jar: 'example:server-processor:1.0',
              classpath: [],
              args: [],
            },
          ],
        }),
      ),
      'install_profile.json',
    );
    zip.addBuffer(
      Buffer.from(
        JSON.stringify({
          id: '1.20.1-forge-47.4.0',
          inheritsFrom: '1.20.1',
          mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
          libraries: [],
        }),
      ),
      'version.json',
    );
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once('error', reject);
    zip.outputStream.once('end', () => resolve(Buffer.concat(chunks)));
    zip.end();
  });

const createLegacyInstaller = () =>
  new Promise<{ installer: Buffer; forgeJar: Buffer }>((resolve, reject) => {
    const zip = new ZipFile();
    const chunks: Buffer[] = [];
    const forgeJar = Buffer.from('verified legacy forge artifact');
    const artifactPath =
      'net/minecraftforge/forge/1.12.2-14.23.5.2864/' +
      'forge-1.12.2-14.23.5.2864.jar';
    const sha1 = createHash('sha1').update(forgeJar).digest('hex');
    const library = {
      name: 'net.minecraftforge:forge:1.12.2-14.23.5.2864',
      downloads: {
        artifact: {
          path: artifactPath,
          url: '',
          sha1,
          size: forgeJar.length,
        },
      },
    };
    zip.addBuffer(
      Buffer.from(
        JSON.stringify({
          spec: 0,
          profile: 'forge',
          version: '1.12.2-forge-14.23.5.2864',
          minecraft: '1.12.2',
          json: '/version.json',
          path: library.name,
          libraries: [library],
          processors: [],
        }),
      ),
      'install_profile.json',
    );
    zip.addBuffer(
      Buffer.from(
        JSON.stringify({
          id: '1.12.2-forge-14.23.5.2864',
          inheritsFrom: '1.12.2',
          mainClass: 'net.minecraft.launchwrapper.Launch',
          libraries: [library],
        }),
      ),
      'version.json',
    );
    zip.addBuffer(forgeJar, `maven/${artifactPath}`);
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once('error', reject);
    zip.outputStream.once('end', () =>
      resolve({ installer: Buffer.concat(chunks), forgeJar }),
    );
    zip.end();
  });

test('Forge Maven metadata is filtered by Minecraft version and sorted', () => {
  const builds = parseForgeMavenMetadata(
    `<?xml version="1.0"?>
     <metadata><versioning><versions>
       <version>1.20.1-47.3.0</version>
       <version>1.21.1-52.0.1</version>
       <version>1.20.1-47.4.0</version>
     </versions></versioning></metadata>`,
    '1.20.1',
  );
  assert.deepEqual(
    builds.map((build) => build.loaderVersion),
    ['47.4.0', '47.3.0'],
  );
  assert.equal(builds[0].resolvedVersionId, '1.20.1-forge-47.4.0');
  assert.match(builds[0].installerUrl, /^https:\/\/maven\.minecraftforge\.net\//);
});

test('Forge installer parser reads install_profile and client processors', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scl-forge-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installerPath = path.join(root, 'forge-installer.jar');
  await fs.writeFile(installerPath, await createInstaller());
  const service = new ForgeService(async () => root, () => undefined, {
    prepareInstalledVersion: async () => {
      throw new Error('not used');
    },
  });
  const parsed = await service.parseInstaller(installerPath);
  assert.equal(parsed.format, 'spec-1');
  assert.equal(parsed.profile.minecraft, '1.20.1');
  assert.equal(parsed.versionJson.id, '1.20.1-forge-47.4.0');
  assert.equal(parsed.versionJson.inheritsFrom, '1.20.1');
  assert.equal(parsed.clientProcessors, 1);
});

test('processor-free legacy Forge extracts its embedded artifact', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scl-forge-legacy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { installer, forgeJar } = await createLegacyInstaller();
  const installerSha1 = createHash('sha1')
    .update(installer)
    .digest('hex');
  const installerUrl =
    'https://maven.minecraftforge.net/net/minecraftforge/forge/' +
    '1.12.2-14.23.5.2864/' +
    'forge-1.12.2-14.23.5.2864-installer.jar';
  const service = new ForgeService(async () => root, () => undefined, {
    fetch: (async (input) => {
      const url = String(input);
      if (url.endsWith('maven-metadata.xml')) {
        return new Response(
          '<metadata><versioning><versions>' +
            '<version>1.12.2-14.23.5.2864</version>' +
            '</versions></versioning></metadata>',
        );
      }
      if (url === `${installerUrl}.sha1`) {
        return new Response(installerSha1);
      }
      if (url === installerUrl) {
        return new Response(new Uint8Array(installer));
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch,
    prepareInstalledVersion: async (versionId) => {
      assert.equal(versionId, '1.12.2-forge-14.23.5.2864');
      return { version: {} as never };
    },
  });

  const versionId = await service.ensureInstalled(
    '1.12.2',
    '14.23.5.2864',
    'java',
  );
  assert.equal(versionId, '1.12.2-forge-14.23.5.2864');
  const artifact = await fs.readFile(
    path.join(
      root,
      'libraries',
      'net',
      'minecraftforge',
      'forge',
      '1.12.2-14.23.5.2864',
      'forge-1.12.2-14.23.5.2864.jar',
    ),
  );
  assert.deepEqual(artifact, forgeJar);
  const marker = JSON.parse(
    await fs.readFile(
      path.join(
        root,
        'versions',
        versionId,
        '.simple-craft-forge.json',
      ),
      'utf8',
    ),
  ) as { processorCount: number; processorOutputs: unknown[] };
  assert.equal(marker.processorCount, 0);
  assert.deepEqual(marker.processorOutputs, []);
});
