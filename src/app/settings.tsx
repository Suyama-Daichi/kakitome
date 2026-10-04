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
import { radius, space, type, useThemed, type Palette } from '../ui/theme';
import { getThemeMode, setThemeMode, type ThemeMode } from '../ui/theme-mode';

const THEMES: { mode: ThemeMode; label: string }[] = [
  { mode: 'system', label: '端末に合わせる' },
  { mode: 'light', label: 'ライト' },
  { mode: 'dark', label: 'ダーク' },
];

export default function Settings() {
  const [p, styles] = useThemed(makeStyles);
  const [email, setEmail] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [wifiOnly, setWifiOnlyState] = useState(true);
  const [usage, setUsage] = useState('');
  const [theme, setTheme] = useState<ThemeMode>(getThemeMode);
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
      <Text style={styles.heading}>テーマ</Text>
      <View style={styles.segments}>
        {THEMES.map((t) => (
          <Pressable key={t.mode} style={[styles.segment, theme === t.mode ? styles.segmentOn : null]} onPress={() => { setThemeMode(t.mode); setTheme(t.mode); }}>
            <Text style={[styles.segmentText, theme === t.mode ? styles.segmentOnText : null]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.note}>ホーム画面のウィジェットは、端末の設定に従います。</Text>
      <Text style={styles.heading}>Google ドライブで同期</Text>
      <Text style={styles.note}>
        同期データは、ご自身の Google ドライブの専用領域（アプリ以外からは見えない）にだけ保存されます。開発者は保持しません。
      </Text>
      {signed ? (
        <>
          <Text style={styles.status}>サインイン中{email ? `: ${email}` : ''}</Text>
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
          <Switch value={wifiOnly} trackColor={{ true: p.accent, false: p.border }} thumbColor={p.ink} onValueChange={(v) => { setWifiOnly(v); setWifiOnlyState(v); }} />
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
      {busy ? <ActivityIndicator style={styles.spinner} color={p.accent} /> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </ScrollView>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    scroll: { flex: 1, backgroundColor: p.bg },
    container: { padding: space.screen, paddingBottom: 60, gap: 10 },
    heading: { ...type.label, color: p.inkFaint, paddingHorizontal: 6, marginTop: 8 },
    note: { ...type.caption, color: p.inkMuted, paddingHorizontal: 6 },
    status: { ...type.small, color: p.ink, paddingHorizontal: 6 },
    button: { backgroundColor: p.accent, borderRadius: radius.button, height: 44, alignItems: 'center', justifyContent: 'center' },
    buttonText: { ...type.button, color: p.onAccent },
    secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: p.borderControl },
    secondaryText: { color: p.inkSub },
    error: { ...type.small, color: p.dangerFg, paddingHorizontal: 6 },
    segments: { flexDirection: 'row', gap: 8 },
    segment: { flex: 1, height: 38, borderRadius: radius.button, borderWidth: 1, borderColor: p.borderControl, alignItems: 'center', justifyContent: 'center' },
    segmentOn: { backgroundColor: p.accent, borderColor: p.accent },
    segmentText: { ...type.item, color: p.inkSub },
    segmentOnText: { color: p.onAccent },
    section: { gap: 10, marginTop: 8 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6 },
    switchLabel: { ...type.small, color: p.ink, flex: 1 },
    spinner: { marginTop: 8 },
    message: { ...type.small, marginTop: 8, color: p.inkSub, paddingHorizontal: 6 },
  });
