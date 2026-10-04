# kakitome 設計ドキュメント

> kakitome（書き留め／書留）— チェックリスト・リマインド・Android ウィジェットに対応した、サーバーを持たないローカルファーストのメモアプリ。

- ステータス: 設計確定（実装前）
- 対象プラットフォーム: iOS / Android / Web（Web は §2.4 の範囲）

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

### 2.2 実装上の取り決め（依存・開発用コード）

- 依存は、使うものだけにする。`create-expo-app` のテンプレートが入れる `expo-font` `expo-device` `expo-symbols` `expo-glass-effect` `expo-web-browser` `expo-status-bar` `@expo/ui` `react-native-reanimated` `react-native-worklets` `react-native-gesture-handler` は削除済み（`react-native-web` `react-dom` は Web 対応のため再度追加した）。`expo-linking` `expo-constants` `react-native-safe-area-context` `react-native-screens` は `expo-router` の必須 peer
- 開発ビルド専用の操作（競合の再現、圧縮の強制、Drive 上のファイル削除など）は `src/dev/DevTools.tsx` にまとめ、設定画面は `__DEV__` のときだけ読み込む

### 2.3 iOS 対応の取り決め

- **ウィジェットは Android 専用**: `react-native-android-widget` は読み込んだだけで iOS では落ちるため、ウィジェット関連は `*.android.ts` に分け、iOS では何もしない版（`refresh.ts`、`register.ts`）を使う
- **UIScene ライフサイクル**: iOS 27 は UIScene を採用していないアプリを起動時に落とす。Expo SDK 57 の `ExpoAppSceneDelegate` を使うよう、設定プラグイン `plugins/withIosScene.js` が prebuild で `AppDelegate`（`ExpoReactNativeFactoryProvider` に準拠、React Native の自前起動を削除）と `Info.plist`（`UIApplicationSceneManifest`）を書き換える。`ios/` は生成物なのでコミットしない
- **Google サインイン**: iOS 用 OAuth クライアント ID（`src/sync/config.ts` の `IOS_CLIENT_ID`）が無いと設定自体が例外になるため、未設定の間は iOS ではサインインを利用不可として扱う（他の機能は動く）。iOS 用クライアント ID は `IOS_CLIENT_ID` に設定済みで、設定プラグインにも `iosUrlScheme`（クライアント ID から `.apps.googleusercontent.com` を除いたものの前に `com.googleusercontent.apps.` を付けた形）を指定している
- **リマインド**: 繰り返しは OS のネイティブ繰り返し（カレンダー）トリガー。正確なアラームの許可は iOS には無い
- **Google サインイン後の最初のトークン取得**: 起動直後は、前回のサインインがライブラリの「現在のユーザー」として復元されておらず `getTokens` が失敗することがある。失敗したら `signInSilently` で復元してから取り直す（iOS シミュレータで再現・解消を確認）
- **検証（iOS 27 シミュレータ＋実 Drive）**: Google サインイン後、新しい端末として同期し、Android の端末と同じ内容（ノート 3・項目 5・画像 1・リマインド 2・op 36 件）が届く。サムネイルは先読みされ、本体は表示時に取得される
- **未確認**: iOS での編集・画像追加・リマインド（通知の予約と発火）・全画面表示の画面操作。シミュレータの画面操作を自動化する手段が無く、手元での確認が要る

### 2.4 Web 対応の取り決め

静的ホスティング（`expo export -p web`、`app.json` の `web.output` は `single`）に配信する SPA。画面はモバイル版と同じ（広い画面では幅 640px の 1 列を中央に置く）。プラットフォームの差は `*.web.ts` に分ける。

