import { MaterialIcons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Platform } from 'react-native';
import { addItem, deleteItem, moveSorted, toggleItem, updateItemText, updateNote } from '../../db/actions';
import { conflictCount, getNote, isBlankNote, listItems, type Item } from '../../db/queries';
import { AttachmentSection } from '../../components/AttachmentSection';
import { DragHandle } from '../../components/DragHandle';
import { ReminderSection } from '../../components/ReminderSection';
import { notifyDbChanged, subscribeDbChanges } from '../../db/changes';
import { confirmDestructive } from '../../ui/dialog';
import { onLocalChange } from '../../sync/auto';
import { radius, size, space, type, useThemed, type Palette } from '../../ui/theme';

/** 入力のたびに op を出さないよう、入力が止まって 500ms 後と画面を離れるときに保存する */
function useAutosave(value: string, save: (v: string) => void) {
  const latest = useRef(value);
  const saved = useRef(value);
  const saveRef = useRef(save);
  useEffect(() => {
    latest.current = value;
    saveRef.current = save;
    const t = setTimeout(() => {
      if (latest.current !== saved.current) {
        saved.current = latest.current;
        saveRef.current(latest.current);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [value, save]);
  useEffect(
    () => () => {
      if (latest.current !== saved.current) saveRef.current(latest.current);
    },
    [],
  );
}

function ItemRow({ item, onChange, handle }: { item: Item; onChange: () => void; handle?: React.ReactNode }) {
  const [p, styles] = useThemed(makeStyles);
  const [text, setText] = useState(item.text);
  useAutosave(text, useCallback((v) => { updateItemText(item.id, v); onLocalChange(); }, [item.id]));
  return (
    <View style={[styles.itemRow, item.checked ? styles.itemRowDone : null]}>
      <Pressable onPress={() => { toggleItem(item.id); onChange(); onLocalChange(); }} hitSlop={8} accessibilityLabel="完了を切り替え">
        <View style={[styles.box, item.checked ? styles.boxOn : null]}>
          {item.checked ? <MaterialIcons name="check" size={15} color="#fff" /> : null}
        </View>
      </Pressable>
      <TextInput
        style={[styles.itemInput, item.checked ? styles.done : null]}
        value={text}
        onChangeText={setText}
        placeholder="項目"
        placeholderTextColor={p.inkDone}
      />
      {handle}
      <Pressable onPress={() => { deleteItem(item.id); onChange(); onLocalChange(); }} hitSlop={8} accessibilityLabel="項目を削除">
        <MaterialIcons name="close" size={18} color={p.inkDone} />
      </Pressable>
    </View>
  );
}

export default function NoteEditor() {
  const [p, styles] = useThemed(makeStyles);
  const [showDone, setShowDone] = useState(true);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const lastDy = useRef(0);
  const { id } = useLocalSearchParams<{ id: string }>();
  const note = getNote(id);
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [pinned, setPinned] = useState(note?.pinned ?? 0);
  const [items, setItems] = useState<Item[]>(() => listItems(id));
  const [conflicts, setConflicts] = useState(() => conflictCount(id));
  const reload = useCallback(() => {
    setItems(listItems(id));
    setConflicts(conflictCount(id));
  }, [id]);

  // 同期で届いた変更は項目一覧にだけ反映する。入力中のタイトル・本文は上書きしない（保存時に LWW で解決）
  useEffect(() => subscribeDbChanges(reload), [reload]);
  // 競合の解消画面から戻ったとき、バナーを消し、解消した本文・タイトルを入力欄に反映する（入力中ではないので上書きしてよい。値が同じなら保存は走らない）
  useFocusEffect(
    useCallback(() => {
      const cur = getNote(id);
      reload();
      if (cur) { setTitle(cur.title); setBody(cur.body); }
    }, [id, reload]),
  );

  useAutosave(title, useCallback((v) => { updateNote(id, { title: v }); onLocalChange(); }, [id]));
  useAutosave(body, useCallback((v) => { updateNote(id, { body: v }); onLocalChange(); }, [id]));

  // 何も入力せずに戻ったら、作ったメモを削除（墓標）する。各入力欄の保存が終わってから判定するため次のタスクに回す
  useEffect(
    () => () => {
      setTimeout(() => {
        if (isBlankNote(id)) { updateNote(id, { deleted: 1 }); onLocalChange(); notifyDbChanged(); } // 一覧は戻った時点で読み込み済みなので再読み込みさせる
      }, 0);
    },
    [id],
  );

  if (!note) return <Text style={styles.missing}>このメモは削除されました</Text>;

  const remove = () =>
    confirmDestructive('メモを削除', 'このメモを削除しますか？', () => { updateNote(id, { deleted: 1 }); onLocalChange(); router.back(); });

  const open = items.filter((it) => !it.checked);
  const done = items.filter((it) => it.checked);

  // 未完了の項目の並び替え: 行の高さは一定なので、動かした行は指に追従させ、通り過ぎた行を 1 行分ずらして見せる
  const ROW = size.rowEdit;
  const target = (from: number, dy: number) => Math.max(0, Math.min(open.length - 1, from + Math.round(dy / ROW)));
  const dragMove = (from: number, dy: number) => {
    lastDy.current = dy;
    dragY.setValue(dy);
    const to = target(from, dy);
    setDrag((d) => (d && d.to !== to ? { from, to } : d));
  };
  const dragEnd = (from: number) => {
    const to = target(from, lastDy.current);
    lastDy.current = 0;
    setDrag(null);
    dragY.setValue(0);
    if (to === from) return;
    const order = [...open];
    order.splice(to, 0, ...order.splice(from, 1));
    moveSorted('checklist_item', order, to);
    reload();
    onLocalChange();
  };
  const shift = (i: number) => {
    if (!drag || i === drag.from) return 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -ROW;
    if (drag.from > drag.to && i < drag.from && i >= drag.to) return ROW;
    return 0;
  };

  const togglePin = () => { const v = pinned ? 0 : 1; setPinned(v); updateNote(id, { pinned: v }); };

  return (
    <ScrollView style={styles.container} scrollEnabled={!drag} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {Platform.OS === 'ios' ? (
        // iOS 26 では headerRight の要素が 1 つの枠にまとまるため、ボタンごとに独立した枠にする
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            separateBackground
            icon={pinned ? 'pin.fill' : 'pin'}
            tintColor={pinned ? p.yellowText : p.barIcon}
            accessibilityLabel="ピン留め"
            onPress={togglePin}
          />
          <Stack.Toolbar.Button separateBackground icon="trash" tintColor={p.barIcon} accessibilityLabel="削除" onPress={remove} />
        </Stack.Toolbar>
      ) : (
        <Stack.Screen
          options={{
            headerRight: () => (
              <View style={styles.headerButtons}>
                <Pressable onPress={togglePin} accessibilityLabel="ピン留め">
                  <MaterialIcons name="push-pin" size={22} color={pinned ? p.yellowText : p.barIcon} style={pinned ? null : styles.dim} />
                </Pressable>
                <Pressable onPress={remove} accessibilityLabel="削除"><MaterialIcons name="delete" size={22} color={p.barIcon} /></Pressable>
              </View>
            ),
          }}
        />
      )}
      {conflicts > 0 || note.conflict_of ? (
        <Pressable style={styles.conflict} onPress={() => router.push({ pathname: '/conflict/[id]', params: { id } })}>
          <MaterialIcons name="sync-problem" size={16} color={p.dangerFg} />
          <Text style={styles.conflictText}>別の端末の編集と競合しました。タップして解消する</Text>
        </Pressable>
      ) : null}
      <TextInput style={styles.titleInput} value={title} onChangeText={setTitle} placeholder="タイトル" placeholderTextColor={p.inkDone} />
      <View style={styles.card}>
        <Text style={styles.cardLabel}>メモ</Text>
        <TextInput style={styles.bodyInput} value={body} onChangeText={setBody} placeholder="メモ" placeholderTextColor={p.inkDone} multiline />
      </View>
      <View style={styles.card}>
        {items.length ? (
          <View style={styles.progressRow}>
            <View style={styles.bar}><View style={[styles.barFill, { width: `${(done.length / items.length) * 100}%` }]} /></View>
            <Text style={styles.count}>{done.length}/{items.length}</Text>
          </View>
        ) : null}
        {open.map((it, i) => (
          <Animated.View key={it.id} style={drag?.from === i ? { zIndex: 1, elevation: 6, backgroundColor: p.surface, transform: [{ translateY: dragY }] } : { transform: [{ translateY: shift(i) }] }}>
            <ItemRow
              item={it}
              onChange={reload}
              handle={open.length > 1 ? <DragHandle onStart={() => setDrag({ from: i, to: i })} onMove={(dy) => dragMove(i, dy)} onEnd={() => dragEnd(i)} /> : undefined}
            />
          </Animated.View>
        ))}
        <Pressable style={styles.add} onPress={() => { addItem(id); reload(); onLocalChange(); }}>
          <MaterialIcons name="add" size={20} color={p.accentText} />
          <Text style={styles.addText}>項目を追加</Text>
        </Pressable>
        {done.length ? (
          <>
            <View style={styles.divider} />
            <Pressable style={styles.doneHeader} onPress={() => setShowDone((v) => !v)}>
              <Text style={styles.doneLabel}>完了 {done.length} 件</Text>
              <MaterialIcons name={showDone ? 'expand-less' : 'expand-more'} size={20} color={p.inkFaint} />
            </Pressable>
            {showDone ? done.map((it) => <ItemRow key={it.id} item={it} onChange={reload} />) : null}
          </>
        ) : null}
      </View>
      <AttachmentSection noteId={id} />
      <ReminderSection noteId={id} />
    </ScrollView>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: p.bg },
    content: { padding: space.screen, paddingBottom: 80, gap: 10 },
    missing: { padding: 24, textAlign: 'center', color: p.inkMuted },
    conflict: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.dangerBg, borderColor: p.dangerBorder, borderWidth: 1, borderRadius: radius.button, padding: 10 },
    conflictText: { ...type.item, color: p.dangerFg, flex: 1 },
    titleInput: { ...type.noteTitle, color: p.ink, paddingVertical: 8, paddingHorizontal: 6 },
    card: { backgroundColor: p.surface, borderColor: p.border, borderWidth: 1, borderRadius: radius.card, paddingVertical: 10, paddingHorizontal: space.cardPad },
    cardLabel: { ...type.label, color: p.inkFaint },
    bodyInput: { ...type.body, color: p.ink, minHeight: 60, textAlignVertical: 'top' },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
    bar: { flex: 1, height: size.progress, borderRadius: 2, backgroundColor: p.border, overflow: 'hidden' },
    barFill: { height: size.progress, backgroundColor: p.accent },
    count: { ...type.monoMeta, color: p.inkFaint },
    itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: size.rowEdit },
    itemRowDone: { minHeight: 40 },
    box: { width: size.checkbox, height: size.checkbox, borderRadius: radius.checkbox, borderWidth: 1.5, borderColor: p.checkboxBorder, alignItems: 'center', justifyContent: 'center' },
    boxOn: { backgroundColor: p.accent, borderColor: p.accent },
    // 1 行の入力欄に lineHeight を付けない: iOS は行の余白を文字の上にためるので、チェックボックスと上下にずれる
    itemInput: { fontSize: type.body.fontSize, flex: 1, color: p.ink, paddingVertical: 8 },
    done: { fontSize: type.item.fontSize, color: p.inkDone, textDecorationLine: 'line-through' },
    add: { flexDirection: 'row', alignItems: 'center', gap: 6, height: size.rowEdit },
    addText: { ...type.item, fontWeight: '500', color: p.accentText },
    divider: { height: 1, backgroundColor: p.border, marginVertical: 4 },
    doneHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 36 },
    doneLabel: { ...type.caption, color: p.inkFaint },
    headerButtons: { flexDirection: 'row', gap: 16 },
    dim: { opacity: 0.4 },
  });
