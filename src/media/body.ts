import { downloadBlob } from '../sync/blobs';
import { makeDrive } from '../sync/run';
import { bodiesAllowed, createBlobPort } from './blob-port';

export type BodyResult = 'ready' | 'wifi' | 'unavailable';

/**
 * 本体を表示するために取得する（遅延ダウンロード）。
 * 「Wi-Fi 接続時のみ」の設定に従い、許可されない回線では取得しない。
 */
export async function ensureBody(hash: string): Promise<BodyResult> {
  const port = createBlobPort();
  if (port.blobs().get(hash)?.local) return 'ready';
  if (!(await bodiesAllowed())) return 'wifi';
  try {
    return (await downloadBlob(makeDrive(), port, hash)) ? 'ready' : 'unavailable'; // Drive 上に未着ならこの後の同期で拾う
  } catch {
    return 'unavailable';
  }
}
