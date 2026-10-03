// iOS 27 は UIScene ライフサイクルを採用していないアプリを起動時に落とす。
// Expo SDK 57 の ExpoAppSceneDelegate を使うよう、prebuild で生成される iOS プロジェクトを書き換える。
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const withScene = (config) => {
  config = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' },
        ],
      },
    };
    return c;
  });

  return withAppDelegate(config, (c) => {
    let src = c.modResults.contents;
    if (!src.includes('ExpoReactNativeFactoryProvider')) {
      src = src.replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
      // ウィンドウ作成と React Native の起動はシーンデリゲートが行う
      src = src.replace(/#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\(\n[\s\S]*?\n#endif\n/, '');
    }
    c.modResults.contents = src;
    return c;
  });
};

module.exports = withScene;
