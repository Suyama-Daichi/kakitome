// 画像 blob の後始末（設計 §7.4）。Drive 上の不要な blob の削除と、ローカルキャッシュの削除。

export interface GcAttachment {
  hash: string;
  thumbHash: string;
  deleted: boolean;
  /** 削除（墓標）の時刻。分からなければ null */
  deletedAtMs: number | null;
}

/**
 * Drive から削除してよい blob。
 * その blob を参照する添付が 1 件以上あり、すべて削除済みで、最後の削除から graceMs 以上経っているもの。
 * 参照が 1 件も無い blob は、まだ届いていない op が参照しているかもしれないので対象にしない。
 */
export function planBlobGc({ attachments, now, graceMs }: { attachments: GcAttachment[]; now: number; graceMs: number }): string[] {
  const refs = new Map<string, GcAttachment[]>();
  for (const a of attachments) for (const h of new Set([a.hash, a.thumbHash])) (refs.get(h) ?? refs.set(h, []).get(h)!).push(a);
  const out: string[] = [];
  for (const [h, list] of refs) {
    if (list.every((a) => a.deleted && a.deletedAtMs !== null && now - a.deletedAtMs >= graceMs)) out.push(h);
  }
  return out;
}

export interface CacheBody {
  hash: string;
  size: number;
  lastUsed: number;
  /** 端末に実体がある */
  local: boolean;
  /** Drive にある（消しても再取得できる） */
  uploaded: boolean;
}

/**
 * 端末に保存している画像本体が上限を超えたとき、最後に使った時刻が古い順に消すものを返す。
 * 未アップロードの本体は絶対に消さない（再取得できないため）。サムネイルは対象外（小さいので常に保持）。
 */
export function planCacheEviction({ bodies, limitBytes }: { bodies: CacheBody[]; limitBytes: number }): string[] {
  let total = bodies.filter((b) => b.local).reduce((n, b) => n + b.size, 0);
  const candidates = bodies
    .filter((b) => b.local && b.uploaded)
    .sort((a, b) => a.lastUsed - b.lastUsed || (a.hash < b.hash ? -1 : 1));
  const out: string[] = [];
  for (const c of candidates) {
    if (total <= limitBytes) break;
    out.push(c.hash);
    total -= c.size;
  }
  return out;
}
