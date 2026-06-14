import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isMicrosoftClientId,
  resolveMicrosoftClientId,
  shouldResetAuthCache,
} from '../src/auth-config';

test('設定ファイルのApplication IDをビルド値より優先する', () => {
  assert.equal(
    resolveMicrosoftClientId(
      ' 11111111-1111-1111-1111-111111111111 ',
      '22222222-2222-2222-2222-222222222222',
    ),
    '11111111-1111-1111-1111-111111111111',
  );
});

test('設定項目がない場合だけビルド値へフォールバックする', () => {
  assert.equal(
    resolveMicrosoftClientId(
      undefined,
      ' 22222222-2222-2222-2222-222222222222 ',
    ),
    '22222222-2222-2222-2222-222222222222',
  );
  assert.equal(resolveMicrosoftClientId('', 'fallback'), '');
});

test('Application ID変更時だけ旧認証キャッシュを破棄する', () => {
  assert.equal(shouldResetAuthCache('', 'old-id', 'new-id'), true);
  assert.equal(shouldResetAuthCache('old-id', '', 'new-id'), true);
  assert.equal(shouldResetAuthCache('', 'same-id', 'same-id'), false);
});

test('Application IDはGUID形式だけを受け入れる', () => {
  assert.equal(
    isMicrosoftClientId('11111111-1111-1111-1111-111111111111'),
    true,
  );
  assert.equal(isMicrosoftClientId('not-a-guid'), false);
  assert.equal(isMicrosoftClientId(''), false);
});
