import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  AuthError,
  PublicClientApplication,
  ServerError,
  type AccountInfo,
  type DeviceCodeRequest,
  type ICachePlugin,
  type TokenCacheContext,
} from '@azure/msal-node';
import { safeStorage, shell, type WebContents } from 'electron';
import { shouldResetAuthCache } from './auth-config';
import {
  AuthStageError,
  classifyAuthFailure,
  type AuthStage,
} from './auth-errors';
import type {
  LauncherLogLevel,
  LauncherLogStage,
} from './diagnostics';

const microsoftScopes = ['XboxLive.SignIn', 'XboxLive.offline_access'];
const xboxUserAuthenticateUrl =
  'https://user.auth.xboxlive.com/user/authenticate';
const xboxXstsAuthorizeUrl = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const minecraftServicesUrl = 'https://api.minecraftservices.com';

export type MicrosoftMinecraftProfile = {
  id: string;
  name: string;
  skins: Array<{
    id: string;
    state: string;
    url: string;
    variant: string;
  }>;
  capes: Array<{
    id: string;
    state: string;
    url: string;
    alias: string;
  }>;
};

type XboxTokenResponse = {
  Token: string;
  DisplayClaims: {
    xui: Array<{
      uhs: string;
    }>;
  };
};

type MinecraftTokenResponse = {
  access_token: string;
};

type MinecraftEntitlements = {
  items: Array<unknown>;
};

export type AuthState = {
  configured: boolean;
  signedIn: boolean;
  secureStorageAvailable: boolean;
  diagnostic: EntraDiagnostic;
  profile: {
    id: string;
    name: string;
    skinUrl?: string;
  } | null;
};

export type MinecraftSession = {
  accessToken: string;
  profile: MicrosoftMinecraftProfile;
  mode: 'online';
};

export type DeviceCodeInfo = {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  expiresAt: number;
  message: string;
};

export type EntraDiagnosticStatus =
  | 'not-configured'
  | 'invalid-format'
  | 'unchecked'
  | 'ready'
  | 'personal-account-disabled'
  | 'public-client-disabled'
  | 'invalid-scope'
  | 'network-error'
  | 'unknown-error';

export type EntraDiagnostic = {
  status: EntraDiagnosticStatus;
  message: string;
  action: string;
  checkedAt: string | null;
  technicalCode?: string;
  correlationId?: string;
};

export type AuthFlowStatus =
  | 'idle'
  | 'requesting-code'
  | 'waiting-for-user'
  | 'exchanging'
  | 'success'
  | 'cancelled'
  | 'error';

export type AuthFlowState = {
  status: AuthFlowStatus;
  deviceCode: DeviceCodeInfo | null;
  message: string;
  errorCode?: string;
  diagnostic?: EntraDiagnostic;
};

type CachedProfile = AuthState['profile'];
type EntraErrorBody = {
  error?: string;
  error_description?: string;
  correlation_id?: string;
};

class ServiceRequestError extends AuthStageError {
  constructor(
    stage: AuthStage,
    message: string,
    status: number,
    readonly detail: string,
  ) {
    super(stage, message, `http_${status}`, status);
  }
}

class MinecraftAppReviewError extends AuthStageError {
  constructor(message: string) {
    super(
      'minecraft-services',
      message,
      'minecraft_app_review_required',
      403,
    );
  }
}

type LogWriter = (
  level: LauncherLogLevel,
  stage: LauncherLogStage,
  message: string,
  detail?: Record<string, unknown>,
) => void;

const authLogStage = (stage: AuthStage): LauncherLogStage =>
  stage === 'microsoft'
    ? 'auth:microsoft'
    : stage === 'xbox'
      ? 'auth:xbox'
      : stage === 'xsts'
        ? 'auth:xsts'
        : stage === 'ownership'
          ? 'auth:ownership'
          : stage === 'profile'
            ? 'auth:profile'
            : 'auth:minecraft';

const clientIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uncheckedDiagnostic = (): EntraDiagnostic => ({
  status: 'unchecked',
  message: 'クライアントIDはまだMicrosoftへ照会されていません。',
  action: 'ログイン開始時にMicrosoftへ登録状態を確認します。',
  checkedAt: null,
});

