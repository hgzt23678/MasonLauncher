import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  detectSupportedLanguage,
  normalizeLanguagePreference,
  resolveLanguage,
  supportedLanguages,
  translate,
  translationKeys,
} from '../src/i18n';

test('supported system languages are detected with Japanese fallback', () => {
  assert.equal(detectSupportedLanguage(['ja-JP']), 'ja');
  assert.equal(detectSupportedLanguage(['en-US']), 'en');
  assert.equal(detectSupportedLanguage(['ko-KR']), 'ko');
  assert.equal(detectSupportedLanguage(['zh-TW']), 'zh-Hant');
  assert.equal(detectSupportedLanguage(['zh-HK']), 'zh-Hant');
  assert.equal(detectSupportedLanguage(['zh-Hans-CN']), 'zh-Hans');
  assert.equal(detectSupportedLanguage(['zh-CN']), 'zh-Hans');
  assert.equal(detectSupportedLanguage(['fr-FR']), 'ja');
});

test('explicit language preference wins over the system language', () => {
  assert.equal(resolveLanguage('ko', ['en-US']), 'ko');
  assert.equal(resolveLanguage('system', ['en-US']), 'en');
  assert.equal(normalizeLanguagePreference('zh-Hant'), 'zh-Hant');
  assert.equal(normalizeLanguagePreference('unsupported'), 'system');
});

test('every supported locale has a non-empty translation for every key', () => {
  for (const language of supportedLanguages) {
    for (const key of translationKeys) {
      assert.notEqual(
        translate(language, key).trim(),
        '',
        `${language}:${key}`,
      );
    }
  }
});

test('translation parameters are interpolated', () => {
  assert.equal(
    translate('en', 'profiles.scanConnected', { count: 3 }),
    'Loaded 3 profiles.',
  );
  assert.equal(
    translate('ko', 'mods.downloaded', { name: 'Sodium' }),
    'Sodium 다운로드를 완료했습니다.',
  );
});

test('settings UI exposes all language preferences', async () => {
  const html = await fs.readFile(path.resolve('index.html'), 'utf8');
  assert.match(html, /id="language-select"/);
  for (const value of ['system', ...supportedLanguages]) {
    assert.match(html, new RegExp(`value="${value}"`));
  }
});
