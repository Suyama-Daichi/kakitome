// ウィジェットのヘッドレス起動ではこのファイルだけが実行されるので、ハンドラはここで登録する
import 'expo-router/entry';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from './src/widget/task-handler';

registerWidgetTaskHandler(widgetTaskHandler);
