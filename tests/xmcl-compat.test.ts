import assert from 'node:assert/strict';
import test from 'node:test';
import { errors } from 'undici';
import { installXmclUndiciCompatibility } from '../src/xmcl-compat';

test('XMCL download errors remain constructible with current undici', () => {
  installXmclUndiciCompatibility();
  const legacyErrors = errors as typeof errors & {
    ResponseStatusCodeError?: new (
      message: string,
      statusCode: number,
      headers: Record<string, string>,
      body: string,
    ) => Error & { statusCode: number };
  };
  const Constructor = legacyErrors.ResponseStatusCodeError;

  assert.equal(typeof Constructor, 'function');
  assert.ok(Constructor);
  const error = new Constructor('', 404, {}, '');
  assert.equal(error.name, 'ResponseStatusCodeError');
  assert.equal(error.statusCode, 404);
});
