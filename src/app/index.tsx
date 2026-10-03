import { useCallback, useState } from 'react';
import { Button, Pressable, StyleSheet, Text, View } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { useFocusEffect } from 'expo-router';
import { seedDemo, toggleItem } from '../db/actions';
import { firstNoteWithItems, type NoteView } from '../db/queries';
import { ChecklistWidget } from '../widget/ChecklistWidget';

// PoC 画面。本格的な UI はロードマップ5
export default function Index() {
  const [note, setNote] = useState<NoteView | undefined>();
  const reload = useCallback(() => setNote(firstNoteWithItems()), []);
  useFocusEffect(reload);

  const refreshWidget = () =>
    requestWidgetUpdate({
      widgetName: 'Checklist',
      renderWidget: () => <ChecklistWidget note={firstNoteWithItems()} />,
      widgetNotFound: () => {},
    });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{note?.title ?? 'メモがありません'}</Text>
      {note?.items.map((it) => (
        <Pressable key={it.id} onPress={() => { toggleItem(it.id); reload(); refreshWidget(); }}>
          <Text style={[styles.item, it.checked ? styles.done : null]}>{it.checked ? '☑' : '☐'} {it.text}</Text>
        </Pressable>
      ))}
      <Button title="デモデータを投入" onPress={() => { seedDemo(); reload(); refreshWidget(); }} />
      <Button title="再読込" onPress={() => { reload(); refreshWidget(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 8 },
  title: { fontSize: 20, fontWeight: 'bold' },
  item: { fontSize: 18, paddingVertical: 6 },
  done: { color: '#999' },
});
