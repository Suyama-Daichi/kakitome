import fc from 'fast-check';
import { createClock, formatHlc, parseHlc } from './hlc';

test('format/parse roundtrip、文字列順 = (ms, counter, device) 順', () => {
  const hlc = fc.record({
    ms: fc.integer({ min: 0, max: 9_999_999_999_999 }),
    counter: fc.integer({ min: 0, max: 9999 }),
    device: fc.constantFrom('dev-a', 'dev-b', 'z'),
  });
  fc.assert(
    fc.property(hlc, hlc, (a, b) => {
      expect(parseHlc(formatHlc(a))).toEqual(a);
      const num = a.ms - b.ms || a.counter - b.counter || (a.device < b.device ? -1 : a.device > b.device ? 1 : 0);
      const str = formatHlc(a) < formatHlc(b) ? -1 : formatHlc(a) > formatHlc(b) ? 1 : 0;
      expect(Math.sign(num)).toBe(str);
    }),
  );
});

test('時計が巻き戻っても now() は単調増加、receive 後は remote より大きい', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.oneof(
          fc.record({ t: fc.integer({ min: 1, max: 50 }), recv: fc.constant(undefined) }),
          fc.record({ t: fc.integer({ min: 1, max: 50 }), recv: fc.integer({ min: 1, max: 60 }) }),
        ),
        { minLength: 1, maxLength: 50 },
      ),
      (steps) => {
        let t = 0;
        const c = createClock('dev-a', () => t);
        let prev = '';
        for (const s of steps) {
          t = s.t; // 巻き戻りを含むランダムな時刻
          if (s.recv !== undefined) {
            const remote = formatHlc({ ms: s.recv, counter: 3, device: 'dev-b' });
            c.receive(remote);
            expect(c.now() > remote).toBe(true);
          }
          const h = c.now();
          expect(h > prev).toBe(true);
          prev = h;
        }
      },
    ),
  );
});

test('last を渡すと再起動後も単調', () => {
  const a = createClock('d', () => 1000);
  const h = a.now();
  expect(createClock('d', () => 0, a.last()).now() > h).toBe(true);
});
