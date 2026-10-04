import { MaterialIcons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import { importKeep, type KeepImportResult } from '../import/keep-import.web';
import { onLocalChange } from '../sync/auto';
import { Group, Row } from './SettingsRow';
import { space, type, useThemed, type Palette } from '../ui/theme';

function summary(r: KeepImportResult) {
  const s = r.skipped;
  const parts = [
    s.trashed ? `ゴミ箱 ${s.trashed}` : '',
    s.archived ? `アーカイブ ${s.archived}` : '',
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
  const [skipArchived, setSkipArchived] = useState(true);

  const run = async (files: File[]) => {
    setMessage('');
    setProgress([0, 0]);
    try {
      const r = await importKeep(files, { includeArchived: !skipArchived }, (done, total) => setProgress([done, total]));
      setMessage(summary(r));
      if (r.imported) onLocalChange();
    } catch (e) {
      setMessage(`取り込めませんでした: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <View>
      <Group>
        <Row
          icon="move-to-inbox"
          title="Google Keep から取り込む"
          sub="Takeout の ZIP か JSON を選ぶ（取り込み済みは重複しない）"
          onPress={() => input.current?.click()}
          disabled={!!progress}
          right={progress ? <ActivityIndicator color={p.accent} /> : <MaterialIcons name="chevron-right" size={22} color={p.inkFaint} />}
        />
        <Row
          icon="archive"
          title="アーカイブしたメモは取り込まない"
          onPress={() => setSkipArchived(!skipArchived)}
          right={<Switch value={skipArchived} style={{ pointerEvents: 'none' }} trackColor={{ true: p.accent, false: p.border }} thumbColor={p.ink} onValueChange={setSkipArchived} />}
        />
      </Group>
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
      {progress ? <Text style={styles.status}>{progress[1] ? `取り込み中… ${progress[0]} / ${progress[1]}` : 'ファイルを読んでいます…'}</Text> : null}
      {message ? <Text style={styles.status}>{message}</Text> : null}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    status: { ...type.small, color: p.ink, paddingHorizontal: space.s, paddingVertical: space.m },
  });
