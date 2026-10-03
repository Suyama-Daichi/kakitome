import { parseHlc } from '../core/hlc';
import { mergeRemoteOps, type Ctx } from '../core/merge';
import type { Op } from '../core/ops';
import { buildSnapshot, parseSnapshot, snapshotToOps } from '../core/snapshot';
import type { Store } from '../core/store';
import { planUploads } from '../core/uploads';
import { collectGarbage, downloadBlob, trimCache, uploadBlob, type BlobPort } from './blobs';
import type { DriveClient, DriveFile } from './drive';

export interface SyncStore extends Store {
  /** 送信待ち（自端末の op）を HLC 順で返す */
  unsentOps(): Op[];
  markUploaded(ids: string[]): void;
  /** device が作った op の全履歴（導出された競合コピーの op は含まない） */
  ownOps(device: string): Op[];
  /** すべての op を送信待ちに戻す（Drive 上のファイル消失からの復元。導出された競合コピーの op は除く） */
  markAllUnsent(): void;
  getState(key: string): string | undefined;
  setState(key: string, value: string): void;
}

export interface SyncOptions {
  /** 自端末の op ファイルがこの数以上になったら圧縮する（設計 §6.4） */
  compactMinFiles?: number;
  now?: () => number;
}

export const COMPACT_MIN_FILES = 20;
const DAY = 86_400_000;
const OWN_FILES = 'own_files';
// 消失を検知したが、まだ再アップロードの準備（全 op を送信待ちに戻す）が済んでいない。検知の直後に通信エラーで落ちても忘れないよう永続化する
const LOST = 'own_files_lost';

