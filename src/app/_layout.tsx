import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { reconcileReminders } from '../notifications/reconcile';
import { registerBackgroundSync } from '../sync/background';
import { startAutoSync } from '../sync/auto';
import { usePalette } from '../ui/theme';
import { applyThemeMode, getThemeMode } from '../ui/theme-mode';

export default function RootLayout() {
  useState(() => applyThemeMode(getThemeMode())); // 最初の描画の前に、保存した配色を反映する
  const p = usePalette();
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
  // 配色は端末のライト／ダーク設定に従う。ヘッダーも同じ配色にする
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: p.bg },
          headerTintColor: p.ink,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: p.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: '' }} />
        <Stack.Screen name="note/[id]" options={{ title: '' }} />
        <Stack.Screen name="conflict/[id]" options={{ title: '競合の解消' }} />
        <Stack.Screen name="settings" options={{ title: '設定' }} />
      </Stack>
    </>
  );
}
