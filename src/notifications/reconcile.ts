import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { planReminders, type Trigger } from '../core/reminders';
import { getDb } from '../db';
import { reminderInputs, scheduledNotifications } from '../db/queries';

const CHANNEL = 'reminders';
const T = Notifications.SchedulableTriggerInputTypes;

// 他端末の同期で届いたリマインドも鳴らす（全端末で鳴らす: 設計 §9）。アプリ前面でも表示する
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

function toExpoTrigger(t: Trigger): Notifications.NotificationTriggerInput {
  const base = Platform.OS === 'android' ? { channelId: CHANNEL } : {};
  switch (t.type) {
    case 'date': return { type: T.DATE, date: new Date(t.at), ...base };
    case 'daily': return { type: T.DAILY, hour: t.hour, minute: t.minute, ...base };
    case 'weekly': return { type: T.WEEKLY, weekday: t.weekday + 1, hour: t.hour, minute: t.minute, ...base }; // expo は 1=日曜
    case 'monthly': return { type: T.MONTHLY, day: t.day, hour: t.hour, minute: t.minute, ...base };
    case 'yearly': return { type: T.YEARLY, month: t.month - 1, day: t.day, hour: t.hour, minute: t.minute, ...base }; // expo は 0 始まり
  }
}

/** 通知の許可を確認し、未許可なら（聞き直せる場合のみ）求める */
export async function ensureNotificationPermission(): Promise<boolean> {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  if (!cur.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

let chain: Promise<unknown> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined;

/** DB のリマインドと OS の予約を突き合わせる（設計 §9）。呼び出しは直列化される */
export function reconcileReminders(now = new Date()): Promise<void> {
  const next = chain.then(() => doReconcile(now));
  chain = next.catch(() => {});
  return next;
}

/** ローカル編集のたびに呼ぶ。入力が落ち着いてから 1 回だけ調停 */
export function reconcileSoon(ms = 1500) {
  clearTimeout(timer);
  timer = setTimeout(() => void reconcileReminders().catch(() => {}), ms);
}

async function doReconcile(now: Date) {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'リマインド', importance: Notifications.AndroidImportance.HIGH });
  }
  if (!(await Notifications.getPermissionsAsync()).granted) return; // 許可後の次の調停で予約される

  const db = getDb();
  const { reminders, notes } = reminderInputs();
  const scheduled = scheduledNotifications();
  const plan = planReminders({ reminders, notes, scheduled, now });

  for (const c of plan.cancel) {
    await Notifications.cancelScheduledNotificationAsync(c.notificationId);
    db.runSync('DELETE FROM scheduled_notifications WHERE reminder_id = ?', c.reminderId);
  }
  for (const d of plan.schedule) {
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: d.title, body: d.body, data: { noteId: d.noteId } },
      trigger: toExpoTrigger(d.trigger),
    });
    db.runSync('INSERT OR REPLACE INTO scheduled_notifications (reminder_id, notification_id, fire_at) VALUES (?, ?, ?)', d.reminderId, id, d.signature);
  }

  // 記録の無い予約（予約直後にクラッシュした等）は取り消す
  const known = new Set(scheduledNotifications().map((s) => s.notificationId));
  for (const n of await Notifications.getAllScheduledNotificationsAsync()) {
    if (!known.has(n.identifier)) await Notifications.cancelScheduledNotificationAsync(n.identifier);
  }
}
