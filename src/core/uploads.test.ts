import fc from 'fast-check';
import type { Op } from './ops';
import { planUploads, type AttachmentRef, type BlobState } from './uploads';

const attOp = (id: string, hlc: string, thumb: string, body: string): Op => ({
  id, hlc, entity: 'attachment', entityId: `att-${id}`, fields: { note_id: 'n1', thumb_hash: thumb, hash: body }, base: {},
});
const textOp = (id: string, hlc: string): Op => ({ id, hlc, entity: 'note', entityId: 'n1', fields: { title: id }, base: {} });
const local = (uploaded = false): BlobState => ({ local: true, uploaded });

test('サムネイル未送信の添付 op は保留し、サムネイルはネットワークに関わらず送る', () => {
  const ops = [textOp('t1', '1'), attOp('a1', '2', 'T', 'B'), textOp('t2', '3')];
  const p = planUploads({
    unsentOps: ops,
    attachments: [{ hash: 'B', thumbHash: 'T' }],
    blobs: new Map([['T', local()], ['B', local()]]),
    allowBodies: false,
  });
  expect(p.thumbs).toEqual(['T']);
  expect(p.ops.map((o) => o.id)).toEqual(['t1', 't2']); // a1 は保留。他の op は止めない
  expect(p.bodies).toEqual([]);
});

test('サムネイルが送信済みになれば op が送れ、本体は許可されたときだけ', () => {
  const blobs = new Map([['T', local(true)], ['B', local()]]);
  const input = { unsentOps: [attOp('a1', '2', 'T', 'B')], attachments: [{ hash: 'B', thumbHash: 'T' }], blobs };
  expect(planUploads({ ...input, allowBodies: false })).toMatchObject({ thumbs: [], bodies: [] });
  expect(planUploads({ ...input, allowBodies: false }).ops).toHaveLength(1);
  expect(planUploads({ ...input, allowBodies: true }).bodies).toEqual(['B']);
});

test('本体はサムネイルより先に送らない。端末に無い・送信済みの blob は対象外。同じ画像は 1 回', () => {
  const att: AttachmentRef[] = [{ hash: 'B', thumbHash: 'T' }, { hash: 'B', thumbHash: 'T' }, { hash: 'X', thumbHash: 'Y' }];
  const blobs = new Map<string, BlobState>([['T', local()], ['B', local()], ['Y', { local: false, uploaded: false }], ['X', local(true)]]);
  const p = planUploads({ unsentOps: [], attachments: att, blobs, allowBodies: true });
  expect(p.thumbs).toEqual(['T']);
  expect(p.bodies).toEqual([]); // T がまだなので B は待つ。X は送信済み
});

test('同じ本体を参照する添付が複数あるとき、すべてのサムネイルが送信済みになるまで本体を送らない', () => {
  const p = planUploads({
    unsentOps: [],
    attachments: [{ hash: 'a', thumbHash: 'd' }, { hash: 'a', thumbHash: 'c' }],
    blobs: new Map<string, BlobState>([['d', local()], ['a', local()]]),
    allowBodies: true,
  });
  expect(p.thumbs).toEqual(['d']);
  expect(p.bodies).toEqual([]);
});

test('blob の記録が無いサムネイルで op を永久に止めない', () => {
  const p = planUploads({ unsentOps: [attOp('a1', '2', 'GONE', 'B')], attachments: [], blobs: new Map(), allowBodies: true });
  expect(p.ops).toHaveLength(1);
});

test('任意の状態で不変条件が成り立つ', () => {
  const hash = fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f');
  const state = fc.record({ local: fc.boolean(), uploaded: fc.boolean() });
  fc.assert(
    fc.property(
      fc.array(fc.tuple(hash, hash), { maxLength: 6 }),
      fc.array(fc.tuple(hash, state), { maxLength: 6 }),
      fc.array(fc.tuple(fc.boolean(), hash, hash), { maxLength: 8 }),
      fc.boolean(),
      (atts, blobList, opSpecs, allowBodies) => {
        const blobs = new Map<string, BlobState>(blobList);
        const attachments = atts.map(([h, t]) => ({ hash: h, thumbHash: t }));
        const unsentOps = opSpecs.map(([isAtt, t, b], i) => (isAtt ? attOp(`o${i}`, String(i), t, b) : textOp(`o${i}`, String(i))));
        const p = planUploads({ unsentOps, attachments, blobs, allowBodies });
        const pending = (h: string) => !!blobs.get(h)?.local && !blobs.get(h)!.uploaded;
        for (const o of p.ops) if (o.entity === 'attachment') expect(pending(o.fields.thumb_hash as string)).toBe(false);
        for (const o of unsentOps) if (o.entity !== 'attachment') expect(p.ops).toContain(o);
        expect(p.ops.map((o) => o.id)).toEqual(unsentOps.filter((o) => p.ops.includes(o)).map((o) => o.id)); // 順序を保つ
        if (!allowBodies) expect(p.bodies).toEqual([]);
        for (const h of [...p.thumbs, ...p.bodies]) expect(pending(h)).toBe(true);
        for (const h of p.bodies) expect(p.thumbs).not.toContain(h);
        for (const h of p.bodies) {
          // 本体は、それを参照するすべての添付のサムネイルが送信済み（または対象外）になってから
          for (const a of attachments.filter((x) => x.hash === h)) expect(pending(a.thumbHash)).toBe(false);
        }
        expect(new Set(p.thumbs).size).toBe(p.thumbs.length);
        expect(new Set(p.bodies).size).toBe(p.bodies.length);
      },
    ),
    { numRuns: 300 },
  );
});
