import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { addItem, deleteItem, toggleItem, updateItemText, updateNote } from '../../db/actions';
import { conflictCount, getNote, isBlankNote, listItems, type Item } from '../../db/queries';
import { AttachmentSection } from '../../components/AttachmentSection';
import { ReminderSection } from '../../components/ReminderSection';
import { notifyDbChanged, subscribeDbChanges } from '../../db/changes';
import { onLocalChange } from '../../sync/auto';

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

function ItemRow({ item, onChange }: { item: Item; onChange: () => void }) {
  const [text, setText] = useState(item.text);
  useAutosave(text, useCallback((v) => { updateItemText(item.id, v); onLocalChange(); }, [item.id]));
  return (
    <View style={styles.itemRow}>
      <Pressable onPress={() => { toggleItem(item.id); onChange(); onLocalChange(); }} hitSlop={8} accessibilityLabel="完了を切り替え">
        <Text style={styles.check}>{item.checked ? '☑' : '☐'}</Text>
      </Pressable>
      <TextInput style={[styles.itemInput, item.checked ? styles.done : null]} value={text} onChangeText={setText} placeholder="項目" />
      <Pressable onPress={() => { deleteItem(item.id); onChange(); onLocalChange(); }} hitSlop={8} accessibilityLabel="項目を削除">
        <Text style={styles.remove}>✕</Text>
      </Pressable>
    </View>
  );
}

export default function NoteEditor() {
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
    Alert.alert('メモを削除', 'このメモを削除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => { updateNote(id, { deleted: 1 }); onLocalChange(); router.back(); } },
    ]);

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerButtons}>
              <Pressable onPress={() => { const p = pinned ? 0 : 1; setPinned(p); updateNote(id, { pinned: p }); }} accessibilityLabel="ピン留め"><Text style={[styles.headerIcon, pinned ? null : styles.dim]}>📌</Text></Pressable>
              <Pressable onPress={remove} accessibilityLabel="削除"><Text style={styles.headerIcon}>🗑</Text></Pressable>
            </View>
          ),
        }}
      />
      {conflicts > 0 || note.conflict_of ? (
        <Pressable style={styles.conflict} onPress={() => router.push({ pathname: '/conflict/[id]', params: { id } })}>
          <Text style={styles.conflictText}>⚠ 別の端末の編集と競合しました。タップして解消する</Text>
        </Pressable>
      ) : null}
      <TextInput style={styles.titleInput} value={title} onChangeText={setTitle} placeholder="タイトル" />
      <TextInput style={styles.bodyInput} value={body} onChangeText={setBody} placeholder="メモ" multiline />
      {items.map((it) => <ItemRow key={it.id} item={it} onChange={reload} />)}
      <Pressable style={styles.add} onPress={() => { addItem(id); reload(); onLocalChange(); }}>
        <Text style={styles.addText}>＋ 項目を追加</Text>
      </Pressable>
      <AttachmentSection noteId={id} />
      <ReminderSection noteId={id} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, paddingBottom: 80 },
  missing: { padding: 24, textAlign: 'center', color: '#888' },
  conflict: { backgroundColor: '#fff4e0', borderRadius: 8, padding: 10, marginBottom: 8 },
  conflictText: { color: '#8a5a00', fontSize: 14 },
  titleInput: { fontSize: 22, fontWeight: '700', paddingVertical: 8 },
  bodyInput: { fontSize: 16, minHeight: 60, paddingVertical: 8, textAlignVertical: 'top' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  check: { fontSize: 22 },
  itemInput: { flex: 1, fontSize: 16, paddingVertical: 8 },
  done: { color: '#999', textDecorationLine: 'line-through' },
  remove: { fontSize: 16, color: '#999', paddingHorizontal: 4 },
  add: { paddingVertical: 12 },
  addText: { color: '#2196f3', fontSize: 16 },
  headerButtons: { flexDirection: 'row', gap: 16 },
  headerIcon: { fontSize: 20 },
  dim: { opacity: 0.3 },
});
