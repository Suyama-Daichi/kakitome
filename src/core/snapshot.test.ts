import fc from 'fast-check';
import { createClock, parseHlc } from './hlc';
import { applyLocalOp, mergeRemoteOps, type Ctx } from './merge';
import type { Json, Op } from './ops';
import { buildSnapshot, parseSnapshot, snapshotToOps } from './snapshot';
import { MemoryStore } from './store';

let idSeq = 0;
function device(name: string, time: { t: number }): Ctx & { store: MemoryStore } {
  const store = new MemoryStore();
  return { store, clock: createClock(name, () => time.t), newId: () => `op-${String(++idSeq).padStart(6, '0')}` };
}
const mainState = (s: MemoryStore) => {
  const snap = s.snapshot();
  return { ...snap, note: Object.fromEntries(Object.entries(snap.note ?? {}).filter(([, f]) => !('conflict_of' in f))) };
};
const copies = (s: MemoryStore) => Object.entries(s.snapshot().note ?? {}).filter(([, f]) => 'conflict_of' in f);
const replica = (ops: Op[]) => {
  const c = device('replica', { t: 0 });
  mergeRemoteOps(c, ops);
  return c.store;
};
function shuffle<T>(xs: T[], seed: number): T[] {
  const a = [...xs];
  let x = seed | 1;
  const rnd = () => ((x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe('buildSnapshot', () => {
  const op = (id: string, hlc: string, fields: Record<string, Json>, base: Record<string, string> = {}): Op => ({
    id, hlc, entity: 'note', entityId: 'n1', fields, base,
  });
  const H = (ms: number, c = 0) => `${String(ms).padStart(13, '0')}:${String(c).padStart(4, '0')}:dev-a`;

  test('フィールドごとに最新の値と HLC、最初の自端末 op の base を残す', () => {
    const ops = [
      op('3', H(30), { body: 'v3' }, { body: H(20) }),
      op('1', H(10), { body: 'v1', title: 't1' }, { body: H(5) }),
      op('2', H(20), { body: 'v2' }, { body: H(10) }),
    ];
    const s = buildSnapshot('dev-a', ops);
    expect(s.upTo).toBe(H(30));
    expect(s.entries).toEqual([
      { entity: 'note', entityId: 'n1', field: 'body', value: 'v3', hlc: H(30), base: H(5) },
      { entity: 'note', entityId: 'n1', field: 'title', value: 't1', hlc: H(10), base: H(10) }, // 最初の op が作成（base なし）→ 自身の HLC
    ]);
  });

  test('他端末の op・導出された競合コピーの op は含めない', () => {
    const other = { ...op('x', '0000000000099:0000:dev-b', { body: 'other' }) };
    const derived = { ...op('d', '0000000000050:0000:conflict-dev-a', { body: 'copy' }) };
    const s = buildSnapshot('dev-a', [op('1', H(10), { body: 'mine' }), other, derived]);
    expect(s.entries.map((e) => e.value)).toEqual(['mine']);
  });

  test('疑似 op は内容から決まる固定の ID を持ち、再生成しても同じ', () => {
    const s = buildSnapshot('dev-a', [op('1', H(10), { body: 'v' }, { body: H(5) })]);
    const a = snapshotToOps(s);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ entity: 'note', entityId: 'n1', fields: { body: 'v' }, base: { body: H(5) }, hlc: H(10) });
    expect(snapshotToOps(s).map((o) => o.id)).toEqual(a.map((o) => o.id));
    expect(a[0].id).toContain(H(10));
  });

  test('JSON を経由しても同じ。壊れた・不正なスナップショットは null', () => {
    const s = buildSnapshot('dev-a', [op('1', H(10), { body: 'v' })]);
    expect(parseSnapshot(JSON.stringify(s))).toEqual(s);
    for (const bad of ['not json', '{}', '{"v":2}', JSON.stringify({ ...s, entries: [{ ...s.entries[0], value: { x: 1 } }] }),
      JSON.stringify({ ...s, entries: [{ ...s.entries[0], entity: 'evil' }] }), JSON.stringify({ ...s, entries: [{ ...s.entries[0], hlc: 'oops' }] }),
      JSON.stringify({ ...s, device: 5 }), JSON.stringify({ ...s, entries: [{ ...s.entries[0], base: undefined }] })]) {
      expect(parseSnapshot(bad)).toBeNull();
    }
  });

  test('空の入力でも壊れない', () => {
    const s = buildSnapshot('dev-a', []);
    expect(s.entries).toEqual([]);
    expect(snapshotToOps(s)).toEqual([]);
  });
});

describe('スナップショット経由でも、全 op を適用した場合と同じ状態になる', () => {
  const step = fc.oneof(
    fc.record({
      kind: fc.constant('edit' as const),
      dev: fc.nat(2),
      target: fc.constantFrom(['note', 'n1', 'title'], ['note', 'n1', 'body'], ['note', 'n1', 'deleted'], ['checklist_item', 'i1', 'checked'], ['checklist_item', 'i1', 'text'], ['reminder', 'r1', 'enabled']),
      value: fc.oneof(fc.string({ maxLength: 3 }), fc.integer({ min: 0, max: 1 })),
      dt: fc.nat(2),
    }),
    fc.record({ kind: fc.constant('sync' as const), dev: fc.nat(2), dt: fc.nat(2) }),
  );

  test('任意の端末を圧縮して、任意の順序・重複で届けても収束する', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }), fc.integer(), (steps, compact, seed) => {
        const time = { t: 1_000_000 };
        const devs = [0, 1, 2].map((i) => device(`dev-${i}`, time));
        const all: Op[] = [];
        for (const s of steps) {
          time.t += s.dt;
          const d = devs[s.dev];
          if (s.kind === 'sync') mergeRemoteOps(d, all);
          else {
            const [entity, id, field] = s.target as ['note' | 'checklist_item' | 'reminder', string, string];
            all.push(applyLocalOp(d, entity, id, { [field]: s.value as Json }));
          }
        }
        // 圧縮する端末は、その端末の op をスナップショット経由（疑似 op）にする
        const delivered = [0, 1, 2].flatMap((i) => {
          const own = all.filter((o) => parseHlc(o.hlc).device === `dev-${i}`);
          return compact[i] ? snapshotToOps(buildSnapshot(`dev-${i}`, own)) : own;
        });
        expect(mainState(replica(shuffle(delivered, seed)))).toEqual(mainState(replica(all)));
      }),
      { numRuns: 300 },
    );
  });
});

