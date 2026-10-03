// JPEG のメタデータ（EXIF=位置情報など）除去。画像はアップロード前に必ず通す（CLAUDE.md の不変条件）。
// 向き(Orientation)も EXIF にあるため、除去の前に画素へ反映済みであること（src/media/process.ts）。

/** 取り除くセグメント: APP1(EXIF/XMP)、APP3-13・15、COM。JFIF(APP0)・ICC(APP2)・Adobe(APP14) は描画に要るので残す */
const isMetadata = (m: number) => m === 0xe1 || (m >= 0xe3 && m <= 0xed) || m === 0xef || m === 0xfe;

function walk(b: Uint8Array, visit: (marker: number, start: number, end: number) => void): number {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new Error('not a JPEG');
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error('corrupt JPEG: marker expected');
    while (b[i + 1] === 0xff) i++; // フィル
    const m = b[i + 1];
    if (m === 0xda || m === 0xd9) return i; // SOS/EOI: 以降はスキャンデータ（変更しない）
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      visit(m, i, i + 2);
      i += 2;
      continue;
    }
    if (i + 3 >= b.length) throw new Error('corrupt JPEG: truncated segment');
    const end = i + 2 + ((b[i + 2] << 8) | b[i + 3]);
    if (end > b.length) throw new Error('corrupt JPEG: segment past end');
    visit(m, i, end);
    i = end;
  }
  throw new Error('corrupt JPEG: no SOS/EOI');
}

export function hasJpegMetadata(b: Uint8Array): boolean {
  let found = false;
  walk(b, (m) => {
    if (isMetadata(m)) found = true;
  });
  return found;
}

export function stripJpegMetadata(b: Uint8Array): Uint8Array<ArrayBuffer> {
  const keep: [number, number][] = [[0, 2]];
  const tail = walk(b, (m, s, e) => {
    if (!isMetadata(m)) keep.push([s, e]);
  });
  keep.push([tail, b.length]);
  const out = new Uint8Array(keep.reduce((n, [s, e]) => n + e - s, 0));
  let o = 0;
  for (const [s, e] of keep) {
    out.set(b.subarray(s, e), o);
    o += e - s;
  }
  return out;
}
