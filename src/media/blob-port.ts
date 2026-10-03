import * as Crypto from 'expo-crypto';
import NetInfo from '@react-native-community/netinfo';
import type { BlobState } from '../core/uploads';
import { getDb } from '../db';
import type { BlobPort } from '../sync/blobs';
import { blobFile, deleteBlobFile, writeBlob } from './blobs';

const KEY = 'wifi_only';

/** 「画像は Wi-Fi 接続時のみ」設定。既定はオン（本体のみが対象。サムネイルと op は回線に関わらず送る） */
export const isWifiOnly = () =>
  (getDb().getFirstSync<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', KEY)?.value ?? '1') !== '0';
export const setWifiOnly = (on: boolean) =>
  getDb().runSync('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', KEY, on ? '1' : '0');

/** Wi-Fi／有線で、従量課金の回線でない */
async function onUnmeteredNetwork(): Promise<boolean> {
  const s = await NetInfo.fetch();
  return (s.type === 'wifi' || s.type === 'ethernet') && s.details.isConnectionExpensive !== true;
}

export async function bodiesAllowed(): Promise<boolean> {
  return !isWifiOnly() || (await onUnmeteredNetwork());
}

export const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

export function createBlobPort(): BlobPort {
  const db = getDb();
  return {
    attachments: () =>
      db.getAllSync<{ hash: string; thumb_hash: string }>('SELECT hash, thumb_hash FROM attachments WHERE deleted = 0').map((r) => ({ hash: r.hash, thumbHash: r.thumb_hash })),

    blobs: () => {
      const m = new Map<string, BlobState>();
      for (const r of db.getAllSync<{ hash: string; local: number; uploaded: number }>('SELECT hash, local_path IS NOT NULL AS local, uploaded FROM blobs')) {
        m.set(r.hash, { local: !!r.local, uploaded: !!r.uploaded });
      }
      return m;
    },

    markUploaded: (hash, remoteId) =>
      db.runSync(
        'INSERT INTO blobs (hash, uploaded, remote_id) VALUES (?, 1, ?) ON CONFLICT(hash) DO UPDATE SET uploaded = 1, remote_id = excluded.remote_id',
        hash, remoteId,
      ),

    // 他端末が送ったファイルの ID を知っただけ。自端末の「送信済み」にはしない（uploadBlob が既知の ID を見て済みにする）
    setRemote: (hash, remoteId) =>
      db.runSync('INSERT INTO blobs (hash, uploaded, remote_id) VALUES (?, 0, ?) ON CONFLICT(hash) DO UPDATE SET remote_id = excluded.remote_id', hash, remoteId),

    remoteId: (hash) => db.getFirstSync<{ remote_id: string | null }>('SELECT remote_id FROM blobs WHERE hash = ?', hash)?.remote_id ?? null,

    read: async (hash) => blobFile(hash).bytes(),

    save: async (hash, bytes) => {
      writeBlob(hash, bytes);
      db.runSync(
        "INSERT INTO blobs (hash, local_path, uploaded, last_used) VALUES (?, ?, 1, ?) ON CONFLICT(hash) DO UPDATE SET local_path = excluded.local_path, uploaded = 1, last_used = excluded.last_used",
        hash, `blobs/${hash}`, new Date().toISOString(),
      );
    },

    missingThumbs: () =>
      db
        .getAllSync<{ thumb_hash: string }>(
          `SELECT DISTINCT a.thumb_hash FROM attachments a WHERE a.deleted = 0 AND NOT EXISTS
             (SELECT 1 FROM blobs b WHERE b.hash = a.thumb_hash AND b.local_path IS NOT NULL)`,
        )
        .map((r) => r.thumb_hash),

    sha256: (bytes) => sha256Hex(bytes as Uint8Array<ArrayBuffer>),
    allowBodies: bodiesAllowed,

    now: () => Date.now(),

    attachmentsForGc: () =>
      db
        .getAllSync<{ hash: string; thumb_hash: string; deleted: number; at: number | null }>(
          `SELECT a.hash, a.thumb_hash, a.deleted, CAST(substr(fc.hlc, 1, 13) AS INTEGER) AS at
           FROM attachments a LEFT JOIN field_clocks fc
             ON fc.entity = 'attachment' AND fc.entity_id = a.id AND fc.field = 'deleted'`,
        )
        .map((r) => ({ hash: r.hash, thumbHash: r.thumb_hash, deleted: !!r.deleted, deletedAtMs: r.deleted ? r.at : null })),

    cacheBodies: () =>
      db
        .getAllSync<{ hash: string; size: number; lu: string; local: number; uploaded: number }>(
          `SELECT a.hash, MAX(a.size) AS size, COALESCE(b.last_used, '') AS lu,
             COALESCE(b.local_path IS NOT NULL, 0) AS local, COALESCE(b.uploaded, 0) AS uploaded
           FROM attachments a LEFT JOIN blobs b ON b.hash = a.hash GROUP BY a.hash`,
        )
        .map((r) => ({ hash: r.hash, size: r.size, lastUsed: Date.parse(r.lu) || 0, local: !!r.local, uploaded: !!r.uploaded })),

    evictLocal: async (hash) => {
      deleteBlobFile(hash);
      db.runSync('UPDATE blobs SET local_path = NULL WHERE hash = ?', hash);
    },

    dropBlob: async (hash) => {
      const b = db.getFirstSync<{ local: number; uploaded: number }>('SELECT local_path IS NOT NULL AS local, uploaded FROM blobs WHERE hash = ?', hash);
      if (b?.local && !b.uploaded) return; // 未アップロードの実体は消さない（CLAUDE.md の不変条件）
      deleteBlobFile(hash);
      db.runSync('DELETE FROM blobs WHERE hash = ?', hash);
    },

    forgetRemote: async (fileId) => {
      const b = db.getFirstSync<{ hash: string }>('SELECT hash FROM blobs WHERE remote_id = ?', fileId);
      if (!b) return;
      const live = db.getFirstSync(
        'SELECT 1 FROM attachments WHERE deleted = 0 AND (hash = ? OR thumb_hash = ?)', b.hash, b.hash,
      );
      if (live) {
        // 生きた添付が参照している: Drive から消えたので、端末に実体があれば再アップロードの対象に戻す
        db.runSync('UPDATE blobs SET remote_id = NULL, uploaded = 0 WHERE hash = ?', b.hash);
      } else {
        deleteBlobFile(b.hash);
        db.runSync('DELETE FROM blobs WHERE hash = ?', b.hash);
      }
    },

    getState: (key) => db.getFirstSync<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', key)?.value,
    setState: (key, value) => db.runSync('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', key, value),
  };
}

/** 表示したときに呼ぶ。ローカルキャッシュを古い順に消すときの基準（設計 §7.4） */
export const touchBlob = (hash: string) =>
  getDb().runSync('UPDATE blobs SET last_used = ? WHERE hash = ?', new Date().toISOString(), hash);

/** 端末に保存している画像（本体＋サムネイル）の合計バイト数 */
export function localImageBytes(): number {
  return getDb()
    .getAllSync<{ hash: string }>('SELECT hash FROM blobs WHERE local_path IS NOT NULL')
    .reduce((n, r) => n + (blobFile(r.hash).size ?? 0), 0);
}