describe('競合コピー', () => {
  test('圧縮された端末の連続編集は、他端末の作成の後でも先でも競合にしない', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.integer(), (edits, seed) => {
        const time = { t: 1_000 };
        const [A, B] = [device('dev-a', time), device('dev-b', time)];
        const create = applyLocalOp(B, 'note', 'n1', { title: 't', body: 'b' });
        mergeRemoteOps(A, [create]);
        time.t += 1;
        const own: Op[] = [];
        for (let i = 0; i < edits; i++) own.push(applyLocalOp(A, 'note', 'n1', { body: `v${i}` }));
        const snap = snapshotToOps(buildSnapshot('dev-a', own));
        expect(copies(replica(shuffle([create, ...snap], seed)))).toHaveLength(0);
      }),
    );
  });

  test('圧縮された側と別の端末が同時に編集したときは、競合コピーが 1 つできる（見逃さない）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), fc.integer(), (edits, seed) => {
        const time = { t: 1_000 };
        const [A, B] = [device('dev-a', time), device('dev-b', time)];
        const create = applyLocalOp(A, 'note', 'n1', { title: 't', body: 'b' });
        mergeRemoteOps(B, [create]);
        time.t += 1;
        const own: Op[] = [create];
        for (let i = 0; i < edits; i++) own.push(applyLocalOp(A, 'note', 'n1', { body: `a${i}` }));
        const b1 = applyLocalOp(B, 'note', 'n1', { body: 'b1' });
        const snap = snapshotToOps(buildSnapshot('dev-a', own));
        expect(copies(replica(shuffle([...snap, b1], seed)))).toHaveLength(1);
      }),
    );
  });
});
