import { planBlobGc, planCacheEviction, type CacheBody, type GcAttachment } from '../core/blobgc';
import type { BlobState } from '../core/uploads';
import type { DriveClient } from './drive';

/** 画像 blob の保存先・状態・回線判定。RN 実装は src/media/blob-port.ts、テストはメモリ実装 */
export interface BlobPort {
  /** 削除されていない添付 */
  attachments(): { hash: string; thumbHash: string }[];
  blobs(): Map<string, BlobState>;
  /** 端末に実体があり Drive に送ったと記録する */
  markUploaded(hash: string, remoteId: string): void;
  /** Drive 上のファイル ID を知った（他端末が送ったもの） */
  setRemote(hash: string, remoteId: string): void;
  remoteId(hash: string): string | null;
  read(hash: string): Promise<Uint8Array>;
  /** 検証済みのバイト列を端末に保存し、取得済み（Drive にある）として登録する */
  save(hash: string, bytes: Uint8Array): Promise<void>;
  /** 削除されていない添付のサムネイルで、端末に無いもの */
  missingThumbs(): string[];
  sha256(bytes: Uint8Array): Promise<string>;
  /** 「Wi-Fi 接続時のみ」設定と回線から、本体を今送受信してよいか */
  allowBodies(): Promise<boolean>;

  // --- 後始末（設計 §7.4）
  now(): number;
  /** 削除済みも含む全添付（blob の参照関係と削除時刻） */
  attachmentsForGc(): GcAttachment[];
  /** 本体の一覧（サイズ・最終利用・端末にあるか・Drive にあるか） */
  cacheBodies(): CacheBody[];
  /** 端末の実体だけ消す（記録と Drive 上の ID は残す。後で再取得できる） */
  evictLocal(hash: string): Promise<void>;
  /** 不要になった blob を端末から消す。未アップロードの実体は消さない */
  dropBlob(hash: string): Promise<void>;
  /** Drive 上のファイルが消えた。生きた添付が参照していれば再アップロードの対象に戻し、参照が無ければ端末からも消す */
  forgetRemote(fileId: string): Promise<void>;
  getState(key: string): string | undefined;
  setState(key: string, value: string): void;
}

const DAY = 86_400_000;
export const BLOB_GRACE_MS = 30 * DAY; // 墓標から 30 日（設計 §7.4 の例）
export const CACHE_LIMIT_BYTES = 500 * 1024 * 1024;

/**
 * Drive 上の不要な blob を削除する（1 日 1 回まで）。
 * 削除した端末は実体も消し、他端末は changes の削除通知で forgetRemote する。
 */
export async function collectGarbage(drive: DriveClient, port: BlobPort, opts: { graceMs?: number; force?: boolean } = {}): Promise<void> {
  const last = Number(port.getState('last_blob_gc') ?? 0);
  if (!opts.force && port.now() - last < DAY) return;
  const dead = planBlobGc({ attachments: port.attachmentsForGc(), now: port.now(), graceMs: opts.graceMs ?? BLOB_GRACE_MS });
  for (const h of dead) {
    const id = port.remoteId(h);
    if (!id) continue; // Drive 上の場所が分からないものは触らない
    await drive.deleteFile(id);
    await port.dropBlob(h);
  }
  port.setState('last_blob_gc', String(port.now()));
}

/** 端末内の画像本体が上限を超えていたら、古いものから消す（Drive から再取得できる分だけ） */
export async function trimCache(port: BlobPort, limitBytes = CACHE_LIMIT_BYTES): Promise<void> {
  for (const h of planCacheEviction({ bodies: port.cacheBodies(), limitBytes })) await port.evictLocal(h);
}

export const blobName = (hash: string) => `blob_${hash}`;

export async function uploadBlob(drive: DriveClient, port: BlobPort, hash: string): Promise<void> {
  const known = port.remoteId(hash);
  if (known) return port.markUploaded(hash, known); // 他端末が先に送っていた（内容アドレス方式なので同じ中身）
  const file = await drive.createBlob({ name: blobName(hash), appProperties: { kind: 'blob', hash } }, await port.read(hash));
  port.markUploaded(hash, file.id);
}

/**
 * Drive から blob を取得して、ハッシュを検証してから保存する。
 * 内容が一致しないものは保存しない（壊れたファイルを信用しない）。
 */
export async function downloadBlob(drive: DriveClient, port: BlobPort, hash: string): Promise<boolean> {
  const id = port.remoteId(hash);
  if (!id) return false; // まだ Drive 上に見つかっていない。次回の同期で再試行
  const bytes = await drive.downloadBytes(id);
  if ((await port.sha256(bytes)) !== hash) return false;
  await port.save(hash, bytes);
  return true;
}
