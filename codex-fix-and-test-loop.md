# Mason Launcher 品質改善タスク(テスト駆動・反復検証)

このリポジトリ(Mason Launcher: Electron 42 / Vite / TypeScript / @material/web)の既知の問題を修正してください。
**大規模リライトは禁止**です。1問題=1最小差分で進め、**変更のたびにテストを繰り返し実行**してください。

作業前に必ず `CLAUDE.md` と `.codex.md` を読み、IPC境界・プロセス分離・undici固定などのルールに従ってください。

---

## 検証ループ(最重要・厳守)

1. 最初に `npm install` → `npm run check`(typecheck + lint + test)を実行し、**ベースラインが緑であることを記録**する。赤なら原因を特定して先に直す。
2. バグ修正は**テストファースト**で行う:
   - まず「現状の挙動で失敗するテスト」を書き、`npm test` で**赤を確認**
   - 最小差分で修正し、`npm test` で**緑を確認**
3. **1ファイル編集するごとに** `npm run typecheck && npm test` を実行する。まとめて後で検証しない。
4. 各問題の完了時に必ずフルの `npm run check` を実行する。
5. 全問題の完了後、`npm run check` を**連続2回**実行し、両方緑であることを確認する(flaky検出)。
6. 既存テストの削除・skip・期待値の書き換えで「通す」ことは**禁止**。既存テストが壊れたら自分の変更を疑う。
7. 同一問題で修正→赤が**3回**続いたら、その問題は中断して「未解決」として報告に回し、次の問題へ進む(無限ループ防止)。

テスト実行コマンド:

```
npm run typecheck    # 型チェック
npm run lint         # ESLint
npm test             # tsx --test tests/**/*.test.ts
npm run check        # 上記すべて
```

---

## 修正対象の問題(優先度順)

着手前に各問題をコード上で自分でも再現確認し、報告に根拠(ファイル・行・該当コード)を含めてください。

### 問題1【バグ】md-select にネイティブ `<option>` が混入している

`src/renderer.ts` の `openProfileEditor` 内で、Forge build セレクトのプレースホルダを
`profileForgeVersionSelect.replaceChildren(new Option('Forge buildを選択してください', ''))`
で挿入している。`<md-filled-select>` はネイティブ `<option>` を認識せず、`md-select-option` でなければ表示・選択状態が正しく動作しない。同ファイルの `loadForgeBuilds` は正しく `document.createElement('md-select-option')` を使っており、実装が不整合。

対応:
- `new Option(` をリポジトリ全体で検索し、md-select 配下に挿入している箇所をすべて `md-select-option` 生成に統一する
- プレースホルダ生成を小さなヘルパー関数に抽出してよい(既存スタイルに合わせる)

### 問題2【サイレント失敗】追加JVM引数が黙って破棄されることがある

`src/minecraft-launch-resolver.ts` の `resolve()` 内:

```ts
const mainClassIndex = args.indexOf(version.mainClass);
if (mainClassIndex >= 0) {
  args.splice(mainClassIndex, 0, ...extraJvmArgs);
}
```

`mainClassIndex < 0` の場合、プロファイルの追加JVM引数(`java.jvmArgs`)が**警告もエラーもなく無視**される。ユーザーが設定した `-Xmx` 系やGC設定が効かないまま起動する。

対応:
- mainClass が引数列に見つからない場合は `MinecraftError`(category: `'arguments'`、code例: `JVM_ARGS_INSERTION_FAILED`)を投げて起動を中止する(既存のエラー分類・UI表示経路に乗せる)
- 「挿入成功」「mainClass未検出で失敗」の両ケースを `tests/minecraft-launch.test.ts` に追加する。既存テストのスタイル(日本語テスト名・`assert.throws` で category/code を検証)に合わせること

### 問題3【データ不整合リスク】LaunchProfile の冗長フィールドと正規表現ベースのForge判定

`LaunchProfile` には `loader` / `loaderType` / `profileType`、`versionId` / `minecraftVersion` / `resolvedVersionId` という重複フィールドがあり、`src/main.ts` の `minecraft:launch-profile` ハンドラでは
`/(?:^|[-_.])forge(?:[-_.]|$)/i` という正規表現と `inheritsFrom` でForgeを推定し、**起動ワークフロー中にプロファイルを直接ミューテートして `writeSettings` している**。判定ロジックが分散しており、フィールド間の不整合(desync)が起きやすい。