- **DB**: expo-sqlite の Web 版（wa-sqlite＋OPFS、alpha）。同期 API は SharedArrayBuffer を使うため、cross-origin isolation（`Cross-Origin-Opener-Policy: same-origin`、`Cross-Origin-Embedder-Policy: require-corp`）が要る。開発サーバーは `metro.config.js`、配信は `public/_headers`（Cloudflare Pages / Netlify 形式。他のホストは同じヘッダーを設定する）。`.wasm` は `metro.config.js` でアセットに加える
- **同期 API の制約**: 待てる時間が短く、結果は約 1MB まで。ワーカーの起動前や重い処理（スキーマ作成・初回の書き込み）は間に合わないので、起動時に `initDb()` で非同期に開き、スキーマ作成と書き込みの予熱まで済ませてから画面を出す（`src/db/ready.ts`）。画像の実体は 1MB を超えうるので、非同期 API で読み書きする
- **画像**: 実体はファイルではなく SQLite の `blob_data` テーブル（`src/media/blobs.web.ts`）。縮小・JPEG 化は canvas（再エンコードで EXIF は落ちる。`stripJpegMetadata` も通す。`process.web.ts`）。表示は `BlobImage`（`blobUri` で object URL を作る）
- **Google サインイン**: COOP: same-origin の下ではポップアップ方式（Google Identity Services）が動かないため、リダイレクト型の OAuth（implicit）を自前で行う（`google-auth.web.ts`）。スコープは `drive.appdata` のみ。アクセストークンは約 1 時間で切れ、リフレッシュはできない。切れたら未サインイン扱いになり、設定からもう一度サインインする（同意済みなら画面は一瞬）。メールアドレスは取れない（スコープを増やさないため）。Google Cloud のウェブ クライアントに、配信元の URL を「承認済みの JavaScript 生成元」と「承認済みのリダイレクト URI」（`<配信元>/`）として登録する
- **対象外**: リマインドの通知（日時の入力・保存・同期はできるが、Web では鳴らさない。他端末では鳴る）、ウィジェット、バックグラウンド同期（起動時・表示に戻ったとき・編集の 5 秒後は動く）、引っ張って同期（設定の「今すぐ同期」を使う）、通知のタップで開く動作
- **Wi-Fi 限定設定**: ブラウザは回線の種別を教えないため、Web では常に許可として扱う
- **既知の制約**: 同じ origin のタブを複数開くと、OPFS の排他で 2 つ目は DB を開けない（開けなかったときは、他のタブを閉じるよう案内する画面を出す。ページ遷移直後の解放待ちのため、起動時に 0.5 秒おき 4 回まで再試行する）。DB は端末（ブラウザ）ごと。サイトデータを消すと消える（Drive に同期していれば復元できる）
- **未確認**: Safari・Firefox での動作、実際の Google アカウントでのサインインと同期（擬似トークンで取り込みと Drive 呼び出しまでは確認）、配信先での COOP/COEP ヘッダー

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

### 3.5 一覧の検索と並び替え

メモ一覧（`listNotes(query, sort)`）の仕様。どちらも端末ローカルの表示だけの設定で、op は出さず同期もしない。

- 検索: 一覧の上の検索ボックス（Google Keep 風。ネイティブヘッダーは出さない）に入力した文字列を、タイトル・本文・チェック項目のテキストに部分一致で絞り込む（大文字小文字を区別しない）
- 並び替え: 検索ボックス右端のボタンから選ぶ。ピン留めは常に先頭で、その中を次の順に並べる。選択は保存せず、起動時は「手動」
  - 手動（`sort_key`。既定）
  - リマインドが近い順（有効なリマインドの最も早い日時。期限切れが先頭で、リマインドの無いメモは最後。同順位は手動順）
  - 作成が新しい順（`created_at`）
  - タイトル順（タイトルが空なら本文）
- ドラッグでの並び替えは、「手動」かつ検索なしのときだけ有効（ハンドルを出す）。他の並びで `sort_key` を書き換えると意味が壊れるため
- 更新日時順は、メモに更新日時のカラムが無いため設けていない
- 並び替えの選択UI: iOS は `ActionSheetIOS`、Android は自前の小さなメニュー（`Alert` はボタンが 3 つまでのため）

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

