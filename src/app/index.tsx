import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, FlatList, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { createNote, updateNote } from '../db/actions';
import { subscribeDbChanges } from '../db/changes';
import { listNotes, type NoteRow } from '../db/queries';
import { onLocalChange } from '../sync/auto';

const SWIPE_DELETE = -96;

/** 左へスワイプして離すと削除の確認を出す。キャンセルや閾値未満なら元の位置へ戻す */
function SwipeRow({ onDelete, children }: { onDelete: () => void; children: React.ReactNode }) {
  const x = useRef(new Animated.Value(0)).current;
  const back = () => Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > 2 * Math.abs(g.dy),
      onPanResponderMove: (_, g) => x.setValue(Math.min(0, g.dx)),
      onPanResponderRelease: (_, g) => {
        back();
        if (g.dx < SWIPE_DELETE) onDelete();
      },
      onPanResponderTerminate: back,
    }),
  ).current;
  return (
    <View style={styles.swipeBox}>
      <View style={styles.swipeBack}><Text style={styles.swipeText}>削除</Text></View>
      <Animated.View style={[styles.swipeFront, { transform: [{ translateX: x }] }]} {...pan.panHandlers}>{children}</Animated.View>
    </View>
  );
}

export default function NoteList() {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const reload = useCallback(() => setNotes(listNotes()), []);
  useFocusEffect(reload);
  useEffect(() => subscribeDbChanges(reload), [reload]);

  const remove = (n: NoteRow) =>
    Alert.alert('メモを削除', `「${n.title || n.body.split('\n')[0] || '無題のメモ'}」を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => { updateNote(n.id, { deleted: 1 }); onLocalChange(); } },
    ]);

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
          <SwipeRow onDelete={() => remove(n)}>
          <Pressable style={styles.row} onPress={() => open(n.id)}>
            <Text style={styles.title} numberOfLines={1}>
              {n.pinned ? '📌 ' : ''}{n.title || n.body.split('\n')[0] || '無題のメモ'}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {n.conflict_of ? '⚠ 競合コピー　' : ''}{n.conflict_count ? `⚠ 競合あり（${n.conflict_count}件）　` : ''}
              {n.total_count ? `${n.total_count - n.open_count}/${n.total_count} 完了　` : ''}
              {n.title ? n.body.split('\n')[0] : ''}
            </Text>
          </Pressable>
          </SwipeRow>
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
  swipeBox: { backgroundColor: '#d32f2f' },
  swipeBack: { ...(StyleSheet.absoluteFill as object),justifyContent: 'center', alignItems: 'flex-end', paddingRight: 24 },
  swipeText: { color: '#fff', fontWeight: '600' },
  swipeFront: { backgroundColor: '#fff' },
  row: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  title: { fontSize: 17, fontWeight: '600' },
  sub: { fontSize: 13, color: '#777', marginTop: 2 },
  gear: { fontSize: 22, paddingHorizontal: 4 },
  fab: { position: 'absolute', right: 20, bottom: 28, width: 56, height: 56, borderRadius: 28, backgroundColor: '#2196f3', alignItems: 'center', justifyContent: 'center', elevation: 4 },
  fabText: { color: '#fff', fontSize: 28, lineHeight: 32 },
});
