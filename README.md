# Mason Launcher

Mason Launcher is a clean, instance-based launcher for Minecraft: Java Edition.
Electron、Vite、TypeScriptで構築された独立した非公式アプリケーションです。

## 日本語に強いMinecraftランチャー

Mason Launcherは日本語を第一言語として設計し、認証、Java管理、
Minecraft起動診断、Modrinth連携まで自然な日本語で案内します。
日本語環境では追加設定なしで日本語を使用でき、OSの言語設定に応じて
英語、繁體中文、简体中文、한국어にも自動で切り替わります。
表示言語は設定画面からいつでも明示的に変更できます。

## Features

- 日本語を標準とした5言語対応とシステム言語の自動検出
- Vanilla / Forgeプロファイルの作成と管理
- プロファイルごとに分離されたゲームインスタンス
- Mojang公式メタデータに基づくクライアント、ライブラリ、assetsの取得と検証
- Minecraftバージョンに応じたJava/JREの選択と管理
- Modrinth APIを使用したMOD検索、依存関係解決、インスタンス単位の同期
- Microsoftデバイスコード認証とMinecraft: Java Editionの所有権確認
- 起動進捗、Javaプロセス、stdout/stderr、終了状態の表示
- SHA-1/size検証と原子的ファイル置換
- OSの暗号化機能を使用した認証キャッシュの保護

## Microsoft Login

Microsoftのデバイスコード認証フローを使用します。ログイン操作を開始すると、
アクセス許可コードとMicrosoftの認証ページが表示されます。

配布者はMason Launcher用のMicrosoft Entraアプリ登録を用意し、
クライアントIDをビルドへ設定する必要があります。他アプリのクライアントIDは使用しません。

1. [Microsoft Entraのアプリ登録](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)を開く。
2. アカウント種類を`AzureADandPersonalMicrosoftAccount`にする。
3. 「パブリック クライアント フローを許可する」を「はい」にする。
4. 独自のEntra App IDを使う場合だけ、`.env.example`を参考に`.env`へ`MICROSOFT_CLIENT_ID`を設定してビルドする。

### Application IDを設定ファイルで変更する

ビルドし直さずにApplication IDを変更する場合は、Mason Launcherを終了してから
次のファイルを編集します。

```text
%APPDATA%\Mason Launcher\launcher-settings.json
```

`microsoftClientId`へMicrosoft Entraの「アプリケーション (クライアント) ID」を指定します。

```json
{
  "microsoftClientId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

次回起動時から設定ファイルの値が`.env`のビルド値より優先されます。
Application IDを変更すると、別アプリのトークンが混ざらないように保存済みの
Microsoft認証キャッシュとMinecraftプロフィールを削除するため、再ログインが必要です。
クライアントシークレットは設定しないでください。

公式資料:

- [デスクトップアプリの登録設定](https://learn.microsoft.com/ja-jp/entra/identity-platform/scenario-desktop-app-configuration)
- [デバイス認可付与フロー](https://learn.microsoft.com/ja-jp/entra/identity-platform/v2-oauth2-device-code)
- [サポートされるアカウントの変更](https://learn.microsoft.com/ja-jp/entra/identity-platform/howto-modify-supported-accounts)

## Development

Node.js 24系が必要です。

```powershell
npm install
npm start
npm run lint
npm run typecheck
npm run test
build.bat
build-release.bat
# Linux:
./build-linux.sh debug
./build-linux.sh release
```

- `npm start`: Viteのホットリロード付きで起動
- `build.bat`: Debugビルドを`out/debug/`へ作成
- `build-release.bat`: Releaseビルドを`out/release/`へ作成
- `build-linux.sh debug|release`: Linuxで構成別に`out/debug/`または`out/release/`へ作成

GitHub Actionsの`Build Electron` workflowはNode.js 24を使用し、Windows、
Linux、macOSのx64/arm64向け成果物を生成します。macOSのZIP成果物は署名と
notarizationを行っていないため、配布前にApple Developer証明書を使った署名が必要です。

`.env`にクライアントIDがない開発ビルドは起動できますが、Microsoftログインは無効になります。

Mason LauncherはMojangまたはMicrosoftの公式製品ではありません。
プレイにはMinecraft: Java Editionを所有するMicrosoftアカウントが必要です。