同じ端末の op 同士は必ず順序づけられている（端末は自分の過去の編集を見ている）ので、**同時編集とみなさない**。これにより、同一端末の連続編集が圧縮（§6.4）や配送順の違いで競合と誤判定されることはない。
直前の親しか見ないため、配送順によっては、別の端末をまたぐ順次編集を競合と誤判定する可能性がある（例: 同一端末の3件以上の連続編集で、孫の op が親より先に届く場合）。また、3件以上が絡む同時編集では、適用順によって競合コピーの数が変わり得る（収束性のテストは競合コピーを除いて検証し、コピーが「ちょうど1つ」になるのは2件の同時編集の場合）。誤検知の結果は「競合コピーが1つ余分にできる」だけでデータは失われないため、**データを失わない側に倒す**方針で許容する。

### 5.3 競合コピーの生成

- LWW の勝者を元メモに反映し、**敗者の値を持つ新しいメモ（競合コピー）を作る**
- 競合コピーには `conflict_of` / `conflict_field` / `conflict_base_hlc` を設定する
- **競合コピーの ID は「元メモ ID＋敗者 op の ID＋競合フィールド名」から決定的に生成する**（UUIDv5）
  - フィールド名を含めるのは、1つの op で title と body の両方が負けた場合に ID が衝突し、`conflict_field` が順序依存になるのを防ぐため（フィールドごとに1つのコピーができる）
  - 同時編集は両端末がそれぞれ検出するが、敗者はどの端末から見ても同じなので、両端末が同じ ID のコピーを作り、冪等な作成 op により1つに収束する
- 敗者 op の ID は HLC から `ops` を引いて得る。§6.4 の圧縮で op ID が失われた場合は HLC で代用するが、その場合は端末間で ID が揃う保証がない（圧縮設計時に再検討）
- 添付画像・チェック項目・リマインドは元メモ側に残し、競合コピーには複製しない

### 5.4 競合解消機能

- メモ一覧に「⚠ 競合あり（N件）」を表示し、競合コピーには「⚠ 競合コピー」と表示する（`conflict_of` で紐付け）。元メモの編集画面には競合バナーを出し、タップで解消画面に入る（競合コピーの編集画面からも同じ解消画面に入る）
- 解消画面では、競合したフィールド（`title` / `body`）について、現在の値と競合コピーの値を、分岐元からの行単位の差分で並べて表示する（`src/core/diff.ts` の LCS 差分）
- 解消の操作は 3 つ: 「現在の値を採用」「コピーの値を採用」「手動でマージ」。手動マージの初期値は、分岐元があれば 3 方向マージの結果（同じ場所を違う内容に変えた箇所は `<<<<<<< 現在 … ======= … >>>>>>> 競合コピー` で両方を残す）、無ければ両方の値を並べたもの
- 解消の結果は、元メモのフィールドへの通常の編集（`applyLocalOp`）と、競合コピーの墓標（`deleted = 1`）。新しい op の種類は無く、他端末にも同じ形で伝わる（解消後に競合コピーが再生成されることもない）
- 分岐元の値は `conflict_base_hlc` を書いた op を `ops` テーブルから引いて取り出す。圧縮（§6.4）で途中の op が無い端末では引けず、その場合は 2 方向（現在 → コピー）の差分だけを表示する。ローカルの `ops` は消さないので、自端末の履歴からは引ける
- 3 方向マージは行単位。短い本文の編集では行全体が衝突になりやすい（既知の制約。文字単位が要るなら `diff.ts` を差し替える）
- 同じ op で `title` と `body` の両方が負けた場合は 2 つのコピーができ、それぞれ別々に解消する
- 検証（Android エミュレータ＋実 Drive、iOS 27 シミュレータ）: 擬似的な別端末の編集と同時に編集すると競合コピーが 1 つでき、一覧・バナー・解消画面（差分と自動マージ結果）が表示される。「コピーの値を採用」で元メモの本文が更新され、コピーが墓標になり、その解消が同期で iOS の端末にも同じ形で届く

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

実装上の取り決め（`src/sync/`）:

