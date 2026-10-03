import fc from 'fast-check';
import { createClock } from '../core/hlc';
import { applyLocalOp, type Ctx } from '../core/merge';
import { MemoryStore } from '../core/store';
import { createDriveClient } from './drive';
import { FakeDrive } from './fake-drive';
import { syncOnce } from './sync';

let idSeq = 0;
function device(name: string, time: { t: number }): Ctx & { store: MemoryStore } {
  const store = new MemoryStore();
  return { store, clock: createClock(name, () => time.t), newId: () => `op-${String(++idSeq).padStart(6, '0')}` };
}
const mainState = (s: MemoryStore) => {
  const snap = s.snapshot();
  return { ...snap, note: Object.fromEntries(Object.entries(snap.note ?? {}).filter(([, f]) => !('conflict_of' in f))) };
};
/** 通信エラーは再試行する（実運用の「次回の同期」に相当） */
async function sync(c: Ctx & { store: MemoryStore }, d: FakeDrive) {
  for (let i = 0; i < 50; i++) {
    try { return await syncOnce(c, d); } catch (e) { if ((e as Error).message !== 'network') throw e; }
  }
  throw new Error('did not recover');
}

test('A の変更が Drive 経由で B に届く。何も無ければ再実行してもファイルは増えない', async () => {
  const time = { t: 1000 };
  const [A, B, drive] = [device('dev-a', time), device('dev-b', time), new FakeDrive()];
  applyLocalOp(A, 'note', 'n1', { title: 't', body: 'hello' });
  await syncOnce(A, drive);
  await syncOnce(B, drive);
  expect(B.store.snapshot().note.n1).toMatchObject({ title: 't', body: 'hello' });

  const n = drive.files.size;
  await syncOnce(A, drive);
  await syncOnce(B, drive);
  expect(drive.files.size).toBe(n); // 受信しただけの op は再送しない
  expect(drive.downloads).toEqual(['f1']); // 取得は B の初回の 1 回だけ（自端末のファイルは取らない・取得済みは再取得しない）
  expect(drive.listAllCalls).toBe(2); // 全件読みは各端末の初回のみ（トークンが保存されている）

  time.t += 1;
  applyLocalOp(A, 'note', 'n1', { body: 'again' });
  await syncOnce(A, drive);
  await syncOnce(B, drive);
  await syncOnce(B, drive);
  expect(B.store.snapshot().note.n1.body).toBe('again');
  expect(drive.downloads).toEqual(['f1', 'f2']); // changes のトークンが進み、取得済みを再取得しない
  expect([...drive.files.values()][0].file.name).toMatch(/^ops_dev-a_\d{13}:\d{4}:dev-a\.jsonl$/);
});

test('後から参加した端末は既存ファイルを全件読む（トークン無しの初回同期）', async () => {
  const time = { t: 1000 };
  const [A, C, drive] = [device('dev-a', time), device('dev-c', time), new FakeDrive()];
  for (let i = 0; i < 5; i++) {
    time.t += 1;
    applyLocalOp(A, 'checklist_item', `i${i}`, { text: `x${i}`, checked: 0 });
    await syncOnce(A, drive); // 5 ファイル → changes は複数ページ
  }
  await syncOnce(C, drive);
  expect(mainState(C.store)).toEqual(mainState(A.store));
});

test('壊れた行・不正な op を含むファイルがあっても同期は止まらない', async () => {
  const time = { t: 1000 };
  const [B, drive] = [device('dev-b', time), new FakeDrive()];
  const good = JSON.stringify({ id: 'x1', hlc: '0000000001000:0000:dev-z', entity: 'note', entityId: 'n1', fields: { title: 'ok' }, base: {} });
  const bad = JSON.stringify({ id: 'x2', hlc: 'oops', entity: 'note', entityId: 'n1', fields: { title: 'NG' }, base: {} });
  const evil = JSON.stringify({ id: 'x3', hlc: '0000000002000:0000:dev-z', entity: 'note', entityId: 'n1', fields: { 'title = 1; --': 'x', body: { a: 1 } }, base: {} });
  await drive.createFile({ name: 'ops_dev-z', appProperties: { deviceId: 'dev-z', hlc: 'h', kind: 'ops' } }, [good, 'not json', bad, evil].join('\n'));
  await syncOnce(B, drive);
  expect(B.store.snapshot().note.n1).toEqual({ title: 'ok' });
});

test('ランダムな編集・同期・通信エラーを経ても、最後に全端末が収束する', async () => {
  const step = fc.oneof(
    fc.record({ kind: fc.constant('edit' as const), dev: fc.nat(2), t: fc.constantFrom('note:n1:title', 'note:n1:body', 'checklist_item:i1:checked', 'checklist_item:i1:text'), v: fc.string({ maxLength: 3 }) }),
    fc.record({ kind: fc.constant('sync' as const), dev: fc.nat(2) }),
  );
  await fc.assert(
    fc.asyncProperty(fc.array(step, { maxLength: 30 }), fc.integer({ min: 0, max: 8 }), async (steps, budget) => {
      const time = { t: 1000 };
      const devs = [0, 1, 2].map((i) => device(`dev-${i}`, time));
      const drive = new FakeDrive();
      drive.failBudget = budget;
      for (const s of steps) {
        time.t += 1;
        if (s.kind === 'edit') {
          const [e, id, f] = s.t.split(':');
          applyLocalOp(devs[s.dev], e as 'note', id, { [f]: s.v });
        } else {
          try { await syncOnce(devs[s.dev], drive); } catch { /* 次の同期で再試行 */ }
        }
      }
      // 最後は全員が 2 周する（エラーは再試行で吸収）
      for (let round = 0; round < 2; round++) for (const d of devs) await sync(d, drive);
      expect(mainState(devs[1].store)).toEqual(mainState(devs[0].store));
      expect(mainState(devs[2].store)).toEqual(mainState(devs[0].store));
      for (const d of devs) expect(d.store.unsentOps()).toHaveLength(0);
    }),
    { numRuns: 100 },
  );
});

describe('REST クライアント', () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = url.includes('startPageToken') ? { startPageToken: '7' } : { id: 'f1', name: 'n' };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const drive = createDriveClient(fetchMock, async () => 'TOKEN');

  test('createFile は appDataFolder 配下に multipart で新規作成する', async () => {
    await drive.createFile({ name: 'a.jsonl', appProperties: { kind: 'ops' } }, 'line1\nline2\n');
    const { url, init } = calls[0];
    expect(url).toContain('/upload/drive/v3/files?uploadType=multipart');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN');
    expect(String(init.body)).toContain('"parents":["appDataFolder"]');
    expect(String(init.body)).toContain('line1\nline2\n');
  });

  test('getStartPageToken は spaces を付けず、changes は spaces=appDataFolder で呼ぶ', async () => {
    expect(await drive.getStartPageToken()).toBe('7');
    expect(calls.at(-1)!.url).not.toContain('spaces');
    await drive.listChanges('7');
    expect(calls.at(-1)!.url).toContain('spaces=appDataFolder');
  });

  test('HTTP エラーは例外にする', async () => {
    const bad = createDriveClient((async () => new Response('no', { status: 401 })) as unknown as typeof fetch, async () => 't');
    await expect(bad.getStartPageToken()).rejects.toThrow('401');
  });
});