export class AuthService {
  private clientId = '';
  private publicClient: PublicClientApplication | undefined;
  private profile: CachedProfile = null;
  private activeDeviceCode: DeviceCodeInfo | null = null;
  private diagnostic: EntraDiagnostic = {
    status: 'not-configured',
    message: 'このビルドにはMicrosoft認証設定がありません。',
    action:
      '配布者がMicrosoft Entraの公開クライアントIDをビルドへ組み込む必要があります。',
    checkedAt: null,
  };
  private flowState: AuthFlowState = {
    status: 'idle',
    deviceCode: null,
    message: '',
  };
  private activeRequest: DeviceCodeRequest | null = null;
  private loginInProgress = false;

  constructor(
    private readonly userDataPath: string,
    private readonly log: LogWriter = () => undefined,
  ) {}

  private get cacheFile() {
    return path.join(this.userDataPath, 'microsoft-cache.bin');
  }

  private get profileFile() {
    return path.join(this.userDataPath, 'minecraft-profile.json');
  }

  private get configuredClientIdFile() {
    return path.join(this.userDataPath, 'microsoft-client-id.txt');
  }

  async configure(clientId: string) {
    const normalized = clientId.trim();
    if (normalized === this.clientId && this.publicClient) {
      return;
    }

    const previousClientId = await fs
      .readFile(this.configuredClientIdFile, 'utf8')
      .then((value) => value.trim())
      .catch(() => '');
    if (shouldResetAuthCache(this.clientId, previousClientId, normalized)) {
      this.cancelLogin();
      this.profile = null;
      await Promise.all([
        fs.rm(this.cacheFile, { force: true }),
        fs.rm(this.profileFile, { force: true }),
      ]);
      this.log(
        'info',
        'auth:microsoft',
        'Microsoft Application IDの変更を検出したため、旧認証キャッシュを削除しました。',
      );
    }

    this.clientId = normalized;
    await fs.mkdir(this.userDataPath, { recursive: true });
    await fs.writeFile(this.configuredClientIdFile, normalized, 'utf8');
    this.diagnostic = !normalized
      ? {
          status: 'not-configured',
          message: 'このビルドにはMicrosoft認証設定がありません。',
          action:
            '配布者がMicrosoft Entraの公開クライアントIDをビルドへ組み込む必要があります。',
          checkedAt: null,
        }
      : clientIdPattern.test(normalized)
        ? uncheckedDiagnostic()
        : {
            status: 'invalid-format',
            message: 'クライアントIDの形式が正しくありません。',
            action:
              '「アプリケーション（クライアント）ID」のGUIDを入力してください。',
            checkedAt: null,
          };
    this.publicClient = clientIdPattern.test(normalized)
      ? new PublicClientApplication({
          auth: {
            clientId: normalized,
            authority: 'https://login.microsoftonline.com/consumers',
          },
          cache: {
            cachePlugin: this.createCachePlugin(),
          },
        })
      : undefined;
    this.profile = await this.readProfile();
    this.log(
      normalized && this.publicClient ? 'info' : 'warn',
      'auth:microsoft',
      normalized
        ? 'Microsoft Entraクライアントを構成しました。'
        : 'Microsoft EntraクライアントIDが未設定です。',
      {
        configured: Boolean(this.publicClient),
        clientIdFormatValid: clientIdPattern.test(normalized),
      },
    );
    if (!safeStorage.isEncryptionAvailable()) {
      this.log(
        'warn',
        'auth:microsoft',
        'OSの安全な暗号化ストレージを使用できないため、認証キャッシュは保存しません。',
      );
    }
  }

  private createCachePlugin(): ICachePlugin {
    return {
      beforeCacheAccess: async (context: TokenCacheContext) => {
        const serialized = await this.readEncryptedCache();
        if (serialized) {
          context.tokenCache.deserialize(serialized);
        }
      },
      afterCacheAccess: async (context: TokenCacheContext) => {
        if (context.cacheHasChanged) {
          await this.writeEncryptedCache(context.tokenCache.serialize());
        }
      },
    };
  }

