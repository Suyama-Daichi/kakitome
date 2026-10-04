import { stripJpegMetadata } from '../core/jpeg';
import type { ProcessedImage } from '../db/actions';
import { isHighQuality, sha256Hex } from './blob-port';
import { writeBlob } from './blobs';

const MAIN_EDGE = 2048; // 設計 §7.2
const HQ_EDGE = 4096; // 「画像を高画質で添付」がオンのとき
const THUMB_EDGE = 320;

/** 長辺が maxEdge を超えるときだけ縮小し、canvas で JPEG にする（再エンコードで EXIF は落ちる。念のため stripJpegMetadata も通す） */
async function toJpeg(src: ImageBitmap, maxEdge: number, quality: number) {
  const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(src.width * scale);
  canvas.height = Math.round(src.height * scale);
  canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
  if (!blob) throw new Error('画像を変換できませんでした');
  return { width: canvas.width, height: canvas.height, bytes: stripJpegMetadata(new Uint8Array(await blob.arrayBuffer())), bitmap: canvas };
}

async function store(bytes: Uint8Array) {
  const hash = await sha256Hex(bytes as Uint8Array<ArrayBuffer>);
  await writeBlob(hash, bytes);
  return { hash, size: bytes.length };
}

/** 選んだ画像 → 本体（長辺 2048px）とサムネイル（長辺 320px）を保存する */
export async function importImage(uri: string): Promise<ProcessedImage> {
  const src = await createImageBitmap(await (await fetch(uri)).blob()); // 既定で EXIF の向きを反映する
  const main = await toJpeg(src, isHighQuality() ? HQ_EDGE : MAIN_EDGE, isHighQuality() ? 0.9 : 0.8);
  const thumb = await toJpeg(await createImageBitmap(main.bitmap), THUMB_EDGE, 0.7);
  src.close();
  const m = await store(main.bytes);
  const t = await store(thumb.bytes);
  return { hash: m.hash, thumbHash: t.hash, width: main.width, height: main.height, size: m.size };
}
