export const DEFAULT_THEME_COLOR = '#9bd36f';

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
  return /^#[0-9a-f]{6}$/.test(withHash)
    ? withHash
    : DEFAULT_THEME_COLOR;
};

export const createMaterialThemeTokens = (value: unknown) => {
  const primary = normalizeThemeColor(value);
  const rgb = parseHex(primary);
  const onPrimary =
    relativeLuminance(rgb) > 0.48 ? '#0c2005' : '#ffffff';
  const container = toHex(mix(rgb, { red: 13, green: 17, blue: 13 }, 0.62));
  const onContainer = toHex(
    mix(rgb, { red: 255, green: 255, blue: 255 }, 0.62),
  );

  return {
    '--md-sys-color-primary': primary,
    '--md-sys-color-on-primary': onPrimary,
    '--md-sys-color-primary-container': container,
    '--md-sys-color-on-primary-container': onContainer,
    '--md-sys-color-inverse-primary': toHex(
      mix(rgb, { red: 0, green: 0, blue: 0 }, 0.35),
    ),
  } as const;
};
