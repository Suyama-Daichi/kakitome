import fc from 'fast-check';
import { createClock } from './hlc';
import { applyLocalOp, mergeRemoteOps, type Ctx } from './merge';
import type { Json, Op } from './ops';
import { MemoryStore } from './store';

let idSeq = 0;
const newId = () => `op-${String(++idSeq).padStart(6, '0')}`;

function device(name: string, time: { t: number }, skew = 0): Ctx & { store: MemoryStore } {
  const store = new MemoryStore();
  return { store, clock: createClock(name, () => time.t + skew), newId };
}

/** 競合コピー（conflict_of を持つメモ）を除いた状態 */
function mainState(s: MemoryStore) {
  const snap = s.snapshot();
  const notes = Object.fromEntries(Object.entries(snap.note ?? {}).filter(([, f]) => !('conflict_of' in f)));
  return { ...snap, note: notes };
}
const copies = (s: MemoryStore) =>
  Object.entries(s.snapshot().note ?? {}).filter(([, f]) => 'conflict_of' in f);

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
/** 順序を崩し、一部を重複させる */
const scramble = (ops: Op[], seed: number) => {
  const dups = ops.filter((_, i) => (seed >> i) & 1);
  return shuffle([...ops, ...dups], seed);
};
const replica = (ops: Op[]) => {
  const c = device('replica', { t: 0 });
  mergeRemoteOps(c, ops);
  return c.store;
};

const step = fc.oneof(
  fc.record({
    kind: fc.constant('edit' as const),
    dev: fc.nat(2),
    target: fc.constantFrom(
      ['note', 'n1', 'title'], ['note', 'n1', 'body'], ['note', 'n2', 'body'], ['note', 'n1', 'deleted'],
      ['checklist_item', 'i1', 'checked'], ['checklist_item', 'i1', 'text'], ['reminder', 'r1', 'enabled'],
    ),
    value: fc.oneof(fc.string({ maxLength: 3 }), fc.integer({ min: 0, max: 1 })),
    dt: fc.nat(2),
  }),
  fc.record({ kind: fc.constant('sync' as const), dev: fc.nat(2), dt: fc.nat(2) }),
);

test('任意の順序・重複で適用しても全レプリカが収束する', () => {
  fc.assert(
    fc.property(fc.array(step, { maxLength: 40 }), fc.integer(), fc.integer(), fc.array(fc.integer({ min: -3, max: 3 }), { minLength: 3, maxLength: 3 }), (steps, s1, s2, skew) => {
      const time = { t: 1_000_000 };
      const devs = [0, 1, 2].map((i) => device(`dev-${i}`, time, skew[i]));
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
      const a = replica(scramble(all, s1));
      const b = replica(scramble(all, s2));
      expect(mainState(a)).toEqual(mainState(b));
      expect(mainState(a)).toEqual(mainState(replica(all)));
      // 全 op を受け取った元端末とも一致する
      mergeRemoteOps(devs[0], all);
      expect(mainState(devs[0].store)).toEqual(mainState(a));
    }),
    { numRuns: 300 },
  );
});

