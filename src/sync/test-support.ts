import { createHash } from 'crypto';
import type { CacheBody, GcAttachment } from '../core/blobgc';
import { createClock, parseHlc } from '../core/hlc';
import { applyLocalOp, type Ctx } from '../core/merge';
import { MemoryStore } from '../core/store';
import type { BlobState } from '../core/uploads';
import type { BlobPort } from './blobs';

// テスト用: メモリ上の BlobPort と、端末・画像添付の補助
export const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export class MemoryBlobPort implements BlobPort {
  files = new Map<string, Uint8Array>();
  uploaded = new Set<string>();
  remote = new Map<string, string>();
  constructor(private store: MemoryStore) {}
  attachments() {
    return Object.values(this.store.snapshot().attachment ?? {})
      .filter((a) => a.deleted !== 1)
      .map((a) => ({ hash: a.hash as string, thumbHash: a.thumb_hash as string }));
  }
  blobs() {
    const m = new Map<string, BlobState>();
    for (const h of new Set([...this.files.keys(), ...this.uploaded])) m.set(h, { local: this.files.has(h), uploaded: this.uploaded.has(h) });
    return m;
  }
  markUploaded(h: string, id: string) { this.uploaded.add(h); this.remote.set(h, id); }
  setRemote(h: string, id: string) { this.remote.set(h, id); }
  remoteId = (h: string) => this.remote.get(h) ?? null;
  read = async (h: string) => this.files.get(h)!;
  async save(h: string, b: Uint8Array) { this.files.set(h, b); this.uploaded.add(h); }
  missingThumbs() { return this.attachments().map((a) => a.thumbHash).filter((h) => !this.files.has(h)); }
  sha256 = async (b: Uint8Array) => sha(b);

  time = 1_000_000_000_000;
  lastUsed = new Map<string, number>();
  state = new Map<string, string>();
  now = () => this.time;
  attachmentsForGc(): GcAttachment[] {
    return Object.entries(this.store.snapshot().attachment ?? {}).map(([id, a]) => ({
      hash: a.hash as string,
      thumbHash: a.thumb_hash as string,
      deleted: a.deleted === 1,
      deletedAtMs: a.deleted === 1 ? parseHlc(this.store.getField('attachment', id, 'deleted')!.hlc).ms : null,
    }));
  }
  cacheBodies(): CacheBody[] {
    const seen = new Map<string, CacheBody>();
    for (const a of Object.values(this.store.snapshot().attachment ?? {})) {
      const hash = a.hash as string;
      seen.set(hash, { hash, size: a.size as number, lastUsed: this.lastUsed.get(hash) ?? 0, local: this.files.has(hash), uploaded: this.uploaded.has(hash) });
    }
    return [...seen.values()];
  }
  async evictLocal(h: string) { this.files.delete(h); }
  async dropBlob(h: string) {
    if (this.files.has(h) && !this.uploaded.has(h)) return;
    this.files.delete(h);
    this.uploaded.delete(h);
    this.remote.delete(h);
  }
  async forgetRemote(fileId: string) {
    const h = [...this.remote].find(([, id]) => id === fileId)?.[0];
    if (!h) return;
    const live = this.attachments().some((a) => a.hash === h || a.thumbHash === h);
    this.remote.delete(h);
    if (live) this.uploaded.delete(h);
    else {
      this.files.delete(h);
      this.uploaded.delete(h);
    }
  }
  getState = (k: string) => this.state.get(k);
  setState(k: string, v: string) { this.state.set(k, v); }
}

let seq = 0;
export function device(name: string, time: { t: number }) {
  const store = new MemoryStore();
  const ctx: Ctx & { store: MemoryStore } = { store, clock: createClock(name, () => time.t), newId: () => `op-${String(++seq).padStart(6, '0')}` };
  return { ctx, port: new MemoryBlobPort(store) };
}
export const bytes = (n: number) => Uint8Array.from({ length: 64 }, (_, i) => (n * 31 + i) % 256);

/** 端末に画像（本体＋サムネイル）を取り込んだことにする */
export function attach(d: ReturnType<typeof device>, noteId: string, n: number) {
  const body = bytes(n);
  const thumb = bytes(n + 1000);
  d.port.files.set(sha(body), body);
  d.port.files.set(sha(thumb), thumb);
  applyLocalOp(d.ctx, 'attachment', `att-${n}`, { note_id: noteId, hash: sha(body), thumb_hash: sha(thumb), mime: 'image/jpeg', width: 1, height: 1, size: 64, sort_key: String(n), deleted: 0 });
  return { body, thumb, bodyHash: sha(body), thumbHash: sha(thumb) };
}
