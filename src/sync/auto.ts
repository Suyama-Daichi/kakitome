import { AppState } from 'react-native';
import { getDb } from '../db';
import { reconcileSoon } from '../notifications/reconcile';
import { refreshWidget } from '../widget/refresh';
import { isSignedIn } from './google-auth';
import { runSync } from './run';
import { createSyncScheduler } from './scheduler';

export const scheduler = createSyncScheduler({
  run: runSync,
  enabled: isSignedIn,
  debounceMs: 5000,
  // 通信エラーなどはユーザーに見せず次のトリガーで再試行。設定画面で確認できるよう記録だけする
  onError: (e) =>
    getDb().runSync("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_error', ?)", e instanceof Error ? e.message : String(e)),
});

/** ローカルの変更後に呼ぶ: ウィジェットを更新し、リマインドを調停し、入力が止まったら同期する */
export function onLocalChange() {
  refreshWidget();
  reconcileSoon(); // 通知の本文（タイトル・未完了項目）やリマインドの変更を反映
  scheduler.schedule();
}

/** 起動時とフォアグラウンド復帰時に同期する */
export function startAutoSync(): () => void {
  void scheduler.trigger();
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') {
      refreshWidget(); // iOS: ウィジェットで押したチェックを取り込む
      void scheduler.trigger();
    }
  });
  return () => {
    sub.remove();
    scheduler.dispose();
  };
}
