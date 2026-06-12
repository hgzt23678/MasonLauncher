import { promises as fs } from 'node:fs';
import path from 'node:path';

const profileIdPattern = /^[a-zA-Z0-9-]+$/;

const isWithin = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

export const managedInstanceDirectory = (
  instancesRoot: string,
  profileId: string,
) => {
  if (!profileIdPattern.test(profileId)) {
    throw new Error(`Invalid instance ID: ${profileId}`);
  }
  return path.join(path.resolve(instancesRoot), profileId, 'instance');
};

export const ensureManagedInstanceDirectory = async (
  instancesRoot: string,
  profileId: string,
) => {
  const root = path.resolve(instancesRoot);
  const instanceParent = path.join(root, profileId);
  const instance = managedInstanceDirectory(root, profileId);
  await fs.mkdir(root, { recursive: true });

  for (const candidate of [instanceParent, instance]) {
    try {
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink()) {
        throw new Error(`Instance path must not be a symlink or junction: ${candidate}`);
      }
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        continue;
      }
      throw error;
    }
  }

  await fs.mkdir(instance, { recursive: true });
  const [canonicalRoot, canonicalInstance] = await Promise.all([
    fs.realpath(root),
    fs.realpath(instance),
  ]);
  if (!isWithin(canonicalRoot, canonicalInstance)) {
    throw new Error(
      `Instance path escapes the launcher-managed instances directory: ${canonicalInstance}`,
    );
  }
  return canonicalInstance;
};

export const ensureInstanceSubdirectory = async (
  instanceDirectory: string,
  relativeDirectory: string,
) => {
  if (
    !relativeDirectory ||
    path.isAbsolute(relativeDirectory) ||
    relativeDirectory.split(/[\\/]/u).some((part) => part === '..')
  ) {
    throw new Error(`Invalid instance subdirectory: ${relativeDirectory}`);
  }
  const canonicalInstance = await fs.realpath(instanceDirectory);
  const target = path.join(canonicalInstance, relativeDirectory);
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Instance subdirectory must not be a symlink or junction: ${target}`,
      );
    }
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
  await fs.mkdir(target, { recursive: true });
  const canonicalTarget = await fs.realpath(target);
  if (!isWithin(canonicalInstance, canonicalTarget)) {
    throw new Error(
      `Instance subdirectory escapes the managed instance: ${canonicalTarget}`,
    );
  }
  return canonicalTarget;
};

export const launcherLogsDirectory = (
  instancesRoot: string,
  profileId: string,
) => path.join(path.resolve(instancesRoot), profileId, 'launcher-logs');

export const ensureLauncherLogsDirectory = async (
  instancesRoot: string,
  profileId: string,
) => {
  const instanceDirectory = await ensureManagedInstanceDirectory(
    instancesRoot,
    profileId,
  );
  const instanceParent = path.dirname(instanceDirectory);
  const logsDirectory = launcherLogsDirectory(instancesRoot, profileId);
  try {
    const stat = await fs.lstat(logsDirectory);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Launcher log directory must not be a symlink or junction: ${logsDirectory}`,
      );
    }
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
  await fs.mkdir(logsDirectory, { recursive: true });
  const [canonicalParent, canonicalLogs] = await Promise.all([
    fs.realpath(instanceParent),
    fs.realpath(logsDirectory),
  ]);
  if (!isWithin(canonicalParent, canonicalLogs)) {
    throw new Error(
      `Launcher log directory escapes the managed instance: ${canonicalLogs}`,
    );
  }
  return canonicalLogs;
};
