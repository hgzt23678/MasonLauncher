export type MinecraftVersionInfo = {
  id: string;
  type: string;
  releaseTime: string | null;
};

export const filterSelectableVersions = <T extends MinecraftVersionInfo>(
  versions: readonly T[],
  showSnapshots: boolean,
  selectedVersionId: string,
) =>
  versions.filter((version) => {
    if (version.type === 'old_beta' || version.type === 'old_alpha') {
      return false;
    }
    if (version.type === 'snapshot') {
      return showSnapshots || version.id === selectedVersionId;
    }
    return true;
  });

export const formatVersionLabel = (version: MinecraftVersionInfo) => {
  if (version.type === 'snapshot') {
    return `${version.id}  /  SNAPSHOT`;
  }
  if (version.type !== 'release') {
    return `${version.id}  /  CUSTOM`;
  }
  return `${version.id}  /  RELEASE`;
};

export const compareVersionsByRelease = (
  left: MinecraftVersionInfo,
  right: MinecraftVersionInfo,
) => {
  const leftTime = left.releaseTime ? Date.parse(left.releaseTime) : NaN;
  const rightTime = right.releaseTime ? Date.parse(right.releaseTime) : NaN;
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    if (leftTime !== rightTime) return rightTime - leftTime;
  } else if (Number.isFinite(leftTime)) {
    return -1;
  } else if (Number.isFinite(rightTime)) {
    return 1;
  }
  return right.id.localeCompare(left.id, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
};
