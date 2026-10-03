# 公開準備（Google Play）

> 開発者向けの手順書。GitHub Pages の公開対象からは外している（`docs/_config.yml` の `exclude`）。

## 1. 署名とビルド（EAS）

- アプリ ID（Android）: `app.kakitome`。**ストアに出すと変更できない。**
- Expo のプロジェクト: `@donchan/kakitome`（`app.json` の `owner` と `extra.eas.projectId`）
- 署名は EAS に任せる。初回の `eas build` で、EAS がアップロード鍵を作って管理する（手元に鍵ファイルは要らない）。**最初の 1 回は対話が必要**なので、手元のターミナルで実行する
- 構築: `eas build -p android --profile production`（AAB が出る）。バージョン番号（`versionCode`）は EAS が自動で増やす（`eas.json` の `appVersionSource: remote` と `autoIncrement`）。表示用のバージョンは `app.json` の `expo.version`
- アップロード鍵の SHA-1: `eas credentials -p android` で確認する（Google Cloud の OAuth に使う。下の 2 章）
- 権限は必要最小限に絞ってある（`app.json` の `blockedPermissions`）。リリースの権限: INTERNET / SCHEDULE_EXACT_ALARM / VIBRATE / ACCESS_NETWORK_STATE / ACCESS_WIFI_STATE / RECEIVE_BOOT_COMPLETED / POST_NOTIFICATIONS / WAKE_LOCK
- ローカルのリリースビルド（動作確認用）は、署名が debug になる。Play への提出には使わない

### 提出（`eas submit`）

- 前提: Play Console でアプリを**手動で作成**してある、Google サービスアカウントの鍵を EAS に登録してある（`eas credentials` か Expo のダッシュボード）
- 実行: `eas submit -p android --profile production`。内部テストの下書きとして提出される（`eas.json`）。提出できるのは AAB のみ
- 提出後は、ストア掲載などを終えるまで下書きのまま

## 2. Google Cloud（OAuth）

1. 「Android」の OAuth クライアントに、SHA-1 を**追加**する（既存のデバッグ用 SHA-1 は消さない）
   - アップロード鍵: `eas credentials -p android` で表示される SHA-1（EAS が作った鍵。EAS の production ビルドを手元の端末に直接入れて試すときに使う）
   - **Play アプリ署名の鍵**: Play Console →「アプリの完全性」→「アプリ署名」に表示される SHA-1（Play 経由でインストールされたアプリが使う。初回アップロード後に表示される）
2. 「Google Auth Platform」→「対象」で、公開ステータスを「テスト」から「本番」へ。要求するスコープは `drive.appdata`（非センシティブ）と基本情報のみ
3. 「ブランディング」: アプリ名、サポートメール、アプリのホームページ（`https://suyama-daichi.github.io/kakitome/`）、プライバシーポリシー（`.../privacy`）
   - 注意: `github.io` は公開サフィックスのため、「承認済みドメイン」に追加できない可能性がある。その場合は独自ドメインが要る。**Console の画面で要否を確認する**
4. 本番にした後、テストユーザー以外の Google アカウントでサインインできることを確認する

## 3. プライバシーポリシーの公開

- 文面: `docs/privacy.md`（連絡先メールアドレスを書き入れてから公開する）
- GitHub のリポジトリ → Settings → Pages → Source を「Deploy from a branch」、Branch を `main` / `/docs` にする
- URL: `https://suyama-daichi.github.io/kakitome/privacy`

## 4. Play Console

- 開発者アカウントの登録（登録料 25 ドル）。個人アカウントは、本番公開の前にクローズドテスト（一定人数・一定期間）が求められる場合がある。**最新の要件を Play Console で確認する**
- アプリのコンテンツ: プライバシーポリシーの URL、広告なし、データセーフティ、コンテンツのレーティング（IARC の質問票）、ターゲット層
- **正確なアラーム**: `SCHEDULE_EXACT_ALARM` を宣言している。`USE_EXACT_ALARM` はアラーム・カレンダーアプリ限定で、本アプリは使わない。Play が申告フォームを求める場合は、用途として下記を書く
  - 「ユーザーが設定したリマインドを、指定した時刻に通知するため。許可は任意で、許可しない場合は少し遅れて通知される。設定画面から、ユーザーが明示的に許可する」
- データセーフティの下書き（最終確認は Play Console の質問で行う）
  - 開発者がデータを収集・共有することはない（サーバーなし。同期先はユーザー自身の Google ドライブの専用領域）
  - 暗号化: 通信は HTTPS。削除: アンインストールで端末内データが消える。ドライブ上のデータの消し方はプライバシーポリシーに記載

## 5. 掲載文の下書き

- アプリ名（30 文字以内）: `kakitome - チェックリストメモ`
- 短い説明（80 文字以内）: `サーバーなし。チェックリスト・リマインド・ウィジェット対応の、書き留めるだけのメモ。`
- 詳しい説明:

```
kakitome（書き留め）は、思いついたことをすばやく書き留めるための、シンプルなメモアプリです。

■ できること
・メモとチェックリスト（完了した項目は自動で下へ）
・ホーム画面のウィジェットから、アプリを開かずにチェック（Android）
・リマインド（毎日・毎週・毎月・毎年の繰り返しに対応）
・画像の添付（位置情報などの付加情報は取り除いて保存）
・複数の端末での同期（任意）

■ サーバーを持たない設計
メモは、まず端末の中に保存されます。複数の端末で使いたいときだけ、ご自身の Google ドライブの専用領域（アプリ以外からは見えない領域）に同期できます。開発者のサーバーはなく、開発者があなたのデータを受け取ることはありません。広告や利用状況の追跡もありません。

■ 同期について
・設定から Google アカウントでサインインすると始まります（サインインしなくても使えます）
・画像の本体は、既定では Wi-Fi 接続時のみ送受信します
・同じメモを複数の端末で同時に編集して内容が食い違ったときは、どちらも失われず、あとで見比べて選べます
```

## 6. 公開前チェックリスト

- [ ] 連絡先メールアドレスを `docs/privacy.md` に記入し、GitHub Pages を有効にした
- [x] アイコン・スプラッシュを差し替えた（ティール地に白いチェックと黄色い鉛筆。生成スクリプトは `~/.kakitome/icon-concepts/make_icons.py`）
- [ ] OAuth: SHA-1 を追加し、同意画面を「本番」にした
- [ ] 本番にした状態で、テストユーザー以外のアカウントでサインインできた
- [ ] Play Console: 開発者アカウント、アプリの作成、AAB のアップロード、各申告
- [ ] スクリーンショット（電話は最低 2 枚）、フィーチャーグラフィック（1024×500）
- [ ] 実機でリリースビルドを通しで確認した（編集・画像・リマインド・ウィジェット・同期）
