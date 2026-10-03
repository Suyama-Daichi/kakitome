import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { lastSyncAt, lastSyncError, unsentOpCount } from '../db/queries';
import { isWifiOnly, localImageBytes, setWifiOnly } from '../media/blob-port';
import { rescheduleAllReminders } from '../notifications/reconcile';
import { currentEmail, isSignedIn, signIn, signOut } from '../sync/google-auth';
import { DevTools } from '../dev/DevTools';
import { makeDrive, runSync } from '../sync/run';

export default function Settings() {
  const [email, setEmail] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [wifiOnly, setWifiOnlyState] = useState(true);
  const [usage, setUsage] = useState('');
  const [info, setInfo] = useState({ unsent: 0, last: null as string | null, error: null as string | null });

  const reload = useCallback(() => {
    setSigned(isSignedIn());
    setEmail(currentEmail());
    setWifiOnlyState(isWifiOnly());
    setInfo({ unsent: unsentOpCount(), last: lastSyncAt(), error: lastSyncError() || null });
  }, []);
  useFocusEffect(reload);

  const run = async <T,>(fn: () => Promise<T>, ok: string | ((r: T) => string)) => {
    setBusy(true);
    setMessage('');
    try {
      const r = await fn();
      setMessage(typeof ok === 'function' ? ok(r) : ok);
    } catch (e) {
      setMessage(`失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      reload();
    }
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Google ドライブで同期</Text>
      <Text style={styles.note}>
        同期データは、ご自身の Google ドライブの専用領域（アプリ以外からは見えない）にだけ保存されます。開発者は保持しません。
      </Text>
      {signed ? (
        <>
          <Text style={styles.status}>サインイン中: {email ?? '（不明）'}</Text>
          <Text style={styles.status}>未送信の変更: {info.unsent} 件</Text>
          <Text style={styles.status}>最終同期: {info.last ? new Date(info.last).toLocaleString() : 'まだありません'}</Text>
          {info.error ? <Text style={styles.error}>直近の自動同期の失敗: {info.error}</Text> : null}
          <Pressable style={styles.button} disabled={busy} onPress={() => run(runSync, '同期しました')}>
            <Text style={styles.buttonText}>今すぐ同期</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.secondary]} disabled={busy} onPress={() => run(signOut, 'サインアウトしました')}>
            <Text style={[styles.buttonText, styles.secondaryText]}>サインアウト（同期を止める）</Text>
          </Pressable>
        </>
      ) : (
        <Pressable style={styles.button} disabled={busy} onPress={() => run(signIn, '')}>
          <Text style={styles.buttonText}>Google アカウントで同期を始める</Text>
        </Pressable>
      )}
      <View style={styles.section}>
        <Text style={styles.heading}>画像</Text>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>画像の本体は Wi-Fi 接続時のみ送受信する</Text>
          <Switch value={wifiOnly} onValueChange={(v) => { setWifiOnly(v); setWifiOnlyState(v); }} />
        </View>
        <Text style={styles.note}>サムネイルとメモの内容は、モバイル回線でも同期されます。オフにすると、画像の本体もモバイル回線で送受信します。</Text>
        <Pressable
          style={[styles.button, styles.secondary]}
          disabled={busy}
          onPress={() =>
            run(async () => {
              const drive = await makeDrive().usage();
              const size = (n: number) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
              setUsage(`Drive の使用量（kakitome の専用領域）: ${size(drive)}／この端末の画像: ${size(localImageBytes())}`);
            }, '')
          }
        >
          <Text style={[styles.buttonText, styles.secondaryText]}>使用容量を確認する</Text>
        </Pressable>
        {usage ? <Text style={styles.status}>{usage}</Text> : null}
      </View>
      {Platform.OS === 'android' && Number(Platform.Version) >= 31 ? (
        <View style={styles.section}>
          <Text style={styles.heading}>リマインドの時刻</Text>
          <Text style={styles.note}>
            「アラームとリマインダー」を許可すると、リマインドが指定の時刻ちょうどに鳴ります。許可しない場合は、数十秒から1分ほど遅れることがあります。
          </Text>
          <Pressable
            style={[styles.button, styles.secondary]}
            disabled={busy}
            onPress={() =>
              run(async () => {
                // 設定画面から戻るまで待ち、許可が変わっていても反映されるよう予約を作り直す
                await IntentLauncher.startActivityAsync('android.settings.REQUEST_SCHEDULE_EXACT_ALARM', {
                  data: `package:${Constants.expoConfig?.android?.package ?? 'app.kakitome'}`,
                });
                await rescheduleAllReminders();
              }, '')
            }
          >
            <Text style={[styles.buttonText, styles.secondaryText]}>正確な時刻で鳴らす（システム設定を開く）</Text>
          </Pressable>
        </View>
      ) : null}
      {__DEV__ ? <DevTools run={run} busy={busy} signed={signed} /> : null}
      {busy ? <ActivityIndicator style={styles.spinner} /> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 20, paddingBottom: 60, gap: 12 },
  heading: { fontSize: 20, fontWeight: '700' },
  note: { color: '#666', lineHeight: 20 },
  status: { fontSize: 15 },
  button: { backgroundColor: '#2196f3', borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: { backgroundColor: '#eee' },
  secondaryText: { color: '#333' },
  error: { color: '#b3261e' },
  section: { gap: 12, marginTop: 16 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchLabel: { flex: 1, fontSize: 15 },
  spinner: { marginTop: 8 },
  message: { marginTop: 8, color: '#444' },
});