- 初回（ページトークン無し）は、先に `changes.getStartPageToken` でトークンを取り、その後 `files.list(spaces=appDataFolder)` で全件を読む。間に増えたファイルは次の `changes.list` で拾う。`getStartPageToken` に `spaces` パラメータは無く、得たトークンを `changes.list(spaces=appDataFolder)` に渡す（Android エミュレータ＋実 Google アカウントで、初回の全件取得・新端末への復元・増分取得でトークンが進むことを確認済み）
- ページトークンは、そのページのファイルを適用した後で保存する（少なくとも1回は適用。重複は §4.3 の冪等性で吸収）
- 自端末が作ったファイルは取得しない。受信しただけの op は再送しない（`ops.uploaded = 1` で受信）
- 受信した op は形を検証し、壊れた行・不正な op・プリミティブ以外のフィールド値は捨てる（1ファイルの破損で同期全体が止まらないようにする）
- サインインは `@react-native-google-signin/google-signin`（`webClientId` と `drive.appdata` を指定）。ライブラリが既定で要求する名前・メールアドレス（基本プロフィール）の許可も同意画面に出るが、Drive のスコープは `drive.appdata` のみ。Android は パッケージ名＋署名 SHA-1 の OAuth クライアントで照合される
- OAuth 同意画面が「テスト」状態の間は、テストユーザーに登録した Google アカウントしかサインインできない（403 access_denied）。公開時は本番公開の手続きが必要（`drive.appdata` は非センシティブスコープ）
- 自動同期（`src/sync/auto.ts`、`scheduler.ts`）: 起動時・フォアグラウンド復帰時・ローカル編集の5秒後（デバウンス）・ウィジェット操作後・`expo-background-task`（最短15分、OS 任せ）で実行する。同時に走るのは1つだけで、実行中の要求は終了後の1回に束ねる。失敗は例外にせず `sync_state.last_error` に記録し、次のトリガーで再試行する（設定画面に表示）。401 はトークンを破棄して1回だけ再試行する
- 手動同期: メモ一覧を下に引っ張ると、自動同期と同じ `scheduler.trigger()` を実行する。終わるとトースト（「同期しました」「同期に失敗しました」、未サインインなら「設定で同期をオンにすると使えます」）を表示する。成否は `sync_state.last_error` が空かどうかで判定する
- 同期で受信した変更は、一覧と編集画面の項目一覧に反映する。編集中のタイトル・本文は上書きしない（保存時に LWW で解決）
- アプリ本体とバックグラウンド／ウィジェットのプロセスが同時に同期すると、同じ op が2ファイルに重複して送られることがある。適用が冪等なので害はない（無駄な通信のみ）
- Drive クライアントは `fetch` とトークン取得関数を注入する。テストはインメモリの `FakeDrive` で行う

### 6.4 圧縮

- **各端末は自分の op だけを、自分で圧縮する**
- 自端末の op を「フィールドごとの最新の値（HLC）」にまとめ、`snapshot_<自端末>_<HLC>.json` を**新規作成**する（不変。設計当初の「更新」から変更）。作成を確認してから、古い自端末のスナップショットと op ファイルを削除する。他端末のファイルには一切書き込まない
- 自端末が後で上書きした値は捨てて構わない（データは失われない）。ローカルの `ops` テーブルは削除しない
- スナップショットの各エントリは `base` を持つ: そのフィールドを最初に編集したとき自端末が見ていた HLC。最初の op が作成（base なし）なら、その op 自身の HLC。base が無いと競合検出の対象外になって同時編集がサイレントに負けるため、必ず入れる。「見ていない値を見たことにする」ことは無いので、競合の見逃しは増えない（余分な競合コピーが増えうるのは、連鎖の途中で他端末の値を取り込んだ場合のみ）
- 受信側はエントリを 1 つずつ疑似 op（ID は HLC・エンティティ・フィールドから決まる固定値）に戻して適用する。再受信しても冪等で、新端末は「全スナップショット＋未圧縮 op ファイル」から復元できる
- 実行条件: 未送信の op が無く、自端末の op ファイルが 20 個以上で、前回の圧縮から 1 日以上。同期の最後に行い、失敗しても同期の成否には影響しない（途中で落ちても重複するだけ）
- 取得しようとしたファイルが持ち主の圧縮で既に消えていたとき（404）は読み飛ばす。置き換えのスナップショットが別に届く
- 既知の制約: 再インストールなどで端末 ID が変わると、古い ID のファイルは誰も圧縮せず残り続ける（他端末のファイルには書き込まない原則のため）。後で整理機能を検討する
- 検証（Android エミュレータ＋実 Drive）: 自端末の op ファイルがスナップショットに置き換わる。新しい端末（アプリのデータを消してサインインし直す）で、ノート・項目・画像・リマインドが基準の状態（フィールド数まで）と一致して復元され、競合コピーは 0 件

