import { parseHlc } from '../core/hlc';
import { mergeRemoteOps, type Ctx } from '../core/merge';
import type { Op } from '../core/ops';
import type { Store } from '../core/store';
import { planUploads } from '../core/uploads';
import { collectGarbage, downloadBlob, trimCache, uploadBlob, type BlobPort } from './blobs';
import type { DriveClient, DriveFile } from './drive';

export interface SyncStore extends Store {
  /** 送信待ち（自端末の op）を HLC 順で返す */
  unsentOps(): Op[];
  markUploaded(ids: string[]): void;
  getState(key: string): string | undefined;
  setState(key: string, value: string): void;
}

const ENTITIES = ['note', 'checklist_item', 'reminder', 'attachment'];
const isPrimitive = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** 壊れた行・不正な op で同期全体が止まらないよう、受信 op は形を検証して捨てる */
function parseOps(text: string): Op[] {
  const ops: Op[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      const ok =
        typeof o.id === 'string' && typeof o.hlc === 'string' && ENTITIES.includes(o.entity) &&
        typeof o.entityId === 'string' && o.fields && o.base &&
        Object.values(o.fields).every(isPrimitive) && Object.values(o.base).every((v) => typeof v === 'string');
      if (ok) {
        parseHlc(o.hlc);
        ops.push(o);
      }
    } catch {
      // 不正な行は無視
    }
  }
  return ops;
}

/**
 * 1回の同期: 未送信 op を不変ファイルとして新規作成 → 他端末のファイルを取得して適用（設計 §6.3）。
 * どこで失敗しても再実行でき、適用が冪等なので重複しても収束する。
 * `tx` は受信 op の適用を囲むトランザクション（SQLite 用）。
 */
export async function syncOnce(
  ctx: Ctx & { store: SyncStore },
  drive: DriveClient,
  tx: <T>(fn: () => T) => T = (fn) => fn(),
  blobs?: BlobPort,
): Promise<void> {
  const { store } = ctx;
  const device = parseHlc(ctx.clock.last()).device;

  // 画像の順序（設計 §7.3）: サムネイル → op → 本体。状態が変わるたびに計画し直す
  const plan = async (allowBodies: boolean) =>
    planUploads({
      unsentOps: store.unsentOps(),
      attachments: blobs ? blobs.attachments() : [],
      blobs: blobs ? blobs.blobs() : new Map(),
      allowBodies,
    });
  if (blobs) for (const h of (await plan(false)).thumbs) await uploadBlob(drive, blobs, h);

  const unsent = (await plan(false)).ops;
  if (unsent.length) {
    const first = unsent[0].hlc;
    await drive.createFile(
      { name: `ops_${device}_${first}.jsonl`, appProperties: { deviceId: device, hlc: first, kind: 'ops' } },
      unsent.map((o) => JSON.stringify(o)).join('\n') + '\n',
    );
    store.markUploaded(unsent.map((o) => o.id)); // ここで落ちても次回は別ファイルで再送されるだけ
  }

  const ingest = async (files: (DriveFile | undefined)[]) => {
    for (const f of files) {
      const p = f?.appProperties;
      if (f && blobs && p?.kind === 'blob' && p.hash) blobs.setRemote(p.hash, f.id);
      if (!f || p?.kind !== 'ops' || p.deviceId === device) continue; // 自端末のファイルは適用済み
      const ops = parseOps(await drive.download(f.id));
      tx(() => mergeRemoteOps(ctx, ops));
    }
  };

  let token = store.getState('drive_page_token');
  if (!token) {
    // 先にトークンを取ってから全件を読む。間に増えたファイルは次の changes で拾う
    token = await drive.getStartPageToken();
    await ingest(await drive.listFiles());
    store.setState('drive_page_token', token);
  }
  for (;;) {
    const page = await drive.listChanges(token);
    await ingest(page.changes.filter((c) => !c.removed).map((c) => c.file));
    // 削除通知は op の適用後に処理する（同じページの「添付の削除」op を先に反映して、生きた参照かを正しく判定するため）
    if (blobs) for (const c of page.changes) if (c.removed && c.fileId) await blobs.forgetRemote(c.fileId);
    token = page.nextPageToken ?? page.newStartPageToken ?? token;
    store.setState('drive_page_token', token); // 処理後に進める（少なくとも1回は適用）
    if (!page.nextPageToken) break;
  }

  if (!blobs) return;
  // サムネイルは先読み。本体は遅延ダウンロード（表示時）。取得に失敗しても同期全体は止めない
  for (const h of blobs.missingThumbs()) await downloadBlob(drive, blobs, h).catch(() => false);
  // 本体のアップロードは最後（「Wi-Fi 接続時のみ」設定に従う）
  const { bodies } = await plan(await blobs.allowBodies());
  for (const h of bodies) await uploadBlob(drive, blobs, h);

  // 後始末は同期の成否に影響させない（次回に持ち越す）
  await collectGarbage(drive, blobs).catch(() => {});
  await trimCache(blobs).catch(() => {});
}
