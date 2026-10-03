import * as Crypto from 'expo-crypto';
import NetInfo from '@react-native-community/netinfo';
import type { BlobState } from '../core/uploads';
import { getDb } from '../db';
import type { BlobPort } from '../sync/blobs';
import { blobFile, writeBlob } from './blobs';

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
  };
}
