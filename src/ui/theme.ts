/**
 * kakitome デザイントークン（デザイン案 7a: ダーク / 8a: ライト）
 * src/ui/theme.ts などに置き、useColorScheme() で palette を切り替える想定。
 * src/core/ からは参照しないこと（core は UI 非依存）。
 */
import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

const dark = {
  bg: '#0d1211',            // 画面の地
  surface: '#141b1a',       // カード・入力欄
  surfaceBar: '#111817',    // 下部バー・ボトムシート
  viewerBg: '#070a09',      // 画像の全画面表示（ライトでもこの色）
  border: '#22302d',        // カード枠・区切り線・進捗バーの溝
  borderStrong: '#2c3b38',  // シート上端・スナックバー枠
  borderControl: '#33433f', // 枠線ボタン（キャンセル等）
  ink: '#dfe8e5',           // 本文・タイトル
  inkSub: '#b5c3bf',        // 説明文・枠線ボタンの文字
  inkMuted: '#8b9d98',      // ラベル・補足
  inkFaint: '#7c8f8a',      // 進捗数字・メタ情報
  inkDone: '#5c6d69',       // 完了した項目（取り消し線）
  checkboxBorder: '#5d716c',
  dragHandle: '#3a4a46',
  barIcon: '#c4d0cd',       // 下部バーのアイコン
  accent: '#26a69a',        // チェック済み・進捗・トグル・選択
  accentText: '#4dd0c0',    // 「項目を追加」など teal の文字
  onAccent: '#06110f',
  yellow: '#ffca28',        // FAB・主ボタン（面）
  onYellow: '#0d1211',
  yellowText: '#ffca28',    // ピン・カウント・「元に戻す」（文字/アイコン）
  reminderBg: '#2a2410', reminderFg: '#ffd54f',
  dangerBg: '#2e1714', dangerFg: '#ff8a75', dangerBorder: '#3a2420',
  danger: '#e5533d', onDanger: '#0d1211',
  diffDelBg: '#2a1513', diffDelFg: '#ff8a75',
  diffAddBg: '#0f2622', diffAddFg: '#6fe0cf',
  diffContext: '#8b9d98',
  chipBg: '#1b2523', chipFg: '#9fb3ae',
  scrim: 'rgba(0,0,0,0.6)',
  shadow: 'rgba(0,0,0,0.5)',
};

const light: typeof dark = {
  bg: '#f3f5f4',
  surface: '#ffffff',
  surfaceBar: '#ffffff',
  viewerBg: '#070a09',
  border: '#dde5e2',
  borderStrong: '#d3ddd9',
  borderControl: '#cfd9d5',
  ink: '#0f1a18',
  inkSub: '#3d4d49',
  inkMuted: '#5d6e6a',
  inkFaint: '#5d6e6a',
  inkDone: '#94a5a1',
  checkboxBorder: '#8fa39e',
  dragHandle: '#b7c4c1',
  barIcon: '#3d4d49',
  accent: '#00897b',
  accentText: '#00796b',
  onAccent: '#ffffff',
  yellow: '#ffca28',
  onYellow: '#10201d',
  yellowText: '#8a6400',
  reminderBg: '#fff4cc', reminderFg: '#5c4300',
  dangerBg: '#fde7e2', dangerFg: '#9a2b14', dangerBorder: '#f3cfc6',
  danger: '#e5533d', onDanger: '#10201d',
  diffDelBg: '#fdecea', diffDelFg: '#9a2b14',
  diffAddBg: '#e3f4ee', diffAddFg: '#0b5c4d',
  diffContext: '#5d6e6a',
  chipBg: '#e8efed', chipFg: '#3d4d49',
  scrim: 'rgba(16,32,29,0.4)',
  shadow: 'rgba(0,0,0,0.25)',
};

export type Palette = typeof dark;
export const palettes = { dark, light };
export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

/** パレットから StyleSheet を作る。配色が変わったときだけ作り直す */
export function useThemed<T extends object>(make: (p: Palette) => T): [Palette, T] {
  const p = usePalette();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- make はモジュール直下の純関数
  return [p, useMemo(() => make(p), [p])];
}

/** フォントは端末のものを使う（依存を増やさない）。数字・日時・状態は等幅 */
export const font = {
  sans: undefined,
  mono: 'monospace',
};

const bold = '700' as const;
const semi = '600' as const;

export const type = {
  noteTitle: { fontWeight: bold, fontSize: 25, lineHeight: 32 },
  appTitle: { fontWeight: bold, fontSize: 22, lineHeight: 28 },
  pageHeading: { fontWeight: bold, fontSize: 19, lineHeight: 26 },  // ウィジェットの設定
  sheetTitle: { fontWeight: bold, fontSize: 17, lineHeight: 24 },   // シート・ダイアログ
  cardTitle: { fontWeight: bold, fontSize: 16, lineHeight: 22 },    // 一覧カード・ヘッダー
  body: { fontSize: 15, lineHeight: 25 },                           // 本文・編集の項目
  item: { fontSize: 14, lineHeight: 20 },                           // 一覧/ウィジェットの項目・行
  button: { fontWeight: bold, fontSize: 14 },
  small: { fontSize: 13, lineHeight: 22 },
  label: { fontWeight: semi, fontSize: 12, lineHeight: 18 },        // セクション見出し
  caption: { fontSize: 11, lineHeight: 18 },                        // 補足・チップ
  monoMeta: { fontFamily: font.mono, fontSize: 11 },                // 1/5・日時
  monoValue: { fontFamily: font.mono, fontWeight: bold, fontSize: 16 }, // シートの日付・時刻
};

export const space = { xs: 4, s: 6, m: 8, l: 10, xl: 12, xxl: 14, screen: 12, cardPad: 14 };

export const radius = {
  chip: 6, checkbox: 6, checkboxSmall: 5, button: 10, card: 12, iconButton: 12,
  fab: 16, dialog: 18, widget: 20, sheet: 22, toggle: 13,
};

export const size = {
  iconButton: 44, fab: 58, buttonPrimary: 50, button: 44, buttonSheet: 46,
  rowEdit: 44, rowList: 38, rowWidget: 34, rowOption: 50,
  checkbox: 20, checkboxList: 18, progress: 3, bottomBar: 62, toggleW: 44, toggleH: 26, toggleKnob: 18,
};
