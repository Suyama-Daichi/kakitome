// 画像のアップロード順序（設計 §7.3）: サムネイル → op → 本体。
import type { Op } from './ops';

export interface BlobState {
  /** 端末に実体がある */
  local: boolean;
  /** Drive にある（アップロード済み、または他端末から取得済み） */
  uploaded: boolean;
}

export interface AttachmentRef {
  hash: string;
  thumbHash: string;
}

export interface UploadInput {
  /** 未送信の op（HLC 順） */
  unsentOps: Op[];
  /** 削除されていない添付 */
  attachments: AttachmentRef[];
  blobs: Map<string, BlobState>;
}

export interface UploadPlan {
  thumbs: string[];
  ops: Op[];
  bodies: string[];
}

/**
 * 今送ってよいものを返す。送信ごとに状態を更新して再計画する想定:
 * サムネイル送信 → 再計画 → op 送信 → 再計画 → 本体送信。
 */
export function planUploads({ unsentOps, attachments, blobs }: UploadInput): UploadPlan {
  const pending = (h: string) => {
    const s = blobs.get(h);
    return !!s && s.local && !s.uploaded;
  };
  const uniq = (xs: string[]) => [...new Set(xs)];

  const thumbs = uniq(attachments.map((a) => a.thumbHash).filter(pending));
  // 端末に記録の無い blob では止めない（永久に op を送れなくならないように）
  const ops = unsentOps.filter((o) => !(o.entity === 'attachment' && pending(String(o.fields.thumb_hash ?? ''))));
  // 本体は、それを参照するすべての添付のサムネイルが送信済み（または対象外）になってから
  const blocked = new Set(attachments.filter((a) => pending(a.thumbHash)).map((a) => a.hash));
  const bodies = uniq(attachments.map((a) => a.hash)).filter((h) => pending(h) && !blocked.has(h) && !thumbs.includes(h));
  return { thumbs, ops, bodies };
}
