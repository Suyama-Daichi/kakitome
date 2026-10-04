import { MaterialIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { deleteAllNotes } from '../db/actions';
import { lastSyncAt, lastSyncError, liveNoteCount, unsentOpCount } from '../db/queries';
import { isWifiOnly, localImageBytes, setWifiOnly } from '../media/blob-port';
import { Group, Row, SectionHeading } from '../components/SettingsRow';
import { KeepImport } from '../components/KeepImport';
import { rescheduleAllReminders } from '../notifications/reconcile';
import { currentEmail, isSignedIn, signIn, signOut } from '../sync/google-auth';
import { DevTools } from '../dev/DevTools';
import { onLocalChange } from '../sync/auto';
import { makeDrive, runSync } from '../sync/run';
import { showToast } from '../ui/toast';
import { font, radius, size, space, type, useThemed, type Palette } from '../ui/theme';
import { getThemeMode, setThemeMode, type ThemeMode } from '../ui/theme-mode';

type Icon = React.ComponentProps<typeof MaterialIcons>['name'];
const THEMES: { mode: ThemeMode; label: string; icon: Icon }[] = [
  { mode: 'system', label: '端末に合わせる', icon: 'brightness-auto' },
  { mode: 'light', label: 'ライト', icon: 'light-mode' },
  { mode: 'dark', label: 'ダーク', icon: 'dark-mode' },
];

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
/** 直後は「たった今」、今日なら時刻、それより前は 月/日 時刻 */
function fmtLast(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  const ago = Date.now() - d.getTime();
  if (ago < 60_000) return 'たった今';
  return d.toDateString() === new Date().toDateString() ? hhmm(d) : `${d.getMonth() + 1}/${d.getDate()} ${hhmm(d)}`;
}
const fmtSize = (n: number) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export default function Settings() {
  const [p, styles] = useThemed(makeStyles);
  const [email, setEmail] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wifiOnly, setWifiOnlyState] = useState(true);
  const [usage, setUsage] = useState<{ drive: number; local: number } | 'loading' | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(getThemeMode);
  const [info, setInfo] = useState({ unsent: 0, last: null as string | null, error: null as string | null });
  const [deleteCount, setDeleteCount] = useState<number | null>(null); // 非 null のあいだ「すべてのメモを削除」のシートを出す

  const reload = useCallback(() => {
    setSigned(isSignedIn());
    setEmail(currentEmail());
    setWifiOnlyState(isWifiOnly());
    setInfo({ unsent: unsentOpCount(), last: lastSyncAt(), error: lastSyncError() || null });
  }, []);
  useFocusEffect(reload);

  const run = async <T,>(fn: () => Promise<T>, ok: string | ((r: T) => string)) => {
    setBusy(true);
    try {
      const r = await fn();
      const m = typeof ok === 'function' ? ok(r) : ok;
      if (m) showToast(m);
    } catch (e) {
      showToast(`失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      reload();
    }
  };

  const revoked = !signed && !!info.error?.includes('取り消');
  // 状態パネルの見た目。地と文字（丸・状態名）の色の組
  const st = !signed
    ? revoked ? { name: '要サインイン', bg: p.dangerBg, fg: p.dangerFg } : { name: '同期オフ', bg: p.chipBg, fg: p.chipFg }
    : busy ? { name: '同期中', bg: p.reminderBg, fg: p.reminderFg }
    : info.error ? { name: '同期エラー', bg: p.dangerBg, fg: p.dangerFg }
    : info.unsent > 0 ? { name: '未送信あり', bg: p.reminderBg, fg: p.reminderFg }
    : { name: '同期済み', bg: p.diffAddBg, fg: p.accentText };

  const checkUsage = async () => {
    setUsage('loading');
    try {
      setUsage({ drive: await makeDrive().usage(), local: localImageBytes() });
    } catch (e) {
      setUsage(null);
      showToast(`失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <View style={[styles.panel, { backgroundColor: st.bg }]}>
        <View style={styles.panelHead}>
          <View style={[styles.dot, { backgroundColor: st.fg }]} />
          <Text style={[styles.stateName, { color: st.fg }]}>{st.name}</Text>
          {signed && email ? <Text style={styles.account}>{email}</Text> : null}
        </View>
        {signed ? (
          <>
            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>最終同期</Text>
                <Text style={styles.statValue}>{fmtLast(info.last)}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>未送信の変更</Text>
                <Text style={styles.statValue}>{info.unsent}<Text style={styles.statUnit}> 件</Text></Text>
              </View>
            </View>
            {info.error ? <Text style={[styles.errorText, { color: p.dangerFg }]}>{info.error}</Text> : null}
          </>
        ) : (
          <View style={styles.signedOut}>
            <Text style={styles.signedOutTitle}>{revoked ? 'アクセスが取り消されました' : '同期はオフです'}</Text>
            <Text style={styles.signedOutSub}>{revoked ? 'Google ドライブへの許可が外れたため、同期を止めています' : 'メモはこの端末にだけ保存されています'}</Text>
          </View>
        )}
        <View style={styles.buttons}>
          {busy && signed ? (
            <View style={[styles.main, styles.mainBusy]}>
              <MaterialIcons name="hourglass-top" size={18} color={p.inkMuted} />
              <Text style={[styles.mainText, { color: p.inkMuted }]}>同期しています…</Text>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.main, pressed && styles.pressed]}
              disabled={busy}
              onPress={() => (signed ? run(runSync, '同期しました') : run(signIn, ''))}
            >
              <MaterialIcons name={signed ? 'sync' : 'login'} size={18} color={p.onAccent} />
              <Text style={[styles.mainText, { color: p.onAccent }]}>
                {!signed ? (revoked ? 'もう一度サインイン' : 'Google アカウントで同期を始める') : info.error ? 'もう一度同期' : '今すぐ同期'}
              </Text>
            </Pressable>
          )}
          {signed ? (
            <Pressable style={({ pressed }) => [styles.signOut, pressed && styles.pressed]} disabled={busy} onPress={() => run(signOut, 'サインアウトしました')}>
              <Text style={styles.signOutText}>サインアウト</Text>
            </Pressable>
          ) : null}
        </View>
        {!signed ? (
          <Text style={styles.panelNote}>同期データは、ご自身の Google ドライブの専用領域（アプリ以外からは見えない）にだけ保存されます。開発者は保持しません。</Text>
        ) : null}
      </View>

      <SectionHeading first>表示</SectionHeading>
      <Group>
        <Row
          icon="contrast"
          title="テーマ"
          sub={
            <>
              {THEMES.find((t) => t.mode === theme)?.label}
              {theme !== 'system' ? '\nホーム画面のウィジェットは、端末の設定に従います。' : ''}
            </>
          }
          right={
            <View style={styles.themes}>
              {THEMES.map((t) => (
                <Pressable
                  key={t.mode}
                  style={[styles.themeBtn, theme === t.mode && styles.themeBtnOn]}
                  onPress={() => { setThemeMode(t.mode); setTheme(t.mode); }}
                  accessibilityLabel={t.label}
                >
                  <MaterialIcons name={t.icon} size={18} color={theme === t.mode ? p.onAccent : p.inkSub} />
                </Pressable>
              ))}
            </View>
          }
        />
      </Group>

      <SectionHeading>画像</SectionHeading>
      <Group>
        <Row
          icon="wifi"
          title="画像の本体は Wi-Fi のみ"
          sub="サムネイルとメモはモバイル回線でも同期"
          onPress={() => { setWifiOnly(!wifiOnly); setWifiOnlyState(!wifiOnly); }}
          right={<Switch value={wifiOnly} pointerEvents="none" trackColor={{ true: p.accent, false: p.border }} thumbColor={p.ink} onValueChange={() => {}} />}
        />
        <Row
          icon="data-usage"
          title="使用容量"
          onPress={usage ? undefined : () => void checkUsage()}
          right={
            usage === 'loading' ? <ActivityIndicator color={p.accent} />
            : usage ? (
              <View>
                <Text style={styles.usage}><Text style={styles.usageLabel}>Drive </Text>{fmtSize(usage.drive)}</Text>
                <Text style={styles.usage}><Text style={styles.usageLabel}>この端末 </Text>{fmtSize(usage.local)}</Text>
              </View>
            ) : <Text style={styles.link}>確認する</Text>
          }
        />
      </Group>

      {Platform.OS === 'web' || (Platform.OS === 'android' && Number(Platform.Version) >= 31) ? (
        <>
          <SectionHeading>取り込み・通知</SectionHeading>
          <Group>
            <KeepImport />
            {Platform.OS === 'android' ? (
              <Row
                icon="alarm"
                title="正確な時刻で鳴らす"
                sub="許可しないと 1 分ほど遅れることがあります"
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
                right={<MaterialIcons name="open-in-new" size={20} color={p.inkFaint} />}
              />
            ) : null}
          </Group>
        </>
      ) : null}

      <SectionHeading>データ</SectionHeading>
      <Group>
        <Row icon="delete-forever" title="すべてのメモを削除" danger onPress={() => setDeleteCount(liveNoteCount())} />
      </Group>

      {__DEV__ ? <DevTools run={run} busy={busy} signed={signed} /> : null}
      <View style={styles.footer}>
        <Text style={styles.version}>kakitome {Constants.expoConfig?.version ?? ''}</Text>
        <Pressable onPress={() => void Linking.openURL('https://kakitome.d0nchan.com/privacy')}>
          <Text style={styles.privacy}>プライバシーポリシー</Text>
        </Pressable>
      </View>

      <Modal visible={deleteCount !== null} transparent animationType="slide" onRequestClose={() => setDeleteCount(null)}>
        <Pressable style={styles.scrim} onPress={() => setDeleteCount(null)}>
          <Pressable style={styles.sheet}>
            <View style={styles.grip} />
            <Text style={styles.sheetTitle}>すべてのメモを削除しますか？</Text>
            <Text style={styles.sheetBody}>{deleteCount} 件のメモをすべて削除します。同期している他の端末のメモも削除され、元に戻せません。</Text>
            <Pressable
              style={({ pressed }) => [styles.sheetDelete, pressed && styles.pressed]}
              onPress={() => {
                const n = deleteAllNotes();
                onLocalChange();
                setDeleteCount(null);
                showToast(`${n} 件のメモを削除しました`);
                reload();
              }}
            >
              <MaterialIcons name="delete-forever" size={20} color={p.onDanger} />
              <Text style={[styles.mainText, { color: p.onDanger }]}>{deleteCount} 件のメモを削除</Text>
            </Pressable>
            <Pressable style={styles.sheetCancel} onPress={() => setDeleteCount(null)}>
              <Text style={styles.signOutText}>キャンセル</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    scroll: { flex: 1, backgroundColor: p.bg },
    container: { padding: space.screen, paddingBottom: 60 },
    pressed: { opacity: 0.7 },
    panel: { borderRadius: 16, padding: 16, gap: 14 },
    panelHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    stateName: { ...type.label, fontWeight: '700' },
    account: { ...type.caption, fontFamily: font.mono, color: p.inkSub, marginLeft: 'auto' },
    stats: { flexDirection: 'row', gap: 12 },
    stat: { flex: 1, gap: 2 },
    statLabel: { ...type.caption, color: p.inkSub },
    statValue: { fontFamily: font.mono, fontWeight: '700', fontSize: 24, letterSpacing: -0.5, color: p.ink },
    statUnit: { fontFamily: font.sans, fontSize: 12, fontWeight: '400', letterSpacing: 0 },
    errorText: { ...type.label, fontWeight: '400' },
    signedOut: { gap: 4 },
    signedOutTitle: { fontWeight: '700', fontSize: 18, color: p.ink },
    signedOutSub: { ...type.label, fontWeight: '400', color: p.inkSub },
    buttons: { flexDirection: 'row', gap: 8 },
    main: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: size.button, borderRadius: radius.button, backgroundColor: p.accent },
    mainBusy: { backgroundColor: p.surface },
    mainText: { ...type.button },
    signOut: { height: size.button, borderRadius: radius.button, backgroundColor: p.surface, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
    signOutText: { ...type.small, color: p.inkSub },
    panelNote: { ...type.caption, color: p.inkSub },
    themes: { flexDirection: 'row', borderWidth: 1, borderColor: p.border, borderRadius: radius.button, backgroundColor: p.surface, overflow: 'hidden' },
    themeBtn: { width: 40, height: 34, alignItems: 'center', justifyContent: 'center' },
    themeBtnOn: { backgroundColor: p.accent },
    usage: { fontFamily: font.mono, fontSize: 12, color: p.ink, textAlign: 'right' },
    usageLabel: { fontFamily: font.sans, fontSize: 11, color: p.inkMuted },
    link: { ...type.small, color: p.accentText },
    footer: { alignItems: 'center', gap: 4, marginTop: 24 },
    version: { ...type.monoMeta, color: p.inkDone },
    privacy: { ...type.caption, color: p.accentText },
    scrim: { flex: 1, backgroundColor: p.scrim, justifyContent: 'flex-end' },
    sheet: { backgroundColor: p.surfaceBar, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderTopWidth: 1, borderColor: p.borderStrong, paddingTop: 10, paddingHorizontal: 16, paddingBottom: 30, gap: 12 },
    grip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: p.borderStrong },
    sheetTitle: { ...type.sheetTitle, color: p.ink },
    sheetBody: { ...type.small, color: p.inkSub },
    sheetDelete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48, borderRadius: radius.card, backgroundColor: p.danger },
    sheetCancel: { height: 44, alignItems: 'center', justifyContent: 'center' },
  });
