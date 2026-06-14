import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_THEME_COLOR,
  createMaterialThemeTokens,
  normalizeThemeColor,
} from '../src/theme';

test('theme colors accept six-digit hex values only', () => {
  assert.equal(DEFAULT_THEME_COLOR, '#0b57d0');
  assert.equal(normalizeThemeColor('#6FA8DC'), '#6fa8dc');
  assert.equal(normalizeThemeColor('6fa8dc'), '#6fa8dc');
  assert.equal(normalizeThemeColor('#9bd36f'), DEFAULT_THEME_COLOR);
  assert.equal(normalizeThemeColor('red'), DEFAULT_THEME_COLOR);
  assert.equal(normalizeThemeColor('#1234'), DEFAULT_THEME_COLOR);
});

test('Material theme tokens retain readable foreground colors', () => {
  const dark = createMaterialThemeTokens('#1b5e20', 'dark');
  const light = createMaterialThemeTokens('#f5d76e', 'light');

  assert.notEqual(dark['--md-sys-color-primary'], '#1b5e20');
  assert.equal(light['--md-sys-color-primary'], '#f5d76e');
  assert.equal(light['--md-sys-color-on-primary'], '#1f1f1f');
  assert.match(dark['--md-sys-color-primary-container'], /^#[0-9a-f]{6}$/);
  assert.match(dark['--md-sys-color-on-primary-container'], /^#[0-9a-f]{6}$/);
});

test('Google Blue uses the recommended light and dark primary roles', () => {
  const light = createMaterialThemeTokens(DEFAULT_THEME_COLOR, 'light');
  const dark = createMaterialThemeTokens(DEFAULT_THEME_COLOR, 'dark');

  assert.deepEqual(light, {
    '--md-sys-color-primary': '#0b57d0',
    '--md-sys-color-on-primary': '#ffffff',
    '--md-sys-color-primary-container': '#d3e3fd',
    '--md-sys-color-on-primary-container': '#041e49',
    '--md-sys-color-inverse-primary': '#a8c7fa',
  });
  assert.deepEqual(dark, {
    '--md-sys-color-primary': '#a8c7fa',
    '--md-sys-color-on-primary': '#062e6f',
    '--md-sys-color-primary-container': '#0842a0',
    '--md-sys-color-on-primary-container': '#d3e3fd',
    '--md-sys-color-inverse-primary': '#0b57d0',
  });
});
