import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from './task-handler';

// ウィジェットのヘッドレス起動ではルートの index.ts だけが実行されるので、ハンドラはここ経由で登録する
registerWidgetTaskHandler(widgetTaskHandler);
