import fc from 'fast-check';
import { keyBetween } from './fractional';

test('端の挿入と中間挿入', () => {
  const a = keyBetween(null, null);
  const b = keyBetween(a, null);
  const c = keyBetween(null, a);
  const m = keyBetween(a, b);
  expect(c < a && a < m && m < b).toBe(true);
});

test('連続する桁・接頭辞の関係にある鍵の間にも挿入できる', () => {
  for (const [a, b] of [['0', '1'], ['1', '2'], ['a', 'a1'], ['a', 'b'], ['az', 'b'], [null, '1'], ['y', null], ['0i', '1']] as const) {
    const k = keyBetween(a, b);
    expect(a === null || a < k).toBe(true);
    expect(b === null || k < b).toBe(true);
  }
});

test('任意の位置への挿入を繰り返しても、常に厳密な昇順で重複せず、末尾が最小桁にならない', () => {
  fc.assert(
    fc.property(fc.array(fc.nat(), { minLength: 1, maxLength: 200 }), (positions) => {
      const keys: string[] = [];
      for (const p of positions) {
        const i = p % (keys.length + 1); // 0..length: i 番目の前に挿入
        const k = keyBetween(keys[i - 1] ?? null, keys[i] ?? null);
        keys.splice(i, 0, k);
        expect(k.endsWith('0')).toBe(false);
      }
      for (let i = 1; i < keys.length; i++) expect(keys[i - 1] < keys[i]).toBe(true);
    }),
    { numRuns: 300 },
  );
});

test('先頭・末尾への挿入を 1000 回繰り返しても、鍵は約 5 回で 1 桁しか伸びない（既知の上限）', () => {
  let first: string | null = null;
  let last: string | null = null;
  for (let i = 0; i < 1000; i++) {
    first = keyBetween(null, first);
    last = keyBetween(last, null);
  }
  expect(first!.length).toBeLessThan(250);
  expect(last!.length).toBeLessThan(250);
});

test('a >= b は拒否する', () => {
  expect(() => keyBetween('b', 'a')).toThrow();
  expect(() => keyBetween('a', 'a')).toThrow();
});