### 6.5 データ消失への備え

- appDataFolder は、ユーザーが My Drive からアプリを削除した場合や手動で削除した場合に消える
- 各端末は自分が Drive に作ったファイルの ID を記録する（`sync_state.own_files`）。`changes` の削除通知がそれに当たる、または初回の全件取得でそれが無い場合は、**手元の全 op を送信待ちに戻して再アップロードする**。他端末の op も含めるのは、残った 1 台から Drive を完全に復元するため。重複は冪等なので害はない。導出された競合コピーの op は含めない（各端末が同じものを導出する）
- 消失を検知した結果（`sync_state.own_files_lost`）は永続化し、全 op を送信待ちに戻した後で下ろす。検知の直後（ページトークンを進めた後）に通信エラーで落ちても、判断を忘れず次回の同期で再アップロードする
- 自端末が圧縮で消したファイルは記録から外すので、その削除通知を消失と誤認しない
- 画像の blob は §7.4 の仕組み（削除通知で `remote_id` を忘れ、生きた添付が参照していれば再アップロード）で復旧する
- appDataFolder 内のファイルはゴミ箱に移せないため、削除は即時の完全削除になる
- 検証（実 Drive）: 自端末のファイルを削除すると、次の同期で消失を検知して再アップロードされ、新しい端末で基準の状態に完全に復元できる

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

実装上の取り決め（段階A: 端末内の取り込み。`src/core/jpeg.ts`、`src/media/`）:

- `expo-image-picker`（Android のシステムフォトピッカー。権限不要）で選び、`expo-image-manipulator` で長辺 2048px / 320px の JPEG にする。縮小は長辺が上限を超えるときだけ
- 向きは画素に反映される（Orientation=6 の 4000×3000 で検証。保存後は 1536×2048 の縦向き）
- メタデータ（EXIF・XMP・IPTC・コメント）は、変換結果に対して必ず `stripJpegMetadata` を通して除去する（変換ライブラリが除去するかに依存しない安全網）。JFIF・ICC・Adobe セグメントは描画に要るので残す
- 保存名は本体バイト列の SHA-256（`document/blobs/<hash>`）。DB には相対名（`blobs/<hash>`）のみを持つ（iOS ではアプリ更新で document の絶対パスが変わりうるため）
- `blobs` テーブルに `remote_id`（Drive のファイル ID）列を足す（§3.3 との差。重複アップロードの回避用）
- 添付の削除は墓標のみ。blob の実体は消さない

### 7.3 アップロード順序

```
サムネイル（常に送信） → op（サムネイル送信済みなら送信可） → 本体（Wi-Fi 限定設定に従う）
```

- 「Wi-Fi 接続時のみ」設定の対象は**本体画像のみ**。サムネイルと op は回線種別にかかわらず送る
  - これにより、モバイル回線中でも画像付きメモのテキストやチェック状態は同期される
- 他端末では、サムネイルは同期時に先読みし、本体は表示時に遅延ダウンロードする（ダウンロードも同じ設定に従う）
- 本体が未アップロード／未取得の場合は「Wi-Fi 接続時に同期されます」等のプレースホルダーを表示する
- 回線が Wi-Fi に切り替わったら（netinfo で検知）キューを再開する