対応(型やデータ構造の再設計は**禁止**。後方互換を維持):
- Forge判定+プロファイル正規化(冗長フィールドの同期)を **純粋関数として1箇所に抽出**する(例: `src/launcher-utils.ts` に追加。`main.ts` から呼び出すだけにする)
- 抽出した純粋関数に対する単体テストを追加する(Forge版ID `1.20.1-forge-47.2.0` の検出、vanilla版の素通し、`inheritsFrom` あり/なし、冗長フィールドが揃うこと)
- `instanceDir` は変更しない。保存形式・既存プロファイルの読み込み互換を壊さない

### 問題4【テスト空白】renderer.ts(約2200行)が完全に未テスト

UIファイル内に DOM 非依存で切り出せる純粋ロジックが埋まっており、回帰がテストで捕捉できない(実際に「非表示Snapshot選択中に md-select が空になる」バグが発生していた)。

対応(**最小限の抽出のみ**。DOM操作・イベント処理は移動しない):
- 次の純粋ロジックを新ファイル `src/renderer-logic.ts`(命名は既存規約に合わせ調整可)へ抽出し、`renderer.ts` はそこから import する:
  - バージョン一覧のフィルタ条件(snapshot表示トグル・old_beta/old_alpha除外・**現在選択中バージョンは常に残す**)
  - `formatVersionLabel`
  - `compareVersionsByRelease`
- `tests/renderer-logic.test.ts` を新設し、最低限以下を検証:
  - トグルOFFでsnapshotが除外される/ONで含まれる
  - old_beta / old_alpha は常に除外される
  - **選択中のsnapshot版はトグルOFFでもリストに残る**(回帰防止)
  - releaseTime によるソート順
- 抽出後、`npm start` で UI が起動することを目視確認できない環境の場合は、その旨を報告に明記する

### 問題5【確認・なければ実装】起動前の `--gameDir` 検証

`src/minecraft-launch-resolver.ts` に `assertGameDirArgument`(起動引数に `--gameDir` が存在し、値がプロファイルの instanceDir と一致することを検証し、不一致なら `MinecraftError('arguments')`)が存在するか確認する。

- **存在する場合**: `tests/minecraft-launch.test.ts` にテスト(一致でpass / 欠落でthrow / 不一致でthrow)が揃っているか確認し、なければ追加するだけ
- **存在しない場合**: 上記仕様で実装+テスト追加

### 問題6【低優先・任意】tsconfig.json の非推奨オプション

`baseUrl` と `moduleResolution: "node"` は TypeScript 6/7 で廃止予定(TS6では既にエラー)。現在のTS 5.9系では動作するため**緊急性は低い**。

対応条件: 変更後に `npm run check` と `npm start`(起動確認)が**両方緑の場合のみ**採用する。1つでも壊れるなら変更を破棄し、「未対応(理由付き)」として報告する。Viteビルド(`vite.*.config.ts`)への影響に注意。

---

## 禁止事項

- 大規模リライト・ディレクトリ再設計・UIフレームワーク導入
- `undici` のバージョン変更(7.27.2固定。`src/xmcl-compat.ts` 参照)
- 認証回避・任意ユーザー名起動の実装
- `.minecraft` 内の既存データの移動・削除
- 保存済みプロファイルの `instanceDir` 変更、設定ファイルの互換性破壊
- renderer からの Node.js API 直接使用(IPC は preload.ts / main.ts / global.d.ts の3ファイルすべてを更新)
- 既存の Modrinth 検索・Forge 起動経路を壊す変更
- テストの削除・skip・期待値改変による「見かけの緑」

---

## 完了条件

- 問題1〜5が修正済み(問題6は任意)で、それぞれに回帰防止テストが存在する
- `npm run check` が連続2回緑
- 追加・変更したテストがすべて「修正前は赤、修正後は緑」であることをログで示せる

## 報告フォーマット

最後に以下を簡潔に報告してください。

1. 変更ファイル一覧(ファイルごとに1行の変更概要)
2. 問題ごとの対応状況(再現根拠 → 修正内容 → 追加テスト名)
3. 実行した検証コマンドと結果(ベースライン → 各問題後 → 最終2回連続の結果)
4. 未解決・未対応の問題とその理由
5. レビュアーが手動確認すべき点(UI目視確認が必要な箇所など)
