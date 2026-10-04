# kakitome

Local-first checklist & memo app for iOS/Android/Web with Android/iOS widgets, reminders, and Google Drive sync. Built with Expo.

設計は [docs/design.md](docs/design.md) を参照してください。

## セットアップ

```sh
npm install
npm test
npm run ios      # または npm run android / npm run web
```

Development Build が必要です（Expo Go では動きません）。

### Google サインインを自分の環境で使う場合

`src/sync/config.ts` の `WEB_CLIENT_ID` / `IOS_CLIENT_ID` と、`app.json` の `@react-native-google-signin/google-signin` プラグインの `iosUrlScheme` を、自分の Google Cloud プロジェクトの OAuth クライアント ID に差し替えてください。スコープは `drive.appdata` のみです。`app.json` の `owner`・`extra.eas.projectId`、`eas.json` の `ascAppId` も自分のものにします。

## ライセンス

[MIT](LICENSE)
