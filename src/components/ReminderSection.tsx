import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { MaterialIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { nextOccurrence, reminderPresets } from '../core/reminders';
import { addReminder, deleteReminder, setReminderEnabled, updateReminder } from '../db/actions';
import { subscribeDbChanges } from '../db/changes';
import { listReminders, type ReminderView } from '../db/queries';
import { ensureNotificationPermission } from '../notifications/reconcile';
import { onLocalChange } from '../sync/auto';
import { notify } from '../ui/dialog';
import { radius, space, type, useThemed, type Palette } from '../ui/theme';

const REPEATS = [
  { label: 'なし', rrule: null },
  { label: '毎日', rrule: 'FREQ=DAILY' },
  { label: '毎週', rrule: 'FREQ=WEEKLY' },
  { label: '毎月', rrule: 'FREQ=MONTHLY' },
  { label: '毎年', rrule: 'FREQ=YEARLY' },
];

const repeatLabel = (rrule: string | null) => (rrule ? (REPEATS.find((r) => r.rrule === rrule)?.label ?? '繰り返し') : '1回');
const fmt = (d: Date) => d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** <input type="datetime-local"> の値（端末のローカル時刻） */
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** 既定は次の正時 */
function nextHour(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

/** 次に鳴る日時（繰り返しは次回）。無効、または鳴り終わった単発は null */
const nextFire = (r: ReminderView) =>
  r.enabled ? nextOccurrence({ id: r.id, noteId: '', fireAt: r.fire_at, timezone: r.timezone, rrule: r.rrule, enabled: true }, new Date()) : null;

function pickAndroid(value: Date, done: (d: Date) => void) {
  DateTimePickerAndroid.open({
    value, mode: 'date',
    onValueChange: (_, date) =>
      DateTimePickerAndroid.open({ value: date, mode: 'time', is24Hour: true, onValueChange: (_e, t) => done(t) }),
  });
}

/** startAdding: 通知の「スヌーズ」から開いたとき、新しいリマインドの入力欄を開いた状態で始める */
export function ReminderSection({ noteId, startAdding = false }: { noteId: string; startAdding?: boolean }) {
  const [p, styles] = useThemed(makeStyles);
  const [items, setItems] = useState<ReminderView[]>(() => listReminders(noteId));
  const reload = useCallback(() => setItems(listReminders(noteId)), [noteId]);
  const [draft, setDraft] = useState<{ id?: string; at: Date; rrule: string | null } | null>(() => (startAdding ? { at: nextHour(), rrule: null } : null));
  // 背景はフェード、シートだけ下から上げる（Modal の slide は背景ごと動くため）
  const open = !!draft;
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!open) return;
    rise.setValue(0);
    Animated.timing(rise, { toValue: 1, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [open, rise]);
  // シートを下げてから閉じる（先に消すと背景だけが残る）
  const close = () => Animated.timing(rise, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setDraft(null));
  // 「完了」ボタンなど、画面の外で変わったリマインドを反映する
  useEffect(() => subscribeDbChanges(reload), [reload]);

  const save = async () => {
    if (!draft) return;
    if (!(await ensureNotificationPermission())) {
      notify('通知が許可されていません', 'リマインドを鳴らすには、設定アプリで kakitome の通知を許可してください。リマインド自体は保存されます。');
    }
    if (draft.id) updateReminder(draft.id, draft.at, draft.rrule);
    else addReminder(noteId, draft.at, draft.rrule);
    close();
    reload();
    onLocalChange();
  };

  // 単発で過去の日時は鳴らないので登録させない（繰り返しは次回から鳴る）
  const past = !!draft && !draft.rrule && draft.at.getTime() <= Date.now();

  return (
    <View style={styles.box}>
      <Text style={styles.heading}>リマインド</Text>
      {items.map((r) => {
        const next = nextFire(r);
        return (
          <View key={r.id} style={styles.row}>
            <Pressable style={styles.whenBox} onPress={() => setDraft({ id: r.id, at: next ?? new Date(r.fire_at), rrule: r.rrule })} accessibilityLabel="リマインドを編集">
              <Text style={[styles.when, next ? null : styles.off]}>
                {fmt(next ?? new Date(r.fire_at))}　{repeatLabel(r.rrule)}{r.enabled && !next ? '　済' : ''}
              </Text>
            </Pressable>
            <Switch value={!!r.enabled} trackColor={{ true: p.accent, false: p.border }} thumbColor={p.ink} onValueChange={(v) => { setReminderEnabled(r.id, v); reload(); onLocalChange(); }} />
            <Pressable onPress={() => { deleteReminder(r.id); reload(); onLocalChange(); }} hitSlop={8} accessibilityLabel="リマインドを削除">
              <MaterialIcons name="close" size={18} color={p.inkDone} />
            </Pressable>
          </View>
        );
      })}
      <Pressable onPress={() => setDraft({ at: nextHour(), rrule: null })}>
        <View style={styles.addRow}><MaterialIcons name="alarm-add" size={20} color={p.accentText} /><Text style={styles.add}>リマインドを追加</Text></View>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.scrim} onPress={close}>
          {draft ? (
            <Animated.View style={{ transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }] }}>
              <Pressable style={styles.sheet}>
                <View style={styles.grip} />
                <Text style={styles.sheetTitle}>{draft.id ? 'リマインドを編集' : 'リマインドを追加'}</Text>
                <View style={styles.chips}>
                  {reminderPresets(new Date()).map((ps) => (
                    <Pressable key={ps.label} style={[styles.chip, draft.at.getTime() === ps.at.getTime() ? styles.chipOn : null]} onPress={() => setDraft({ ...draft, at: ps.at })}>
                      <Text style={[styles.chipText, draft.at.getTime() === ps.at.getTime() ? styles.chipOnText : null]}>{ps.label}</Text>
                    </Pressable>
                  ))}
                </View>
                {Platform.OS === 'web' ? (
                  <input
                    type="datetime-local"
                    value={toLocalInput(draft.at)}
                    onChange={(e) => { const at = new Date(e.target.value); if (!isNaN(at.getTime())) setDraft({ ...draft, at }); }}
                    style={{ font: 'inherit', padding: 8, borderRadius: 8, border: `1px solid ${p.borderControl}`, background: p.surface, color: p.reminderFg, alignSelf: 'flex-start' }}
                  />
                ) : (
                  <Pressable onPress={() => Platform.OS === 'android' && pickAndroid(draft.at, (at) => setDraft({ ...draft, at }))}>
                    <Text style={styles.dateButton}>{fmt(draft.at)}</Text>
                  </Pressable>
                )}
                {__DEV__ ? (
                  <Pressable onPress={() => setDraft({ ...draft, at: new Date(Date.now() + 90_000) })}>
                    <Text style={styles.hint}>（開発用）90秒後にする</Text>
                  </Pressable>
                ) : null}
                {Platform.OS === 'ios' ? <DateTimePicker value={draft.at} mode="datetime" onValueChange={(_, at) => setDraft({ ...draft, at })} /> : null}
                <View style={styles.chips}>
                  {REPEATS.map((r) => (
                    <Pressable key={r.label} style={[styles.chip, draft.rrule === r.rrule ? styles.chipOn : null]} onPress={() => setDraft({ ...draft, rrule: r.rrule })}>
                      <Text style={[styles.chipText, draft.rrule === r.rrule ? styles.chipOnText : null]}>{r.label}</Text>
                    </Pressable>
                  ))}
                </View>
                {past ? <Text style={styles.warn}>過去の日時です。未来の日時を選んでください。</Text> : null}
                {draft.rrule ? <Text style={styles.hint}>繰り返しは、選んだ時刻（毎週は曜日、毎月は日）に合う次の時刻から始まります。</Text> : null}
                <View style={styles.actions}>
                  <Pressable onPress={close}><Text style={styles.cancel}>キャンセル</Text></Pressable>
                  <Pressable onPress={save} disabled={past}><Text style={[styles.add, past ? styles.off : null]}>{draft.id ? '保存' : '追加'}</Text></Pressable>
                </View>
              </Pressable>
            </Animated.View>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    box: { backgroundColor: p.surface, borderColor: p.border, borderWidth: 1, borderRadius: radius.card, paddingVertical: 10, paddingHorizontal: space.cardPad, gap: 8 },
    heading: { ...type.label, color: p.inkFaint },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    whenBox: { flex: 1, paddingVertical: 4 },
    when: { ...type.monoMeta, fontSize: 14, color: p.reminderFg },
    off: { color: p.inkDone },
    scrim: { flex: 1, backgroundColor: p.scrim, justifyContent: 'flex-end' },
    sheet: { backgroundColor: p.surfaceBar, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderTopWidth: 1, borderColor: p.borderStrong, paddingTop: 10, paddingHorizontal: 16, paddingBottom: 30, gap: 12 },
    grip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: p.borderStrong },
    sheetTitle: { ...type.sheetTitle, color: p.ink },
    dateButton: { ...type.monoValue, color: p.reminderFg, paddingVertical: 6 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.button, borderWidth: 1, borderColor: p.borderControl },
    chipOn: { backgroundColor: p.accent, borderColor: p.accent },
    chipText: { ...type.item, color: p.inkSub },
    chipOnText: { color: p.onAccent },
    warn: { ...type.caption, color: p.dangerFg },
    hint: { ...type.caption, color: p.inkMuted },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24, paddingTop: 4 },
    cancel: { ...type.button, color: p.inkSub },
    add: { ...type.item, fontWeight: '500', color: p.accentText },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  });
