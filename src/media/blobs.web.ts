import { getDb } from '../db';

// Web: ファイルシステムが無いので、画像の実体は SQLite（OPFS に保存される）の blob_data に持つ。
// 同期 API は結果が約 1MB までなので、画像の読み書きは非同期 API で行う。
// ponytail: 画像が増えると DB が太る。問題になれば OPFS のファイルへ分ける
let ready = false;
const table = () => {
  const db = getDb();
  if (!ready) {
    db.execSync('CREATE TABLE IF NOT EXISTS blob_data (hash TEXT PRIMARY KEY, data BLOB NOT NULL)');
    ready = true;
  }
  return db;
};

const urls = new Map<string, string>();
const forget = (hash: string) => {
  const u = urls.get(hash);
  if (u) URL.revokeObjectURL(u);
  urls.delete(hash);
};

export function blobFile(hash: string) {
  return {
    bytes: async () => (await table().getFirstAsync<{ data: Uint8Array }>('SELECT data FROM blob_data WHERE hash = ?', hash))?.data ?? new Uint8Array(),
    get size() { return table().getFirstSync<{ n: number }>('SELECT length(data) AS n FROM blob_data WHERE hash = ?', hash)?.n ?? null; },
  };
}

/** <img> に渡せる URL（hash は内容そのものなので、一度作れば使い回せる）。実体が無ければ null */
export async function blobUri(hash: string): Promise<string | null> {
  const cached = urls.get(hash);
  if (cached) return cached;
  const row = await table().getFirstAsync<{ data: Uint8Array }>('SELECT data FROM blob_data WHERE hash = ?', hash);
  if (!row) return null;
  const u = URL.createObjectURL(new Blob([row.data as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }));
  urls.set(hash, u);
  return u;
}

export async function writeBlob(hash: string, bytes: Uint8Array): Promise<void> {
  await table().runAsync('INSERT OR REPLACE INTO blob_data (hash, data) VALUES (?, ?)', hash, bytes);
  forget(hash);
}

export function deleteBlobFile(hash: string): void {
  table().runSync('DELETE FROM blob_data WHERE hash = ?', hash);
  forget(hash);
}
