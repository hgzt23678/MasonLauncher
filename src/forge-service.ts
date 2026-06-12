import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  LibraryInfo,
  MinecraftFolder,
  type ResolvedVersion,
} from '@xmcl/core';
import {
  installForgeTask,
  resolveProcessors,
  type InstallProfile,
} from '@xmcl/installer';
import type { Task, TaskContext } from '@xmcl/task';
import {
  filterEntries,
  open,
  readEntry,
  walkEntriesGenerator,
} from '@xmcl/unzip';
import { XMLParser } from 'fast-xml-parser';
import type {
  LauncherLogLevel,
  LauncherLogStage,
} from './diagnostics';
import { MinecraftError, toMinecraftError } from './minecraft-errors';

const FORGE_MAVEN = 'https://maven.minecraftforge.net';
const FORGE_METADATA_URL =
  `${FORGE_MAVEN}/net/minecraftforge/forge/maven-metadata.xml`;

type LogWriter = (
  level: LauncherLogLevel,
  stage: LauncherLogStage,
  message: string,
  detail?: Record<string, unknown>,
) => void;

export type ForgeBuild = {
  minecraftVersion: string;
  loaderVersion: string;
  artifactVersion: string;
  resolvedVersionId: string;
  installerUrl: string;
};

export type ForgeProgress = {
  percent: number;
  message: string;
  file?: string;
};

type VersionJson = {
  id?: string;
  inheritsFrom?: string;
  mainClass?: string;
  libraries?: unknown[];
};

type ParsedInstaller = {
  profile: InstallProfile;
  versionJson: VersionJson;
  format: string;
  clientProcessors: number;
};

type PreparedVersion = {
  version: ResolvedVersion;
};

type ForgeServiceOptions = {
  fetch?: typeof fetch;
  prepareInstalledVersion: (
    versionId: string,
    offlineOnly: boolean,
  ) => Promise<PreparedVersion>;
};

const normalizeArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const compareNumericVersion = (left: string, right: string) => {
  const a = left.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return right.localeCompare(left);
};

export const parseForgeMavenMetadata = (
  xml: string,
  minecraftVersion: string,
): ForgeBuild[] => {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: true,
  }).parse(xml) as {
    metadata?: {
      versioning?: {
        versions?: {
          version?: string | string[];
        };
      };
    };
  };
  const prefix = `${minecraftVersion}-`;
  return normalizeArray(
    parsed.metadata?.versioning?.versions?.version,
  )
    .filter(
      (version): version is string =>
        typeof version === 'string' &&
        version.startsWith(prefix) &&
        version.length > prefix.length,
    )
    .map((artifactVersion) => {
      const loaderVersion = artifactVersion.slice(prefix.length);
      return {
        minecraftVersion,
        loaderVersion,
        artifactVersion,
        resolvedVersionId: `${minecraftVersion}-forge-${loaderVersion}`,
        installerUrl:
          `${FORGE_MAVEN}/net/minecraftforge/forge/${artifactVersion}/` +
          `forge-${artifactVersion}-installer.jar`,
      };
    })
    .sort((left, right) =>
      compareNumericVersion(left.loaderVersion, right.loaderVersion),
    );
};

const sha1File = async (filePath: string) => {
  const hash = createHash('sha1');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
};

const isSha1 = (value: string) => /^[a-f0-9]{40}$/i.test(value);

