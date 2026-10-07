import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { completeFromNotification } from './actions';
import { ACTION_DONE, ACTION_SNOOZE } from './reconcile';

/** 通知のタップでそのメモを開く（アプリ終了中からの起動も含む）。ボタン（完了・スヌーズ）もここで受ける */
export function useOpenOnNotificationTap() {
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!response) return;
    const noteId = response.notification.request.content.data?.noteId;
    if (typeof noteId !== 'string') return;
    switch (response.actionIdentifier) {
      case Notifications.DEFAULT_ACTION_IDENTIFIER:
        router.push({ pathname: '/note/[id]', params: { id: noteId } });
        break;
      case ACTION_SNOOZE: // メモを開き、新しいリマインドの入力欄を出す
        void Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(() => {});
        router.push({ pathname: '/note/[id]', params: { id: noteId, reminder: 'new' } });
        break;
      case ACTION_DONE:
        void completeFromNotification(response);
        break;
      default:
        return;
    }
    // 処理済みの応答が次の起動で再び届かないようにする（後で有効に戻したリマインドを「完了」で無効にし直さないため）
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) Notifications.clearLastNotificationResponse();
  }, [response]);
}
