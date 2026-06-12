# CLAUDE.md — Mason Launcher 作業メモ

## プロジェクト概要

Electron 42 + Vite + TypeScript で構成された、インスタンスベースの Minecraft Java Edition 非公式ランチャー。
Microsoft デバイスコードフローで認証し、Mojang CDN から vanilla / Forge / Java JRE を自動取得して起動する。
UI はフレームワークなしのバニラ DOM 操作（React/Vue 等なし）。ただし UI コンポーネントには **@material/web（MD3 Web Components）** を全面採用済み。

---

## セットアップ確認（作業前チェックリスト）

```
node -v      # 20+ であること
npm install  # 済みか確認
```

Microsoft ログイン機能を使う場合は `.env` が必要：

```
MICROSOFT_CLIENT_ID=<Azure Entra アプリの GUID>
```

Client ID がなくてもビルド・起動は可能（Microsoft ログイン機能のみ無効になる）。

---

## コマンドリファレンス

```
npm start            開発起動（Electron Forge + Vite HMR）
npm run typecheck    型チェックのみ（ファイル出力なし）
npm run lint         ESLint
npm run test         Node.js test runner (tsx --test tests/**/*.test.ts)
npm run package      out/ に展開ビルド
npm run make         out/make/ に Squirrel インストーラ生成
```

---

## アーキテクチャのルール

### IPC の境界（必ず守ること）

renderer → main の通信は **必ず preload.ts の contextBridge 経由**。

新しい IPC チャンネルを追加するときは **3ファイルすべて** を更新する：

1. `src/preload.ts` — `contextBridge.exposeInMainWorld('launcher', {...})` に関数を追加
2. `src/main.ts` — `ipcMain.handle('チャンネル名', ...)` にハンドラを追加
3. `src/global.d.ts` — `Window['launcher']` の型に追加

renderer.ts は `window.launcher.xxx()` を呼ぶだけ。renderer から `ipcRenderer` を直接使わない。

### プロセスの分離

| プロセス | 許可されること |
|---|---|
| main.ts | ファイルシステム・Electron API・ネットワーク・子プロセス |
| renderer.ts | DOM 操作のみ。Node.js API は **使用不可**（contextIsolation ON / nodeIntegration OFF） |
| preload.ts | IPC ブリッジのみ。ビジネスロジックを書かない |

### 状態管理

- UI 状態は `renderer.ts` 内の `LauncherState` ローカル変数のみ。外部ストアなし。
- 設定の永続化先: `%APPDATA%\Mason Launcher\launcher-settings.json`（`LauncherSettings` 型）
- プロファイルは同ファイルの `profiles[]` 配列に保存。

---

## 主要ファイルと責務

| ファイル | 責務 |
|---|---|
| `src/main.ts` | Electron メインプロセス。IPC ハンドラ全登録・設定読み書き・起動ワークフロー制御 |
| `src/preload.ts` | contextBridge で `window.launcher` を公開 |
| `src/renderer.ts` | UI 全体（2150行超のバニラ TS DOM 操作）|
| `src/global.d.ts` | renderer から見える型定義（`Window['launcher']`、各種型） |
| `src/diagnostics.ts` | ログエントリ管理（`LauncherDiagnostics`）。全ログは IPC 経由で renderer に push |
| `src/auth-service.ts` | Microsoft → Xbox → XSTS → Minecraft Services 認証チェーン |
| `src/auth-config.ts` | `__MICROSOFT_CLIENT_ID__` のビルド時定数解決 |
| `src/auth-errors.ts` | 認証エラーの分類・メッセージ整形 |
| `src/offline-auth-cache.ts` | オフライン起動キャッシュ（30日TTL）の生成・検証 |
| `src/minecraft-service.ts` | ダウンロード・Java確保・Forge確保・起動を束ねるファサード |
| `src/minecraft-downloader.ts` | Mojang CDN からバイナリ取得・SHA-1 検証・atomic write |
| `src/minecraft-launch-resolver.ts` | JVM / ゲーム引数の組み立て・起動前診断ログ出力 |
| `src/minecraft-process-runner.ts` | Java プロセス spawn・終了コード監視・クラッシュ検出 |
| `src/minecraft-errors.ts` | `MinecraftError` クラスとエラー分類 |
| `src/java-runtime-service.ts` | Java ランタイム管理（Foojay Disco 経由インストール・バージョン解決） |
| `src/forge-service.ts` | Forge maven-metadata.xml → installer DL → @xmcl/installer で適用 |
| `src/modrinth-service.ts` | Modrinth 検索・バージョン解決・MOD jar のダウンロード同期 |
| `src/launcher-utils.ts` | パスヘルパー・spawn バリデーション・起動オプションビルダー |
| `src/xmcl-compat.ts` | undici 7 互換パッチ（後述） |

