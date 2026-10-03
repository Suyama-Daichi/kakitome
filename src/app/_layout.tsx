import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { reconcileReminders } from '../notifications/reconcile';
import { registerBackgroundSync } from '../sync/background';
import { startAutoSync } from '../sync/auto';

export default function RootLayout() {
  // 通知のタップでそのメモを開く（アプリ終了中からの起動も含む）
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const noteId = response?.notification.request.content.data?.noteId;
    if (typeof noteId === 'string' && response?.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
      router.push({ pathname: '/note/[id]', params: { id: noteId } });
    }
  }, [response]);

  useEffect(() => {
    void reconcileReminders().catch(() => {});
    void registerBackgroundSync();
    return startAutoSync();
  }, []);
  // 画面は白背景固定（ダークモード未対応）。端末がダークモードでも、時計などのアイコンが白背景に溶けないよう暗い色にする
  return (
    <>
      <StatusBar style="dark" />
      <Stack>
      <Stack.Screen name="index" options={{ title: 'kakitome' }} />
      <Stack.Screen name="note/[id]" options={{ title: '' }} />
      <Stack.Screen name="conflict/[id]" options={{ title: '競合の解消' }} />
      <Stack.Screen name="settings" options={{ title: '設定' }} />
      </Stack>
    </>
  );
}
