import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { registerBackgroundSync } from '../sync/background';
import { startAutoSync } from '../sync/auto';

export default function RootLayout() {
  useEffect(() => {
    void registerBackgroundSync();
    return startAutoSync();
  }, []);
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'kakitome' }} />
      <Stack.Screen name="note/[id]" options={{ title: '' }} />
      <Stack.Screen name="settings" options={{ title: '設定' }} />
    </Stack>
  );
}
