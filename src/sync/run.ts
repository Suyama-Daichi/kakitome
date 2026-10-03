import { notifyDbChanged } from '../db/changes';
import { fetch as expoFetch } from 'expo/fetch';
import { openCore } from '../db';
import { createBlobPort } from '../media/blob-port';
import { reconcileReminders } from '../notifications/reconcile';
import { refreshWidget } from '../widget/refresh';
import { createDriveClient } from './drive';
import { discardAccessToken, getAccessToken } from './google-auth';
import { syncOnce } from './sync';

// 画像のバイナリ（Uint8Array の送信・ArrayBuffer の受信）を扱えるよう expo/fetch を使う
export const makeDrive = () => createDriveClient(expoFetch as unknown as typeof fetch, getAccessToken, discardAccessToken);

/** 手動・自動・バックグラウンド共通の同期。失敗時は例外（次回の同期が再試行になる） */
export async function runSync(): Promise<void> {
  const { ctx, tx } = openCore();
  await syncOnce(ctx, makeDrive(), tx, createBlobPort());
  ctx.store.setState('last_sync_at', new Date().toISOString());
  ctx.store.setState('last_error', '');
  refreshWidget();
  notifyDbChanged();
  await reconcileReminders().catch(() => {}); // 他端末のリマインドを反映
}
