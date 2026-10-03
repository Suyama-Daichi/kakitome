import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { diffLines, mergeThreeWay } from '../../core/diff';
import { resolveConflict } from '../../db/actions';
import { conflictsFor, type ConflictView } from '../../db/queries';
import { onLocalChange } from '../../sync/auto';

const FIELD = { title: 'タイトル', body: '本文' } as const;

function Diff({ from, to, title }: { from: string; to: string; title: string }) {
  const d = useMemo(() => diffLines(from, to), [from, to]);
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>{title}</Text>
      {d.length === 0 ? <Text style={styles.empty}>（空）</Text> : null}
      {d.map((l, i) => (
        <Text key={i} style={[styles.line, l.kind === 'add' ? styles.add : l.kind === 'del' ? styles.del : null]}>
          {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : '  '}{l.text}
        </Text>
      ))}
    </View>
  );
}

function Resolver({ c, onDone }: { c: ConflictView; onDone: () => void }) {
  const [mode, setMode] = useState<'choose' | 'merge'>('choose');
  const merged = useMemo(() => (c.base !== null ? mergeThreeWay(c.base, c.ours, c.theirs) : null), [c]);
  // 手動マージの初期値: 分岐元があれば自動マージ結果、無ければ両方を並べる
  const [draft, setDraft] = useState(merged?.text ?? `${c.ours}\n${c.theirs}`);

  const finish = (value: string) => {
    resolveConflict(c, value);
    onLocalChange();
    onDone();
  };

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{FIELD[c.field]}の競合</Text>
      <Text style={styles.note}>
        別の端末の編集と同時に変更されました。{c.base === null ? '分岐元が残っていないため、現在とコピーの違いだけを表示します。' : '分岐元からの変更を表示します。'}
      </Text>
      {c.base !== null ? <Diff from={c.base} to={c.ours} title="現在の値（分岐元からの変更）" /> : <Text style={styles.value}>現在の値{'\n'}{c.ours || '（空）'}</Text>}
      {c.base !== null ? <Diff from={c.base} to={c.theirs} title="競合コピーの値（分岐元からの変更）" /> : <Diff from={c.ours} to={c.theirs} title="現在 → 競合コピー" />}
      {mode === 'choose' ? (
        <View style={styles.actions}>
          <Pressable style={styles.button} onPress={() => finish(c.ours)}><Text style={styles.buttonText}>現在の値を採用</Text></Pressable>
          <Pressable style={styles.button} onPress={() => finish(c.theirs)}><Text style={styles.buttonText}>コピーの値を採用</Text></Pressable>
          <Pressable style={[styles.button, styles.secondary]} onPress={() => setMode('merge')}><Text style={[styles.buttonText, styles.secondaryText]}>手動でマージ</Text></Pressable>
        </View>
      ) : (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>{merged && merged.conflicts > 0 ? `自動マージ結果（衝突 ${merged.conflicts} 件。<<<<<<< ～ >>>>>>> を直してください）` : '結果を編集してください'}</Text>
          <TextInput style={styles.editor} value={draft} onChangeText={setDraft} multiline={c.field === 'body'} />
          <View style={styles.actions}>
            <Pressable style={styles.button} onPress={() => finish(draft)}><Text style={styles.buttonText}>この内容で解消</Text></Pressable>
            <Pressable style={[styles.button, styles.secondary]} onPress={() => setMode('choose')}><Text style={[styles.buttonText, styles.secondaryText]}>戻る</Text></Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

/** id は元メモ・競合コピーのどちらでもよい */
export default function ConflictScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [version, setVersion] = useState(0);
  const conflicts = useMemo(() => conflictsFor(id), [id, version]);

  if (!conflicts.length) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>解消する競合はありません</Text>
        <Pressable style={styles.button} onPress={() => router.back()}><Text style={styles.buttonText}>戻る</Text></Pressable>
      </View>
    );
  }
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      {conflicts.map((c) => <Resolver key={c.copyId} c={c} onDone={() => setVersion((v) => v + 1)} />)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 16, gap: 16, paddingBottom: 60 },
  card: { gap: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: '#ccc', borderRadius: 10, padding: 12 },
  heading: { fontSize: 18, fontWeight: '700' },
  note: { color: '#666', fontSize: 13, lineHeight: 18 },
  block: { gap: 4 },
  blockTitle: { fontSize: 13, fontWeight: '600', color: '#555' },
  line: { fontFamily: 'Courier', fontSize: 13, paddingVertical: 1, paddingHorizontal: 4 },
  add: { backgroundColor: '#e6f6e6' },
  del: { backgroundColor: '#fde8e8' },
  value: { fontSize: 14 },
  empty: { color: '#888', textAlign: 'center' },
  actions: { gap: 8, marginTop: 6 },
  button: { backgroundColor: '#2196f3', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondary: { backgroundColor: '#eee' },
  secondaryText: { color: '#333' },
  editor: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#999', borderRadius: 8, padding: 8, minHeight: 100, fontSize: 15, textAlignVertical: 'top' },
});
