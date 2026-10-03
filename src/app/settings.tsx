import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { lastSyncAt, unsentOpCount } from '../db/queries';
import { currentEmail, isSignedIn, signIn, signOut } from '../sync/google-auth';
import { runSync } from '../sync/run';

export default function Settings() {
  const [email, setEmail] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [info, setInfo] = useState({ unsent: 0, last: null as string | null });

  const reload = useCallback(() => {
    setSigned(isSignedIn());
    setEmail(currentEmail());
    setInfo({ unsent: unsentOpCount(), last: lastSyncAt() });
  }, []);
  useFocusEffect(reload);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
      setMessage(ok);
    } catch (e) {
      setMessage(`失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      reload();
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Google ドライブで同期</Text>
      <Text style={styles.note}>
        同期データは、ご自身の Google ドライブの専用領域（アプリ以外からは見えない）にだけ保存されます。開発者は保持しません。
      </Text>
      {signed ? (
        <>
          <Text style={styles.status}>サインイン中: {email ?? '（不明）'}</Text>
          <Text style={styles.status}>未送信の変更: {info.unsent} 件</Text>
          <Text style={styles.status}>最終同期: {info.last ? new Date(info.last).toLocaleString() : 'まだありません'}</Text>
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
      {busy ? <ActivityIndicator style={styles.spinner} /> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 12, backgroundColor: '#fff' },
  heading: { fontSize: 20, fontWeight: '700' },
  note: { color: '#666', lineHeight: 20 },
  status: { fontSize: 15 },
  button: { backgroundColor: '#2196f3', borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: { backgroundColor: '#eee' },
  secondaryText: { color: '#333' },
  spinner: { marginTop: 8 },
  message: { marginTop: 8, color: '#444' },
});
