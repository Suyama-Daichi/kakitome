import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { completeReminder } from '../db/actions';
import { notifyDbChanged } from '../db/changes';
import { scheduler } from '../sync/auto';
import { ACTION_DONE, reconcileReminders } from './reconcile';

const ACTION_TASK = 'kakitome-notification-action';

/**
 * 通知の「完了」ボタン。単発のリマインドを無効にする（繰り返しは通知を消すだけ）。
 * 前面のリスナーと Android のバックグラウンドタスクの両方から届き得るが、completeReminder が冪等なので害はない
 */
export async function completeFromNotification(res: Notifications.NotificationResponse) {
  await Notifications.dismissNotificationAsync(res.notification.request.identifier).catch(() => {});
  const reminderId = res.notification.request.content.data?.reminderId;
  if (typeof reminderId !== 'string' || !completeReminder(reminderId)) return;
  notifyDbChanged(); // アプリが開いていれば、メモのリマインド欄・一覧のチップを更新する
  await reconcileReminders().catch(() => {});
  await scheduler.trigger();
}

// Android: アプリを開かないボタンは、アプリがバックグラウンド・停止中だとこのタスクに届く（ヘッドレス JS）。
// グローバルスコープで定義する必要があるため、ルートの index.ts から import される
TaskManager.defineTask<Notifications.NotificationTaskPayload>(ACTION_TASK, async ({ data }) => {
  if (data && 'actionIdentifier' in data && data.actionIdentifier === ACTION_DONE) await completeFromNotification(data);
});
if (Platform.OS === 'android') void Notifications.registerTaskAsync(ACTION_TASK).catch(() => {}); // iOS の「完了」はアプリを開くので不要
