# Simple Craft Launcher

Minecraft Java Editionを単体でインストール・起動する、非公式のElectronランチャーです。
公式Minecraft Launcherは必要ありません。

## Features

- Mojangのバージョンマニフェストからバニラ版を選択
- クライアント、ライブラリ、ネイティブ、アセットを直接ダウンロード
- Mojang配布のバージョン別Javaランタイムを自動導入
- 複数の起動プロファイルをカードグリッドで作成・編集
- プロファイルごとのVanilla / Forge切り替えとメモリ設定
- Modrinthから対応MODと必須依存MODを取得し、プロファイル単位で分離
- Microsoftデバイスコード認証とMinecraft Java Editionの所有権確認
- 公式メタデータのSHA-1/size検証と原子的ファイル置換
- 保存済みトークンをOSの暗号化機能で保護
- メモリ割り当てとゲームディレクトリを設定
- Javaプロセスを直接起動し、終了状態をランチャーへ通知

## Microsoft Login

MultiMC / PrismLauncherと同じMicrosoftデバイスコードフローを使用します。
利用者がクライアントIDを入力する必要はありません。ログインボタンを押すと
アクセス許可コードとMicrosoftの認証ページが表示されます。

ランチャーの配布者は、ランチャー自身のMicrosoft Entraアプリ登録を用意して
クライアントIDをビルドへ組み込む必要があります。PrismLauncherなど別アプリの
クライアントIDは使用しません。

1. [Microsoft Entraのアプリ登録](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)を開く。
2. アカウント種類を`AzureADandPersonalMicrosoftAccount`にする。
3. 「パブリック クライアント フローを許可する」を「はい」にする。
4. `.env.example`を参考に`.env`へ`MICROSOFT_CLIENT_ID`を設定してビルドする。

### Application IDを設定ファイルで変更する

ビルドし直さずにApplication IDを変更する場合は、ランチャーを終了してから次のファイルを編集します。

```text
%APPDATA%\Simple Craft Launcher\launcher-settings.json
```

`microsoftClientId`へMicrosoft Entraの「アプリケーション (クライアント) ID」を指定します。

```json
{
  "microsoftClientId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

次回起動時から設定ファイルの値が`.env`のビルド値より優先されます。Application IDを変更すると、
別アプリのトークンが混ざらないように保存済みMicrosoft認証キャッシュとMinecraftプロフィールを
自動削除するため、再ログインが必要です。クライアントシークレットは設定しないでください。

公式資料:

- [デスクトップアプリの登録設定](https://learn.microsoft.com/ja-jp/entra/identity-platform/scenario-desktop-app-configuration)
- [デバイス認可付与フロー](https://learn.microsoft.com/ja-jp/entra/identity-platform/v2-oauth2-device-code)
- [サポートされるアカウントの変更](https://learn.microsoft.com/ja-jp/entra/identity-platform/howto-modify-supported-accounts)

## Development

Node.js 20以降が必要です。

```powershell
npm install
npm start
npm run lint
npm run typecheck
npm run test
npm run package
npm run make
```

- `npm start`: Viteのホットリロード付きで起動
- `npm run package`: `out/`へ展開済みアプリを作成
- `npm run make`: `out/make/`へWindowsインストーラー等を作成

`.env`にクライアントIDがない開発ビルドは起動できますが、Microsoftログインは
無効になります。

このプロジェクトはMojangまたはMicrosoftの公式製品ではありません。プレイには
Minecraft: Java Editionを所有するMicrosoftアカウントが必要です。
