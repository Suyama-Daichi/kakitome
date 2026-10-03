import fc from 'fast-check';
import { diffLines, mergeThreeWay, type DiffLine } from './diff';

const text = (lines: DiffLine[], kinds: DiffLine['kind'][]) => lines.filter((l) => kinds.includes(l.kind)).map((l) => l.text);

describe('diffLines', () => {
  test('同じ・追加・削除を行単位で返す', () => {
    const d = diffLines('a\nb\nc', 'a\nc\nd');
    expect(d).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
  });
  test('同一なら全行 same。空文字列は 0 行として扱う', () => {
    expect(diffLines('x\ny', 'x\ny').every((l) => l.kind === 'same')).toBe(true);
    expect(diffLines('', 'a')).toEqual([{ kind: 'add', text: 'a' }]);
    expect(diffLines('a', '')).toEqual([{ kind: 'del', text: 'a' }]);
    expect(diffLines('', '')).toEqual([]);
  });
  test('任意の入力で: same+del を結合すると元の文、same+add を結合すると新しい文に戻る（空行・末尾改行も保つ）', () => {
    const line = fc.constantFrom('a', 'b', 'c', '', 'd e');
    fc.assert(
      fc.property(fc.array(line, { maxLength: 8 }), fc.array(line, { maxLength: 8 }), (xs, ys) => {
        const a = xs.join('\n');
        const b = ys.join('\n');
        const d = diffLines(a, b);
        const join = (kinds: DiffLine['kind'][]) => {
          const t = text(d, kinds);
          return t.join('\n');
        };
        if (a !== '') expect(join(['same', 'del'])).toBe(a);
        if (b !== '') expect(join(['same', 'add'])).toBe(b);
      }),
      { numRuns: 300 },
    );
  });
});

describe('mergeThreeWay', () => {
  test('片側だけの変更は取り込まれる', () => {
    expect(mergeThreeWay('a\nb\nc', 'a\nB\nc', 'a\nb\nc')).toEqual({ text: 'a\nB\nc', conflicts: 0 });
    expect(mergeThreeWay('a\nb\nc', 'a\nb\nc', 'a\nb\nC')).toEqual({ text: 'a\nb\nC', conflicts: 0 });
  });
  test('両側が別の行を変えたら両方取り込まれる', () => {
    expect(mergeThreeWay('a\nb\nc', 'A\nb\nc', 'a\nb\nC')).toEqual({ text: 'A\nb\nC', conflicts: 0 });
  });
  test('両側が同じ変更をしたら重複しない', () => {
    expect(mergeThreeWay('a\nb', 'a\nX', 'a\nX')).toEqual({ text: 'a\nX', conflicts: 0 });
  });
  test('同じ行を違う内容に変えたら衝突として両方を残す', () => {
    const r = mergeThreeWay('a\nb\nc', 'a\nours\nc', 'a\ntheirs\nc');
    expect(r.conflicts).toBe(1);
    expect(r.text).toBe('a\n<<<<<<< 現在\nours\n=======\ntheirs\n>>>>>>> 競合コピー\nc');
  });
  test('追加だけの変更も取り込む（末尾への追記など）', () => {
    expect(mergeThreeWay('a', 'a\nours', 'a')).toEqual({ text: 'a\nours', conflicts: 0 });
    expect(mergeThreeWay('a', 'a', 'a\ntheirs')).toEqual({ text: 'a\ntheirs', conflicts: 0 });
    expect(mergeThreeWay('', 'x', 'y').conflicts).toBe(1);
  });
  test('両側が同じ場所へ別々に追記したら衝突', () => {
    expect(mergeThreeWay('a', 'a\nours', 'a\ntheirs').conflicts).toBe(1);
  });
  test('任意の入力で: 片側が分岐元のままなら、もう片側がそのまま結果で衝突なし。両側が同じなら同じ', () => {
    const line = fc.constantFrom('a', 'b', 'c', 'd', 'e');
    const doc = fc.array(line, { minLength: 1, maxLength: 7 }).map((l) => l.join('\n'));
    fc.assert(
      fc.property(doc, doc, (base, other) => {
        expect(mergeThreeWay(base, base, other)).toEqual({ text: other, conflicts: 0 });
        expect(mergeThreeWay(base, other, base)).toEqual({ text: other, conflicts: 0 });
        expect(mergeThreeWay(base, other, other)).toEqual({ text: other, conflicts: 0 });
      }),
      { numRuns: 300 },
    );
  });
  test('任意の入力で: 衝突なしなら、結果は現在と競合コピーの両方の追加行を含む', () => {
    const line = fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f');
    const doc = fc.array(line, { minLength: 1, maxLength: 6 }).map((l) => l.join('\n'));
    fc.assert(
      fc.property(doc, doc, doc, (base, ours, theirs) => {
        const r = mergeThreeWay(base, ours, theirs);
        if (r.conflicts > 0) {
          expect(r.text).toContain('<<<<<<<');
          return;
        }
        const out = r.text.split('\n');
        const baseSet = new Set(base.split('\n'));
        for (const side of [ours, theirs]) for (const l of side.split('\n')) if (!baseSet.has(l)) expect(out).toContain(l);
      }),
      { numRuns: 300 },
    );
  });
});
