import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { WebContents } from 'electron';
import type {
  LauncherLogLevel,
  LauncherLogStage,
} from './diagnostics';

const apiBase = 'https://api.modrinth.com/v2';
const userAgent = 'SimpleCraftLauncher/1.4.0 (desktop launcher)';

type LogWriter = (
  level: LauncherLogLevel,
  stage: LauncherLogStage,
  message: string,
  detail?: Record<string, unknown>,
) => void;

export type ModrinthProject = {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  iconUrl: string | null;
  downloads: number;
};

export type ProfileMod = Pick<
  ModrinthProject,
  'projectId' | 'slug' | 'title' | 'iconUrl'
>;

type SearchResponse = {
  hits: Array<{
    project_id: string;
    slug: string;
    title: string;
    description: string;
    icon_url: string | null;
    downloads: number;
  }>;
};

type ModrinthVersion = {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  dependencies: Array<{
    version_id: string | null;
    project_id: string | null;
    dependency_type: string;
  }>;
  files: Array<{
    hashes: {
      sha1?: string;
    };
    url: string;
    filename: string;
    primary: boolean;
  }>;
};

type ResolvedMod = {
  projectId: string;
  title: string;
  version: ModrinthVersion;
};

type ManagedModsFile = {
  files: string[];
};

export class ModrinthService {
  constructor(private readonly log: LogWriter = () => undefined) {}

