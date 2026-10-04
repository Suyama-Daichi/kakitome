import { getDb } from '../db';

/** この端末だけの設定（同期しない）。一覧の列数。sync_state に保存する */
export function getListColumns(): 1 | 2 {
  return getDb().getFirstSync<{ value: string }>("SELECT value FROM sync_state WHERE key = 'list_columns'")?.value === '2' ? 2 : 1;
}

export function setListColumns(n: 1 | 2) {
  getDb().runSync("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('list_columns', ?)", String(n));
}
