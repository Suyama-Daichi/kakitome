import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { createNote } from '../db/actions';
import { listNotes, type NoteRow } from '../db/queries';

export default function NoteList() {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  useFocusEffect(useCallback(() => setNotes(listNotes()), []));

  const open = (id: string) => router.push({ pathname: '/note/[id]', params: { id } });

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{ headerRight: () => <Pressable onPress={() => router.push('/settings')} accessibilityLabel="設定"><Text style={styles.gear}>⚙</Text></Pressable> }}
      />
      <FlatList
        data={notes}
        keyExtractor={(n) => n.id}
        contentContainerStyle={notes.length ? undefined : styles.emptyBox}
        ListEmptyComponent={<Text style={styles.empty}>メモはまだありません</Text>}
        renderItem={({ item: n }) => (
          <Pressable style={styles.row} onPress={() => open(n.id)}>
            <Text style={styles.title} numberOfLines={1}>
              {n.pinned ? '📌 ' : ''}{n.title || n.body.split('\n')[0] || '無題のメモ'}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {n.conflict_of ? '⚠ 競合コピー　' : ''}
              {n.total_count ? `${n.total_count - n.open_count}/${n.total_count} 完了　` : ''}
              {n.title ? n.body.split('\n')[0] : ''}
            </Text>
          </Pressable>
        )}
      />
      <Pressable style={styles.fab} onPress={() => open(createNote())} accessibilityLabel="新しいメモ">
        <Text style={styles.fabText}>＋</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  emptyBox: { flex: 1, justifyContent: 'center' },
  empty: { textAlign: 'center', color: '#888' },
  row: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  title: { fontSize: 17, fontWeight: '600' },
  sub: { fontSize: 13, color: '#777', marginTop: 2 },
  gear: { fontSize: 22, paddingHorizontal: 4 },
  fab: { position: 'absolute', right: 20, bottom: 28, width: 56, height: 56, borderRadius: 28, backgroundColor: '#2196f3', alignItems: 'center', justifyContent: 'center', elevation: 4 },
  fabText: { color: '#fff', fontSize: 28, lineHeight: 32 },
});
