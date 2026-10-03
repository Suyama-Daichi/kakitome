import { createHash } from 'crypto';
import fc from 'fast-check';
import { createClock } from '../core/hlc';
import { applyLocalOp, type Ctx } from '../core/merge';
import type { BlobState } from '../core/uploads';
import { MemoryStore } from '../core/store';
import { downloadBlob, type BlobPort } from './blobs';
import { FakeDrive } from './fake-drive';
import { syncOnce } from './sync';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

class MemoryBlobPort implements BlobPort {
  files = new Map<string, Uint8Array>();
  uploaded = new Set<string>();
  remote = new Map<string, string>();
  wifi = true;
  wifiOnly = true;
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
  allowBodies = async () => !this.wifiOnly || this.wifi;
}

let seq = 0;
function device(name: string, time: { t: number }) {
  const store = new MemoryStore();
  const ctx: Ctx & { store: MemoryStore } = { store, clock: createClock(name, () => time.t), newId: () => `op-${String(++seq).padStart(6, '0')}` };
  return { ctx, port: new MemoryBlobPort(store) };
}
const bytes = (n: number) => Uint8Array.from({ length: 64 }, (_, i) => (n * 31 + i) % 256);

/** 端末に画像（本体＋サムネイル）を取り込んだことにする */
function attach(d: ReturnType<typeof device>, noteId: string, n: number) {
  const body = bytes(n);
  const thumb = bytes(n + 1000);
  d.port.files.set(sha(body), body);
  d.port.files.set(sha(thumb), thumb);
  applyLocalOp(d.ctx, 'attachment', `att-${n}`, { note_id: noteId, hash: sha(body), thumb_hash: sha(thumb), mime: 'image/jpeg', width: 1, height: 1, size: 64, sort_key: String(n), deleted: 0 });
  return { body, thumb, bodyHash: sha(body), thumbHash: sha(thumb) };
}
const sync = (d: ReturnType<typeof device>, drive: FakeDrive) => syncOnce(d.ctx, drive, undefined, d.port);
const names = (drive: FakeDrive) => drive.log.map((id) => drive.files.get(id)!.file.name);

test('アップロード順は サムネイル → op → 本体', async () => {
  const time = { t: 1000 };
  const [A, drive] = [device('dev-a', time), new FakeDrive()];
  const img = attach(A, 'n1', 1);
  await sync(A, drive);
  const n = names(drive);
  expect(n[0]).toBe(`blob_${img.thumbHash}`);
  expect(n[1]).toMatch(/^ops_dev-a_/);
  expect(n[2]).toBe(`blob_${img.bodyHash}`);
  expect(A.port.uploaded).toEqual(new Set([img.thumbHash, img.bodyHash]));
});

test('Wi-Fi 限定でモバイル回線のとき: サムネイルと op は送り、本体は Wi-Fi になってから', async () => {
  const time = { t: 1000 };
  const [A, B, drive] = [device('dev-a', time), device('dev-b', time), new FakeDrive()];
  A.port.wifi = false;
  const img = attach(A, 'n1', 1);
  await sync(A, drive);
  expect(names(drive).map((x) => x.split('_')[0])).toEqual(['blob', 'ops']); // 本体は未送信
  expect(A.ctx.store.unsentOps()).toHaveLength(0);

  // 他端末: 添付は見えてサムネイルも取得済み、本体は未取得（op が先に届き本体が後から届く）
  await sync(B, drive);
  expect(B.ctx.store.snapshot().attachment['att-1'].hash).toBe(img.bodyHash);
  expect(B.port.files.has(img.thumbHash)).toBe(true);
  expect(B.port.files.has(img.bodyHash)).toBe(false);
  expect(await downloadBlob(drive, B.port, img.bodyHash)).toBe(false); // Drive にまだ無い

  A.port.wifi = true;
  await sync(A, drive);
  await sync(B, drive); // 本体のファイルが changes に現れ、ID を知る
  expect(await downloadBlob(drive, B.port, img.bodyHash)).toBe(true);
  expect([...B.port.files.get(img.bodyHash)!]).toEqual([...img.body]);
});

