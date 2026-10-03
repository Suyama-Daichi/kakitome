import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { MaterialIcons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { addReminder, deleteReminder, setReminderEnabled } from '../db/actions';
import { listReminders, type ReminderView } from '../db/queries';
import { ensureNotificationPermission } from '../notifications/reconcile';
import { onLocalChange } from '../sync/auto';
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

/** 既定は次の正時 */
function nextHour(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

function pickAndroid(value: Date, done: (d: Date) => void) {
  DateTimePickerAndroid.open({
    value, mode: 'date',
    onChange: (e, date) => {
      if (e.type !== 'set' || !date) return;
      DateTimePickerAndroid.open({
        value: date, mode: 'time', is24Hour: true,
        onChange: (e2, t) => { if (e2.type === 'set' && t) done(t); },
      });
    },
  });
}

export function ReminderSection({ noteId }: { noteId: string }) {
  const [p, styles] = useThemed(makeStyles);
  const [items, setItems] = useState<ReminderView[]>(() => listReminders(noteId));
  const reload = useCallback(() => setItems(listReminders(noteId)), [noteId]);
  const [draft, setDraft] = useState<{ at: Date; rrule: string | null } | null>(null);

  const save = async () => {
    if (!draft) return;
    if (!(await ensureNotificationPermission())) {
      Alert.alert('通知が許可されていません', 'リマインドを鳴らすには、設定アプリで kakitome の通知を許可してください。リマインド自体は保存されます。');
    }
    addReminder(noteId, draft.at, draft.rrule);
    setDraft(null);
    reload();
    onLocalChange();
  };

  return (
    <View style={styles.box}>
      <Text style={styles.heading}>リマインド</Text>
      {items.map((r) => (
        <View key={r.id} style={styles.row}>
          <Text style={[styles.when, r.enabled ? null : styles.off]}>{fmt(new Date(r.fire_at))}　{repeatLabel(r.rrule)}</Text>
          <Switch value={!!r.enabled} trackColor={{ true: p.accent, false: p.border }} thumbColor={p.ink} onValueChange={(v) => { setReminderEnabled(r.id, v); reload(); onLocalChange(); }} />
          <Pressable onPress={() => { deleteReminder(r.id); reload(); onLocalChange(); }} hitSlop={8} accessibilityLabel="リマインドを削除">
            <MaterialIcons name="close" size={18} color={p.inkDone} />
          </Pressable>
        </View>
      ))}
      {draft ? (
        <View style={styles.draft}>
          <Pressable onPress={() => Platform.OS === 'android' && pickAndroid(draft.at, (at) => setDraft({ ...draft, at }))}>
            <Text style={styles.dateButton}>{fmt(draft.at)}</Text>
          </Pressable>
          {__DEV__ ? (
            <Pressable onPress={() => setDraft({ ...draft, at: new Date(Date.now() + 90_000) })}>
              <Text style={styles.hint}>（開発用）90秒後にする</Text>
            </Pressable>
          ) : null}
          {Platform.OS === 'ios' ? <DateTimePicker value={draft.at} mode="datetime" onChange={(_, at) => at && setDraft({ ...draft, at })} /> : null}
          <View style={styles.chips}>
            {REPEATS.map((r) => (
              <Pressable key={r.label} style={[styles.chip, draft.rrule === r.rrule ? styles.chipOn : null]} onPress={() => setDraft({ ...draft, rrule: r.rrule })}>
                <Text style={[styles.chipText, draft.rrule === r.rrule ? styles.chipOnText : null]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
          {draft.rrule ? <Text style={styles.hint}>繰り返しは、選んだ時刻（毎週は曜日、毎月は日）に合う次の時刻から始まります。</Text> : null}
          <View style={styles.actions}>
            <Pressable onPress={() => setDraft(null)}><Text style={styles.cancel}>キャンセル</Text></Pressable>
            <Pressable onPress={save}><Text style={styles.add}>追加</Text></Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setDraft({ at: nextHour(), rrule: null })}>
          <View style={styles.addRow}><MaterialIcons name="alarm-add" size={20} color={p.accentText} /><Text style={styles.add}>リマインドを追加</Text></View>
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    box: { backgroundColor: p.surface, borderColor: p.border, borderWidth: 1, borderRadius: radius.card, paddingVertical: 10, paddingHorizontal: space.cardPad, gap: 8 },
    heading: { ...type.label, color: p.inkFaint },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    when: { ...type.monoMeta, fontSize: 14, color: p.reminderFg, flex: 1 },
    off: { color: p.inkDone },
    draft: { gap: 10 },
    dateButton: { ...type.monoValue, color: p.reminderFg, paddingVertical: 6 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.button, borderWidth: 1, borderColor: p.borderControl },
    chipOn: { backgroundColor: p.accent, borderColor: p.accent },
    chipText: { ...type.item, color: p.inkSub },
    chipOnText: { color: p.onAccent },
    hint: { ...type.caption, color: p.inkMuted },
    actions: { flexDirection: 'row', gap: 24 },
    cancel: { ...type.button, color: p.inkSub },
    add: { ...type.item, fontWeight: '500', color: p.accentText },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  });