実装上の取り決め（段階B: 同期。`src/core/uploads.ts`、`src/sync/blobs.ts`、`src/media/blob-port.ts`）:

- 順序は `planUploads`（純粋関数）が決める。サムネイル送信 → 再計画 → op 送信 → 再計画 → 本体送信。サムネイルが未送信の添付 op は保留し、他の op は止めない。本体は、それを参照するすべての添付のサムネイルが送信済みになってから。端末に記録の無い blob のために op を永久に止めることはしない
- Drive の `blob_<sha256>` は `appProperties = { kind: 'blob', hash }`。作成と本体を 1 つの multipart リクエストで送り（途中で落ちた空ファイルを「送信済み」と誤認しない）、バイナリの送受信には `expo/fetch` を使う
- 他端末が先に送った同じ内容の blob は、ファイル ID を知っていれば再アップロードしない（`blobs.remote_id`）
- 受信: 添付の op を適用したらサムネイルを先読みし、本体は表示時に取得する。取得したバイト列は SHA-256 を検証し、一致しなければ保存しない（同期は止めない）。ID がまだ分からない blob は次回の同期で再試行
- 「画像の本体は Wi-Fi 接続時のみ送受信する」設定（既定オン。`sync_state.wifi_only`）。対象は本体のみで、サムネイルと op は回線に関わらず送る。Wi-Fi／有線で、従量課金でない回線を「許可」とみなす（`@react-native-community/netinfo`）。許可の回線につながったら同期を再開する
- 検証（Android エミュレータ＋実 Drive）: Wi-Fi を切ったモバイル回線では、サムネイルと op が送信され、本体は未送信のまま。Wi-Fi をオンにすると本体が自動でアップロードされる。アプリのデータを消した新しい端末では、サムネイルが先読みされ、本体は全画面表示で遅延ダウンロードされて高画質で表示される

### 7.4 削除とストレージ

- 添付の削除は墓標 op のみ。Drive 上の本体は即時削除しない（別メモから同じ画像が参照されている可能性があるため）
- 圧縮処理のついでに「生きた添付から参照されず、墓標から一定期間（例: 30日）経過した blob」を削除する
- ローカルの本体画像は `last_used` を基準に、一定容量を超えたら古いものから削除する（Drive から再取得可能）
- **未アップロードの blob はローカルから絶対に削除しない**
- 設定画面に「kakitome の Drive 使用容量」を表示する（ユーザーの Google アカウント容量を消費するため）

---

実装上の取り決め（段階C: 後始末。`src/core/blobgc.ts`、`src/sync/blobs.ts`）:

- Drive 上の不要な blob の削除（`planBlobGc`）: その blob を参照する添付が 1 件以上あり、すべて削除済みで、最後の削除から 30 日以上経ったもの。参照が 1 件も無い blob は、まだ届いていない op が参照しているかもしれないので対象にしない。削除時刻は `deleted` フィールドの HLC の物理時刻。同期の最後に 1 日 1 回まで実行する。§7.4 の「圧縮のついで」は、圧縮（§6.4）が未実装のため独立した GC として実装した（圧縮を作るときに統合を検討）
- 削除した端末は実体も消す。ただし未アップロードの実体は消さない（不変条件）。そのため、アップロード前に削除した添付の本体は端末に残る（少量の無駄）
- 他端末による削除への備え（§6.5）: `changes` の削除通知（`removed` と `fileId`）を、同じページの op を適用した後に処理する。生きた添付が参照している blob は、Drive のファイル ID を忘れて再アップロードの対象に戻す（本体は同じ同期で、サムネイルは次回の同期で再送される）。参照が無ければ端末からも消す
- ローカルキャッシュ（`planCacheEviction`）: 端末内の画像本体が 500MB を超えたら、`last_used`（表示・取得時に更新）の古い順に消す。対象は Drive にアップロード済みの本体のみ。サムネイルは常に保持。消した本体は表示時に再取得できる
- 設定画面に「使用容量を確認する」を置く（appDataFolder のファイルサイズ合計と、端末内の画像の合計。通信を伴うので押したときだけ）
- 検証（Android エミュレータ＋実 Drive）: 猶予 0 で整理すると、参照の無い画像の本体とサムネイルだけが Drive から完全削除され（70.9 KB → 34.2 KB）、生きた添付が参照する画像は残る。続く同期でエラーは出ない