const ENTITIES = ['note', 'checklist_item', 'reminder', 'attachment'];
const isPrimitive = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const isNotFound = (e: unknown) => e instanceof Error && e.message.startsWith('Drive API 404');

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
  opts: SyncOptions = {},
): Promise<void> {
  const { store } = ctx;
  const device = parseHlc(ctx.clock.last()).device;
  const now = opts.now ?? Date.now;

  // 自端末が Drive に作ったファイル（op・スナップショット）の ID。消失の検知と圧縮に使う
  const ownFiles = (): string[] => JSON.parse(store.getState(OWN_FILES) ?? '[]');
  const setOwnFiles = (ids: string[]) => store.setState(OWN_FILES, JSON.stringify(ids));
  const isOwn = (f: DriveFile) => f.appProperties?.deviceId === device && (f.appProperties.kind === 'ops' || f.appProperties.kind === 'snapshot');

  // 画像の順序（設計 §7.3）: サムネイル → op → 本体。状態が変わるたびに計画し直す
  const plan = async (allowBodies: boolean) =>
    planUploads({
      unsentOps: store.unsentOps(),
      attachments: blobs ? blobs.attachments() : [],
      blobs: blobs ? blobs.blobs() : new Map(),
      allowBodies,
    });

  const sendOps = async () => {
    if (blobs) for (const h of (await plan(false)).thumbs) await uploadBlob(drive, blobs, h);
    const unsent = (await plan(false)).ops;
    if (!unsent.length) return;
    const first = unsent[0].hlc;
    const file = await drive.createFile(
      { name: `ops_${device}_${first}.jsonl`, appProperties: { deviceId: device, hlc: first, kind: 'ops' } },
      unsent.map((o) => JSON.stringify(o)).join('\n') + '\n',
    );
    setOwnFiles([...ownFiles(), file.id]); // 先に記録（消失検知の対象にする）
    store.markUploaded(unsent.map((o) => o.id)); // ここで落ちても次回は別ファイルで再送されるだけ
  };
  // 以前の版から更新した端末の初回: 既存の自端末ファイルを記録する（送信前なので、以後の消失検知に含められる）
  if (store.getState(OWN_FILES) === undefined && store.getState('drive_page_token')) {
    setOwnFiles((await drive.listFiles()).filter(isOwn).map((f) => f.id));
  }
  await sendOps();

  const markLost = () => store.setState(LOST, '1');
  const ingest = async (files: (DriveFile | undefined)[]) => {
    for (const f of files) {
      const p = f?.appProperties;
      if (f && blobs && p?.kind === 'blob' && p.hash) blobs.setRemote(p.hash, f.id);
      if (!f || (p?.kind !== 'ops' && p?.kind !== 'snapshot') || p.deviceId === device) continue; // 自端末のファイルは適用済み
      let text: string;
      try {
        text = await drive.download(f.id);
      } catch (e) {
        if (isNotFound(e)) continue; // 取得前に持ち主の端末が圧縮して消した。置き換えのスナップショットが別に届く
        throw e;
      }
      let ops: Op[];
      if (p.kind === 'ops') ops = parseOps(text);
      else {
        const snap = parseSnapshot(text); // スナップショットは疑似 op に戻して適用する（冪等）
        ops = snap && snap.device !== device ? snapshotToOps(snap) : [];
      }
      tx(() => mergeRemoteOps(ctx, ops));
    }
  };

  let token = store.getState('drive_page_token');
  if (!token) {
    // 先にトークンを取ってから全件を読む。間に増えたファイルは次の changes で拾う
    token = await drive.getStartPageToken();
    const files = await drive.listFiles();
    await ingest(files);
    const present = new Set(files.map((f) => f.id));
    if (store.getState(OWN_FILES) === undefined) setOwnFiles(files.filter(isOwn).map((f) => f.id));
    else if (ownFiles().some((id) => !present.has(id))) markLost();
    store.setState('drive_page_token', token);
  }
  for (;;) {
    const page = await drive.listChanges(token);
    await ingest(page.changes.filter((c) => !c.removed).map((c) => c.file));
    // 削除通知は op の適用後に処理する（同じページの「添付の削除」op を先に反映して、生きた参照かを正しく判定するため）
    const mine = new Set(ownFiles());
    for (const c of page.changes) {
      if (!c.removed || !c.fileId) continue;
      if (mine.has(c.fileId)) markLost(); // 自端末が作ったファイルが Drive から消えた
      if (blobs) await blobs.forgetRemote(c.fileId);
    }
    token = page.nextPageToken ?? page.newStartPageToken ?? token;
    store.setState('drive_page_token', token); // 処理後に進める（少なくとも1回は適用）
    if (!page.nextPageToken) break;
  }

  // 設計 §6.5: Drive 上のファイルが消えたら、手元の全データから再アップロードする（重複は冪等）
  if (store.getState(LOST) === '1') {
    store.markAllUnsent();
    setOwnFiles([]);
    store.setState(LOST, '0'); // 送信待ちに戻した後で下ろす。送信に失敗しても、次回の sendOps が再送する
    await sendOps();
  }

  if (blobs) {
    // サムネイルは先読み。本体は遅延ダウンロード（表示時）。取得に失敗しても同期全体は止めない
    for (const h of blobs.missingThumbs()) await downloadBlob(drive, blobs, h).catch(() => false);
    // 本体のアップロードは最後（「Wi-Fi 接続時のみ」設定に従う）
    const { bodies } = await plan(await blobs.allowBodies());
    for (const h of bodies) await uploadBlob(drive, blobs, h);
  }

  // 圧縮と後始末は同期の成否に影響させない（次回に持ち越す）
  await compact().catch(() => {});
  if (blobs) {
    await collectGarbage(drive, blobs).catch(() => {});
    await trimCache(blobs).catch(() => {});
  }

  /**
   * 設計 §6.4: 自端末の op だけを自分で圧縮する。
   * 新しいスナップショットを作り（不変）、確認してから、古い自端末のファイルを削除する。
   * 途中で落ちても、重複するだけで害はない。
   */
  async function compact() {
    if (store.unsentOps().length) return;
    if (ownFiles().length < (opts.compactMinFiles ?? COMPACT_MIN_FILES)) return;
    if (now() - Number(store.getState('last_compaction') ?? 0) < DAY) return;
    const own = store.ownOps(device);
    if (!own.length) return;
    const snap = buildSnapshot(device, own);
    const file = await drive.createFile(
      { name: `snapshot_${device}_${snap.upTo}.json`, appProperties: { deviceId: device, hlc: snap.upTo, kind: 'snapshot' } },
      JSON.stringify(snap),
    );
    // 記録に無い古い自端末ファイル（以前の版が作ったもの）も一覧から拾う
    const listed = (await drive.listFiles()).filter((f) => isOwn(f) && f.id !== file.id).map((f) => f.id);
    let remaining = [file.id, ...new Set([...ownFiles(), ...listed])];
    setOwnFiles(remaining);
    for (const id of remaining.slice(1)) {
      try {
        await drive.deleteFile(id);
      } catch {
        continue; // 消せなかったものは記録に残し、次回やり直す
      }
      remaining = remaining.filter((x) => x !== id);
      setOwnFiles(remaining); // 消した分は記録から外す（その削除通知を「消失」と誤認しないため）
    }
    store.setState('last_compaction', String(now()));
  }
}