test('Wi-Fi 限定を切れば、モバイル回線でも本体を送る', async () => {
  const time = { t: 1000 };
  const [A, drive] = [device('dev-a', time), new FakeDrive()];
  A.port.wifi = false;
  A.port.wifiOnly = false;
  attach(A, 'n1', 1);
  await sync(A, drive);
  expect(names(drive)).toHaveLength(3);
});

test('内容がハッシュと一致しない blob は保存しない（同期は止まらない）', async () => {
  const time = { t: 1000 };
  const [A, B, drive] = [device('dev-a', time), device('dev-b', time), new FakeDrive()];
  const img = attach(A, 'n1', 1);
  await sync(A, drive);
  const thumbFile = [...drive.files.values()].find((f) => f.file.name === `blob_${img.thumbHash}`)!;
  thumbFile.content = Uint8Array.from([9, 9, 9]); // 壊れた／すり替えられた内容
  await expect(sync(B, drive)).resolves.toBeUndefined();
  expect(B.port.files.has(img.thumbHash)).toBe(false);
  expect(B.ctx.store.snapshot().attachment['att-1']).toBeDefined(); // メタデータは届く
});

test('同じ画像を他端末が先に送っていれば、再アップロードしない', async () => {
  const time = { t: 1000 };
  const [A, B, drive] = [device('dev-a', time), device('dev-b', time), new FakeDrive()];
  const img = attach(A, 'n1', 1);
  await sync(A, drive);
  await sync(B, drive); // B は blob の ID を知る
  B.port.files.set(img.thumbHash, img.thumb);
  B.port.files.set(img.bodyHash, img.body);
  B.port.uploaded.clear();
  const before = drive.files.size;
  applyLocalOp(B.ctx, 'attachment', 'att-b', { note_id: 'n2', hash: img.bodyHash, thumb_hash: img.thumbHash, deleted: 0 });
  await sync(B, drive);
  expect(drive.files.size).toBe(before + 1); // 増えたのは op ファイルだけ
});

test('ランダムな追加・回線切替・通信エラーのあと、Wi-Fi で同期すれば全端末に画像が行き渡る', async () => {
  const step = fc.oneof(
    fc.record({ k: fc.constant('add' as const), dev: fc.nat(2), n: fc.nat(30) }),
    fc.record({ k: fc.constant('wifi' as const), dev: fc.nat(2), on: fc.boolean() }),
    fc.record({ k: fc.constant('sync' as const), dev: fc.nat(2) }),
  );
  await fc.assert(
    fc.asyncProperty(fc.array(step, { maxLength: 25 }), fc.integer({ min: 0, max: 6 }), async (steps, budget) => {
      const time = { t: 1000 };
      const devs = [0, 1, 2].map((i) => device(`dev-${i}`, time));
      const drive = new FakeDrive();
      drive.failBudget = budget;
      const all = new Map<string, Uint8Array>();
      for (const s of steps) {
        time.t += 1;
        if (s.k === 'add') {
          const img = attach(devs[s.dev], 'n1', s.n + s.dev * 100);
          all.set(img.thumbHash, img.thumb);
          all.set(img.bodyHash, img.body);
        } else if (s.k === 'wifi') devs[s.dev].port.wifi = s.on;
        else await sync(devs[s.dev], drive).catch(() => {});
      }
      for (const d of devs) d.port.wifi = true;
      for (let r = 0; r < 3; r++) for (const d of devs) for (let i = 0; i < 30; i++) { try { await sync(d, drive); break; } catch { /* 再試行 */ } }
      for (const d of devs) {
        expect(d.ctx.store.unsentOps()).toHaveLength(0);
        for (const a of d.port.attachments()) {
          expect(d.port.files.has(a.thumbHash)).toBe(true); // サムネイルは自動で行き渡る
          if (!d.port.files.has(a.hash)) expect(await downloadBlob(drive, d.port, a.hash)).toBe(true); // 本体は表示時に取得できる
          expect([...d.port.files.get(a.hash)!]).toEqual([...all.get(a.hash)!]);
        }
        for (const st of d.port.blobs().values()) if (st.local) expect(st.uploaded).toBe(true); // 端末にある blob は全部 Drive にある
      }
    }),
    { numRuns: 60 },
  );
});
