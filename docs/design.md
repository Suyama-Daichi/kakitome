# kakitome 設計ドキュメント

> kakitome（書き留め／書留）— チェックリスト・リマインド・Android ウィジェットに対応した、サーバーを持たないローカルファーストのメモアプリ。

- ステータス: 設計確定（実装前）
- 対象プラットフォーム: iOS / Android

---

## 1. 目的と方針

### 1.1 必要な機能

- チェックリストを作れる
- Android のホーム画面ウィジェットから、チェックリストの完了状態を編集できる
- iOS / Android 間でメモを同期できる
- リマインド機能がある
- 画像を添付できる
- Google アカウントで同期を始められる

### 1.2 設計上の優先事項

1. **運用コストゼロ**（最優先）
2. **サーバー運用をしない**
3. **ユーザーデータを開発者が保持しない**

この3点から、同期は自前サーバーや BaaS を使わず、**ユーザー自身の Google Drive（appDataFolder）** を同期先とする。

### 1.3 非目標（MVP ではやらないこと）

- リアルタイム同期（同期はアプリ起動時・フォアグラウンド復帰時・バックグラウンドタスクでのベストエフォート）
- 本文中への画像埋め込み
- iOS ウィジェット（将来 `expo-widgets` で追加を検討）
- 本文のテキスト CRDT による自動マージ
- GitHub アカウント連携（検討の結果、対象外とした。§11 参照）

---

## 2. 全体アーキテクチャ

```
┌──────────────────────── 端末 ────────────────────────┐
│                                                      │
│  アプリ UI (Expo Router)     Android ウィジェット      │
│        │                    (ヘッドレス JS)            │
│        └──────────┬─────────────┘                    │
│                   ▼                                  │
│          同期コア (純粋 TypeScript)                   │
│          applyLocalOp / mergeRemoteOps / HLC          │
│                   │                                  │
│                   ▼                                  │
│          expo-sqlite（唯一の正）                       │
│                   │                                  │
│     ┌─────────────┼──────────────┐                   │
│     ▼             ▼              ▼                   │
│  通知調停     アップロードキュー   画像ストア             │
│ (expo-        (op / 画像)       (expo-file-system)    │
│ notifications)    │                                  │
└───────────────────┼──────────────────────────────────┘
                    ▼
        ユーザーの Google Drive (appDataFolder)
```

### 2.1 技術スタック

| 領域 | 採用技術 |
| --- | --- |
| アプリ基盤 | Expo（Development Build）、Expo Router、TypeScript |
| ローカル DB | expo-sqlite |
| Android ウィジェット | react-native-android-widget（Expo Config Plugin） |
| 同期先 | Google Drive API v3（`drive.appdata` スコープ） |
| 認証 | Google サインイン |
| 通知 | expo-notifications（ローカル通知） |
| 画像 | expo-image-picker、expo-image-manipulator、expo-file-system |
| 回線判定 | @react-native-community/netinfo |
| バックグラウンド処理 | expo-background-task |

Expo を選んだ理由: 全要件が Expo のまま（Kotlin / Swift を書かずに）実現できるため。唯一の懸念だった Android ウィジェットのチェック操作は、react-native-android-widget の `clickAction` とタスクハンドラで実現できる。

---

## 3. データモデル

### 3.1 設計原則

1. **expo-sqlite が唯一の正**。アプリ本体もウィジェットも、すべての変更を同期コアの `applyLocalOp` 経由で行う
2. **すべての変更は op（操作ログ）として記録**し、Drive には op だけを送る（画像本体は別扱い、§7）
3. **競合解決はフィールド単位の LWW（後勝ち）**。比較には HLC（ハイブリッド論理時計）を使う
4. **削除は物理削除せず墓標（`deleted = 1`）** とする
5. **並び順は分数インデックス（文字列の `sort_key`）**。移動した1件の `sort_key` を変えるだけで済み、並び替えの競合を避けられる
6. ID は **UUIDv7**（時刻順にソート可能）

### 3.2 同期対象テーブル

すべてのメモは「タイトル＋本文＋0個以上のチェック項目＋0個以上の添付画像」を持つ。テキストメモ／チェックリストメモの区別（`kind`）は持たない。