describe('競合コピー', () => {
  const setup = (skewA: number, skewB: number, field: 'title' | 'body') => {
    const time = { t: 1_000 };
    const A = device('dev-a', time, skewA);
    const B = device('dev-b', time, skewB);
    const create = applyLocalOp(A, 'note', 'n1', { title: 't', body: 'b', pinned: 0, deleted: 0 });
    mergeRemoteOps(B, [create]);
    time.t += 10;
    const a = applyLocalOp(A, 'note', 'n1', { [field]: 'from-a' });
    const b = applyLocalOp(B, 'note', 'n1', { [field]: 'from-b' });
    return { create, a, b };
  };

  test('同時編集ではどの配送順でもちょうど1つ、全端末で同じ ID・内容', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 5 }), fc.integer({ min: -5, max: 5 }), fc.constantFrom('title', 'body' as const), fc.integer(), (sa, sb, field, seed) => {
        const { create, a, b } = setup(sa, sb, field as 'title' | 'body');
        const r1 = replica([create, a, b]);
        const r2 = replica([create, b, a]);
        const r3 = replica(scramble([create, a, b], seed));
        const [winner, loser] = a.hlc > b.hlc ? [a, b] : [b, a];
        for (const r of [r1, r2, r3]) {
          expect(copies(r)).toHaveLength(1);
          const [[, c]] = copies(r);
          expect(c).toMatchObject({ [field]: loser.fields[field], conflict_of: 'n1', conflict_field: field, conflict_base_hlc: create.hlc });
          expect(r.snapshot().note.n1[field]).toBe(winner.fields[field]);
        }
        expect(r1.snapshot()).toEqual(r2.snapshot());
        expect(r1.snapshot()).toEqual(r3.snapshot());
      }),
    );
  });

  test('同じ端末の連続編集が逆順に届いても競合にならない', () => {
    const time = { t: 1_000 };
    const A = device('dev-a', time);
    const create = applyLocalOp(A, 'note', 'n1', { title: 't', body: 'b' });
    const e1 = applyLocalOp(A, 'note', 'n1', { body: 'v1' });
    const e2 = applyLocalOp(A, 'note', 'n1', { body: 'v2' });
    // [create, e2, e1] は e2 到着時に親 e1 が未着で、同時編集に見える（§5.2 で許容済みの誤検知）
    for (const order of [[e2, create, e1], [e2, e1, create]]) {
      const r = replica(order);
      expect(copies(r)).toHaveLength(0);
      expect(r.snapshot().note.n1.body).toBe('v2');
    }
  });

  test('title と body を同時に編集された場合はフィールドごとに1つずつできる', () => {
    const time = { t: 1_000 };
    const A = device('dev-a', time);
    const B = device('dev-b', time);
    const create = applyLocalOp(A, 'note', 'n1', { title: 't', body: 'b' });
    mergeRemoteOps(B, [create]);
    time.t += 10;
    const a = applyLocalOp(A, 'note', 'n1', { title: 'ta', body: 'ba' });
    const b = applyLocalOp(B, 'note', 'n1', { title: 'tb', body: 'bb' });
    const r1 = replica([create, a, b]);
    const r2 = replica([create, b, a]);
    expect(copies(r1)).toHaveLength(2);
    expect(r1.snapshot()).toEqual(r2.snapshot());
  });

  test('別フィールドの編集は競合にならない', () => {
    const time = { t: 1_000 };
    const A = device('dev-a', time);
    const B = device('dev-b', time);
    const create = applyLocalOp(A, 'note', 'n1', { title: 't', body: 'b' });
    mergeRemoteOps(B, [create]);
    time.t += 1;
    const a = applyLocalOp(A, 'note', 'n1', { title: 'x' });
    const b = applyLocalOp(B, 'note', 'n1', { body: 'y' });
    const r = replica([create, b, a]);
    expect(copies(r)).toHaveLength(0);
    expect(r.snapshot().note.n1).toMatchObject({ title: 'x', body: 'y' });
  });

  test('順次編集（同期してから編集）では競合コピーができない', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(1), { minLength: 1, maxLength: 12 }), (who) => {
        const time = { t: 1_000 };
        const devs = [device('dev-a', time), device('dev-b', time)];
        const all: Op[] = [applyLocalOp(devs[0], 'note', 'n1', { title: 't', body: 'b' })];
        who.forEach((w, i) => {
          time.t += 1;
          mergeRemoteOps(devs[w], all);
          all.push(applyLocalOp(devs[w], 'note', 'n1', { body: `v${i}` }));
        });
        expect(copies(replica(all))).toHaveLength(0);
      }),
    );
  });
});

test('attachment の op は画像本体（blob）の有無と無関係に適用される', () => {
  const time = { t: 1 };
  const A = device('dev-a', time);
  const op = applyLocalOp(A, 'attachment', 'att1', { note_id: 'n1', hash: 'h', thumb_hash: 't', mime: 'image/jpeg', deleted: 0 });
  const r = replica([op]);
  expect(r.snapshot().attachment.att1).toMatchObject({ hash: 'h', thumb_hash: 't' });
});
