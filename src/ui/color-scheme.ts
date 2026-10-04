import { Appearance, useColorScheme } from 'react-native';

export { useColorScheme };

/** アプリ全体の配色を切り替える（'unspecified' は端末に従う） */
export const applyColorScheme = (mode: 'light' | 'dark' | 'unspecified') => Appearance.setColorScheme(mode);
