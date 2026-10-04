import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { importKeep, type KeepImportResult } from '../import/keep-import.web';
import { onLocalChange } from '../sync/auto';
import { radius, space, type, useThemed, type Palette } from '../ui/theme';

function summary(r: KeepImportResult) {
  const s = r.skipped;
  const parts = [
    s.trashed ? `ゴミ箱 ${s.trashed}` : '',
    s.already ? `取り込み済み ${s.already}` : '',
    s.empty ? `空のメモ ${s.empty}` : '',
    s.attachments ? `取り込めない添付（音声など） ${s.attachments}` : '',
  ].filter(Boolean);
  return `${r.imported} 件のメモを取り込みました。${parts.length ? `取り込まなかったもの: ${parts.join('、')}` : ''}`;
}

export function KeepImport() {
  const [p, styles] = useThemed(makeStyles);
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [message, setMessage] = useState('');

  const run = async (files: File[]) => {
    setMessage('');
    setProgress([0, 0]);
    try {
      const r = await importKeep(files, (done, total) => setProgress([done, total]));
      setMessage(summary(r));
      if (r.imported) onLocalChange();
    } catch (e) {
      setMessage(`取り込めませんでした: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Google Keep から取り込む</Text>
      <Text style={styles.note}>
        Google Takeout で書き出した Keep の ZIP（または、展開した JSON と画像）を選んでください。ゴミ箱のメモは取り込みません。ラベルは本文の末尾に書き足します。同じ ZIP をもう一度選んでも、取り込み済みのメモは重複しません。
      </Text>
      <input
        ref={input}
        type="file"
        multiple
        accept=".zip,.json,image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = ''; // 同じファイルをもう一度選べるように
          if (files.length) void run(files);
        }}
      />
      <Pressable style={[styles.button, styles.secondary]} disabled={!!progress} onPress={() => input.current?.click()}>
        <Text style={[styles.buttonText, styles.secondaryText]}>ファイルを選んで取り込む</Text>
      </Pressable>
      {progress ? (
        <View style={styles.progress}>
          <ActivityIndicator color={p.accent} />
          <Text style={styles.status}>{progress[1] ? `取り込み中… ${progress[0]} / ${progress[1]}` : 'ファイルを読んでいます…'}</Text>
        </View>
      ) : null}
      {message ? <Text style={styles.status}>{message}</Text> : null}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    section: { gap: 10, marginTop: 8 },
    heading: { ...type.label, color: p.inkFaint, paddingHorizontal: 6 },
    note: { ...type.caption, color: p.inkMuted, paddingHorizontal: 6 },
    status: { ...type.small, color: p.ink, paddingHorizontal: 6 },
    button: { borderRadius: radius.button, height: 44, alignItems: 'center', justifyContent: 'center' },
    buttonText: { ...type.button },
    secondary: { borderWidth: 1, borderColor: p.borderControl },
    secondaryText: { color: p.inkSub },
    progress: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  });
