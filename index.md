---
title: Mason Launcher プライバシーに関する声明
---

# Mason Launcher プライバシーに関する声明

最終更新日: 2026年6月14日

Mason Launcher（以下「本アプリ」）は、Minecraft Java Edition向けの非公式ランチャーです。本アプリはMicrosoft、Mojang Studios、Modrinthの公式製品ではありません。

## 取り扱う情報

本アプリは、機能の提供に必要な範囲で次の情報を取り扱います。

- Microsoftアカウント認証トークン
- Minecraftプロフィールのユーザー名、UUID、スキン情報
- Minecraft Java Editionの所有権確認結果
- ランチャー設定、インスタンス設定、導入済みMODの情報
- Minecraftおよびランチャーの診断ログ

## 利用目的

これらの情報は、Microsoftアカウントでのログイン、Minecraft Java Editionの所有権確認、ゲームの起動、MODやゲームファイルの取得、設定保存、障害調査のために使用します。

## 保存方法

認証キャッシュは、利用可能な場合にOSが提供する暗号化機能を使用して端末内へ保存します。プロフィール、設定、インスタンス、ログなども原則として利用者の端末内に保存されます。

アクセストークン、更新トークン、Authorizationヘッダーなどの秘密情報は、ランチャーの診断ログではマスクするよう設計されています。

本アプリ独自のサーバーへ利用者情報や利用状況を送信するテレメトリ機能は、現在実装していません。

## 外部サービスへの通信

本アプリは機能提供のため、次の外部サービスへ直接通信します。

- Microsoft Entra ID、Xbox Live、XSTS、Minecraft Services
- Mojang/Minecraftの公式メタデータ、ライブラリ、アセット配信サービス
- Modrinth APIおよびModrinth配信サービス
- Javaランタイムの公式配信サービス

外部サービスでの情報の取り扱いには、各サービスの規約およびプライバシーポリシーが適用されます。

- [Microsoft プライバシー ステートメント](https://privacy.microsoft.com/privacystatement)
- [Minecraft EULAとプライバシー情報](https://www.minecraft.net/en-us/eula)
- [Modrinth Privacy Policy](https://modrinth.com/legal/privacy)

## 情報の削除

本アプリからログアウトすると、保存済みのMicrosoft認証キャッシュ、Minecraftプロフィール、および認証済みオフライン起動権限が削除されます。その他の設定、インスタンス、ゲームデータは、利用者が端末上のファイルを削除することで消去できます。

## 第三者への提供

本アプリの開発者が、利用者の個人情報を販売することはありません。認証やダウンロードなどの機能を実行する際は、上記外部サービスへ必要な情報が直接送信されます。

## 変更

本声明は、本アプリの機能変更などに応じて更新される場合があります。更新時はこのページの最終更新日を変更します。

## お問い合わせ

本声明または本アプリについての問い合わせは、[Mason Launcher GitHub Issues](https://github.com/hgzt23678/MasonLauncher/issues)からお願いします。
