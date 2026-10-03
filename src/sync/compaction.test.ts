import fc from 'fast-check';
import { parseHlc } from '../core/hlc';
import { applyLocalOp, mergeRemoteOps } from '../core/merge';
import type { Json, Op } from '../core/ops';
import type { DriveClient } from './drive';
import { FakeDrive } from './fake-drive';
import { syncOnce, type SyncOptions } from './sync';
import { device } from './test-support';

type Dev = ReturnType<typeof device>;
const DAY = 86_400_000;
const sync = (d: Dev, drive: DriveClient, opts: SyncOptions = {}) => syncOnce(d.ctx, drive, undefined, undefined, opts);
const mainState = (d: Dev) => {
  const snap = d.ctx.store.snapshot();
  return { ...snap, note: Object.fromEntries(Object.entries(snap.note ?? {}).filter(([, f]) => !('conflict_of' in f))) };
};
const copies = (d: Dev) => Object.values(d.ctx.store.snapshot().note ?? {}).filter((f) => 'conflict_of' in f).length;
const kinds = (drive: FakeDrive, dev?: string) =>
  [...drive.files.values()].map((f) => f.file.appProperties!).filter((p) => !dev || p.deviceId === dev).map((p) => p.kind);
const count = (xs: string[], k: string) => xs.filter((x) => x === k).length;
const setup = () => {
  const time = { t: 1_700_000_000_000 };
  return { time, A: device('dev-a', time), B: device('dev-b', time), C: device('dev-c', time), drive: new FakeDrive() };
};
/** 編集して同期するのを n 回（そのたびに自端末の op ファイルが 1 つ増える） */
async function edits(d: Dev, drive: FakeDrive, time: { t: number }, n: number, opts: SyncOptions, field = 'body', note = 'n1') {
  for (let i = 0; i < n; i++) {
    time.t += 1;
    applyLocalOp(d.ctx, 'note', note, { [field]: `${d.ctx.clock.last()}-${i}` });
    await sync(d, drive, opts);
  }
}

test('自端末の op ファイルが閾値に達すると、スナップショットに置き換わる。ローカルの履歴は消さない', async () => {
  const { time, A, drive } = setup();
  const opts = { compactMinFiles: 3, now: () => time.t };
  applyLocalOp(A.ctx, 'note', 'n1', { title: 't', body: 'b' });
  await edits(A, drive, time, 4, { ...opts, now: () => 0 }); // 1 日以内扱いで、まだ圧縮しない
  expect(count(kinds(drive, 'dev-a'), 'ops')).toBeGreaterThanOrEqual(4);
  const before = A.ctx.store.ownOps('dev-a').length;

  time.t += 2 * DAY;
  await sync(A, drive, opts);
  expect(kinds(drive, 'dev-a')).toEqual(['snapshot']); // op ファイルは消え、スナップショット 1 つになる
  expect(A.ctx.store.ownOps('dev-a')).toHaveLength(before); // ローカルの op 履歴は残す
});

test('圧縮後に参加した新しい端末が、全 op を適用した場合と同じ状態に復元できる。既存の端末も追従する', async () => {
  const { time, A, B, C, drive } = setup();
  const opts = { compactMinFiles: 3, now: () => time.t };
  applyLocalOp(A.ctx, 'note', 'n1', { title: 't', body: 'b' });
  applyLocalOp(A.ctx, 'checklist_item', 'i1', { note_id: 'n1', text: 'milk', checked: 0 });
  await edits(A, drive, time, 5, { ...opts, now: () => 0 });
  await sync(B, drive); // B は圧縮前に追いつく
  time.t += 2 * DAY;
  await sync(A, drive, opts);
  expect(kinds(drive, 'dev-a')).toEqual(['snapshot']);

  await sync(C, drive); // 圧縮後に参加
  expect(mainState(C)).toEqual(mainState(A));
  expect(copies(C)).toBe(0);

  // 圧縮の後も編集が続き、全員が追従する
  await edits(A, drive, time, 2, { ...opts, now: () => 0 });
  applyLocalOp(A.ctx, 'checklist_item', 'i1', { checked: 1 });
  await sync(A, drive, { ...opts, now: () => 0 });
  await sync(B, drive);
  await sync(C, drive);
  expect(mainState(B)).toEqual(mainState(A));
  expect(mainState(C)).toEqual(mainState(A));
});

