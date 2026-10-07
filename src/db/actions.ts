import { keyBetween } from '../core/fractional';
import { applyLocalOp } from '../core/merge';
import { completeFields } from '../core/reminders';
import type { Json } from '../core/ops';
import { getDb, openCore } from './index';
import { getNote, getReminder, itemChecked, maxAttachmentKey, maxItemKey, minNoteKey } from './queries';

/** アプリ・ウィジェット共通。変更は必ず applyLocalOp 経由 */
export function toggleItem(itemId: string) {
  const { ctx, tx } = openCore();
  tx(() => applyLocalOp(ctx, 'checklist_item', itemId, { checked: itemChecked(itemId) ? 0 : 1 }));
}

const nowIso = () => new Date().toISOString();

/** 新しいメモを一覧の先頭に作る */
export function createNote(): string {
  const { ctx, tx } = openCore();
  return tx(() => {
    const id = ctx.newId();
    applyLocalOp(ctx, 'note', id, { title: '', body: '', pinned: 0, list_view: '', sort_key: keyBetween(null, minNoteKey()), deleted: 0, created_at: nowIso() });
    return id;
  });
}

/** メモのフィールド更新。値が変わっていないものは op を出さない */
export function updateNote(id: string, fields: { title?: string; body?: string; pinned?: number; list_view?: string; deleted?: number }) {
  const cur = getNote(id) as Record<string, Json> | undefined;
  const changed = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== undefined && (k === 'deleted' || cur?.[k] !== v)));
  if (!Object.keys(changed).length) return;
  const { ctx, tx } = openCore();
  tx(() => applyLocalOp(ctx, 'note', id, changed as Record<string, Json>));
}

/**
 * 並び替え（メモ・チェック項目）。order は移動後の並び（メモは同じピン留め状態のものだけ、項目は同じメモの未完了だけ）、moved は動かした 1 件の位置。
 * 動かした1件の sort_key だけを前後の間に変える。前後の鍵が使えない（空・同値）ときは全件を振り直す
 */
export function moveSorted(entity: 'note' | 'checklist_item', order: { id: string; sort_key: string }[], moved: number) {
  const prev = order[moved - 1]?.sort_key || null;
  const next = order[moved + 1]?.sort_key ?? null;
  const { ctx, tx } = openCore();
  tx(() => {
    try {
      if (next === '') throw new Error('no room');
      applyLocalOp(ctx, entity, order[moved].id, { sort_key: keyBetween(prev, next) });
    } catch {
      let k: string | null = null;
      for (const n of order) applyLocalOp(ctx, entity, n.id, { sort_key: (k = keyBetween(k, null)) });
    }
  });
}

export function addItem(noteId: string, text = ''): string {
  const { ctx, tx } = openCore();
  return tx(() => {
    const id = ctx.newId();
    applyLocalOp(ctx, 'checklist_item', id, { note_id: noteId, text, checked: 0, sort_key: keyBetween(maxItemKey(noteId), null), deleted: 0, created_at: nowIso() });
    return id;
  });
}

export function updateItemText(id: string, text: string) {
  const { ctx, tx } = openCore();
  tx(() => applyLocalOp(ctx, 'checklist_item', id, { text }));
}

/** 削除は墓標 */
export function deleteItem(id: string) {
  const { ctx, tx } = openCore();
  tx(() => applyLocalOp(ctx, 'checklist_item', id, { deleted: 1 }));
}

const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function addReminder(noteId: string, fireAt: Date, rrule: string | null): string {
  const { ctx, tx } = openCore();
  return tx(() => {
    const id = ctx.newId();
    applyLocalOp(ctx, 'reminder', id, { note_id: noteId, fire_at: fireAt.toISOString(), timezone: deviceTimeZone(), rrule, enabled: 1, deleted: 0 });
    return id;
  });
}

/** 日時と繰り返しを変える。変えたら鳴るように有効に戻す */
export function updateReminder(id: string, fireAt: Date, rrule: string | null) {
  const { ctx, tx } = openCore();
  tx(() => applyLocalOp(ctx, 'reminder', id, { fire_at: fireAt.toISOString(), timezone: deviceTimeZone(), rrule, enabled: 1 }));
}

export function setReminderEnabled(id: string, enabled: boolean) {
  const { ctx, tx } = openCore();
  tx(() => applyLocalOp(ctx, 'reminder', id, { enabled: enabled ? 1 : 0 }));
}

/** 通知の「完了」。単発は無効にし、繰り返しはそのまま（core の completeFields）。op を出したら true */
export function completeReminder(id: string): boolean {
  const rem = getReminder(id);
  const fields = rem && completeFields({ rrule: rem.rrule, enabled: !!rem.enabled });
  if (!fields) return false;
  const { ctx, tx } = openCore();
  tx(() => applyLocalOp(ctx, 'reminder', id, fields));
  return true;
}

