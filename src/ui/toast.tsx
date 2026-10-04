import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, space, type, useThemed, type Palette } from './theme';

// 画面遷移をまたいで出せるよう、トーストはルートに置いた ToastHost が表示する
let listener: ((text: string) => void) | null = null;
export const showToast = (text: string) => listener?.(text);

/** ルートレイアウトに 1 つ置く。右は一覧の追加ボタンを避ける余白 */
export function ToastHost() {
  const [, styles] = useThemed(makeStyles);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    listener = setText;
    return () => { listener = null; };
  }, []);
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => setText(null), 2500);
    return () => clearTimeout(t);
  }, [text]);
  return text ? (
    <View style={styles.toast} pointerEvents="none">
      <Text style={styles.text}>{text}</Text>
    </View>
  ) : null;
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    toast: { position: 'absolute', left: space.screen, right: 90, bottom: 32, backgroundColor: p.ink, borderRadius: radius.card, paddingVertical: 12, paddingHorizontal: space.xxl },
    text: { ...type.small, color: p.bg },
  });
