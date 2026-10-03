// 開発ビルド専用の操作（本番の設定画面には出ない）。設定画面からは __DEV__ のときだけ読み込む
import * as BackgroundTask from 'expo-background-task';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { applyLocalOp } from '../core/merge';
import { getDb, openCore } from '../db';
import { createBlobPort } from '../media/blob-port';
import { collectGarbage } from '../sync/blobs';
import { makeDrive, runSync } from '../sync/run';

/** 開発用: Drive の専用領域のファイル内訳（種類ごとの数と、端末ごとの数） */
async function driveBreakdown(): Promise<string> {
  const files = await makeDrive().listFiles();
  const by: Record<string, number> = {};
  for (const f of files) {
    const k = f.appProperties?.kind ?? '?';
    by[k] = (by[k] ?? 0) + 1;
    if (k === 'ops' || k === 'snapshot') by[`${k}@${f.appProperties?.deviceId}`] = (by[`${k}@${f.appProperties?.deviceId}`] ?? 0) + 1;
  }
  return `Drive: ${files.length} 件 ${JSON.stringify(by)}`;
}

/** 開発用: 自端末が Drive に作ったファイルを削除する（ユーザーが Drive 側のデータを消した状況の再現） */
async function devDeleteOwnFiles(): Promise<number> {
  const ids: string[] = JSON.parse(getDb().getFirstSync<{ value: string }>("SELECT value FROM sync_state WHERE key = 'own_files'")?.value ?? '[]');
  const drive = makeDrive();
  for (const id of ids) await drive.deleteFile(id);
  return ids.length;
}

/**
 * 開発用: 「別の端末」が、このメモを編集した状況を Drive に作る。
 * 1) 共通の分岐元（3 行の本文）を自端末の通常の編集として作って同期する
 * 2) 擬似端末が、その分岐元を見たうえで本文を編集した op を Drive に直接書く
 * 3) 自端末が、擬似端末の編集を見ないまま本文を編集する → 次の同期で競合コピーができる
 */
async function devSeedConflict(): Promise<string> {
  const db = getDb();
  const note = db.getFirstSync<{ id: string }>("SELECT id FROM notes WHERE deleted = 0 AND conflict_of IS NULL AND title != '' ORDER BY sort_key, id LIMIT 1");
  if (!note) throw new Error('メモがありません');
  const { ctx, tx } = openCore();
  const base = 'りんご\nみかん\nぶどう';
  tx(() => applyLocalOp(ctx, 'note', note.id, { body: base }));
  await runSync();
  const baseHlc = ctx.store.getField('note', note.id, 'body')!.hlc;
  const ms = Date.now() + 1000;
  const hlc = `${String(ms).padStart(13, '0')}:0000:dev-pseudo`;
  const op = { id: `pseudo-${ms}`, hlc, entity: 'note', entityId: note.id, fields: { body: 'りんご\nみかん\nぶどう\nメロン（別の端末）' }, base: { body: baseHlc } };
  await makeDrive().createFile({ name: `ops_dev-pseudo_${hlc}.jsonl`, appProperties: { deviceId: 'dev-pseudo', hlc, kind: 'ops' } }, JSON.stringify(op) + '\n');
  tx(() => applyLocalOp(ctx, 'note', note.id, { body: 'りんご\nみかん\nぶどう\nバナナ（この端末）' }));
  await runSync();
  return '競合を仕込みました。同期後、メモの上部に競合バナーが出ます';
}

type Run = <T>(fn: () => Promise<T>, ok: string | ((r: T) => string)) => Promise<void>;

function Button({ label, onPress, busy }: { label: string; onPress: () => void; busy: boolean }) {
  return (
    <Pressable style={styles.button} disabled={busy} onPress={onPress}>
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

export function DevTools({ run, busy }: { run: Run; busy: boolean }) {
  return (
    <View style={styles.box}>
      <Text style={styles.heading}>（開発用）</Text>
      <Button busy={busy} label="バックグラウンド同期を実行" onPress={() => run(() => BackgroundTask.triggerTaskWorkerForTestingAsync(), 'バックグラウンド同期を実行しました')} />
      <Button busy={busy} label="猶予なしで不要な画像を整理" onPress={() => run(() => collectGarbage(makeDrive(), createBlobPort(), { graceMs: 0, force: true }), '整理しました')} />
      <Button busy={busy} label="今すぐ圧縮して同期" onPress={() => run(async () => { await runSync({ compactMinFiles: 1 }); return driveBreakdown(); }, (r) => r)} />
      <Button busy={busy} label="Drive 上の自端末ファイルを削除" onPress={() => run(devDeleteOwnFiles, (n) => `自端末のファイルを ${n} 件削除しました`)} />
      <Button busy={busy} label="競合を仕込む" onPress={() => run(devSeedConflict, (r) => r)} />
      <Button busy={busy} label="Drive のファイル内訳を表示" onPress={() => run(driveBreakdown, (r) => r)} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 12, marginTop: 16 },
  heading: { fontSize: 20, fontWeight: '700' },
  button: { backgroundColor: '#eee', borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  text: { color: '#333', fontSize: 16, fontWeight: '600' },
});
