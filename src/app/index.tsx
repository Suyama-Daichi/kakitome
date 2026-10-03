import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { createNote, moveNote, updateNote } from '../db/actions';
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

/** 右端の「≡」を押したまま上下に動かして並び替える。指を離すまで他の操作を横取りされない */
function DragHandle({ onStart, onMove, onEnd }: { onStart: () => void; onMove: (dy: number) => void; onEnd: () => void }) {
  const cb = useRef({ onStart, onMove, onEnd });
  cb.current = { onStart, onMove, onEnd };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => cb.current.onStart(),
      onPanResponderMove: (_, g) => cb.current.onMove(g.dy),
      onPanResponderRelease: () => cb.current.onEnd(),
      onPanResponderTerminate: () => cb.current.onEnd(),
    }),
  ).current;
  return (
    <View {...pan.panHandlers} style={styles.handle} accessibilityLabel="ドラッグして並び替え">
      <Text style={styles.handleText}>≡</Text>
    </View>
  );
}

export default function NoteList() {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const reload = useCallback(() => setNotes(listNotes()), []);
  useFocusEffect(reload);
  useEffect(() => subscribeDbChanges(reload), [reload]);

  // 並び替え: from の行を指に追従させ、to まで他の行を1行分ずらして見せる。範囲は同じピン留め状態の行だけ
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const rowH = useRef(60);
  const lastDy = useRef(0);
  const range = (from: number) => {
    const same = (i: number) => notes[i].pinned === notes[from].pinned;
    let lo = from, hi = from;
    while (lo > 0 && same(lo - 1)) lo--;
    while (hi < notes.length - 1 && same(hi + 1)) hi++;
    return [lo, hi];
  };
  const dragMove = (from: number, dy: number) => {
    lastDy.current = dy;
    dragY.setValue(dy);
    const [lo, hi] = range(from);
    const to = Math.min(hi, Math.max(lo, from + Math.round(dy / rowH.current)));
    setDrag((d) => (d && d.to !== to ? { from, to } : d));
  };
  const dragEnd = (from: number) => {
    const [lo, hi] = range(from);
    const to = Math.min(hi, Math.max(lo, from + Math.round(lastDy.current / rowH.current)));
    lastDy.current = 0;
    setDrag(null);
    dragY.setValue(0);
    if (to === from) return;
    const group = notes.slice(lo, hi + 1);
    group.splice(to - lo, 0, ...group.splice(from - lo, 1));
    moveNote(group, to - lo);
    reload();
    onLocalChange();
  };
  const shift = (i: number) => {
    if (!drag || i === drag.from) return 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -rowH.current;
    if (drag.from > drag.to && i < drag.from && i >= drag.to) return rowH.current;
    return 0;
  };

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
      <ScrollView scrollEnabled={!drag} contentContainerStyle={notes.length ? undefined : styles.emptyBox}>
        {notes.length ? null : <Text style={styles.empty}>メモはまだありません</Text>}
        {notes.map((n, i) => (
          <Animated.View
            key={n.id}
            onLayout={(e) => { rowH.current = e.nativeEvent.layout.height; }}
            style={drag?.from === i ? { zIndex: 1, elevation: 4, transform: [{ translateY: dragY }] } : { transform: [{ translateY: shift(i) }] }}
          >
            <SwipeRow onDelete={() => remove(n)}>
              <View style={styles.rowWrap}>
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
                <DragHandle
                  onStart={() => setDrag({ from: i, to: i })}
                  onMove={(dy) => dragMove(i, dy)}
                  onEnd={() => dragEnd(i)}
                />
              </View>
            </SwipeRow>
          </Animated.View>
        ))}
      </ScrollView>
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
  rowWrap: { flexDirection: 'row', alignItems: 'center' },
  handle: { paddingHorizontal: 16, alignSelf: 'stretch', justifyContent: 'center' },
  handleText: { fontSize: 22, color: '#aaa' },
  row: { flex: 1, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  title: { fontSize: 17, fontWeight: '600' },
  sub: { fontSize: 13, color: '#777', marginTop: 2 },
  gear: { fontSize: 22, paddingHorizontal: 4 },
  fab: { position: 'absolute', right: 20, bottom: 28, width: 56, height: 56, borderRadius: 28, backgroundColor: '#2196f3', alignItems: 'center', justifyContent: 'center', elevation: 4 },
  fabText: { color: '#fff', fontSize: 28, lineHeight: 32 },
});
