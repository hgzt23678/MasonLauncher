import { promises as fs } from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { installNeoForged } from '@xmcl/installer';
import type { ResolvedVersion } from '@xmcl/core';
import type {
  LauncherLogLevel,
  LauncherLogStage,
} from './diagnostics';
import { MinecraftError } from './minecraft-errors';

const FABRIC_META = 'https://meta.fabricmc.net';
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases';
const NEOFORGE_METADATA =
  `${NEOFORGE_MAVEN}/net/neoforged/neoforge/maven-metadata.xml`;

export type ModLoaderType = 'forge' | 'neoforge' | 'fabric';

export type ModLoaderBuild = {
  loader: ModLoaderType;
  minecraftVersion: string;
  loaderVersion: string;
  resolvedVersionId: string;
  stable: boolean;
};

type LogWriter = (
  level: LauncherLogLevel,
  stage: LauncherLogStage,
  message: string,
  detail?: Record<string, unknown>,
) => void;

type PreparedVersion = {
  version: ResolvedVersion;
};

type ModLoaderServiceOptions = {
  fetch?: typeof fetch;
  installNeoForge?: typeof installNeoForged;
  prepareInstalledVersion: (
    versionId: string,
    offlineOnly: boolean,
  ) => Promise<PreparedVersion>;
};

type FabricLoaderEntry = {
  loader?: {
    version?: unknown;
    stable?: unknown;
  };
};

const compareVersionsDescending = (left: string, right: string) =>
  right.localeCompare(left, undefined, {
    numeric: true,
    sensitivity: 'base',
  });

export const resolvedModLoaderVersionId = (
  loader: ModLoaderType,
  minecraftVersion: string,
  loaderVersion: string,
) => {
  if (loader === 'forge') {
    return `${minecraftVersion}-forge-${loaderVersion}`;
  }
  if (loader === 'fabric') {
    return `${minecraftVersion}-fabric${loaderVersion}`;
  }
  return `neoforge-${loaderVersion}`;
};

export const neoForgeMinecraftPrefix = (minecraftVersion: string) => {
  const parts = minecraftVersion.split('.');
  if (parts[0] === '1' && parts.length >= 3) {
    return `${parts[1]}.${parts[2]}.`;
  }
  if (parts.length >= 2) {
    return `${parts[0]}.${parts[1]}.`;
  }
  return `${minecraftVersion}.`;
};

export const parseNeoForgeMavenMetadata = (
  xml: string,
  minecraftVersion: string,
): ModLoaderBuild[] => {
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
  const raw = parsed.metadata?.versioning?.versions?.version;
  const versions = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const prefix = neoForgeMinecraftPrefix(minecraftVersion);
  return versions
    .filter(
      (version): version is string =>
        typeof version === 'string' && version.startsWith(prefix),
    )
    .sort(compareVersionsDescending)
    .map((loaderVersion) => ({
      loader: 'neoforge',
      minecraftVersion,
      loaderVersion,
      resolvedVersionId: resolvedModLoaderVersionId(
        'neoforge',
        minecraftVersion,
        loaderVersion,
      ),
      stable: !/(?:alpha|beta|rc)/i.test(loaderVersion),
    }));
};

export class ModLoaderService {
  private readonly fetchImpl: typeof fetch;
  private readonly installNeoForgeImpl: typeof installNeoForged;

  constructor(
    private readonly gameDirectory: () => Promise<string>,
    private readonly log: LogWriter,
    private readonly options: ModLoaderServiceOptions,
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.installNeoForgeImpl =
      options.installNeoForge ?? installNeoForged;
  }