## 8. Android ウィジェット

- react-native-android-widget を Expo Config Plugin で導入する
- 表示: 1つのメモのチェックリスト（未完了→完了の順、§3.4 と同じクエリ）。表示するメモはウィジェットごとに選ぶ（追加時と、長押しの設定から開く設定画面。`widgetFeatures: reconfigurable`、`registerWidgetConfigurationScreen`）。選択は `sync_state` の `widget_note:<widgetId>` に保存する（この端末だけの設定で、同期しない）。未選択、または選んだメモが削除済みなら、一覧の先頭のメモを表示する
- 操作: 項目タップで `clickAction` + `clickActionData: { itemId }` を発火 → タスクハンドラで `applyLocalOp` を呼び `checked` をトグル → 再描画
- Drive への送信は次回起動時またはバックグラウンドタスクで行う
- 画像は表示しない
- **同期コア（`applyLocalOp` 等）はヘッドレス JS でも動くよう、UI・画像処理系の依存を持たせない**
- **PoC で確認済み（Android エミュレータ API 37、Development Build）**: アプリのプロセスが無い状態でウィジェットの項目をタップすると、ヘッドレス JS で expo-sqlite を開いて `applyLocalOp` を実行でき、DB の更新とウィジェットの再描画（完了項目が下へ移動）まで動く。アプリ側でも同じ状態が見える
- ウィジェットのコンポーネントファイルの先頭に `"use no memo";` が必須（React Compiler が有効だと描画時に Invalid Hook Call になる）
- ヘッドレス起動のエントリは `index.ts`（`package.json` の `main`）。`registerWidgetTaskHandler` は `_layout.tsx` ではなくここで呼ぶ
- ウィジェットのタスクハンドラは都度新しいプロセスで起動し得るため、端末 ID と HLC の最終値は `sync_state` に永続化する
- 検証時の注意: `adb shell am force-stop` で停止状態にすると、アプリを起動し直すまでウィジェットのクリックが配送されない。プロセスだけ落とすなら `am kill` を使う
- clickAction は Android 7 以上でのみ動作する。ウィジェットは React Native の View を画像としてレンダリングする方式である点に留意する

---

## 9. リマインド

- expo-notifications のローカル通知を使う
- **全端末で鳴らす**（端末間の調整はしない）
- 同期で reminder の op を適用したら**調停（reconcile）**を実行する
  - 有効かつ未来日時のリマインドについて `scheduled_notifications` と突き合わせ、不足分を予約・不要分を取消
- iOS の予約上限（64件）に備え、直近のものから一定件数のみ予約する
- 繰り返しは `rrule` と `timezone` から次回日時を計算する
- Android 12 以降の正確なアラーム: `SCHEDULE_EXACT_ALARM` を宣言する（下記）

実装上の取り決め（`src/core/reminders.ts`、`src/notifications/`）:

