import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'kakitome' }} />
      <Stack.Screen name="note/[id]" options={{ title: '' }} />
    </Stack>
  );
}