```sql
CREATE TABLE notes (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL DEFAULT '',
  body               TEXT NOT NULL DEFAULT '',
  pinned             INTEGER NOT NULL DEFAULT 0,
  sort_key           TEXT NOT NULL,
  deleted            INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  -- 競合コピーの場合のみ値を持つ（§5）
  conflict_of        TEXT,            -- 元メモの ID
  conflict_field     TEXT,            -- 'title' | 'body'
  conflict_base_hlc  TEXT             -- 分岐元の HLC
);

CREATE TABLE checklist_items (
  id          TEXT PRIMARY KEY,
  note_id     TEXT NOT NULL,
  text        TEXT NOT NULL DEFAULT '',
  checked     INTEGER NOT NULL DEFAULT 0,
  sort_key    TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE reminders (
  id          TEXT PRIMARY KEY,
  note_id     TEXT NOT NULL,
  fire_at     TEXT NOT NULL,          -- UTC ISO8601
  timezone    TEXT NOT NULL,          -- 'Asia/Tokyo' など（繰り返し計算用）
  rrule       TEXT,                   -- RFC 5545 RRULE（NULL なら単発）
  enabled     INTEGER NOT NULL DEFAULT 1,
  deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE attachments (
  id          TEXT PRIMARY KEY,
  note_id     TEXT NOT NULL,
  hash        TEXT NOT NULL,          -- 本体の SHA-256
  thumb_hash  TEXT NOT NULL,          -- サムネイルの SHA-256
  mime        TEXT NOT NULL,          -- 'image/jpeg'
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  size        INTEGER NOT NULL,
  sort_key    TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- フィールドごとの最終更新 HLC（LWW 判定・競合検出用）
CREATE TABLE field_clocks (
  entity     TEXT NOT NULL,           -- 'note' | 'checklist_item' | 'reminder' | 'attachment'
  entity_id  TEXT NOT NULL,
  field      TEXT NOT NULL,
  hlc        TEXT NOT NULL,           -- この値を書いた op の HLC
  base       TEXT,                    -- この値が編集時に見ていた HLC
  PRIMARY KEY (entity, entity_id, field)
);
```

### 3.3 端末ローカル専用テーブル（同期しない）

```sql
CREATE TABLE ops (                      -- 自端末・他端末の全 op（適用済み）
  id         TEXT PRIMARY KEY,
  hlc        TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  payload    TEXT NOT NULL,             -- op の JSON
  uploaded   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sync_state (               -- changes API のページトークン、読込済みファイル等
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

CREATE TABLE scheduled_notifications (  -- リマインドと OS 通知 ID の対応
  reminder_id      TEXT PRIMARY KEY,
  notification_id  TEXT NOT NULL,
  fire_at          TEXT NOT NULL
);

CREATE TABLE blobs (                    -- 画像ファイルの所在と転送状態
  hash        TEXT PRIMARY KEY,
  local_path  TEXT,                     -- 未取得なら NULL
  uploaded    INTEGER NOT NULL DEFAULT 0,
  last_used   TEXT                      -- ローカルキャッシュ削除の判定用
);
```

### 3.4 表示時の並び順

完了したチェック項目は**表示時のソートで下へ移動**させる。完了操作で `sort_key` は変更しない（余計な op を出さず、チェックを外せば元の位置に戻る）。

```sql
SELECT * FROM checklist_items
WHERE note_id = ? AND deleted = 0
ORDER BY checked ASC, sort_key ASC;
```

完了済み項目を「最近完了した順」にしたい場合は、`field_clocks` の `checked` の HLC を使う（新カラム不要）。ウィジェットも同じクエリを使う。

---

## 4. op と HLC

### 4.1 op の形式

```json
{
  "id": "0192f3a0-...",
  "hlc": "1759480000000:0003:dev-a1b2",
  "entity": "note",
  "entityId": "0192f39f-...",
  "fields": { "body": "牛乳を買う\n卵も" },
  "base": { "body": "1759470000000:0001:dev-c3d4" }
}
```

| 操作 | `fields` の内容 |
| --- | --- |
| 作成 | 全フィールド |
| 更新 | 変更したフィールドのみ |
| 削除 | `{ "deleted": 1 }` |

`base` は、編集時に見ていた値の HLC。競合検出（§5）に使う。

### 4.2 HLC

