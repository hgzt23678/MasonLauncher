# Mason Launcher Website

Mason LauncherのGitHub Pages向け公式ホームページです。
`docs`ブランチ上で、アプリ本体とは独立したVite + TypeScript構成として管理します。

## Local development

Node.js 20以降が必要です。

```bash
npm ci
npm run dev
```

ローカルビルド:

```bash
npm run build
npm run preview
```

## GitHub Pages

1. リポジトリの **Settings > Pages** を開く。
2. **Build and deployment > Source** を **GitHub Actions** に設定する。
3. `docs`ブランチへpushする。
4. `Deploy website to GitHub Pages` workflowの完了を待つ。

workflowはViteで`dist/`を生成し、GitHub Pages artifactとして公開します。
公開URLは次を想定しています。

`https://hgzt23678.github.io/MasonLauncher/`

リポジトリ名や公開URLを変更する場合は、次も更新してください。

- `vite.config.ts`の`base`
- `index.html`と`privacy/index.html`のcanonical / OGP URL
- `public/og-image.svg`

## Assets to replace

トップページのスクリーンショット領域は現在CSSプレースホルダーです。
正式な画面画像を用意した場合は、個人情報・Minecraftアクセストークン・ローカルパスが
写っていないことを確認してから`public/`へ追加し、`index.html`の該当領域を差し替えてください。