  private async readEncryptedCache() {
    if (!safeStorage.isEncryptionAvailable()) {
      return '';
    }

    try {
      const encrypted = Buffer.from(await fs.readFile(this.cacheFile, 'utf8'), 'base64');
      return safeStorage.decryptString(encrypted);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code !== 'ENOENT'
      ) {
        this.log('warn', 'auth:microsoft', '暗号化された認証キャッシュを読み込めません。', {
          code: String(error.code),
        });
      }
      return '';
    }
  }

  private async writeEncryptedCache(serialized: string) {
    if (!safeStorage.isEncryptionAvailable()) {
      return;
    }

    await fs.mkdir(this.userDataPath, { recursive: true });
    const encrypted = safeStorage.encryptString(serialized);
    await fs.writeFile(this.cacheFile, encrypted.toString('base64'), 'utf8');
  }

  private async readProfile(): Promise<CachedProfile> {
    try {
      const profile = JSON.parse(await fs.readFile(this.profileFile, 'utf8')) as CachedProfile;
      if (profile && typeof profile.id === 'string' && typeof profile.name === 'string') {
        return profile;
      }
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code !== 'ENOENT'
      ) {
        this.log('warn', 'auth:profile', '保存済みMinecraftプロフィールを読み込めません。', {
          code: String(error.code),
        });
      }
    }
    return null;
  }

  private async writeProfile(profile: MicrosoftMinecraftProfile) {
    this.profile = {
      id: profile.id,
      name: profile.name,
      skinUrl: profile.skins[0]?.url,
    };
    await fs.mkdir(this.userDataPath, { recursive: true });
    await fs.writeFile(this.profileFile, JSON.stringify(this.profile, null, 2), 'utf8');
  }

  private async getAccount(): Promise<AccountInfo | undefined> {
    const accounts = await this.publicClient?.getAllAccounts();
    return accounts?.[0];
  }

  async getState(): Promise<AuthState> {
    const account = await this.getAccount();
    return {
      configured: Boolean(this.publicClient),
      signedIn: Boolean(account && this.profile),
      secureStorageAvailable: safeStorage.isEncryptionAvailable(),
      diagnostic: this.diagnostic,
      profile: account ? this.profile : null,
    };
  }

  private ensureClient() {
    if (!this.publicClient || !this.clientId) {
      throw new Error(
        'このビルドにはMicrosoft認証用クライアントIDが組み込まれていません。',
      );
    }
    return this.publicClient;
  }

  private classifyEntraError(
    code: string,
    description: string,
    correlationId?: string,
  ): EntraDiagnostic {
    const checkedAt = new Date().toISOString();
    if (
      code === 'unauthorized_client' ||
      description.includes('AADSTS700016')
    ) {
      return {
        status: 'personal-account-disabled',
        message:
          'このクライアントIDは個人用Microsoftアカウント向けに公開されていません。',
        action:
          'Entraの「サポートされているアカウントの種類」を「任意の組織ディレクトリと個人用Microsoftアカウント」に変更してください。',
        checkedAt,
        technicalCode: code || 'AADSTS700016',
        correlationId,
      };
    }
    if (
      code === 'invalid_client' ||
      description.includes('AADSTS7000218')
    ) {
      return {
        status: 'public-client-disabled',
        message: 'パブリッククライアントフローが無効です。',
        action:
          'Entraの「認証」→「詳細設定」で「パブリッククライアントフローを許可」を「はい」にしてください。',
        checkedAt,
        technicalCode: code || 'AADSTS7000218',
        correlationId,
      };
    }
    if (code === 'invalid_scope') {
      return {
        status: 'invalid-scope',
        message: 'Xbox Live認証スコープを要求できないアプリ登録です。',
        action:
          '個人用Microsoftアカウント対応のアプリとして新しく登録し直してください。',
        checkedAt,
        technicalCode: code,
        correlationId,
      };
    }
    return {
      status: 'unknown-error',
      message: 'Microsoft Entraがクライアント設定を拒否しました。',
      action:
        'アプリ登録のアカウント種類とパブリッククライアント設定を確認してください。',
      checkedAt,
      technicalCode: code || 'unknown_error',
      correlationId,
    };
  }

  async diagnoseClient(): Promise<EntraDiagnostic> {
    if (!this.clientId) {
      this.diagnostic = {
        status: 'not-configured',
        message: 'このビルドにはMicrosoft認証設定がありません。',
        action:
          '配布者がMicrosoft Entraの公開クライアントIDをビルドへ組み込む必要があります。',
        checkedAt: null,
      };
      return this.diagnostic;
    }
    if (!clientIdPattern.test(this.clientId)) {
      this.diagnostic = {
        status: 'invalid-format',
        message: 'クライアントIDの形式が正しくありません。',
        action:
          '「アプリケーション（クライアント）ID」のGUIDを入力してください。',
        checkedAt: new Date().toISOString(),
      };
      return this.diagnostic;
    }

    const body = new URLSearchParams({
      client_id: this.clientId,
      scope: microsoftScopes.join(' '),
    });
    try {
      const response = await fetch(
        'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode?mkt=ja-JP',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        },
      );
      const result = (await response.json()) as EntraErrorBody & {
        user_code?: string;
        verification_uri?: string;
      };
      if (response.ok && result.user_code && result.verification_uri) {
        this.diagnostic = {
          status: 'ready',
          message:
            'MicrosoftはこのクライアントIDに対してデバイスコードを発行できます。',
          action:
            '登録の基本設定は有効です。ログインして最終確認してください。',
          checkedAt: new Date().toISOString(),
        };
      } else {
        this.diagnostic = this.classifyEntraError(
          result.error ?? '',
          result.error_description ?? '',
          result.correlation_id,
        );
      }
    } catch {
      this.diagnostic = {
        status: 'network-error',
        message: 'Microsoft Entraへ接続できませんでした。',
        action:
          'インターネット接続、プロキシ、ファイアウォールを確認して再診断してください。',
        checkedAt: new Date().toISOString(),
        technicalCode: 'network_error',
      };
    }
    return this.diagnostic;
  }

  private normalizeLoginError(error: unknown) {
    const code =
      error instanceof AuthError || error instanceof ServerError
        ? error.errorCode
        : '';
    const message = error instanceof Error ? error.message : String(error);

    if (
      code === 'unauthorized_client' ||
      message.includes('AADSTS700016') ||
      message.includes('unauthorized_client')
    ) {
      return new Error(
        'MicrosoftクライアントIDが個人用Microsoftアカウントで利用できません。' +
          'Microsoft Entraの「サポートされているアカウントの種類」を' +
          '「任意の組織ディレクトリと個人用Microsoftアカウント」に変更し、' +
          '「パブリッククライアントフローを許可」を「はい」にしてください。',
      );
    }

    if (
      code === 'invalid_client' ||
      message.includes('AADSTS7000218') ||
      message.includes('invalid_client')
    ) {
      return new Error(
        'Microsoftアプリがパブリッククライアントとして設定されていません。' +
          'Microsoft Entraの「認証」で「パブリッククライアントフローを許可」を「はい」にしてください。',
      );
    }

    if (
      code === 'device_code_polling_cancelled' ||
      message.includes('device_code_polling_cancelled')
    ) {
      return new Error('Microsoft認証をキャンセルしました。');
    }

    if (
      code === 'device_code_expired' ||
      code === 'user_timeout_reached' ||
      message.includes('expired_token')
    ) {
      return new Error(
        'アクセス許可コードの有効期限が切れました。もう一度ログインしてください。',
      );
    }

    if (
      message.includes('authorization_declined') ||
      message.includes('access_denied')
    ) {
      return new Error('Microsoft側でログインが拒否またはキャンセルされました。');
    }

    if (error instanceof MinecraftAppReviewError) {
      return error;
    }

    if (error instanceof AuthStageError) {
      const classified = classifyAuthFailure(error, error.stage);
      return new AuthStageError(
        classified.stage,
        classified.message,
        classified.code,
        classified.status,
      );
    }

    return error instanceof Error
      ? error
      : new Error('Microsoft認証コードを発行できませんでした。');
  }

  private async requestJson<T>(
    url: string,
    init: RequestInit,
    description: string,
    stage: AuthStage,
  ): Promise<T> {
    this.log('info', authLogStage(stage), `${description}を開始します。`, {
      host: new URL(url).host,
    });
    try {
      const response = await fetch(url, init);
      if (!response.ok) {
        let detail = '';
        try {
          detail = await response.text();
        } catch {
          // HTTP status and stage are still available.
        }
        throw new ServiceRequestError(
          stage,
          `${description}に失敗しました（HTTP ${response.status}）${
            detail ? `: ${detail.slice(0, 300)}` : ''
          }`,
          response.status,
          detail,
        );
      }
      const result = (await response.json()) as T;
      this.log('info', authLogStage(stage), `${description}が完了しました。`, {
        status: response.status,
      });
      return result;
    } catch (error) {
      const classified = classifyAuthFailure(error, stage);
      this.log('error', authLogStage(stage), classified.message, {
        category: classified.category,
        code: classified.code,
        status: classified.status,
      });
      throw error;
    }
  }

  private async exchangeMicrosoftToken(
    microsoftAccessToken: string,
  ): Promise<MinecraftSession> {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const xboxToken = await this.requestJson<XboxTokenResponse>(
      xboxUserAuthenticateUrl,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          Properties: {
            AuthMethod: 'RPS',
            SiteName: 'user.auth.xboxlive.com',
            RpsTicket: `d=${microsoftAccessToken}`,
          },
          RelyingParty: 'http://auth.xboxlive.com',
          TokenType: 'JWT',
        }),
      },
      'Xbox Live認証',
      'xbox',
    );
    const xstsToken = await this.requestJson<XboxTokenResponse>(
      xboxXstsAuthorizeUrl,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          Properties: {
            SandboxId: 'RETAIL',
            UserTokens: [xboxToken.Token],
          },
          RelyingParty: 'rp://api.minecraftservices.com/',
          TokenType: 'JWT',
        }),
      },
      'Xbox Secure Token Service認証',
      'xsts',
    );
    const xui = xstsToken.DisplayClaims.xui[0];
    if (!xui) {
      throw new AuthStageError(
        'xsts',
        'Xboxプロフィールを取得できませんでした。',
        'missing_xui',
      );
    }

    let minecraftAuth: MinecraftTokenResponse;
    try {
      minecraftAuth = await this.requestJson<MinecraftTokenResponse>(
        `${minecraftServicesUrl}/authentication/login_with_xbox`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            identityToken: `XBL3.0 x=${xui.uhs};${xstsToken.Token}`,
          }),
        },
        'Minecraft Services認証',
        'minecraft-services',
      );
    } catch (error) {
      if (
        error instanceof ServiceRequestError &&
        (error.status === 403 ||
          /AppRegInfo|application.+(?:approved|permission|allow)/i.test(
            error.detail,
          ))
      ) {
        throw new MinecraftAppReviewError(
          'Minecraft Services がこのApp IDを拒否しました。\n' +
            '原因: Application ID が Minecraft API 利用許可を受けていません。\n' +
            'この状態ではMinecraftを起動できません。\n' +
            'Minecraft Servicesの利用には AppID review の承認が必要です。',
        );
      }
      throw error;
    }
    const bearerHeaders = {
      Accept: 'application/json',
      Authorization: `Bearer ${minecraftAuth.access_token}`,
    };
    const ownership = await this.requestJson<MinecraftEntitlements>(
      `${minecraftServicesUrl}/entitlements/mcstore`,
      { headers: bearerHeaders },
      'Minecraftの所有権確認',
      'ownership',
    );

    if (ownership.items.length === 0) {
      throw new AuthStageError(
        'ownership',
        'このMicrosoftアカウントではMinecraft: Java Editionの所有権を確認できません。',
        'minecraft_not_owned',
      );
    }

    const profile = await this.requestJson<MicrosoftMinecraftProfile>(
      `${minecraftServicesUrl}/minecraft/profile`,
      { headers: bearerHeaders },
      'Minecraftプロフィール取得',
      'profile',
    );
    await this.writeProfile(profile);
    return {
      accessToken: minecraftAuth.access_token,
      profile,
      mode: 'online',
    };
  }

  async login(sender: WebContents): Promise<AuthState> {
    if (this.loginInProgress) {
      throw new Error('Microsoft認証はすでに進行中です。');
    }
    const client = this.ensureClient();
    this.log('info', 'auth:microsoft', 'Microsoftデバイスコード認証を開始します。');
    this.loginInProgress = true;
    this.activeDeviceCode = null;
    this.flowState = {
      status: 'requesting-code',
      deviceCode: null,
      message: 'Microsoftへアクセス許可コードを要求しています。',
    };
    sender.send('auth:flow-state', this.flowState);
    const request: DeviceCodeRequest = {
      scopes: microsoftScopes,
      timeout: 900,
      correlationId: randomUUID(),
      extraQueryParameters: {
        mkt: 'ja-JP',
      },
      deviceCodeCallback: (response) => {
        const userCode = response.userCode?.trim();
        const verificationUri = response.verificationUri?.trim();
        if (!userCode || !verificationUri) {
          throw new Error(
            'Microsoftから有効なアクセス許可コードが返されませんでした。',
          );
        }

        this.activeDeviceCode = {
          userCode,
          verificationUri,
          expiresIn: response.expiresIn,
          expiresAt: Date.now() + response.expiresIn * 1000,
          message: response.message,
        };
        this.log('info', 'auth:microsoft', 'Microsoftデバイスコードを受信しました。', {
          expiresIn: response.expiresIn,
          verificationHost: new URL(verificationUri).host,
        });
        this.flowState = {
          status: 'waiting-for-user',
          deviceCode: this.activeDeviceCode,
          message:
            'ブラウザでMicrosoftアカウントにログインし、コードを入力してください。',
        };
        sender.send('auth:device-code', this.activeDeviceCode);
        sender.send('auth:flow-state', this.flowState);
        setTimeout(() => {
          void shell.openExternal(verificationUri);
        }, 250);
      },
    };
    this.activeRequest = request;
    try {
      const result = await client.acquireTokenByDeviceCode(request);
      this.flowState = {
        status: 'exchanging',
        deviceCode: this.activeDeviceCode,
        message: 'Xbox LiveとMinecraft Servicesへ接続しています。',
      };
      sender.send('auth:flow-state', this.flowState);

      if (!result?.accessToken) {
        throw new AuthStageError(
          'microsoft',
          'Microsoft認証が完了しませんでした。',
          'missing_access_token',
        );
      }

      await this.exchangeMicrosoftToken(result.accessToken);
      this.activeDeviceCode = null;
      this.flowState = {
        status: 'success',
        deviceCode: null,
        message: 'Microsoftアカウントの認証が完了しました。',
      };
      sender.send('auth:flow-state', this.flowState);
      this.log('info', 'auth:minecraft', 'Microsoft/Minecraft認証が完了しました。');
      return this.getState();
    } catch (error) {
      const normalized = this.normalizeLoginError(error);
      const classified = classifyAuthFailure(error);
      const cancelled =
        request.cancel === true ||
        normalized.message.includes('キャンセルしました');
      const errorCode =
        error instanceof AuthError || error instanceof ServerError
          ? error.errorCode
          : error instanceof MinecraftAppReviewError
            ? error.code
            : undefined;
      const errorMessage = error instanceof Error ? error.message : '';
      if (
        errorCode === 'unauthorized_client' ||
        errorCode === 'invalid_client' ||
        errorCode === 'invalid_scope' ||
        errorMessage.includes('AADSTS700016') ||
        errorMessage.includes('AADSTS7000218')
      ) {
        this.diagnostic = this.classifyEntraError(
          errorCode ?? '',
          errorMessage,
        );
      }
      this.flowState = {
        status: cancelled ? 'cancelled' : 'error',
        deviceCode: this.activeDeviceCode,
        message: normalized.message,
        errorCode: errorCode ?? classified.category,
        diagnostic: this.diagnostic,
      };
      sender.send('auth:flow-state', this.flowState);
      this.log('error', authLogStage(classified.stage), classified.message, {
        category: classified.category,
        code: classified.code,
        status: classified.status,
      });
      throw normalized;
    } finally {
      this.activeRequest = null;
      this.loginInProgress = false;
    }
  }

  getActiveDeviceCode() {
    return this.activeDeviceCode;
  }

  getFlowState() {
    return this.flowState;
  }

  cancelLogin() {
    if (this.activeRequest) {
      this.activeRequest.cancel = true;
    }
  }

  async getMinecraftSession(): Promise<MinecraftSession> {
    const client = this.ensureClient();
    const account = await this.getAccount();
    if (!account) {
      throw new AuthStageError(
        'microsoft',
        'Microsoftアカウントでログインしてください。',
        'not_signed_in',
      );
    }

    this.log('info', 'auth:microsoft', 'Microsoftトークンを更新します。');
    const result = await client.acquireTokenSilent({
      account,
      scopes: microsoftScopes,
    });
    return this.exchangeMicrosoftToken(result.accessToken);
  }

  async logout(): Promise<AuthState> {
    const accounts = await this.publicClient?.getAllAccounts();
    for (const account of accounts ?? []) {
      await this.publicClient?.getTokenCache().removeAccount(account);
    }

    this.profile = null;
    this.cancelLogin();
    this.activeDeviceCode = null;
    this.flowState = {
      status: 'idle',
      deviceCode: null,
      message: '',
    };
    await Promise.all([
      fs.rm(this.cacheFile, { force: true }),
      fs.rm(this.profileFile, { force: true }),
    ]);
    return this.getState();
  }
}
