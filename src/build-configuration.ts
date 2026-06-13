export type BuildConfiguration = 'debug' | 'release';

export const normalizeBuildConfiguration = (
  value: unknown,
): BuildConfiguration =>
  typeof value === 'string' && value.toLowerCase() === 'release'
    ? 'release'
    : 'debug';

export const developerLogsVisibleByDefault = (value: unknown): boolean =>
  normalizeBuildConfiguration(value) === 'debug';
