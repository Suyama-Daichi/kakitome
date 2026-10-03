// リリース署名。鍵とパスワードはリポジトリに置かず、~/.gradle/gradle.properties の
// KAKITOME_UPLOAD_* から読む。未設定の環境（他の開発者など）では debug 署名にフォールバックする。
const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = (config) =>
  withAppBuildGradle(config, (c) => {
    let src = c.modResults.contents;
    if (src.includes('KAKITOME_UPLOAD_STORE_FILE')) return c;

    src = src.replace(
      /(signingConfigs \{\s*debug \{[\s\S]*?\n        \})/,
      `$1
        release {
            if (findProperty('KAKITOME_UPLOAD_STORE_FILE')) {
                storeFile file(findProperty('KAKITOME_UPLOAD_STORE_FILE'))
                storePassword findProperty('KAKITOME_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('KAKITOME_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('KAKITOME_UPLOAD_KEY_PASSWORD')
            }
        }`,
    );
    src = src.replace(
      /(release \{\s*\/\/ Caution![\s\S]*?\/\/ see [^\n]*\n\s*)signingConfig signingConfigs\.debug/,
      "$1signingConfig findProperty('KAKITOME_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    );
    c.modResults.contents = src;
    return c;
  });
