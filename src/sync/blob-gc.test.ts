import { applyLocalOp } from '../core/merge';
import { downloadBlob, trimCache } from './blobs';
import { FakeDrive } from './fake-drive';
import { syncOnce } from './sync';
import { attach, device, sha } from './test-support';

const DAY = 86_400_000;
const BASE = 1_700_000_000_000;
type Dev = ReturnType<typeof device>;
const sync = (d: Dev, drive: FakeDrive) => syncOnce(d.ctx, drive, undefined, d.port);
const blobNames = (drive: FakeDrive) => [...drive.files.values()].map((f) => f.file.name).filter((n) => n.startsWith('blob_'));
const at = (days: number, time: { t: number }, ...devs: Dev[]) => {
  time.t = BASE + days * DAY;
  for (const d of devs) d.port.time = time.t;
};

async function setup() {
  const time = { t: BASE };
  const [A, B, C, drive] = [device('dev-a', time), device('dev-b', time), device('dev-c', time), new FakeDrive()];
  at(0, time, A, B, C);
  return { time, A, B, C, drive };
}

test('削除から 30 日たつと Drive の blob が消え、削除した端末の実体も消える。他端末は削除通知で実体を落とす', async () => {
  const { time, A, B, drive } = await setup();
  const img = attach(A, 'n1', 1);
  await sync(A, drive);
  await sync(B, drive);
  await downloadBlob(drive, B.port, img.bodyHash); // B にも本体がある
  expect(blobNames(drive)).toHaveLength(2);

  applyLocalOp(A.ctx, 'attachment', 'att-1', { deleted: 1 });
  await sync(A, drive);

  at(29, time, A, B);
  await sync(A, drive);
  expect(blobNames(drive)).toHaveLength(2); // 猶予内は消さない

  at(31, time, A, B);
  await sync(A, drive);
  expect(blobNames(drive)).toHaveLength(0);
  expect(A.port.files.size).toBe(0); // 削除した端末の実体も消える

  await sync(B, drive);
  expect(B.port.files.size).toBe(0); // 他端末は削除通知で、参照の無い blob を落とす
  expect(B.port.blobs().size).toBe(0);
});

test('同じ画像を参照する別の添付が生きていれば、blob は消さない', async () => {
  const { time, A, drive } = await setup();
  const img = attach(A, 'n1', 1);
  applyLocalOp(A.ctx, 'attachment', 'att-copy', { note_id: 'n2', hash: img.bodyHash, thumb_hash: img.thumbHash, deleted: 0 });
  await sync(A, drive);
  applyLocalOp(A.ctx, 'attachment', 'att-1', { deleted: 1 });
  at(40, time, A);
  await sync(A, drive);
  expect(blobNames(drive)).toHaveLength(2);
});

test('未アップロードの blob は、墓標になっても端末から消さない。Drive 上の場所が分からないものは触らない', async () => {
  const { time, A, drive } = await setup();
  const img = attach(A, 'n1', 1); // 同期する前に墓標にするので、本体は未アップロードのまま
  applyLocalOp(A.ctx, 'attachment', 'att-1', { deleted: 1 });
  at(40, time, A);
  await sync(A, drive);
  expect(A.port.files.has(img.bodyHash)).toBe(true); // 未アップロードの本体は残る
  expect(A.port.uploaded.has(img.bodyHash)).toBe(false);
});

test('他端末が blob を消した後に同じ画像を添付し直しても、参照先が失われない（再アップロードされる）', async () => {
  const { time, A, B, C, drive } = await setup();
  const img = attach(A, 'n1', 1);
  await sync(A, drive);
  await sync(B, drive);
  await downloadBlob(drive, B.port, img.bodyHash); // B は本体も持ち、Drive にあると思っている
  applyLocalOp(A.ctx, 'attachment', 'att-1', { deleted: 1 });
  await sync(A, drive);
  at(31, time, A, B, C);
  await sync(A, drive); // A が GC して Drive から消す
  expect(blobNames(drive)).toHaveLength(0);

  // B は古い状態のまま、同じ画像を添付し直す
  applyLocalOp(B.ctx, 'attachment', 'att-b', { note_id: 'n1', hash: img.bodyHash, thumb_hash: img.thumbHash, mime: 'image/jpeg', width: 1, height: 1, size: 64, sort_key: '1', deleted: 0 });
  await sync(B, drive); // 削除通知を受けて、本体を再アップロード
  await sync(B, drive); // サムネイルも再アップロード
  expect(blobNames(drive).sort()).toEqual([`blob_${img.bodyHash}`, `blob_${img.thumbHash}`].sort());

  await sync(C, drive); // 新しい端末にも行き渡る
  expect(C.port.files.has(img.thumbHash)).toBe(true);
  expect(await downloadBlob(drive, C.port, img.bodyHash)).toBe(true);
  expect([...C.port.files.get(img.bodyHash)!]).toEqual([...img.body]);
});

test('キャッシュが上限を超えたら古い本体から消し、消した本体は後で再取得できる。未アップロードは消さない', async () => {
  const { A, B, drive } = await setup();
  const imgs = [1, 2, 3].map((n) => attach(A, 'n1', n));
  await sync(A, drive);
  // 使った時刻: 1 → 古い、3 → 新しい
  imgs.forEach((im, i) => A.port.lastUsed.set(im.bodyHash, 100 + i));
  A.port.uploaded.delete(imgs[0].bodyHash); // 1 番目は未アップロード扱い

  await trimCache(A.port, 128); // 本体 64 バイト × 3 = 192 → 上限 128 なら 1 つ消す
  expect(A.port.files.has(imgs[0].bodyHash)).toBe(true); // 一番古いが未アップロードなので残る
  expect(A.port.files.has(imgs[1].bodyHash)).toBe(false); // 次に古い本体が消える
  expect(A.port.files.has(imgs[2].bodyHash)).toBe(true);

  // 消した本体は Drive から再取得できる
  await sync(B, drive);
  expect(await downloadBlob(drive, B.port, imgs[1].bodyHash)).toBe(true);
  expect(sha(B.port.files.get(imgs[1].bodyHash)!)).toBe(imgs[1].bodyHash);
});

test('GC は 1 日に 1 回まで', async () => {
  const { time, A, drive } = await setup();
  attach(A, 'n1', 1);
  await sync(A, drive);
  applyLocalOp(A.ctx, 'attachment', 'att-1', { deleted: 1 });
  at(31, time, A);
  await sync(A, drive);
  expect(blobNames(drive)).toHaveLength(0);
  const stamp = A.port.getState('last_blob_gc');
  at(31.5, time, A);
  attach(A, 'n1', 1); // 同じ画像を添付し直す（再アップロードされる）
  await sync(A, drive);
  expect(A.port.getState('last_blob_gc')).toBe(stamp); // 半日後なので GC は走らない
});
