import { downloadBlob } from '../sync/blobs';
import { makeDrive } from '../sync/run';
import { createBlobPort, touchBlob } from './blob-port';

export type BodyResult = 'ready' | 'unavailable';

/**
 * 本体を表示するために取得する（遅延ダウンロード）。
 */
export async function ensureBody(hash: string): Promise<BodyResult> {
  const port = createBlobPort();
  if (port.blobs().get(hash)?.local) {
    touchBlob(hash);
    return 'ready';
  }
  try {
    if (!(await downloadBlob(makeDrive(), port, hash))) return 'unavailable'; // Drive 上に未着ならこの後の同期で拾う
    touchBlob(hash);
    return 'ready';
  } catch {
    return 'unavailable';
  }
}
