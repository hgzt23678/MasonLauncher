# CLAUDE.md — Simple Craft Launcher 作業メモ

## プロジェクト概要

Electron 42 + Vite + TypeScript で構成された Minecraft Java Edition 非公式ランチャー。
Microsoft デバイスコードフローで認証し、Mojang CDN から vanilla / Forge / Java JRE を自動取得して起動する。
UI はフレームワークなしのバニラ DOM 操作（React/Vue 等なし）。

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
- 設定の永続化先: `%APPDATA%\Simple Craft Launcher\launcher-settings.json`（`LauncherSettings` 型）
- プロファイルは同ファイルの `profiles[]` 配列に保存。

---

## 主要ファイルと責務

| ファイル | 責務 |
|---|---|
| `src/main.ts` | Electron メインプロセス。IPC ハンドラ全登録・設定読み書き・起動ワークフロー制御 |
| `src/preload.ts` | contextBridge で `window.launcher` を公開 |
| `src/renderer.ts` | UI 全体（1660行超のバニラ TS DOM 操作） |
| `src/auth-service.ts` | Microsoft → Xbox → XSTS → Minecraft Services 認証チェーン |
| `src/offline-auth-cache.ts` | オフライン起動キャッシュ（30日TTL）の生成・検証 |
| `src/minecraft-service.ts` | ダウンロード・Java確保・Forge確保・起動を束ねるファサード |
| `src/minecraft-downloader.ts` | Mojang CDN からバイナリ取得・SHA-1 検証・atomic write |
| `src/minecraft-launch-resolver.ts` | JVM / ゲーム引数の組み立て |
| `src/minecraft-process-runner.ts` | Java プロセス spawn・終了コード監視 |
| `src/forge-service.ts` | Forge maven-metadata.xml → installer DL → @xmcl/installer で適用 |
| `src/modrinth-service.ts` | Modrinth 検索・バージョン解決・MOD jar のダウンロード同期 |
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

1660行超の単一ファイル。関数を追加するときは既存のセクション（auth / profile / mod / log）に合わせて配置する。

---

## Forge プロファイルのインスタンス分離

- **バニラプロファイル**: 共通の `gameDirectory`（`.minecraft` 相当）を使用
- **Forge プロファイル**: `<gameDirectory>/simple-craft/profiles/<profileId>/` を独立インスタンスとして使用
- MOD ファイルは `<instanceDirectory>/mods/` に配置される

---

## テストについて

Node.js 組み込み test runner（`tsx --test`）で実行。Electron API は使用しない。

| テストファイル | 内容 |
|---|---|
| `tests/minecraft-downloader.test.ts` | ローカル HTTP サーバーを立てた統合スタイル。SHA-1 検証・キャッシュ再利用・atomic write を検証 |
| `tests/minecraft-launch.test.ts` | `MinecraftLaunchResolver` / `MinecraftProcessRunner` のユニットテスト |
| `tests/launcher-utils.test.ts` | パスヘルパー等のユニットテスト（推測） |
| `tests/forge-service.test.ts` | Forge 関連のユニットテスト（推測） |
| `tests/offline-auth-cache.test.ts` | キャッシュ検証ロジックのユニットテスト（推測） |

本物の Mojang / Microsoft API へのネットワーク接続はテストしない。

---

## ビルド時変数インジェクション

`__MICROSOFT_CLIENT_ID__` は Vite が `.env` から注入するビルド時定数。

- 型宣言: `src/global.d.ts`
- ランタイム上書き: `launcher-settings.json` の `microsoftClientId` フィールドが優先される
- Client ID なしでビルドした場合、認証機能は無効化されるが起動は可能
