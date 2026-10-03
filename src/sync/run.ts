import { openCore } from '../db';
import { refreshWidget } from '../widget/refresh';
import { createDriveClient } from './drive';
import { getAccessToken } from './google-auth';
import { syncOnce } from './sync';

/** 手動・自動の同期を共通で実行する。失敗時は例外（次回の同期が再試行になる） */
export async function runSync(): Promise<void> {
  const { ctx, tx } = openCore();
  await syncOnce(ctx, createDriveClient(fetch, getAccessToken), tx);
  ctx.store.setState('last_sync_at', new Date().toISOString());
  refreshWidget();
}
