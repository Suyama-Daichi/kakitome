"use no memo"; // ウィジェットの描画（renderWidget）に渡すコンポーネントを含むため、ChecklistWidget と同じ制約
import { createElement } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WidgetConfigurationScreenProps } from 'react-native-android-widget';
import { listNotes, setWidgetNote, widgetNote } from '../db/queries';
import { ChecklistWidget } from './ChecklistWidget';

/** ウィジェットの追加時と、長押しの「設定」から開く。どのメモを表示するかを選ぶ */
export function WidgetConfigScreen({ widgetInfo, renderWidget, setResult }: WidgetConfigurationScreenProps) {
  const notes = listNotes().filter((n) => !n.conflict_of);
  const choose = (id: string | null) => {
    setWidgetNote(widgetInfo.widgetId, id);
    renderWidget(createElement(ChecklistWidget, { note: widgetNote(widgetInfo.widgetId) }));
    setResult('ok');
  };
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>表示するメモを選んでください</Text>
      <FlatList
        data={[{ id: null as string | null, label: '一覧の先頭のメモ（並び替えに追従）' }, ...notes.map((n) => ({ id: n.id as string | null, label: n.title || n.body.split('\n')[0] || '無題のメモ' }))]}
        keyExtractor={(n) => n.id ?? 'first'}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => choose(item.id)}>
            <Text style={styles.label} numberOfLines={1}>{item.label}</Text>
          </Pressable>
        )}
      />
      <Pressable style={styles.cancel} onPress={() => setResult('cancel')}>
        <Text style={styles.cancelText}>キャンセル</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 48 },
  heading: { fontSize: 18, fontWeight: '600', paddingHorizontal: 16, paddingBottom: 12 },
  row: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  label: { fontSize: 16 },
  cancel: { padding: 16, alignItems: 'center' },
  cancelText: { color: '#2196f3', fontSize: 16 },
});
