import { Appearance } from 'react-native';
import { getDb } from '../db';

export type ThemeMode = 'system' | 'light' | 'dark';

/** この端末だけの設定（同期しない）。sync_state に保存する */
export function getThemeMode(): ThemeMode {
  const v = getDb().getFirstSync<{ value: string }>("SELECT value FROM sync_state WHERE key = 'theme_mode'")?.value;
  return v === 'light' || v === 'dark' ? v : 'system';
}

/** アプリ全体の配色を切り替える（useColorScheme と StatusBar の auto もこれに従う） */
export function applyThemeMode(mode: ThemeMode) {
  Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
}

export function setThemeMode(mode: ThemeMode) {
  getDb().runSync("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('theme_mode', ?)", mode);
  applyThemeMode(mode);
}
