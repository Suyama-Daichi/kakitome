import fc from 'fast-check';
import { planBlobGc, planCacheEviction, type GcAttachment } from './blobgc';

const DAY = 86_400_000;
const NOW = 100 * DAY;
const att = (hash: string, thumbHash: string, deleted: boolean, ageDays: number | null): GcAttachment => ({
  hash, thumbHash, deleted, deletedAtMs: deleted && ageDays !== null ? NOW - ageDays * DAY : null,
});
const gc = (attachments: GcAttachment[]) => planBlobGc({ attachments, now: NOW, graceMs: 30 * DAY }).sort();

describe('planBlobGc', () => {
  test('削除から猶予を過ぎた添付の本体とサムネイルを対象にする', () => {
    expect(gc([att('B', 'T', true, 31)])).toEqual(['B', 'T']);
    expect(gc([att('B', 'T', true, 30)])).toEqual(['B', 'T']); // ちょうど猶予
  });
  test('猶予内・削除時刻不明・生きている添付は対象外', () => {
    expect(gc([att('B', 'T', true, 29)])).toEqual([]);
    expect(gc([att('B', 'T', true, null)])).toEqual([]);
    expect(gc([att('B', 'T', false, null)])).toEqual([]);
  });
  test('同じ画像を参照する添付が 1 つでも生きていれば残す。全部が古く削除済みなら対象', () => {
    expect(gc([att('B', 'T', true, 90), att('B', 'T', false, null)])).toEqual([]);
    expect(gc([att('B', 'T', true, 90), att('B', 'T', true, 5)])).toEqual([]); // 新しい削除が猶予内
    expect(gc([att('B', 'T', true, 90), att('B', 'T', true, 40)])).toEqual(['B', 'T']);
  });
  test('参照が 1 件も無い blob は対象にしない（まだ届いていない op が参照しているかもしれない）', () => {
    expect(gc([])).toEqual([]);
  });
  test('本体として参照する添付と、サムネイルとして参照する添付が別でも、生きた参照があれば残す', () => {
    expect(gc([att('X', 'T', true, 90), att('B', 'X', false, null)])).toEqual(['T']);
  });
  test('不変条件（ランダム）: 生きた参照のある blob・参照の無い blob・猶予内の blob は返さない', () => {
    const h = fc.constantFrom('a', 'b', 'c', 'd', 'e');
    const a = fc.record({ hash: h, thumbHash: h, deleted: fc.boolean(), ageDays: fc.option(fc.integer({ min: 0, max: 90 }), { nil: null }) });
    fc.assert(
      fc.property(fc.array(a, { maxLength: 8 }), (list) => {
        const atts = list.map((x) => att(x.hash, x.thumbHash, x.deleted, x.ageDays));
        const out = planBlobGc({ attachments: atts, now: NOW, graceMs: 30 * DAY });
        for (const hash of out) {
          const refs = atts.filter((x) => x.hash === hash || x.thumbHash === hash);
          expect(refs.length).toBeGreaterThan(0);
          for (const r of refs) {
            expect(r.deleted).toBe(true);
            expect(r.deletedAtMs).not.toBeNull();
            expect(NOW - r.deletedAtMs!).toBeGreaterThanOrEqual(30 * DAY);
          }
        }
        expect(new Set(out).size).toBe(out.length);
      }),
      { numRuns: 300 },
    );
  });
});

describe('planCacheEviction', () => {
  const body = (hash: string, size: number, lastUsed: number, o: { local?: boolean; uploaded?: boolean } = {}) => ({
    hash, size, lastUsed, local: o.local ?? true, uploaded: o.uploaded ?? true,
  });
  test('上限以内なら何もしない', () => {
    expect(planCacheEviction({ bodies: [body('a', 10, 1), body('b', 10, 2)], limitBytes: 20 })).toEqual([]);
  });
  test('古い順に、上限に収まるまで削除する', () => {
    const bodies = [body('new', 10, 3), body('old', 10, 1), body('mid', 10, 2)];
    expect(planCacheEviction({ bodies, limitBytes: 20 })).toEqual(['old']);
    expect(planCacheEviction({ bodies, limitBytes: 10 })).toEqual(['old', 'mid']);
  });
  test('未アップロードは絶対に消さない。端末に無いものは数えない', () => {
    const bodies = [body('u', 100, 1, { uploaded: false }), body('x', 10, 2), body('gone', 999, 0, { local: false })];
    expect(planCacheEviction({ bodies, limitBytes: 50 })).toEqual(['x']); // u が上限超過でも消せない
    expect(planCacheEviction({ bodies, limitBytes: 0 })).toEqual(['x']);
  });
  test('不変条件（ランダム）: 未アップロード・端末に無いものは返さない／古い順の最小の接頭辞／適用後に再計画すると空', () => {
    const b = fc.record({ size: fc.integer({ min: 0, max: 50 }), lastUsed: fc.integer({ min: 0, max: 20 }), local: fc.boolean(), uploaded: fc.boolean() });
    fc.assert(
      fc.property(fc.array(b, { maxLength: 10 }), fc.integer({ min: 0, max: 200 }), (list, limit) => {
        const bodies = list.map((x, i) => ({ hash: `h${i}`, ...x }));
        const out = planCacheEviction({ bodies, limitBytes: limit });
        const byHash = new Map(bodies.map((x) => [x.hash, x]));
        for (const h of out) {
          expect(byHash.get(h)!.local).toBe(true);
          expect(byHash.get(h)!.uploaded).toBe(true);
        }
        const total = (xs: typeof bodies) => xs.filter((x) => x.local).reduce((n, x) => n + x.size, 0);
        const left = bodies.filter((x) => !out.includes(x.hash));
        const candidates = bodies.filter((x) => x.local && x.uploaded);
        // 上限に収まるか、消せるものを全部消した状態
        expect(total(left) <= limit || left.filter((x) => x.local && x.uploaded).length === 0).toBe(true);
        // 最後に消したものを戻すと上限を超える（余計には消さない）
        if (out.length) expect(total(left) + byHash.get(out[out.length - 1])!.size > limit).toBe(true);
        // 消したものより新しいものを先に消していない
        const evictedMax = Math.max(...out.map((h) => byHash.get(h)!.lastUsed), -1);
        for (const c of candidates.filter((x) => !out.includes(x.hash))) expect(c.lastUsed).toBeGreaterThanOrEqual(evictedMax);
        // 適用後は空
        expect(planCacheEviction({ bodies: bodies.map((x) => (out.includes(x.hash) ? { ...x, local: false } : x)), limitBytes: limit })).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });
});
