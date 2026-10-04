import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

/** 通知のタップでそのメモを開く（アプリ終了中からの起動も含む） */
export function useOpenOnNotificationTap() {
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const noteId = response?.notification.request.content.data?.noteId;
    if (typeof noteId === 'string' && response?.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
      router.push({ pathname: '/note/[id]', params: { id: noteId } });
    }
  }, [response]);
}