- 形式: `物理時刻ms(13桁):カウンタ(4桁):端末ID`
- 固定長にして、**文字列比較だけで大小が決まる**ようにする
- 送信時・受信時に標準的な HLC の更新規則で進める
- 外部ライブラリは使わず自前実装（50行程度）

### 4.3 op の適用（LWW）

フィールドごとに `field_clocks.hlc` と op の `hlc` を比較し、op の方が新しい場合のみ値と `field_clocks` を更新する。

この処理は**可換かつ冪等**であり、同じ op を何度・どの順で適用しても結果は同じになる。§6 の Drive 設計はこの性質に依存する。

---

## 5. 競合の扱い

### 5.1 対象

- `notes.title` と `notes.body` の同時編集のみを「競合」として扱う
- それ以外のフィールド（チェック項目のテキスト、チェック状態など）は LWW のみ

### 5.2 検出

受信した op を X、現在値を Y とする。次の両方が成り立つとき「同時編集」と判定する。

- X は Y を見て書かれていない（`X.base != Y.hlc`）
- Y は X を見て書かれていない（`Y.base != X.hlc`）

直前の親しか見ないため、配送順によっては順次編集を競合と誤判定する可能性がある。誤検知の結果は「競合コピーが1つ余分にできる」だけでデータは失われないため、**データを失わない側に倒す**方針で許容する。

### 5.3 競合コピーの生成

- LWW の勝者を元メモに反映し、**敗者の値を持つ新しいメモ（競合コピー）を作る**
- 競合コピーには `conflict_of` / `conflict_field` / `conflict_base_hlc` を設定する
- **競合コピーの ID は「元メモ ID＋敗者 op の ID」から決定的に生成する**（UUIDv5）
  - 同時編集は両端末がそれぞれ検出するが、敗者はどの端末から見ても同じなので、両端末が同じ ID のコピーを作り、冪等な作成 op により1つに収束する
- 添付画像・チェック項目・リマインドは元メモ側に残し、競合コピーには複製しない

### 5.4 将来の競合解消機能（後続フェーズ）

- メモ一覧で「競合あり」バッジを表示（`conflict_of` で紐付け）
- 元メモと競合コピーの差分を並べて表示し、片方を採用または手動マージ
- 解消後は競合コピーを墓標化し、結果を元メモに書く
- `conflict_base_hlc` から分岐元の本文を取得して**3方向マージ**を行う。そのため、競合に関わる op はローカルの `ops` テーブルから削除しない

---

## 6. Google Drive 同期

### 6.1 スコープと位置付け

- スコープは `https://www.googleapis.com/auth/drive.appdata` のみ（非センシティブスコープ）
- appDataFolder はユーザーから見えず、作成したアプリのみがアクセスできる
- アプリは**ログインなしのローカル専用モード**で起動し、設定から「Google ドライブで同期する」をオンにする形にする
  - Google アカウントを持たないユーザーも利用できる
  - App Store 審査ガイドライン 4.8（Sign in with Apple の要求）に関するリスクを下げる（要最終確認）

### 6.2 ファイル構成

Drive のファイルは追記できず更新は全体上書きになるため、**op ファイルは不変**（一度書いたら変更しない）とする。

```
appDataFolder/
  ops_<deviceId>_<先頭HLC>.jsonl   アップロードごとに新規作成（不変）
  snapshot_<deviceId>.json         その端末の op を圧縮したもの
  blob_<sha256>                    画像本体・サムネイル（不変、§7）
```

- 各ファイルの `appProperties` に `deviceId`・`hlc`・`kind` を設定し、一覧取得時の絞り込みに使う

### 6.3 同期の流れ

1. **送信**: 未送信の op をまとめて `ops_<自端末>_<HLC>.jsonl` として新規作成
2. **受信**: changes API（`spaces=appDataFolder`）をポーリングし、新規ファイルだけを取得して `mergeRemoteOps` で適用
3. **タイミング**: アプリ起動時、フォアグラウンド復帰時、ウィジェット操作後、expo-background-task（ベストエフォート）
4. 変更通知（Webhook）はサーバーが必要なため使わない

### 6.4 圧縮

- **各端末は自分の op だけを、自分で圧縮する**
- 自端末の op ファイル群を「フィールドごとの最新値（＋HLC・base）」にまとめて `snapshot_<自端末>.json` を更新し、古い op ファイルを削除する
- 他端末のファイルには一切書き込まないため、端末間の書き込み競合が起きない
- 新端末は「全スナップショット＋未圧縮 op ファイル」を読めば復元できる。重複は §4.3 の冪等性により問題にならない

