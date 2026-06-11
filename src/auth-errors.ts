export type AuthStage =
  | 'microsoft'
  | 'xbox'
  | 'xsts'
  | 'minecraft-services'
  | 'ownership'
  | 'profile';

export type AuthFailureCategory =
  | 'app-registration'
  | 'public-client-disabled'
  | 'invalid-scope'
  | 'cancelled'
  | 'expired'
  | 'network'
  | 'xbox-auth'
  | 'xsts-auth'
  | 'minecraft-app-review'
  | 'ownership'
  | 'profile'
  | 'http'
  | 'unknown';

export type ClassifiedAuthFailure = {
  category: AuthFailureCategory;
  stage: AuthStage;
  message: string;
  code?: string;
  status?: number;
};

export class AuthStageError extends Error {
  constructor(
    readonly stage: AuthStage,
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AuthStageError';
  }
}

type ErrorMetadata = Error & {
  code?: string;
  errorCode?: string;
  status?: number;
  stage?: AuthStage;
};

export const classifyAuthFailure = (
  error: unknown,
  fallbackStage: AuthStage = 'microsoft',
): ClassifiedAuthFailure => {
  const value = error instanceof Error ? (error as ErrorMetadata) : undefined;
  const message = value?.message ?? String(error);
  const code = value?.errorCode ?? value?.code;
  const stage = value?.stage ?? fallbackStage;
  const status = value?.status;

  if (
    code === 'unauthorized_client' ||
    message.includes('AADSTS700016') ||
    message.includes('unauthorized_client')
  ) {
    return {
      category: 'app-registration',
      stage: 'microsoft',
      message:
        'Microsoft Entraのアプリ登録が個人用Microsoftアカウントを許可していません。',
      code,
      status,
    };
  }
  if (
    code === 'invalid_client' ||
    message.includes('AADSTS70002') ||
    message.includes('AADSTS7000218') ||
    /marked as ['"]?mobile/i.test(message) ||
    message.includes('public client')
  ) {
    return {
      category: 'public-client-disabled',
      stage: 'microsoft',
      message:
        'Microsoft Entraで「パブリック クライアント フローを許可」が無効です。',
      code,
      status,
    };
  }
  if (code === 'invalid_scope' || message.includes('invalid_scope')) {
    return {
      category: 'invalid-scope',
      stage: 'microsoft',
      message: 'Microsoft/Xbox Live認証スコープを要求できません。',
      code,
      status,
    };
  }
  if (
    code === 'device_code_polling_cancelled' ||
    message.includes('authorization_declined') ||
    message.includes('access_denied')
  ) {
    return {
      category: 'cancelled',
      stage: 'microsoft',
      message: 'Microsoft認証がキャンセルまたは拒否されました。',
      code,
      status,
    };
  }
  if (
    code === 'device_code_expired' ||
    code === 'user_timeout_reached' ||
    message.includes('expired_token')
  ) {
    return {
      category: 'expired',
      stage: 'microsoft',
      message: 'アクセス許可コードの有効期限が切れました。',
      code,
      status,
    };
  }
  if (
    code === 'minecraft_app_review_required' ||
    (stage === 'minecraft-services' && status === 403)
  ) {
    return {
      category: 'minecraft-app-review',
      stage: 'minecraft-services',
      message:
        'Minecraft ServicesがApplication IDを拒否しました。AppID reviewの承認が必要です。',
      code,
      status,
    };
  }
  if (stage === 'xbox') {
    return {
      category: 'xbox-auth',
      stage,
      message: 'Xbox Live認証に失敗しました。',
      code,
      status,
    };
  }
  if (stage === 'xsts') {
    return {
      category: 'xsts-auth',
      stage,
      message: 'Xbox Secure Token Service認証に失敗しました。',
      code,
      status,
    };
  }
  if (stage === 'ownership') {
    return {
      category: 'ownership',
      stage,
      message: 'Minecraft: Java Editionの所有確認に失敗しました。',
      code,
      status,
    };
  }
  if (stage === 'profile') {
    return {
      category: 'profile',
      stage,
      message: 'Minecraftプロフィールの取得に失敗しました。',
      code,
      status,
    };
  }
  if (status) {
    return {
      category: 'http',
      stage,
      message: `${stage}でHTTP ${status}が返されました。`,
      code,
      status,
    };
  }
  if (/fetch|network|ENOTFOUND|ECONN|ETIMEDOUT/i.test(message)) {
    return {
      category: 'network',
      stage,
      message: `${stage}へのネットワーク接続に失敗しました。`,
      code,
      status,
    };
  }
  return {
    category: 'unknown',
    stage,
    message,
    code,
    status,
  };
};