---

## 触るときに注意が必要な箇所

### undici バージョン固定（`src/xmcl-compat.ts`）

`@xmcl/installer` が削除済みの `ResponseStatusCodeError` を参照するため、
`src/xmcl-compat.ts` で undici のグローバルに互換パッチを当てている。
`package.json` の `overrides.undici` が `7.27.2` に固定されているのはこのため。

**undici のバージョンを変更しない。** 変更する場合は `xmcl-compat.ts` の動作確認が必須。

### safeStorage 暗号化ファイル

以下のファイルは `electron.safeStorage` で暗号化されている。
テスト環境や別マシンでは復号できない（意図した設計）。

- `microsoft-cache.bin` — MSAL トークンキャッシュ
- `microsoft-offline-authorization.bin` — 30日オフラインキャッシュ

### オフライン認証キャッシュ（`src/offline-auth-cache.ts`）

`OFFLINE_AUTH_CACHE_DAYS = 30`。clientId が変わると自動でキャッシュが無効化される。
`microsoftClientId` の変更テスト時は古いキャッシュを手動削除すること。

### 二重起動ガード（`src/main.ts`）

`launchWorkflowInProgress` フラグがメインプロセスのモジュールスコープで管理されている。
IPC ハンドラを追加するとき、起動ワークフロー中に呼ばれてはいけない処理はガードの内側に書かないよう注意。

### `src/renderer.ts` の巨大ファイル

2150行超の単一ファイル。関数を追加するときは既存のセクション（auth / profile / mod / log）に合わせて配置する。

### Material Web コンポーネント（`@material/web`）

すべてのボタン・フォーム要素は MD3 Web Components に移行済み。

- サイドバーナビ: `<md-icon-button class="nav-icon-btn">` — アクティブ状態は `data-active="true"` 属性（`.active` クラスではない）
- アカウントボタン: `<md-outlined-button class="account-btn">` — アバターは `slot="icon"`
- 動的生成ボタン: `document.createElement('md-outlined-button') as unknown as HTMLButtonElement`
- イベント委譲のセレクタ: `'button[data-*]'` ではなく **`'[data-*]'`** にすること（md-* はカスタム要素なので `button` で拾えない）
- CSS テーマは MD3 CSS カスタムプロパティ（`--md-icon-button-*` 等）で上書き

---

## インスタンス分離アーキテクチャ

各プロファイルは独立した `instanceDir`（ゲームディレクトリ）を持つ。

