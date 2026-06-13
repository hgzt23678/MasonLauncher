import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AuthStageError,
  classifyAuthFailure,
} from '../src/auth-errors';

test('Entra public client設定エラーを分類する', () => {
  const result = classifyAuthFailure(
    new Error(
      "AADSTS70002: The client application must be marked as 'mobile'.",
    ),
  );
  assert.equal(result.category, 'public-client-disabled');
  assert.equal(result.stage, 'microsoft');
});

test('Xbox/XSTS/Minecraft Services/所有確認を別段階に分類する', () => {
  assert.equal(
    classifyAuthFailure(new AuthStageError('xbox', 'HTTP 401', 'http_401', 401))
      .category,
    'xbox-auth',
  );
  assert.equal(
    classifyAuthFailure(new AuthStageError('xsts', 'HTTP 401', 'http_401', 401))
      .category,
    'xsts-auth',
  );
  assert.equal(
    classifyAuthFailure(
      new AuthStageError(
        'minecraft-services',
        'HTTP 403',
        'minecraft_app_review_required',
        403,
      ),
    ).category,
    'minecraft-app-review',
  );
  assert.equal(
    classifyAuthFailure(
      new AuthStageError('ownership', 'not owned', 'minecraft_not_owned'),
    ).category,
    'ownership',
  );
});
