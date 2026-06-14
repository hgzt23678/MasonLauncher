export const DEFAULT_THEME_COLOR = '#0b57d0';
const LEGACY_DEFAULT_THEME_COLOR = '#9bd36f';

export type ThemeColorScheme = 'light' | 'dark';

type Rgb = {
  red: number;
  green: number;
  blue: number;
};

const clampChannel = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value)));

const parseHex = (value: string): Rgb => ({
  red: Number.parseInt(value.slice(1, 3), 16),
  green: Number.parseInt(value.slice(3, 5), 16),
  blue: Number.parseInt(value.slice(5, 7), 16),
});

const toHex = ({ red, green, blue }: Rgb) =>
  `#${[red, green, blue]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, '0'))
    .join('')}`;

const mix = (color: Rgb, target: Rgb, amount: number): Rgb => ({
  red: color.red + (target.red - color.red) * amount,
  green: color.green + (target.green - color.green) * amount,
  blue: color.blue + (target.blue - color.blue) * amount,
});

const relativeLuminance = ({ red, green, blue }: Rgb) => {
  const channels = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (
    channels[0] * 0.2126 +
    channels[1] * 0.7152 +
    channels[2] * 0.0722
  );
};

export const normalizeThemeColor = (value: unknown): string => {
  if (typeof value !== 'string') return DEFAULT_THEME_COLOR;
  const normalized = value.trim().toLowerCase();
  const withHash = normalized.startsWith('#') ? normalized : `#${normalized}`;
  if (!/^#[0-9a-f]{6}$/.test(withHash)) return DEFAULT_THEME_COLOR;
  return withHash === LEGACY_DEFAULT_THEME_COLOR
    ? DEFAULT_THEME_COLOR
    : withHash;
};

const googleBlueTokens = {
  light: {
    '--md-sys-color-primary': '#0b57d0',
    '--md-sys-color-on-primary': '#ffffff',
    '--md-sys-color-primary-container': '#d3e3fd',
    '--md-sys-color-on-primary-container': '#041e49',
    '--md-sys-color-inverse-primary': '#a8c7fa',
  },
  dark: {
    '--md-sys-color-primary': '#a8c7fa',
    '--md-sys-color-on-primary': '#062e6f',
    '--md-sys-color-primary-container': '#0842a0',
    '--md-sys-color-on-primary-container': '#d3e3fd',
    '--md-sys-color-inverse-primary': '#0b57d0',
  },
} as const;

export const createMaterialThemeTokens = (
  value: unknown,
  scheme: ThemeColorScheme = 'light',
) => {
  const primary = normalizeThemeColor(value);
  if (primary === DEFAULT_THEME_COLOR) {
    return googleBlueTokens[scheme];
  }

  const rgb = parseHex(primary);
  const white = { red: 255, green: 255, blue: 255 };
  const nearBlack = { red: 31, green: 31, blue: 31 };
  const displayedPrimary =
    scheme === 'dark' ? toHex(mix(rgb, white, 0.58)) : primary;
  const displayedRgb = parseHex(displayedPrimary);
  const onPrimary =
    relativeLuminance(displayedRgb) > 0.48 ? '#1f1f1f' : '#ffffff';
  const container =
    scheme === 'dark'
      ? toHex(mix(rgb, nearBlack, 0.28))
      : toHex(mix(rgb, white, 0.82));
  const onContainer =
    scheme === 'dark'
      ? toHex(mix(rgb, white, 0.82))
      : toHex(mix(rgb, nearBlack, 0.72));

  return {
    '--md-sys-color-primary': displayedPrimary,
    '--md-sys-color-on-primary': onPrimary,
    '--md-sys-color-primary-container': container,
    '--md-sys-color-on-primary-container': onContainer,
    '--md-sys-color-inverse-primary':
      scheme === 'dark' ? primary : toHex(mix(rgb, white, 0.58)),
  } as const;
};
