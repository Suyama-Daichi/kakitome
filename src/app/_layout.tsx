import { MaterialIcons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useDbReady } from '../db/ready';
import { useOpenOnNotificationTap } from '../notifications/use-open-on-tap';
import { reconcileReminders } from '../notifications/reconcile';
import { registerBackgroundSync } from '../sync/background';
import { startAutoSync } from '../sync/auto';
import { refreshWidget } from '../widget/refresh';
import { ToastHost } from '../ui/toast';
import { usePalette } from '../ui/theme';
import { applyThemeMode, getThemeMode } from '../ui/theme-mode';

// 描画中の例外で画面が真っ白にならないよう、エラーの内容と「再試行」を出す
export { ErrorBoundary } from 'expo-router';

export default function RootLayout() {
  const { ready, error } = useDbReady();
  if (error) {
    // Web: 同じサイトを開いている別のタブが DB を使っていると開けない
    return (
      <View style={styles.error}>
        <Text style={styles.errorText}>データを開けませんでした。kakitome を開いている他のタブをすべて閉じてから、このページを再読み込みしてください。</Text>
        <Text style={styles.errorDetail}>{error.message}</Text>
      </View>
    );
  }
  return ready ? <App /> : null;
}

function App() {
  useState(() => applyThemeMode(getThemeMode())); // 最初の描画の前に、保存した配色を反映する
  const p = usePalette();
  useOpenOnNotificationTap();

  useEffect(() => {
    void reconcileReminders().catch(() => {});
    refreshWidget(); // iOS: 編集が無くても、起動時にウィジェットへ内容を入れる
    void registerBackgroundSync();
    return startAutoSync();
  }, []);
  // Web: サインインで戻ってきた URL の #access_token=… は google-auth.web が取り込んで消すが、ルーターが自分の状態から URL を作り直して戻してしまう。ルーターの状態ごと '/' に置き換える
  useEffect(() => {
    if (Platform.OS === 'web' && location.hash.includes('access_token')) router.replace('/');
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
            // Web: 再読み込みすると履歴が失われ、既定の戻るボタンが消える。履歴が無いときは一覧へ戻す
            ...(Platform.OS === 'web' && {
              headerLeft: ({ canGoBack }: { canGoBack?: boolean }) => (
                <Pressable onPress={() => (canGoBack ? router.back() : router.replace('/'))} accessibilityLabel="戻る" hitSlop={8}>
                  <MaterialIcons name="arrow-back" size={24} color={p.ink} />
                </Pressable>
              ),
            }),
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
  error: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  errorText: { fontSize: 16 },
  errorDetail: { fontSize: 12, opacity: 0.6 },
  column: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
});