  private async request(url: string, label: string) {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { 'User-Agent': 'Mason Launcher/1.4.1' },
      });
    } catch (error) {
      throw new MinecraftError(
        `${label} could not be downloaded.`,
        'download',
        'MOD_LOADER_NETWORK_ERROR',
        { url },
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new MinecraftError(
        `${label} returned HTTP ${response.status}.`,
        'download',
        `HTTP_${response.status}`,
        { url, status: response.status },
      );
    }
    return response;
  }

  async getBuilds(
    loader: Exclude<ModLoaderType, 'forge'>,
    minecraftVersion: string,
  ): Promise<ModLoaderBuild[]> {
    if (loader === 'fabric') {
      const url =
        `${FABRIC_META}/v2/versions/loader/` +
        encodeURIComponent(minecraftVersion);
      const response = await this.request(url, 'Fabric loader metadata');
      const entries = (await response.json()) as FabricLoaderEntry[];
      if (!Array.isArray(entries)) {
        throw new MinecraftError(
          'Fabric loader metadata has an invalid response shape.',
          'download',
          'FABRIC_METADATA_INVALID',
          { url },
        );
      }
      const builds = entries
        .map((entry) => ({
          loaderVersion:
            typeof entry.loader?.version === 'string'
              ? entry.loader.version
              : '',
          stable: entry.loader?.stable === true,
        }))
        .filter((entry) => entry.loaderVersion)
        .map(
          (entry): ModLoaderBuild => ({
            loader,
            minecraftVersion,
            loaderVersion: entry.loaderVersion,
            resolvedVersionId: resolvedModLoaderVersionId(
              loader,
              minecraftVersion,
              entry.loaderVersion,
            ),
            stable: entry.stable,
          }),
        );
      this.log('info', 'manifest', 'Fabric loader builds loaded.', {
        minecraftVersion,
        builds: builds.length,
        source: url,
      });
      return builds;
    }

    const response = await this.request(
      NEOFORGE_METADATA,
      'NeoForge Maven metadata',
    );
    const builds = parseNeoForgeMavenMetadata(
      await response.text(),
      minecraftVersion,
    );
    this.log('info', 'manifest', 'NeoForge builds loaded.', {
      minecraftVersion,
      builds: builds.length,
      source: NEOFORGE_METADATA,
    });
    return builds;
  }

  private async installFabricProfile(
    minecraftVersion: string,
    loaderVersion: string,
  ) {
    const url =
      `${FABRIC_META}/v2/versions/loader/` +
      `${encodeURIComponent(minecraftVersion)}/` +
      `${encodeURIComponent(loaderVersion)}/profile/json`;
    const response = await this.request(url, 'Fabric launch profile');
    const profile = (await response.json()) as Record<string, unknown>;
    if (
      profile.inheritsFrom !== minecraftVersion ||
      typeof profile.mainClass !== 'string' ||
      !Array.isArray(profile.libraries)
    ) {
      throw new MinecraftError(
        'Fabric launch profile is missing required fields.',
        'download',
        'FABRIC_PROFILE_INVALID',
        { url, minecraftVersion, loaderVersion },
      );
    }
    const versionId = resolvedModLoaderVersionId(
      'fabric',
      minecraftVersion,
      loaderVersion,
    );
    profile.id = versionId;
    const root = await this.gameDirectory();
    const versionDirectory = path.join(root, 'versions', versionId);
    const target = path.join(versionDirectory, `${versionId}.json`);
    const temporary = `${target}.tmp`;
    await fs.mkdir(versionDirectory, { recursive: true });
    await fs.writeFile(temporary, JSON.stringify(profile, null, 2), 'utf8');
    await fs.rename(temporary, target);
    this.log('info', 'files', 'Fabric launch profile installed.', {
      minecraftVersion,
      loaderVersion,
      versionId,
      target,
    });
    return versionId;
  }

  async ensureInstalled(input: {
    loader: Exclude<ModLoaderType, 'forge'>;
    minecraftVersion: string;
    loaderVersion: string;
    resolvedVersionId: string;
    javaPath?: string;
    offlineOnly: boolean;
  }) {
    if (input.offlineOnly) {
      await this.options.prepareInstalledVersion(
        input.resolvedVersionId,
        true,
      );
      return input.resolvedVersionId;
    }

    let versionId: string;
    if (input.loader === 'fabric') {
      versionId = await this.installFabricProfile(
        input.minecraftVersion,
        input.loaderVersion,
      );
    } else {
      if (!input.javaPath) {
        throw new MinecraftError(
          'NeoForge installation requires Java.',
          'java',
          'NEOFORGE_JAVA_REQUIRED',
        );
      }
      const root = await this.gameDirectory();
      this.log('info', 'forge', 'Starting NeoForge client installation.', {
        minecraftVersion: input.minecraftVersion,
        loaderVersion: input.loaderVersion,
        installerUrl:
          `${NEOFORGE_MAVEN}/net/neoforged/neoforge/` +
          `${input.loaderVersion}/neoforge-${input.loaderVersion}-installer.jar`,
      });
      try {
        versionId = await this.installNeoForgeImpl(
          'neoforge',
          input.loaderVersion,
          root,
          {
            java: input.javaPath,
            side: 'client',
            mavenHost: [
              NEOFORGE_MAVEN,
              'https://maven.minecraftforge.net',
            ],
          },
        );
      } catch (error) {
        throw new MinecraftError(
          'NeoForge client installation failed.',
          'forge-processor',
          'NEOFORGE_INSTALL_FAILED',
          {
            minecraftVersion: input.minecraftVersion,
            loaderVersion: input.loaderVersion,
          },
          { cause: error },
        );
      }
    }

    await this.options.prepareInstalledVersion(versionId, false);
    return versionId;
  }
}