export class ForgeService {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly gameDirectory: () => Promise<string>,
    private readonly log: LogWriter,
    private readonly options: ForgeServiceOptions,
  ) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async request(url: string, category: 'metadata' | 'installer') {
    let response: Response;
    try {
      response = await this.fetchImpl(url);
    } catch (error) {
      throw new MinecraftError(
        `Forge ${category} request failed.`,
        category === 'installer' ? 'forge-installer' : 'download',
        'FORGE_NETWORK_ERROR',
        { url },
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new MinecraftError(
        `Forge ${category} request returned HTTP ${response.status}.`,
        category === 'installer' ? 'forge-installer' : 'download',
        `HTTP_${response.status}`,
        { url },
      );
    }
    return response;
  }

  async getBuilds(minecraftVersion: string) {
    const response = await this.request(FORGE_METADATA_URL, 'metadata');
    const builds = parseForgeMavenMetadata(
      await response.text(),
      minecraftVersion,
    );
    this.log('info', 'forge', 'Forge build list loaded.', {
      minecraftVersion,
      builds: builds.length,
      source: FORGE_METADATA_URL,
    });
    return builds;
  }

  private installerPath(root: string, build: ForgeBuild) {
    return path.join(
      root,
      'libraries',
      'net',
      'minecraftforge',
      'forge',
      build.artifactVersion,
      `forge-${build.artifactVersion}-installer.jar`,
    );
  }

  private markerPath(root: string, versionId: string) {
    return path.join(
      root,
      'versions',
      versionId,
      '.simple-craft-forge.json',
    );
  }

  private async downloadInstaller(root: string, build: ForgeBuild) {
    const destination = this.installerPath(root, build);
    const shaResponse = await this.request(
      `${build.installerUrl}.sha1`,
      'installer',
    );
    const expectedSha1 = (await shaResponse.text()).trim().split(/\s+/)[0];
    if (!isSha1(expectedSha1)) {
      throw new MinecraftError(
        'Forge installer SHA-1 response is invalid.',
        'forge-installer',
        'FORGE_INSTALLER_INVALID_SHA1',
        { url: `${build.installerUrl}.sha1` },
      );
    }
    try {
      if ((await sha1File(destination)) === expectedSha1) {
        return { destination, expectedSha1, downloaded: false };
      }
      await fs.rm(destination, { force: true });
    } catch {
      // Missing or unreadable installer is downloaded below.
    }

    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
    try {
      const response = await this.request(build.installerUrl, 'installer');
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length === 0) {
        throw new MinecraftError(
          'Forge installer download was empty.',
          'forge-installer',
          'FORGE_INSTALLER_EMPTY',
        );
      }
      await fs.writeFile(temporary, body, { flag: 'wx' });
      const actualSha1 = await sha1File(temporary);
      if (actualSha1 !== expectedSha1) {
        throw new MinecraftError(
          'Forge installer SHA-1 verification failed.',
          'forge-installer',
          'FORGE_INSTALLER_HASH_MISMATCH',
          { expectedSha1, actualSha1 },
        );
      }
      await fs.rm(destination, { force: true });
      await fs.rename(temporary, destination);
      return { destination, expectedSha1, downloaded: true };
    } finally {
      await fs.rm(temporary, { force: true }).catch((): void => undefined);
    }
  }

  async parseInstaller(installerPath: string): Promise<ParsedInstaller> {
    const installerBuffer = await fs.readFile(installerPath);
    const zip = await open(installerBuffer, {
      lazyEntries: true,
      autoClose: false,
    });
    let profileBuffer: Buffer | undefined;
    let versionBuffer: Buffer | undefined;
    try {
      for await (const entry of walkEntriesGenerator(zip)) {
        if (entry.fileName === 'install_profile.json') {
          profileBuffer = await readEntry(zip, entry);
        } else if (entry.fileName === 'version.json') {
          versionBuffer = await readEntry(zip, entry);
        }
        if (profileBuffer && versionBuffer) break;
      }
    } catch (error) {
      throw new MinecraftError(
        'Forge installer ZIP could not be read.',
        'forge-profile',
        'FORGE_INSTALLER_ZIP_ERROR',
        { installerPath },
        { cause: error },
      );
    } finally {
      zip.close();
    }
    if (!profileBuffer) {
      throw new MinecraftError(
        'install_profile.json is missing from the Forge installer.',
        'forge-profile',
        'FORGE_INSTALL_PROFILE_MISSING',
        { installerPath },
      );
    }

    let profile: InstallProfile;
    let versionJson: VersionJson;
    try {
      profile = JSON.parse(profileBuffer.toString('utf8')) as InstallProfile;
    } catch (error) {
      throw new MinecraftError(
        'Forge install_profile.json is invalid.',
        'forge-profile',
        'FORGE_INSTALL_PROFILE_INVALID',
        undefined,
        { cause: error },
      );
    }
    try {
      versionJson = versionBuffer
        ? (JSON.parse(versionBuffer.toString('utf8')) as VersionJson)
        : (profile.versionInfo as VersionJson);
    } catch (error) {
      throw new MinecraftError(
        'Forge version JSON is invalid.',
        'forge-version-json',
        'FORGE_VERSION_JSON_INVALID',
        undefined,
        { cause: error },
      );
    }
    if (
      profile.profile !== 'forge' ||
      !profile.version ||
      !profile.minecraft ||
      !versionJson?.id
    ) {
      throw new MinecraftError(
        'Forge installer metadata is incomplete.',
        'forge-profile',
        'FORGE_INSTALL_PROFILE_INCOMPLETE',
      );
    }
    return {
      profile,
      versionJson,
      format: profile.spec ? `spec-${profile.spec}` : 'legacy',
      clientProcessors: (profile.processors ?? []).filter(
        (processor) =>
          !processor.sides || processor.sides.includes('client'),
      ).length,
    };
  }

  private async saveVersionJson(
    root: string,
    versionJson: VersionJson,
  ) {
    if (!versionJson.id) {
      throw new MinecraftError(
        'Forge version JSON has no id.',
        'forge-version-json',
        'FORGE_VERSION_ID_MISSING',
      );
    }
    const destination = path.join(
      root,
      'versions',
      versionJson.id,
      `${versionJson.id}.json`,
    );
    const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try {
      await fs.writeFile(
        temporary,
        JSON.stringify(versionJson, null, 2),
        'utf8',
      );
      await fs.rm(destination, { force: true });
      await fs.rename(temporary, destination);
    } catch (error) {
      throw new MinecraftError(
        'Forge version JSON could not be saved.',
        'forge-version-json',
        'FORGE_VERSION_JSON_SAVE_FAILED',
        { destination },
        { cause: error },
      );
    } finally {
      await fs.rm(temporary, { force: true }).catch((): void => undefined);
    }
    return destination;
  }

  private async extractLegacyForgeArtifact(
    root: string,
    installerPath: string,
    profile: InstallProfile,
  ) {
    if (!profile.path) {
      throw new MinecraftError(
        'Legacy Forge profile does not identify its embedded artifact.',
        'forge-profile',
        'FORGE_LEGACY_ARTIFACT_MISSING',
      );
    }
    const libraryInfo = LibraryInfo.resolve(profile.path);
    const descriptor = profile.libraries
      .map((library) => ({
        library,
        info: LibraryInfo.resolve(library),
      }))
      .find(({ info }) => info.path === libraryInfo.path)?.library;
    const artifact = descriptor?.downloads?.artifact;
    const expectedSha1 = artifact?.sha1;
    const expectedSize = artifact?.size;
    const entryName = `maven/${libraryInfo.path}`.replaceAll('\\', '/');
    const destination = path.join(root, 'libraries', libraryInfo.path);

    this.log('info', 'forge', 'Validating legacy Forge artifact.', {
      entryName,
      destination,
      expectedSha1: expectedSha1 ?? null,
      expectedSize: expectedSize ?? null,
    });
    try {
      const stat = await fs.stat(destination);
      const hashMatches =
        !expectedSha1 || (await sha1File(destination)) === expectedSha1;
      const sizeMatches =
        expectedSize === undefined ||
        expectedSize < 0 ||
        stat.size === expectedSize;
      if (stat.isFile() && stat.size > 0 && hashMatches && sizeMatches) {
        this.log('info', 'forge', 'Legacy Forge artifact is already valid.', {
          destination,
          size: stat.size,
        });
        return destination;
      }
      this.log('warn', 'forge', 'Legacy Forge artifact is invalid; replacing it.', {
        destination,
        actualSize: stat.size,
        hashMatches,
        sizeMatches,
      });
    } catch {
      // The embedded artifact is extracted below.
    }

    this.log('debug', 'forge', 'Reading legacy Forge artifact from installer.', {
      installerPath,
      entryName,
    });
    const installerArchive = await fs.readFile(installerPath);
    const zip = await open(installerArchive, {
      lazyEntries: true,
      autoClose: false,
    });
    let artifactBuffer: Buffer | undefined;
    try {
      const [entry] = await filterEntries(zip, [entryName]);
      if (entry) {
        artifactBuffer = await readEntry(zip, entry);
        this.log('debug', 'forge', 'Legacy Forge artifact entry was read.', {
          entryName,
          size: artifactBuffer.length,
        });
      }
    } finally {
      zip.close();
    }
    if (!artifactBuffer?.length) {
      throw new MinecraftError(
        'Legacy Forge artifact is missing from the installer.',
        'forge-version-json',
        'FORGE_VERSION_JSON_ARTIFACT_MISSING',
        { entryName },
      );
    }
    if (
      expectedSize !== undefined &&
      expectedSize >= 0 &&
      artifactBuffer.length !== expectedSize
    ) {
      throw new MinecraftError(
        'Legacy Forge artifact size verification failed.',
        'forge-library',
        'FORGE_LEGACY_ARTIFACT_SIZE_MISMATCH',
        {
          entryName,
          expectedSize,
          actualSize: artifactBuffer.length,
        },
      );
    }
    const actualSha1 = createHash('sha1')
      .update(artifactBuffer)
      .digest('hex');
    if (expectedSha1 && actualSha1 !== expectedSha1) {
      throw new MinecraftError(
        'Legacy Forge artifact SHA-1 verification failed.',
        'forge-library',
        'FORGE_LEGACY_ARTIFACT_HASH_MISMATCH',
        { entryName, expectedSha1, actualSha1 },
      );
    }

    const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try {
      this.log('debug', 'forge', 'Writing verified legacy Forge artifact.', {
        temporary,
        destination,
      });
      await fs.writeFile(temporary, artifactBuffer, { flag: 'wx' });
      await fs.rm(destination, { force: true });
      await fs.rename(temporary, destination);
    } finally {
      await fs.rm(temporary, { force: true }).catch((): void => undefined);
    }
    this.log('info', 'forge', 'Legacy Forge artifact extracted.', {
      entryName,
      destination,
      sha1Verified: Boolean(expectedSha1),
      sizeVerified: expectedSize !== undefined && expectedSize >= 0,
    });
    return destination;
  }

  private async verifyProcessorOutputs(
    root: string,
    outputs: Array<{ path: string; sha1: string | null }>,
  ) {
    for (const output of outputs) {
      const destination = path.resolve(root, output.path);
      if (
        destination !== path.resolve(root) &&
        !destination.startsWith(`${path.resolve(root)}${path.sep}`)
      ) {
        throw new MinecraftError(
          'Forge processor output points outside the game directory.',
          'forge-processor',
          'FORGE_PROCESSOR_OUTPUT_PATH_INVALID',
          { output: output.path },
        );
      }
      let stat;
      try {
        stat = await fs.stat(destination);
      } catch (error) {
        throw new MinecraftError(
          'A Forge processor output is missing.',
          'forge-processor',
          'FORGE_PROCESSOR_OUTPUT_MISSING',
          { output: output.path },
          { cause: error },
        );
      }
      if (!stat.isFile() || stat.size === 0) {
        throw new MinecraftError(
          'A Forge processor output is empty.',
          'forge-processor',
          'FORGE_PROCESSOR_OUTPUT_EMPTY',
          { output: output.path },
        );
      }
      if (output.sha1) {
        const actualSha1 = await sha1File(destination);
        if (actualSha1 !== output.sha1) {
          throw new MinecraftError(
            'A Forge processor output failed SHA-1 verification.',
            'forge-processor',
            'FORGE_PROCESSOR_OUTPUT_HASH_MISMATCH',
            { output: output.path, expectedSha1: output.sha1, actualSha1 },
          );
        }
      }
    }
  }

  private taskContext(
    rootTask: Task<unknown>,
    onProgress: (progress: ForgeProgress) => void,
  ): TaskContext {
    const emit = (task: Task<unknown>) => {
      const total = rootTask.total || task.total;
      const current = rootTask.progress || task.progress;
      onProgress({
        percent:
          total > 0
            ? Math.min(99, Math.round((current / total) * 100))
            : 0,
        message: 'Installing Forge libraries and processors.',
        file: task.to ? path.basename(task.to) : task.name,
      });
    };
    return { onStart: emit, onUpdate: emit };
  }

  async verifyReady(
    minecraftVersion: string,
    loaderVersion: string,
    offlineOnly: boolean,
  ) {
    const root = await this.gameDirectory();
    const expectedVersionId = `${minecraftVersion}-forge-${loaderVersion}`;
    let marker: {
      minecraftVersion?: string;
      loaderVersion?: string;
      resolvedVersionId?: string;
      processorCount?: number;
      processorOutputs?: Array<{ path: string; sha1: string | null }>;
    };
    try {
      marker = JSON.parse(
        await fs.readFile(
          this.markerPath(root, expectedVersionId),
          'utf8',
        ),
      ) as typeof marker;
    } catch (error) {
      throw new MinecraftError(
        'Forge processors have not completed for this profile.',
        'forge-processor',
        'FORGE_PROCESSOR_NOT_COMPLETE',
        { expectedVersionId },
        { cause: error },
      );
    }
    if (
      marker.minecraftVersion !== minecraftVersion ||
      marker.loaderVersion !== loaderVersion ||
      marker.resolvedVersionId !== expectedVersionId ||
      !Array.isArray(marker.processorOutputs)
    ) {
      throw new MinecraftError(
        'Forge processor completion marker does not match this profile.',
        'forge-processor',
        'FORGE_PROCESSOR_MARKER_MISMATCH',
        { expectedVersionId },
      );
    }
    await this.verifyProcessorOutputs(root, marker.processorOutputs);
    await this.options.prepareInstalledVersion(
      expectedVersionId,
      offlineOnly,
    );
    return expectedVersionId;
  }

  async ensureInstalled(
    minecraftVersion: string,
    loaderVersion: string,
    java: string,
    onProgress: (progress: ForgeProgress) => void = () => undefined,
  ) {
    try {
      return await this.verifyReady(
        minecraftVersion,
        loaderVersion,
        false,
      );
    } catch {
      // Install or repair below.
    }

    const build = (await this.getBuilds(minecraftVersion)).find(
      (candidate) => candidate.loaderVersion === loaderVersion,
    );
    if (!build) {
      throw new MinecraftError(
        `Forge ${loaderVersion} for Minecraft ${minecraftVersion} was not found.`,
        'forge-installer',
        'FORGE_BUILD_NOT_FOUND',
      );
    }

    const root = await this.gameDirectory();
    this.log('info', 'forge', 'Forge installer selected.', {
      installerUrl: build.installerUrl,
      minecraftVersion,
      loaderVersion,
    });
    onProgress({
      percent: 0,
      message: `Downloading Forge ${loaderVersion} installer.`,
    });
    const installer = await this.downloadInstaller(root, build);
    const parsed = await this.parseInstaller(installer.destination);
    if (
      parsed.profile.minecraft !== minecraftVersion ||
      parsed.versionJson.inheritsFrom !== minecraftVersion
    ) {
      throw new MinecraftError(
        'Forge installer parent Minecraft version does not match the profile.',
        'forge-profile',
        'FORGE_PARENT_VERSION_MISMATCH',
        {
          expected: minecraftVersion,
          profileMinecraft: parsed.profile.minecraft,
          inheritsFrom: parsed.versionJson.inheritsFrom ?? null,
        },
      );
    }
    if (parsed.versionJson.id !== build.resolvedVersionId) {
      throw new MinecraftError(
        'Forge installer version id does not match the selected build.',
        'forge-version-json',
        'FORGE_VERSION_ID_MISMATCH',
        {
          expected: build.resolvedVersionId,
          actual: parsed.versionJson.id,
        },
      );
    }
    const versionJsonPath = await this.saveVersionJson(
      root,
      parsed.versionJson,
    );
    this.log('info', 'forge', 'Forge installer metadata parsed.', {
      installerFormat: parsed.format,
      forgeVersionId: parsed.versionJson.id,
      inheritsFrom: parsed.versionJson.inheritsFrom ?? null,
      versionJsonPath,
      installProfileLibraries: parsed.profile.libraries?.length ?? 0,
      launchLibraries: parsed.versionJson.libraries?.length ?? 0,
      clientProcessors: parsed.clientProcessors,
      installerSha1: installer.expectedSha1,
      installerDownloaded: installer.downloaded,
    });

    let processorSuccess = 0;
    let processorFailed = 0;
    let installedVersionId: string;
    if (parsed.format === 'legacy' && parsed.clientProcessors === 0) {
      await this.extractLegacyForgeArtifact(
        root,
        installer.destination,
        parsed.profile,
      );
      installedVersionId = parsed.versionJson.id;
      this.log(
        'info',
        'forge',
        'Legacy Forge profile has no client processors; embedded artifact was installed directly.',
        {
          forgeVersionId: installedVersionId,
          processorSuccess,
          processorFailed,
        },
      );
    } else {
      const task = installForgeTask(
        {
          mcversion: minecraftVersion,
          version: loaderVersion,
          installer: {
            path: build.installerUrl,
            sha1: installer.expectedSha1,
          },
        },
        root,
        {
          java,
          side: 'client',
          libraryHost: (library) => [
            library.download.url ||
              new URL(library.download.path, `${FORGE_MAVEN}/`).toString(),
          ],
          librariesDownloadConcurrency: 8,
          spawn: (command, args, options) => {
            const child = spawn(command, args, options);
            child.stderr?.on('data', (chunk: Buffer) => {
              for (const line of chunk
                .toString()
                .split(/\r?\n/)
                .map((value) => value.trim())
                .filter(Boolean)) {
                this.log('warn', 'forge', line, {
                  stream: 'processor-stderr',
                });
              }
            });
            return child;
          },
          onPostProcessSuccess: (
            processor,
            _jar,
            classpath,
            mainClass,
          ) => {
            processorSuccess += 1;
            this.log('info', 'forge', 'Forge client processor completed.', {
              processor: processor.jar,
              mainClass,
              processorClasspathEntries: classpath
                .split(path.delimiter)
                .filter(Boolean).length,
            });
          },
          onPostProcessFailed: (
            processor,
            _jar,
            classpath,
            mainClass,
            _args,
            error,
          ) => {
            processorFailed += 1;
            this.log('error', 'forge', 'Forge client processor failed.', {
              processor: processor.jar,
              mainClass,
              processorClasspathEntries: classpath
                .split(path.delimiter)
                .filter(Boolean).length,
              message: error instanceof Error ? error.message : String(error),
            });
          },
        },
      );

      try {
        installedVersionId = await task.startAndWait(
          this.taskContext(task, onProgress),
        );
      } catch (error) {
        throw new MinecraftError(
          'Forge client processor execution failed.',
          processorFailed > 0 ? 'forge-processor' : 'forge-library',
          processorFailed > 0
            ? 'FORGE_PROCESSOR_FAILED'
            : 'FORGE_LIBRARY_DOWNLOAD_FAILED',
          {
            processorSuccess,
            processorFailed,
            expectedProcessors: parsed.clientProcessors,
          },
          { cause: error },
        );
      }
    }
    if (installedVersionId !== build.resolvedVersionId) {
      throw new MinecraftError(
        'Forge installer returned an unexpected version id.',
        'forge-version-json',
        'FORGE_INSTALLED_VERSION_ID_MISMATCH',
        { expected: build.resolvedVersionId, actual: installedVersionId },
      );
    }
    try {
      await this.options.prepareInstalledVersion(installedVersionId, false);
    } catch (error) {
      throw new MinecraftError(
        'Forge launch libraries could not be downloaded or verified.',
        'forge-library',
        'FORGE_LAUNCH_LIBRARY_VALIDATION_FAILED',
        { installedVersionId },
        { cause: error },
      );
    }
    const processorOutputs = resolveProcessors(
      'client',
      parsed.profile,
      MinecraftFolder.from(root),
    ).flatMap((processor) =>
      Object.entries(processor.outputs ?? {}).map(([output, expectedSha1]) => ({
        path: path.relative(root, output),
        sha1: isSha1(expectedSha1.replaceAll("'", ''))
          ? expectedSha1.replaceAll("'", '').toLowerCase()
          : null,
      })),
    );
    await this.verifyProcessorOutputs(root, processorOutputs);
    const marker = {
      schemaVersion: 1,
      minecraftVersion,
      loaderVersion,
      resolvedVersionId: installedVersionId,
      installerSha1: installer.expectedSha1,
      installProfileFormat: parsed.format,
      processorCount: parsed.clientProcessors,
      processorSuccess,
      processorFailed,
      processorOutputs,
      completedAt: new Date().toISOString(),
    };
    await fs.writeFile(
      this.markerPath(root, installedVersionId),
      JSON.stringify(marker, null, 2),
      'utf8',
    );
    this.log('info', 'forge', 'Forge installation completed.', {
      ...marker,
      mainClass: parsed.versionJson.mainClass ?? null,
      libraries:
        (parsed.profile.libraries?.length ?? 0) +
        (parsed.versionJson.libraries?.length ?? 0),
    });
    onProgress({
      percent: 100,
      message: `Forge ${loaderVersion} is ready.`,
    });
    return installedVersionId;
  }

  normalizeError(error: unknown) {
    return toMinecraftError(
      error,
      'forge-installer',
      'Forge installation failed.',
    );
  }
}
