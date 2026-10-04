import fc from 'fast-check';
import { applyLocalOp } from '../core/merge';
import { downloadBlob } from './blobs';
import { attach, device } from './test-support';
import { FakeDrive } from './fake-drive';
import { syncOnce } from './sync';

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

test('ランダムな追加・通信エラーのあと、同期すれば全端末に画像が行き渡る', async () => {
  const step = fc.oneof(
    fc.record({ k: fc.constant('add' as const), dev: fc.nat(2), n: fc.nat(30) }),
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
        } else await sync(devs[s.dev], drive).catch(() => {});
      }
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