- 繰り返しは `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY` と `INTERVAL` のみ対応。それ以外（BYDAY、COUNT、UNTIL など）は単発として扱う。時刻・曜日・日付は `timezone` のウォールクロックで数える（毎日 9:00 は、どのタイムゾーンにいても 9:00 に鳴る）
- 間隔 1 の繰り返しは OS のネイティブ繰り返し（1 リマインド = 1 通知）。間隔 2 以上は次の 1 回だけを予約し、調停のたびに次を予約し直す（アプリが長く開かれないと鳴らない既知の制約）
- ネイティブ繰り返しには開始日が無いため、繰り返しは「選んだ時刻（毎週は曜日、毎月は日）に合う次の時刻」から始まる
- `scheduled_notifications.fire_at` にはトリガーと通知内容（タイトル・本文）の署名を保存する（§3.3 との差）。署名が変わると取り消して再予約する
- 通知の本文は「最初の未完了項目、なければ本文の1行目」。調停は、起動時・同期後・ローカル編集後（デバウンス）・ウィジェット操作後に走る
- 通知の許可が無い間は予約しない。許可後の次の調停で予約される
- 正確なアラーム: `SCHEDULE_EXACT_ALARM` を宣言する。Android 14 以降の新規インストールでは既定で未許可で、許可が無いと `expo-notifications` は非正確アラームで予約する（実測で約50〜60秒遅れ）。設定画面の「正確な時刻で鳴らす」から、システムの「アラームとリマインダー」画面を開く（`expo-intent-launcher`）。戻ったら予約を全部作り直す（既存の予約は、予約時点の許可状態で方式が決まるため）。許可状態を JS から取る API は無いので、状態の表示はせずシステム画面に任せる。許可後の実測は予約時刻の 1 秒以内
- Play ストアで `SCHEDULE_EXACT_ALARM` を使うには、公開時に用途（ユーザーが設定したリマインドの通知）の申告が要る。審査の扱いは公開準備で確認する
- 検証（Android エミュレータ API 37）: 通知は鳴り、タップでそのメモが開く（アプリのプロセスが無い状態からも）
- メモ一覧のカードにある次のリマインドの日時（チップ）をタップすると、カード内にリマインド設定（編集画面と同じ `ReminderSection`）が折りたたみで開く。「すべて完了」の展開と同じ形式で、シートやモーダルは使わない。開いている間は一覧を更新せず、閉じるときに反映する（全部削除してもチップが消えて閉じられなくなることを防ぐため）
- 発火済みの単発リマインドは一覧に残る（手動で削除）。表示の改善は後続

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
| 13 | 競合コピーの ID | 元メモ ID＋敗者 op ID＋フィールド名 | 1つの op で title/body 両方が負けた場合の ID 衝突を避ける |
| 14 | ウィジェットの表示メモ | ウィジェットごとに選択。端末ローカルで同期しない | 端末ごとにホーム画面の構成が違う。未選択は一覧の先頭（並び替えに追従） |
| 15 | 画面のデザイン | ティール＋黄色のカード型。ライト／ダーク対応（端末設定に従う）。アイコンは `@expo/vector-icons`、フォントは端末のもの | アイコンに合わせた配色に統一。フォントは依存と容量を増やさないため端末で代用。配色は `src/ui/theme.ts`（`usePalette`）に集約 |
| 16 | Web 対応 | 対象に加える。同期もする。通知・ウィジェット・バックグラウンド同期は対象外 | ブラウザからも使いたいという要望。同期コアは純粋 TS なのでそのまま使え、差は DB・画像・認証・通知の入口だけ。詳細は §2.4 |

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
- 汎用ライブラリの採否: 分数インデックスは自前実装（`src/core/fractional.ts`、桁 0-9a-z の中点方式。端への挿入は約5回で1桁伸びる。問題になれば整数部を持つ方式へ）。UUIDv5 は `uuid` パッケージ、UUIDv7 は同パッケージに乱数を注入して生成
- 墓標・op の長期的なガベージコレクション方針
- `src/db/` のスキーマは、列単位の upsert のため NOT NULL 列に `DEFAULT ''` を付けている（§3.2 の DDL と差がある）。スキーマのマイグレーション機構は未実装

## 参考

- [Expo Widgets](https://docs.expo.dev/versions/latest/sdk/widgets/)
- [react-native-android-widget: Register widget in Expo](https://saleksovski.github.io/react-native-android-widget/docs/tutorial/register-widget-expo)
- [react-native-android-widget: Handling Clicks](https://saleksovski.github.io/react-native-android-widget/docs/handling-clicks)
- [Google Drive: Store application-specific data](https://developers.google.com/workspace/drive/api/guides/appdata)
- [Google Drive: Choose API scopes](https://developers.google.com/drive/api/guides/about-auth)
- [Google Drive: Upload file data](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [expo-notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
