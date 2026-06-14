import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_THEME_COLOR,
  createMaterialThemeTokens,
  normalizeThemeColor,
} from '../src/theme';

test('theme colors accept six-digit hex values only', () => {
  assert.equal(normalizeThemeColor('#6FA8DC'), '#6fa8dc');
  assert.equal(normalizeThemeColor('6fa8dc'), '#6fa8dc');
  assert.equal(normalizeThemeColor('red'), DEFAULT_THEME_COLOR);
  assert.equal(normalizeThemeColor('#1234'), DEFAULT_THEME_COLOR);
});

test('Material theme tokens retain readable foreground colors', () => {
  const dark = createMaterialThemeTokens('#1b5e20');
  const light = createMaterialThemeTokens('#f5d76e');

  assert.equal(dark['--md-sys-color-primary'], '#1b5e20');
  assert.equal(dark['--md-sys-color-on-primary'], '#ffffff');
  assert.equal(light['--md-sys-color-on-primary'], '#0c2005');
  assert.match(dark['--md-sys-color-primary-container'], /^#[0-9a-f]{6}$/);
  assert.match(dark['--md-sys-color-on-primary-container'], /^#[0-9a-f]{6}$/);
});
