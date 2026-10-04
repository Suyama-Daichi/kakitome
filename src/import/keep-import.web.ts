import { importNote, isImported } from '../db/actions';
import type { ProcessedImage } from '../db/actions';
import { importImage } from '../media/process';
import { isEmptyNote, parseKeepNote } from './keep';
import { readZip, type ZipEntry } from './zip';

export interface KeepImportResult {
  imported: number;
  skipped: { trashed: number; already: number; empty: number; attachments: number };
}

const baseName = (path: string) => path.split('/').pop() ?? path;

/** 選んだファイル（Takeout の ZIP、または展開した JSON・画像）を、1 ファイルずつ中身の一覧にする */
async function collect(files: File[]): Promise<ZipEntry[]> {
  const all: ZipEntry[] = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) all.push(...(await readZip(f)));
    else all.push({ name: f.name, bytes: async () => new Uint8Array(await f.arrayBuffer()) });
  }
  return all;
}

/** Google Keep の Takeout を取り込む。古い順に作るので、最後に編集したメモが一覧の先頭になる */
export async function importKeep(files: File[], onProgress: (done: number, total: number) => void): Promise<KeepImportResult> {
  const entries = await collect(files);
  const media = new Map(entries.filter((e) => !/\.(json|html|txt)$/i.test(e.name)).map((e) => [baseName(e.name), e]));

  const notes = [];
  for (const e of entries.filter((e) => /\.json$/i.test(e.name))) {
    try {
      const n = parseKeepNote(JSON.parse(new TextDecoder().decode(await e.bytes())));
      if (n) notes.push(n);
    } catch {
      // Keep のメモではない JSON は無視する
    }
  }
  notes.sort((a, b) => a.editedAt - b.editedAt);

  const result: KeepImportResult = { imported: 0, skipped: { trashed: 0, already: 0, empty: 0, attachments: 0 } };
  for (const [i, n] of notes.entries()) {
    onProgress(i, notes.length);
    await new Promise((r) => setTimeout(r)); // 画面を更新できるよう、1 件ごとに手放す
    if (n.trashed) { result.skipped.trashed++; continue; }
    if (isEmptyNote(n)) { result.skipped.empty++; continue; }
    if (isImported(n.key)) { result.skipped.already++; continue; }

    const images: ProcessedImage[] = [];
    for (const a of n.attachments) {
      const src = media.get(baseName(a.name));
      if (!a.mime.startsWith('image/') || !src) { result.skipped.attachments++; continue; } // 音声など
      const url = URL.createObjectURL(new Blob([(await src.bytes()) as Uint8Array<ArrayBuffer>], { type: a.mime }));
      try {
        images.push(await importImage(url));
      } catch {
        result.skipped.attachments++; // ブラウザが読めない形式
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    importNote(n.key, { title: n.title, body: n.body, pinned: n.pinned, createdAt: n.createdAt, items: n.items, images });
    result.imported++;
  }
  onProgress(notes.length, notes.length);
  return result;
}
