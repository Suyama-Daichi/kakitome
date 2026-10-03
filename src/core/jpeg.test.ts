import fc from 'fast-check';
import { hasJpegMetadata, stripJpegMetadata } from './jpeg';

const seg = (marker: number, payload: number[]) => {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...payload];
};
const exif = (extra: number[] = []) => seg(0xe1, [...Array.from('Exif\0\0', (c) => c.charCodeAt(0)), ...extra]);
const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const SOS = seg(0xda, [1, 1, 0, 0, 63, 0]);
const bytes = (...parts: number[][]) => new Uint8Array(parts.flat());

test('EXIF(APP1) を取り除き、残りはそのまま', () => {
  const jfif = seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]);
  const dqt = seg(0xdb, [0, 1, 2, 3]);
  const scan = [1, 2, 0xff, 0x00, 3, 0xff, 0xd0, 4];
  const input = bytes(SOI, jfif, exif([0x47, 0x50, 0x53]), dqt, SOS, scan, EOI);
  expect(hasJpegMetadata(input)).toBe(true);
  const out = stripJpegMetadata(input);
  expect([...out]).toEqual([...bytes(SOI, jfif, dqt, SOS, scan, EOI)]);
  expect(hasJpegMetadata(out)).toBe(false);
});

test('XMP・IPTC・コメントも消し、JFIF・ICC・Adobe は残す', () => {
  const keep = [seg(0xe0, [1]), seg(0xe2, [2]), seg(0xee, [3])];
  const drop = [seg(0xe1, [9]), seg(0xed, [9]), seg(0xfe, [9]), seg(0xe5, [9])];
  const input = bytes(SOI, ...drop, ...keep, SOS, [7], EOI);
  expect([...stripJpegMetadata(input)]).toEqual([...bytes(SOI, ...keep, SOS, [7], EOI)]);
});

test('JPEG でない・壊れた入力は例外（黙って素通ししない）', () => {
  expect(() => stripJpegMetadata(new Uint8Array([1, 2, 3, 4]))).toThrow();
  expect(() => stripJpegMetadata(bytes(SOI, [0xff, 0xe1, 0xff, 0xff, 1, 2]))).toThrow();
});

test('任意の構成で: メタデータが無くなり、他のセグメントとスキャンは不変で、冪等', () => {
  const payload = fc.array(fc.nat(255), { maxLength: 60 });
  const marker = fc.constantFrom(0xe0, 0xe1, 0xe2, 0xe3, 0xed, 0xee, 0xfe, 0xdb, 0xc4, 0xc0);
  const scan = fc.array(fc.nat(255), { maxLength: 80 }).map((a) => a.flatMap((v) => (v === 0xff ? [0xff, 0x00] : [v])));
  fc.assert(
    fc.property(fc.array(fc.tuple(marker, payload), { maxLength: 12 }), scan, (segs, scanData) => {
      const segments = segs.map(([m, p]) => seg(m, p));
      const input = bytes(SOI, ...segments, SOS, scanData, EOI);
      const out = stripJpegMetadata(input);
      const removable = new Set([0xe1, 0xe3, 0xed, 0xfe]);
      const expected = bytes(SOI, ...segs.filter(([m]) => !removable.has(m)).map(([m, p]) => seg(m, p)), SOS, scanData, EOI);
      expect([...out]).toEqual([...expected]);
      expect([...stripJpegMetadata(out)]).toEqual([...out]);
      expect(hasJpegMetadata(out)).toBe(false);
    }),
    { numRuns: 200 },
  );
});