  private async requestJson<T>(url: URL | string): Promise<T> {
    const requestUrl = new URL(url);
    try {
      const response = await fetch(requestUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': userAgent,
        },
      });
      if (!response.ok) {
        throw Object.assign(
          new Error(
            `Modrinth APIへの接続に失敗しました（HTTP ${response.status}）。`,
          ),
          { status: response.status },
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      this.log('error', 'mods', 'Modrinth APIへの接続に失敗しました。', {
        host: requestUrl.host,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async search(
    query: string,
    gameVersion: string,
    loader: 'forge',
  ): Promise<ModrinthProject[]> {
    const url = new URL(`${apiBase}/search`);
    url.searchParams.set('query', query.trim());
    url.searchParams.set(
      'facets',
      JSON.stringify([
        ['project_type:mod'],
        [`categories:${loader}`],
        [`versions:${gameVersion}`],
      ]),
    );
    url.searchParams.set('index', query.trim() ? 'relevance' : 'downloads');
    url.searchParams.set('limit', '20');

    const result = await this.requestJson<SearchResponse>(url);
    return result.hits.map((hit) => ({
      projectId: hit.project_id,
      slug: hit.slug,
      title: hit.title,
      description: hit.description,
      iconUrl: hit.icon_url,
      downloads: hit.downloads,
    }));
  }

  private async getVersion(versionId: string) {
    return this.requestJson<ModrinthVersion>(
      `${apiBase}/version/${encodeURIComponent(versionId)}`,
    );
  }

  private async getLatestVersion(
    projectId: string,
    gameVersion: string,
    loader: 'forge',
  ) {
    const url = new URL(
      `${apiBase}/project/${encodeURIComponent(projectId)}/version`,
    );
    url.searchParams.set('loaders', JSON.stringify([loader]));
    url.searchParams.set('game_versions', JSON.stringify([gameVersion]));
    url.searchParams.set('include_changelog', 'false');
    const versions = await this.requestJson<ModrinthVersion[]>(url);
    const version = versions.find((candidate) => candidate.files.length > 0);
    if (!version) {
      throw new Error(
        `「${projectId}」にMinecraft ${gameVersion} / Forge対応ファイルがありません。`,
      );
    }
    return version;
  }

  private async resolveMods(
    selected: ProfileMod[],
    gameVersion: string,
  ): Promise<ResolvedMod[]> {
    const resolved = new Map<string, ResolvedMod>();
    const resolving = new Set<string>();

    const resolveProject = async (
      projectId: string,
      title: string,
      versionId?: string,
    ) => {
      if (resolved.has(projectId) || resolving.has(projectId)) {
        return;
      }
      resolving.add(projectId);
      const version = versionId
        ? await this.getVersion(versionId)
        : await this.getLatestVersion(projectId, gameVersion, 'forge');
      resolved.set(projectId, { projectId, title, version });

      for (const dependency of version.dependencies) {
        if (
          dependency.dependency_type !== 'required' ||
          (!dependency.project_id && !dependency.version_id)
        ) {
          continue;
        }
        if (dependency.version_id) {
          const dependencyVersion = await this.getVersion(
            dependency.version_id,
          );
          await resolveProject(
            dependencyVersion.project_id,
            dependencyVersion.name,
            dependency.version_id,
          );
        } else if (dependency.project_id) {
          await resolveProject(dependency.project_id, dependency.project_id);
        }
      }
      resolving.delete(projectId);
    };

    for (const mod of selected) {
      await resolveProject(mod.projectId, mod.title);
    }
    return [...resolved.values()];
  }

  private async sha1(file: string) {
    const hash = createHash('sha1');
    hash.update(await fs.readFile(file));
    return hash.digest('hex');
  }

  private async download(
    url: string,
    destination: string,
    expectedSha1?: string,
  ) {
    try {
      if (!expectedSha1 || (await this.sha1(destination)) === expectedSha1) {
        return;
      }
    } catch {
      // The destination does not exist or is unreadable.
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': userAgent },
    });
    if (!response.ok) {
      throw new Error(
        `Modrinth CDNからMODを取得できません（HTTP ${response.status}）。`,
      );
    }
    const data = Buffer.from(await response.arrayBuffer());
    if (
      expectedSha1 &&
      createHash('sha1').update(data).digest('hex') !== expectedSha1
    ) {
      throw new Error('ダウンロードしたMODのSHA-1が一致しません。');
    }
    await fs.writeFile(destination, data);
  }

  async syncMods(
    instanceDirectory: string,
    selected: ProfileMod[],
    gameVersion: string,
    sender: WebContents,
  ) {
    this.log('info', 'mods', 'プロファイルMODの同期を開始します。', {
      gameVersion,
      selectedMods: selected.length,
      instanceDirectory,
    });
    const modsDirectory = path.join(instanceDirectory, 'mods');
    const managedFile = path.join(instanceDirectory, '.simple-craft-mods.json');
    await fs.mkdir(modsDirectory, { recursive: true });
    const resolved = await this.resolveMods(selected, gameVersion);
    const files: string[] = [];

    for (const [index, mod] of resolved.entries()) {
      const file =
        mod.version.files.find((candidate) => candidate.primary) ??
        mod.version.files[0];
      if (!file) {
        continue;
      }
      const safeFileName = path.basename(file.filename);
      if (safeFileName !== file.filename || !safeFileName.endsWith('.jar')) {
        throw new Error(
          `Modrinthが返したファイル名「${file.filename}」は使用できません。`,
        );
      }
      sender.send('minecraft:progress', {
        phase: 'mods',
        percent:
          resolved.length > 0
            ? Math.round(((index + 1) / resolved.length) * 100)
            : 100,
        message: `ModrinthからMODを同期中: ${mod.title}`,
        file: safeFileName,
      });
      await this.download(
        file.url,
        path.join(modsDirectory, safeFileName),
        file.hashes.sha1,
      );
      files.push(safeFileName);
    }

    let previous: ManagedModsFile = { files: [] };
    try {
      previous = JSON.parse(
        await fs.readFile(managedFile, 'utf8'),
      ) as ManagedModsFile;
    } catch {
      // This is the first sync for this profile.
    }
    for (const oldFile of previous.files) {
      if (
        path.basename(oldFile) === oldFile &&
        oldFile.endsWith('.jar') &&
        !files.includes(oldFile)
      ) {
        await fs.rm(path.join(modsDirectory, oldFile), { force: true });
      }
    }
    await fs.writeFile(
      managedFile,
      JSON.stringify({ files }, null, 2),
      'utf8',
    );
    this.log('info', 'mods', 'プロファイルMODの同期が完了しました。', {
      gameVersion,
      installedFiles: files.length,
    });
  }
}
