import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { diffLines, mergeThreeWay } from '../../core/diff';
import { resolveConflict } from '../../db/actions';
import { conflictsFor, type ConflictView } from '../../db/queries';
import { onLocalChange } from '../../sync/auto';
import { showToast } from '../../ui/toast';
import { radius, space, type, useThemed, type Palette } from '../../ui/theme';

const FIELD = { title: 'タイトル', body: '本文' } as const;

function Diff({ from, to, title }: { from: string; to: string; title: string }) {
  const [, styles] = useThemed(makeStyles);
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
  const [p, styles] = useThemed(makeStyles);
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
          <TextInput style={styles.editor} placeholderTextColor={p.inkDone} value={draft} onChangeText={setDraft} multiline={c.field === 'body'} />
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
  const [, styles] = useThemed(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [version, setVersion] = useState(0);
  // キーボードの高さ分だけ下に余白を足し、ボタンまでスクロールできるようにする（edge-to-edge の Android でも効く）
  const [kb, setKb] = useState(0);
  useEffect(() => {
    const onShow = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setKb(e.endCoordinates.height));
    const onHide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(0));
    return () => { onShow.remove(); onHide.remove(); };
  }, []);
  const conflicts = useMemo(() => conflictsFor(id), [id, version]);
  const onResolved = (remaining: number) => {
    if (remaining > 0) {
      showToast(`解消しました。残り ${remaining} 件`);
      setVersion((v) => v + 1);
    } else {
      showToast('競合をすべて解消しました');
      router.back(); // 残りが無ければ、この画面に留まる理由がない
    }
  };

  return (
    <View style={styles.scroll}>
      {conflicts.length ? (
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.container, { paddingBottom: 60 + kb }]} keyboardShouldPersistTaps="handled">
          {conflicts.map((c) => <Resolver key={c.copyId} c={c} onDone={() => onResolved(conflicts.length - 1)} />)}
        </ScrollView>
      ) : (
        <View style={styles.container}>
          <Text style={styles.empty}>解消する競合はありません</Text>
          <Pressable style={styles.button} onPress={() => router.back()}><Text style={styles.buttonText}>戻る</Text></Pressable>
        </View>
      )}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    scroll: { flex: 1, backgroundColor: p.bg },
    container: { padding: space.screen, gap: 12, paddingBottom: 60 },
    card: { gap: 10, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, borderRadius: radius.card, padding: space.cardPad },
    heading: { ...type.sheetTitle, color: p.ink },
    note: { ...type.caption, color: p.inkMuted },
    block: { gap: 4 },
    blockTitle: { ...type.label, color: p.inkFaint },
    line: { fontFamily: 'monospace', fontSize: 12, lineHeight: 22, paddingHorizontal: 6, color: p.diffContext, borderRadius: 4 },
    add: { backgroundColor: p.diffAddBg, color: p.diffAddFg },
    del: { backgroundColor: p.diffDelBg, color: p.diffDelFg },
    value: { ...type.item, color: p.ink },
    empty: { ...type.small, color: p.inkMuted, textAlign: 'center' },
    actions: { gap: 8, marginTop: 6 },
    button: { backgroundColor: p.accent, borderRadius: radius.button, height: 44, alignItems: 'center', justifyContent: 'center' },
    buttonText: { ...type.button, color: p.onAccent },
    secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: p.borderControl },
    secondaryText: { color: p.inkSub },
    editor: { borderWidth: 1, borderColor: p.borderControl, borderRadius: radius.button, padding: 10, minHeight: 100, ...type.body, color: p.ink, backgroundColor: p.surface, textAlignVertical: 'top' },
  });
