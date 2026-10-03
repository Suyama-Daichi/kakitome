import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { stripJpegMetadata } from '../core/jpeg';
import type { ProcessedImage } from '../db/actions';
import { writeBlob } from './blobs';

const MAIN_EDGE = 2048; // 設計 §7.2
const THUMB_EDGE = 320;

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/** 長辺が maxEdge を超えるときだけ縮小し、JPEG で保存する（HEIC などもここで JPEG になる） */
async function toJpeg(uri: string, maxEdge: number, compress: number) {
  const { width, height } = await ImageManipulator.manipulate(uri).renderAsync();
  const ctx = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > maxEdge) ctx.resize(width >= height ? { width: maxEdge } : { height: maxEdge });
  return (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress });
}

/** 一時ファイルを読み、メタデータ（EXIF=位置情報など）を必ず除去してから SHA-256 で名前を付けて保存する */
async function store(tmpUri: string): Promise<{ hash: string; size: number }> {
  const tmp = new File(tmpUri);
  const bytes = stripJpegMetadata(await tmp.bytes());
  const hash = hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
  writeBlob(hash, bytes);
  tmp.delete();
  return { hash, size: bytes.length };
}

/** 選んだ画像 → 本体（長辺 2048px）とサムネイル（長辺 320px）を端末に保存する */
export async function importImage(uri: string): Promise<ProcessedImage> {
  const main = await toJpeg(uri, MAIN_EDGE, 0.8);
  const thumb = await toJpeg(main.uri, THUMB_EDGE, 0.7);
  const m = await store(main.uri);
  const t = await store(thumb.uri);
  return { hash: m.hash, thumbHash: t.hash, width: main.width, height: main.height, size: m.size };
}