test('他端末が作ったメモを連続編集して圧縮しても、復元時に誤った競合コピーができない（受信順に依らない）', async () => {
  for (const order of ['asc', 'desc'] as const) {
    const { time, A, B, C, drive } = setup();
    const opts = { compactMinFiles: 3, now: () => time.t };
    applyLocalOp(B.ctx, 'note', 'n1', { title: 't', body: 'b' });
    await sync(B, drive);
    await sync(A, drive);
    await edits(A, drive, time, 4, { ...opts, now: () => 0 });
    time.t += 2 * DAY;
    await sync(A, drive, opts);
    drive.listOrder = order;
    await sync(C, drive);
    expect(copies(C)).toBe(0);
    expect(mainState(C)).toEqual(mainState(A));
  }
});

test('圧縮された端末と別の端末が同時に編集したときは、復元した端末でも競合コピーが 1 つできる（見逃さない）', async () => {
  for (const order of ['asc', 'desc'] as const) {
    const { time, A, B, C, drive } = setup();
    const opts = { compactMinFiles: 3, now: () => time.t };
    applyLocalOp(A.ctx, 'note', 'n1', { title: 't', body: 'b' });
    await sync(A, drive);
    await sync(B, drive);
    // A と B が同時に編集（互いに見ていない）
    await edits(A, drive, time, 3, { ...opts, now: () => 0 });
    applyLocalOp(B.ctx, 'note', 'n1', { body: 'from-b' });
    await sync(B, drive);
    time.t += 2 * DAY;
    await sync(A, drive, opts);
    expect(kinds(drive, 'dev-a')).toEqual(['snapshot']);
    drive.listOrder = order;
    await sync(C, drive);
    expect(copies(C)).toBe(1);
  }
});

test('Drive のファイルがすべて消えたら、手元の全データ（他端末の op も含む）から再アップロードし、新しい端末が復元できる', async () => {
  const { A, B, C, drive } = setup();
  applyLocalOp(A.ctx, 'note', 'n1', { title: 'from-a' });
  applyLocalOp(B.ctx, 'note', 'n2', { title: 'from-b' });
  await sync(A, drive);
  await sync(B, drive);
  await sync(A, drive); // A は B の op も持つ
  // ユーザーが Drive 側のデータを消した
  for (const id of Array.from(drive.files.keys())) await drive.deleteFile(id);
  expect(drive.files.size).toBe(0);

  await sync(A, drive); // 削除通知で消失を検知し、全部を再アップロード
  expect(drive.files.size).toBeGreaterThan(0);
  await sync(C, drive); // B はもう同期しなくても、A 経由で B の分も復元される
  expect(C.ctx.store.snapshot().note.n1.title).toBe('from-a');
  expect(C.ctx.store.snapshot().note.n2.title).toBe('from-b');
});

test('消失を検知した直後に通信エラーで落ちても、判断を忘れず次回の同期で再アップロードする', async () => {
  const { time, A, B, C, drive } = setup();
  applyLocalOp(A.ctx, 'note', 'n1', { title: 'v0' });
  await edits(A, drive, time, 2, { now: () => 0 }); // 自端末の op ファイルが 2 つ（f1, f2）
  applyLocalOp(B.ctx, 'note', 'n2', { title: 'from-b' });
  await sync(B, drive); // 他端末のファイル（f3）
  await sync(A, drive); // A は B の op を受け取っている（A から B の分も復元できる）
  expect(drive.files.size).toBe(3);
  for (const id of Array.from(drive.files.keys())) await drive.deleteFile(id);
  // 削除通知は 2 件ずつのページ: 1 ページ目 = 自端末の f1・f2、2 ページ目 = 他端末の f3

  // 1 ページ目で消失を検知し、トークンを進めた後、2 ページ目の取得で落ちる
  let calls = 0;
  const flaky = Object.assign(Object.create(drive), {
    listChanges: (t: string) => (++calls === 2 ? Promise.reject(new Error('network')) : drive.listChanges(t)),
  }) as DriveClient;
  await expect(syncOnce(A.ctx, flaky)).rejects.toThrow('network');
  expect(drive.files.size).toBe(0);

  await sync(A, drive); // 次回: 残りのページに自端末の通知は無いが、検知の結果を覚えていて全部を再アップロードする
  expect(drive.files.size).toBeGreaterThan(0);
  await sync(C, drive);
  expect(C.ctx.store.snapshot().note.n1.title).toBe(A.ctx.store.snapshot().note.n1.title);
  expect(C.ctx.store.snapshot().note.n2.title).toBe('from-b'); // 他端末の分も復元される
});

