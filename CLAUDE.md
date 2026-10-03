# kakitome

チェックリスト・リマインド・Android ウィジェットに対応した、サーバーを持たないローカルファーストのメモアプリ（Expo / iOS・Android）。

設計の詳細は必ず `docs/design.md` を参照すること。設計と異なる実装が必要になった場合は、実装前にユーザーに確認し、合意後に `docs/design.md`（特に「意思決定ログ」）も更新すること。

## 守るべき不変条件

- **expo-sqlite が唯一の正**。データの変更は必ず同期コアの `applyLocalOp` 経由で行う。テーブルを直接 UPDATE しない
- **`src/core/` は純粋 TypeScript**。React Native・Expo・UI・画像処理への依存を持ち込まない（Android ウィジェットのヘッドレス JS から呼ぶため）
- op の適用は**可換かつ冪等**でなければならない。これを壊す変更をしない
- **削除は墓標（`deleted = 1`）**。同期対象テーブルで物理削除しない
- Drive 上の op ファイル・blob は**不変**。既存ファイルを上書きしない。各端末は他端末のファイルに書き込まない
- 競合コピーの ID は「元メモ ID＋敗者 op の ID」から**決定的に生成**する
- **未アップロードの blob をローカルから削除しない**
- 画像の EXIF（位置情報）を保存しない
- Google のスコープは `drive.appdata` 以外を追加しない

## 技術スタック

Expo（Development Build）/ Expo Router / TypeScript / expo-sqlite / react-native-android-widget / Google Drive API v3 / expo-notifications / expo-image-picker / expo-image-manipulator / expo-file-system / @react-native-community/netinfo

ライブラリの使い方は、公式ドキュメントを一次情報として確認すること。

## 開発の進め方

- 同期コアはテストファーストで実装する。収束性（順不同・重複適用でも同じ状態になること）はプロパティベーステストで検証する
- 実装の優先順は `docs/design.md` の「実装ロードマップ」に従う
