import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDbReady } from '../db/ready';
import { useOpenOnNotificationTap } from '../notifications/use-open-on-tap';
import { reconcileReminders } from '../notifications/reconcile';
import { registerBackgroundSync } from '../sync/background';
import { startAutoSync } from '../sync/auto';
import { ToastHost } from '../ui/toast';
import { usePalette } from '../ui/theme';
import { applyThemeMode, getThemeMode } from '../ui/theme-mode';

// 描画中の例外で画面が真っ白にならないよう、エラーの内容と「再試行」を出す
export { ErrorBoundary } from 'expo-router';

export default function RootLayout() {
  return useDbReady() ? <App /> : null;
}

function App() {
  useState(() => applyThemeMode(getThemeMode())); // 最初の描画の前に、保存した配色を反映する
  const p = usePalette();
  useOpenOnNotificationTap();

  useEffect(() => {
    void reconcileReminders().catch(() => {});
    void registerBackgroundSync();
    return startAutoSync();
  }, []);
  // 配色は端末のライト／ダーク設定に従う。ヘッダーも同じ配色にする
  return (
    <View style={[styles.outer, { backgroundColor: p.bg }]}>
      <View style={styles.column}>
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
        <ToastHost />
      </View>
    </View>
  );
}

// 広い画面（Web）では、モバイル版と同じ幅の 1 列を中央に置く
const styles = StyleSheet.create({
  outer: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
});