### 6.5 データ消失への備え

- appDataFolder は、ユーザーが My Drive からアプリを削除した場合や手動で削除した場合に消える
- 各端末はローカルに完全なコピーを持つため、**Drive 上のファイル消失を検知したら手元のデータから再アップロード**する
- appDataFolder 内のファイルはゴミ箱に移せないため、削除は即時の完全削除になる点に注意する

---

## 7. 画像添付

### 7.1 方針

- **メタデータ（`attachments`）は op で同期、画像本体は別ファイルで同期**する
- 画像本体はコンテンツアドレス方式（SHA-256 をファイル名に使用）の不変ファイルとし、重複排除と冪等性を得る
- 表示は**添付エリア方式**（本文・チェックリストの下に横スクロールのサムネイル一覧、タップで全画面表示）

### 7.2 画像処理

| 項目 | 値 |
| --- | --- |
| 本体 | 長辺 2048px にリサイズ、JPEG 品質 0.8 程度 |
| サムネイル | 長辺 320px 程度、JPEG |
| HEIC | 必ず JPEG に変換（Android 互換のため） |
| EXIF | 保存しない（位置情報を残さない）。向きは先に画像へ反映してから削除する |

### 7.3 アップロード順序

```
サムネイル（常に送信） → op（サムネイル送信済みなら送信可） → 本体（Wi-Fi 限定設定に従う）
```

- 「Wi-Fi 接続時のみ」設定の対象は**本体画像のみ**。サムネイルと op は回線種別にかかわらず送る
  - これにより、モバイル回線中でも画像付きメモのテキストやチェック状態は同期される
- 他端末では、サムネイルは同期時に先読みし、本体は表示時に遅延ダウンロードする（ダウンロードも同じ設定に従う）
- 本体が未アップロード／未取得の場合は「Wi-Fi 接続時に同期されます」等のプレースホルダーを表示する
- 回線が Wi-Fi に切り替わったら（netinfo で検知）キューを再開する

### 7.4 削除とストレージ

- 添付の削除は墓標 op のみ。Drive 上の本体は即時削除しない（別メモから同じ画像が参照されている可能性があるため）
- 圧縮処理のついでに「生きた添付から参照されず、墓標から一定期間（例: 30日）経過した blob」を削除する
- ローカルの本体画像は `last_used` を基準に、一定容量を超えたら古いものから削除する（Drive から再取得可能）
- **未アップロードの blob はローカルから絶対に削除しない**
- 設定画面に「kakitome の Drive 使用容量」を表示する（ユーザーの Google アカウント容量を消費するため）

---

## 8. Android ウィジェット

- react-native-android-widget を Expo Config Plugin で導入する
- 表示: 1つのメモのチェックリスト（未完了→完了の順、§3.4 と同じクエリ）
- 操作: 項目タップで `clickAction` + `clickActionData: { itemId }` を発火 → タスクハンドラで `applyLocalOp` を呼び `checked` をトグル → 再描画
- Drive への送信は次回起動時またはバックグラウンドタスクで行う
- 画像は表示しない
- **同期コア（`applyLocalOp` 等）はヘッドレス JS でも動くよう、UI・画像処理系の依存を持たせない**
- clickAction は Android 7 以上でのみ動作する。ウィジェットは React Native の View を画像としてレンダリングする方式である点に留意する

---

## 9. リマインド

- expo-notifications のローカル通知を使う
- **全端末で鳴らす**（端末間の調整はしない）
- 同期で reminder の op を適用したら**調停（reconcile）**を実行する
  - 有効かつ未来日時のリマインドについて `scheduled_notifications` と突き合わせ、不足分を予約・不要分を取消
- iOS の予約上限（64件）に備え、直近のものから一定件数のみ予約する
- 繰り返しは `rrule` と `timezone` から次回日時を計算する
- Android 12 以降の正確なアラームに関する権限要件を実装時に確認する

---

## 10. モジュール構成（案）

