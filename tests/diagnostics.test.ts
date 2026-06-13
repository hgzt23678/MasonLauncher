import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LauncherDiagnostics,
  sanitizeLogText,
} from '../src/diagnostics';

test('ログ本文とdetailから資格情報らしい値を除去する', () => {
  assert.equal(
    sanitizeLogText(
      'Bearer abc.def and 0123456789abcdef0123456789abcdef',
    ),
    'Bearer [REDACTED] and [REDACTED]',
  );

  const diagnostics = new LauncherDiagnostics(() => undefined);
  const entry = diagnostics.log('info', 'process', 'token=ignored', {
    accessToken: 'secret-token',
    output: 'JWT 0123456789abcdef0123456789abcdef',
  });
  assert.equal(entry.detail?.accessToken, '[REDACTED]');
  assert.equal(entry.detail?.output, 'JWT [REDACTED]');
});
