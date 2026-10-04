// 最小の ZIP 読み取り（Takeout の ZIP 用）。ブラウザ標準の DecompressionStream で展開する。
// ponytail: 4GB 超（ZIP64）・暗号化には未対応。必要になったら fflate などを入れる
export interface ZipEntry {
  name: string;
  /** 中身。大きな画像でメモリを使い切らないよう、ArrayBuffer ではなく Blob（ブラウザが管理する領域）で返す */
  blob(): Promise<Blob>;
}

export async function readZip(file: Blob): Promise<ZipEntry[]> {
  const tail = new DataView(await file.slice(Math.max(0, file.size - 65557)).arrayBuffer());
  let e = tail.byteLength - 22;
  while (e >= 0 && tail.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('ZIP ファイルとして読めません');
  const count = tail.getUint16(e + 10, true);
  const cdSize = tail.getUint32(e + 12, true);
  const cdOffset = tail.getUint32(e + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('4GB を超える ZIP には未対応です');

  if (cdSize > 64 * 1024 * 1024) throw new Error('ZIP の構造が想定と違います');
  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const utf8 = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    const method = cd.getUint16(p + 10, true);
    const compressed = cd.getUint32(p + 20, true);
    const nameLen = cd.getUint16(p + 28, true);
    const skip = cd.getUint16(p + 30, true) + cd.getUint16(p + 32, true);
    const offset = cd.getUint32(p + 42, true);
    const name = utf8.decode(new Uint8Array(cd.buffer, p + 46, nameLen));
    p += 46 + nameLen + skip;
    if (name.endsWith('/')) continue;
    entries.push({
      name,
      blob: async () => {
        const h = new DataView(await file.slice(offset, offset + 30).arrayBuffer());
        const start = offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
        const raw = file.slice(start, start + compressed);
        if (method === 0) return raw;
        if (method !== 8) throw new Error(`未対応の圧縮方式です（${method}）`);
        return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      },
    });
  }
  return entries;
}