export function deleteReminder(id: string) {
  const { ctx, tx } = openCore();
  tx(() => applyLocalOp(ctx, 'reminder', id, { deleted: 1 }));
}

/** すべてのメモを削除する（墓標。同期すると他の端末のメモも消える）。競合コピーも含む。消した件数を返す */
export function deleteAllNotes(): number {
  const { ctx, tx } = openCore();
  return tx(() => {
    const ids = getDb().getAllSync<{ id: string }>('SELECT id FROM notes WHERE deleted = 0');
    for (const { id } of ids) applyLocalOp(ctx, 'note', id, { deleted: 1 });
    return ids.length;
  });
}

export interface ProcessedImage {
  hash: string;
  thumbHash: string;
  width: number;
  height: number;
  size: number;
}

/** 画像は blobs に登録（端末に実体あり・未アップロード）し、メタデータだけを op で記録する（設計 §7.1）。tx の中で呼ぶ */
function putAttachment(ctx: ReturnType<typeof openCore>['ctx'], noteId: string, img: ProcessedImage): string {
  const now = nowIso();
  for (const hash of [img.hash, img.thumbHash]) {
    getDb().runSync(
      "INSERT INTO blobs (hash, local_path, uploaded, last_used) VALUES (?, ?, 0, ?) ON CONFLICT(hash) DO UPDATE SET local_path = excluded.local_path, last_used = excluded.last_used",
      hash, `blobs/${hash}`, now,
    );
  }
  const id = ctx.newId();
  applyLocalOp(ctx, 'attachment', id, {
    note_id: noteId, hash: img.hash, thumb_hash: img.thumbHash, mime: 'image/jpeg',
    width: img.width, height: img.height, size: img.size,
    sort_key: keyBetween(maxAttachmentKey(noteId), null), deleted: 0, created_at: now,
  });
  return id;
}

export function addAttachment(noteId: string, img: ProcessedImage): string {
  const { ctx, tx } = openCore();
  return tx(() => putAttachment(ctx, noteId, img));
}

const importMark = (key: string) => `import:${key}`;

/** 他のサービスから取り込み済みか（同じものを 2 回取り込まないための、この端末だけの記録）。取り込んだメモを消したあとは、もう一度取り込める */
export const isImported = (key: string) =>
  // 値が '1' の記録は、メモの ID を持たない古い形式。取り込み済みとして扱い続ける
  !!getDb().getFirstSync(
    "SELECT 1 FROM sync_state s LEFT JOIN notes n ON n.id = s.value WHERE s.key = ? AND (s.value = '1' OR n.deleted = 0)",
    importMark(key),
  );

/** 他のサービスのメモを 1 件、まとめて取り込む。メモ・項目・画像・取り込み済みの記録を 1 つのトランザクションで書く */
export function importNote(
  key: string,
  n: { title: string; body: string; pinned: boolean; createdAt: string; items: { text: string; checked: boolean }[]; images: ProcessedImage[] },
): string {
  const { ctx, tx } = openCore();
  return tx(() => {
    const id = ctx.newId();
    applyLocalOp(ctx, 'note', id, {
      title: n.title, body: n.body, pinned: n.pinned ? 1 : 0, sort_key: keyBetween(null, minNoteKey()), deleted: 0, created_at: n.createdAt,
    });
    let last: string | null = null;
    for (const it of n.items) {
      applyLocalOp(ctx, 'checklist_item', ctx.newId(), {
        note_id: id, text: it.text, checked: it.checked ? 1 : 0, sort_key: (last = keyBetween(last, null)), deleted: 0, created_at: n.createdAt,
      });
    }
    for (const img of n.images) putAttachment(ctx, id, img);
    getDb().runSync('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', importMark(key), id);
    return id;
  });
}

/** 削除は墓標のみ。blob 本体は別メモから参照されうるので消さない（設計 §7.4） */
export function deleteAttachment(id: string) {
  const { ctx, tx } = openCore();
  tx(() => applyLocalOp(ctx, 'attachment', id, { deleted: 1 }));
}

/**
 * 競合の解消（設計 §5.4）: 元メモのフィールドを resolved にし、競合コピーを墓標にする。
 * どちらも通常の編集（applyLocalOp）なので、他端末にも同じ形で伝わる。
 */
export function resolveConflict(conflict: { copyId: string; noteId: string; field: 'title' | 'body' }, resolved: string) {
  const { ctx, tx } = openCore();
  tx(() => {
    const cur = getNote(conflict.noteId) as Record<string, Json> | undefined;
    if (cur && cur[conflict.field] !== resolved) applyLocalOp(ctx, 'note', conflict.noteId, { [conflict.field]: resolved });
    applyLocalOp(ctx, 'note', conflict.copyId, { deleted: 1 });
  });
}