test('自端末が圧縮で消したファイルの削除通知を、消失と誤認しない', async () => {
  const { time, A, drive } = setup();
  const opts = { compactMinFiles: 3, now: () => time.t };
  applyLocalOp(A.ctx, 'note', 'n1', { title: 't' });
  await edits(A, drive, time, 4, { ...opts, now: () => 0 });
  time.t += 2 * DAY;
  await sync(A, drive, opts);
  const n = drive.files.size;
  await sync(A, drive, opts);
  await sync(A, drive, opts);
  expect(drive.files.size).toBe(n); // 一括再アップロードは起きていない
  expect(kinds(drive, 'dev-a')).toEqual(['snapshot']);
});

test('圧縮は、未送信がある・閾値未満・1 日以内のときは走らない', async () => {
  const { time, A, drive } = setup();
  applyLocalOp(A.ctx, 'note', 'n1', { title: 't' });
  await edits(A, drive, time, 2, { compactMinFiles: 5, now: () => time.t + 9 * DAY });
  expect(kinds(drive, 'dev-a')).not.toContain('snapshot'); // 閾値未満
  await edits(A, drive, time, 4, { compactMinFiles: 3, now: () => 1000 }); // 1000ms（= 1970 年。last_compaction 未設定との差が 1 日未満）
  expect(kinds(drive, 'dev-a')).not.toContain('snapshot'); // 1 日以内
});

test('取得しようとしたファイルが（持ち主の圧縮で）既に無くても、同期は止まらず、置き換えのスナップショットで追いつく', async () => {
  const { time, A, C, drive } = setup();
  const opts = { compactMinFiles: 3, now: () => time.t };
  applyLocalOp(A.ctx, 'note', 'n1', { title: 't' });
  await edits(A, drive, time, 4, { ...opts, now: () => 0 });
  const goneId = [...drive.files.values()].find((f) => f.file.appProperties!.kind === 'ops')!.file.id;
  time.t += 2 * DAY;
  await sync(A, drive, opts); // 圧縮で goneId は消える
  // C の一覧には、消えたファイルが（古い情報として）残っている状況
  const stale = Object.assign(Object.create(drive), {
    listFiles: async () => [...(await drive.listFiles()), { id: goneId, name: 'x', appProperties: { deviceId: 'dev-a', kind: 'ops', hlc: 'x' } }],
  }) as DriveClient;
  await expect(syncOnce(C.ctx, stale, undefined, undefined, opts)).resolves.toBeUndefined();
  expect(mainState(C)).toEqual(mainState(A));
});

test('ランダムな編集・同期・通信エラー・圧縮・Drive の全消去のあとでも、全端末が収束する', async () => {
  const step = fc.oneof(
    fc.record({ k: fc.constant('edit' as const), dev: fc.nat(2), t: fc.constantFrom('note:n1:title', 'note:n1:body', 'checklist_item:i1:checked', 'checklist_item:i1:text'), v: fc.string({ maxLength: 3 }) }),
    fc.record({ k: fc.constant('sync' as const), dev: fc.nat(2) }),
    fc.record({ k: fc.constant('wipe' as const) }),
  );
  await fc.assert(
    fc.asyncProperty(fc.array(step, { maxLength: 40 }), fc.integer({ min: 0, max: 6 }), async (steps, budget) => {
      const time = { t: 1_700_000_000_000 };
      const devs = [0, 1, 2].map((i) => device(`dev-${i}`, time));
      const drive = new FakeDrive();
      drive.failBudget = budget;
      const all: Op[] = [];
      const opts = { compactMinFiles: 2, now: () => time.t };
      for (const s of steps) {
        time.t += DAY / 2; // 圧縮の間隔（1 日）を頻繁にまたぐ
        if (s.k === 'edit') {
          const [e, id, f] = s.t.split(':');
          all.push(applyLocalOp(devs[s.dev].ctx, e as 'note', id, { [f]: s.v as Json }));
        } else if (s.k === 'sync') await sync(devs[s.dev], drive, opts).catch(() => {});
        else for (const id of Array.from(drive.files.keys())) await drive.deleteFile(id).catch(() => {});
      }
      drive.failBudget = 0;
      for (let r = 0; r < 4; r++) for (const d of devs) await sync(d, drive, opts);
      const expected = device('expected', { t: 0 });
      mergeRemoteOps(expected.ctx, all);
      for (const d of devs) {
        expect(mainState(d)).toEqual(mainState(expected));
        expect(d.ctx.store.unsentOps()).toHaveLength(0);
      }
      // 新しい端末が最後に参加しても同じ状態に復元できる
      const late = device('dev-late', time);
      await sync(late, drive, opts);
      await sync(late, drive, opts);
      expect(mainState(late)).toEqual(mainState(expected));
      expect(parseHlc(devs[0].ctx.clock.last()).device).toBe('dev-0');
    }),
    { numRuns: 60 },
  );
});
