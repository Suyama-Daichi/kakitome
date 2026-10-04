import { useSyncExternalStore } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

// react-native-web の Appearance には setColorScheme が無いので、上書きは自前で持つ
let override: 'light' | 'dark' | null = null;
const listeners = new Set<() => void>();

export function applyColorScheme(mode: 'light' | 'dark' | 'unspecified') {
  override = mode === 'unspecified' ? null : mode;
  listeners.forEach((l) => l());
}

export function useColorScheme() {
  const system = useSystemColorScheme();
  const o = useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => override);
  return o ?? system;
}