```
src/
  core/            同期コア（純粋 TS、RN 依存なし）
    hlc.ts
    ops.ts         op の型・生成
    merge.ts       LWW 適用・競合検出・競合コピー生成
    fractional.ts  分数インデックス
  db/              expo-sqlite のスキーマ・マイグレーション・リポジトリ
  sync/            Drive クライアント、送受信、圧縮、アップロードキュー
  media/           画像の選択・変換・ハッシュ・保存
  notifications/   リマインドの調停
  widget/          ウィジェットの UI とタスクハンドラ
app/               Expo Router の画面
```

---

## 11. 意思決定ログ

| # | 論点 | 決定 | 主な理由 |
| --- | --- | --- | --- |
| 1 | Expo かネイティブか | Expo | 全要件が Expo で実現可能。Android ウィジェットは react-native-android-widget で対応 |
| 2 | 同期方式 | ユーザーの Google Drive appDataFolder | コストゼロ、サーバー運用なし、開発者がデータを持たない。純粋な P2P は両端末の同時オンラインが必要で、iOS⇔Android の直接通信手段も限られるため不採用 |
| 3 | GitHub 連携 | 対象外 | サーバーなしでは Web フローの client_secret を秘匿できず、保存先（Gist／リポジトリ）にも課題があるため |
| 4 | 競合解決 | フィールド単位 LWW＋HLC | 実装が軽く、ウィジェットのヘッドレス JS でも確実に動く |
| 5 | 本文の同時編集 | 競合コピーとして保存、後で解消機能を作る | データを失わない。将来の3方向マージに備えメタデータを保持 |
| 6 | チェックリストメモの本文 | 持たせる（`kind` を廃止） | メモ構造を統一 |
| 7 | 完了項目 | 下に移動（表示時ソート） | 余計な op を出さない |
| 8 | リマインドの複数端末通知 | 全端末で鳴らす | 端末間の調整が不要 |
| 9 | 画像の配置 | 添付エリア方式 | 本文の競合処理と干渉しない |
| 10 | 画像の画質 | 長辺 2048px にリサイズ | ユーザーの Drive 容量と転送量の節約 |
| 11 | ウィジェットの画像表示 | 出さない | シンプルさとヘッドレス JS の軽量化 |
| 12 | 画像アップロード | 「Wi-Fi 接続時のみ」設定を用意（本体のみ対象） | モバイル通信量の節約と同期の即時性の両立 |

---

## 12. 実装ロードマップ

1. **同期コア**: HLC、op、`applyLocalOp` / `mergeRemoteOps`、競合検出、決定的な競合コピー生成を純粋 TS で実装
2. **同期コアのテスト**: プロパティベーステスト（fast-check 等）で以下を検証
   - op をランダムな順序・重複で適用しても全端末が同じ状態に収束する
   - 同時編集で競合コピーがちょうど1つできる
   - op が先に届き画像本体が後から届くケースを正しく扱える
3. **ウィジェット PoC**: ヘッドレス JS から `applyLocalOp` を呼び、チェックのトグルと再描画ができることを確認
4. **Drive 同期 PoC**: Google サインイン → appDataFolder への書き込み → 別端末での読み取り
5. **アプリ UI**: メモ一覧・編集・チェックリスト・添付エリア
6. **リマインド**: 予約と調停
7. **画像**: 変換・アップロードキュー・Wi-Fi 限定設定・キャッシュ管理
8. （後続）競合解消 UI、iOS ウィジェット

## 13. 未確定事項

- App Store 審査ガイドライン 4.8 の適用範囲（Drive 連携を「ストレージ連携」として扱えるか）
- Android 12 以降の正確なアラーム権限の扱い
- 汎用ライブラリ（分数インデックス、UUIDv7/v5）を採用するか自前実装するか
- 墓標・op の長期的なガベージコレクション方針

## 参考

- [Expo Widgets](https://docs.expo.dev/versions/latest/sdk/widgets/)
- [react-native-android-widget: Register widget in Expo](https://saleksovski.github.io/react-native-android-widget/docs/tutorial/register-widget-expo)
- [react-native-android-widget: Handling Clicks](https://saleksovski.github.io/react-native-android-widget/docs/handling-clicks)
- [Google Drive: Store application-specific data](https://developers.google.com/workspace/drive/api/guides/appdata)
- [Google Drive: Choose API scopes](https://developers.google.com/drive/api/guides/about-auth)
- [Google Drive: Upload file data](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [expo-notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
