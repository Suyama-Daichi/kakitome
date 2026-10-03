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
