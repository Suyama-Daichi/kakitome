import { getDb } from '../db';

// Web: ファイルシステムが無いので、画像の実体は SQLite（OPFS に保存される）の blob_data に持つ。
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

export function blobFile(hash: string) {
  const read = () => table().getFirstSync<{ data: Uint8Array }>('SELECT data FROM blob_data WHERE hash = ?', hash)?.data;
  return {
    bytes: async () => read() ?? new Uint8Array(),
    get size() { return table().getFirstSync<{ n: number }>('SELECT length(data) AS n FROM blob_data WHERE hash = ?', hash)?.n ?? null; },
    /** <img> に渡せる URL（hash は内容そのものなので、一度作れば使い回せる） */
    get uri() {
      let u = urls.get(hash);
      if (!u) {
        u = URL.createObjectURL(new Blob([(read() ?? new Uint8Array()) as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }));
        urls.set(hash, u);
      }
      return u;
    },
  };
}

export function writeBlob(hash: string, bytes: Uint8Array): void {
  table().runSync('INSERT OR REPLACE INTO blob_data (hash, data) VALUES (?, ?)', hash, bytes);
  const u = urls.get(hash);
  if (u) URL.revokeObjectURL(u);
  urls.delete(hash);
}

export function deleteBlobFile(hash: string): void {
  table().runSync('DELETE FROM blob_data WHERE hash = ?', hash);
  const u = urls.get(hash);
  if (u) URL.revokeObjectURL(u);
  urls.delete(hash);
}
