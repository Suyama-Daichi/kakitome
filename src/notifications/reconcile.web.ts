// Web: リマインドの通知は鳴らさない（expo-notifications は Web 非対応）。日時の入力と同期は他の端末のために動く
export const ensureNotificationPermission = async () => true;
export const reconcileReminders = async () => {};
export const rescheduleAllReminders = async () => {};
export const reconcileSoon = () => {};
