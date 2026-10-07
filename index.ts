// ウィジェットのヘッドレス起動ではこのファイルだけが実行されるので、ハンドラはここで登録する
import 'expo-router/entry';
import './src/sync/background';
import './src/notifications/actions';
import './src/widget/register';