| 項目 | パス |
|---|---|
| 共有リソース（client.jar・libraries・assets・natives） | `settings.gameDirectory`（`.minecraft` 相当） |
| デフォルトプロファイルのインスタンス | `%APPDATA%\Mason Launcher\instances\default-profile\instance\` |
| UI で新規作成したプロファイルのインスタンス | `<gameDirectory>\mason-launcher\profiles\<uuid>\` |
| 旧形式プロファイル（instanceDir なし）のフォールバック | 旧保存先の既存インスタンスを継続利用 |
| MOD ファイル | `<instanceDir>\mods\` |

**重要**: `launchVersion` に渡す `gamePath`（`--gameDir`）は instanceDir、
`resourcePath`（classpath / assets のルート）は共有 gameDirectory。両者は必ず別々に渡すこと。

`profile:save` IPC で新規プロファイルを作成すると `instanceDir` は `gameDirectory` 配下に固定される。
`instanceDir` は保存後に変更しない（セーブデータが残る）。

---

## Java ランタイム管理（`src/java-runtime-service.ts`）

`JavaRuntimeService` は Foojay Disco API 経由で JRE を自動インストール・管理する。

- 管理ランタイム: `%APPDATA%\Mason Launcher\runtime\java\managed\<distribution>-<major>-<arch>\`
- Mojang ランタイム: `%APPDATA%\Mason Launcher\runtime\<component>\`（`@xmcl/installer` が配置）
- Windows での実行ファイル名: **`java.exe`**（`javaw.exe` ではない）
- プローブ時も `java.exe` を使用。`javaw.exe` が渡された場合は隣の `java.exe` に切り替えてプローブする

`ProfileJavaSettings.mode`:
- `auto` — 要求バージョンに合う管理/カスタム/システム Java を自動選択。なければ Foojay からインストール
- `fixed` — 特定の runtimeId を固定
- `customPath` — ユーザー指定の java.exe / javaw.exe パスを使用

---

## クラッシュ検出と診断ログ（`src/minecraft-process-runner.ts`）

- **`windowEverAppeared` + `spawnedAt`**: ウィンドウ未表示のまま 15 秒以内に終了した場合を「起動失敗」として検出
- `abnormalCode = code !== 0`、`killedBySignal = signal != null` — いずれかで crash 判定
- stdout/stderr は行単位で `diagnostics.log()` に転送（上限なし）
- 起動引数の診断ログは `stage: 'arguments'` に出力（`javaExecutable`・`classpathEntries`・`nativesDirectory` 等を含む）
- Minecraft クラッシュ時: renderer の `onProcessState` ハンドラが `refreshDeveloperLogs()` を自動呼び出しし、設定パネルのログを即時更新する

---

## Forge プロファイルの起動フロー

1. `ensureVersionInstalled(minecraftVersion)` — バニラ本体を確保
2. `ensureForge(minecraftVersion, loaderVersion, java)` — Forge installer DL → `@xmcl/installer` でライブラリ展開 → 互換マーカー書き込み
3. 再起動時は `verifyReady()` でマーカーとプロセッサ出力の SHA-1 を検証してスキップ
4. `modrinthService.syncMods()` — プロファイルの mods リストと instanceDir/mods/ を同期
5. `minecraftService.launchVersion(forgeVersionId, ..., instanceDir)` — 起動

---

## テストについて

Node.js 組み込み test runner（`tsx --test`）で実行。Electron API は使用しない。

| テストファイル | 内容 |
|---|---|
| `tests/minecraft-downloader.test.ts` | ローカル HTTP サーバーを立てた統合スタイル。SHA-1 検証・キャッシュ再利用・atomic write を検証 |
| `tests/minecraft-launch.test.ts` | `MinecraftLaunchResolver` / `MinecraftProcessRunner` のユニットテスト |
| `tests/launcher-utils.test.ts` | パスヘルパー・spawn バリデーション・起動オプションビルダーのユニットテスト |
| `tests/forge-service.test.ts` | Forge Maven metadata パース・installer パース・legacy アーティファクト抽出 |
| `tests/java-runtime-service.test.ts` | バージョン解決・Foojay インストール・auto/fixed/customPath モードの挙動 |
| `tests/modrinth-service.test.ts` | Modrinth 検索・バージョン解決・ダウンロード・依存関係処理 |
| `tests/auth-config.test.ts` | Client ID の解決・フォールバック |
| `tests/auth-errors.test.ts` | 認証エラー分類 |
| `tests/diagnostics.test.ts` | ログのサニタイズ（資格情報マスク） |
| `tests/offline-auth-cache.test.ts` | キャッシュ有効期限・clientId 変更時の無効化 |
| `tests/xmcl-compat.test.ts` | undici 7 との互換パッチ動作確認 |

本物の Mojang / Microsoft API へのネットワーク接続はテストしない。

---

## ビルド時変数インジェクション

`__MICROSOFT_CLIENT_ID__` は Vite が `.env` から注入するビルド時定数。

- 型宣言: `src/global.d.ts`
- ランタイム上書き: `launcher-settings.json` の `microsoftClientId` フィールドが優先される
- Client ID なしでビルドした場合、認証機能は無効化されるが起動は可能
