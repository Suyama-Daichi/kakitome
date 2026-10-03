import { keyBetween } from '../core/fractional';
import { applyLocalOp } from '../core/merge';
import type { Json } from '../core/ops';
import { getDb, openCore } from './index';
import { firstNoteWithItems, getNote, itemChecked, maxAttachmentKey, maxItemKey, minNoteKey } from './queries';

/** アプリ・ウィジェット共通。変更は必ず applyLocalOp 経由 */
export function toggleItem(itemId: string) {
  const { ctx, tx } = openCore();
  tx(() => applyLocalOp(ctx, 'checklist_item', itemId, { checked: itemChecked(itemId) ? 0 : 1 }));
}

/** PoC 用のデモデータ。ノートが無いときだけ投入 */
export function seedDemo() {
  if (firstNoteWithItems()) return;
  const { ctx, tx } = openCore();
  const now = new Date().toISOString();
  tx(() => {
    const noteId = ctx.newId();
    applyLocalOp(ctx, 'note', noteId, { title: '買い物', body: '', pinned: 0, sort_key: 'a0', deleted: 0, created_at: now });
    ['牛乳', '卵', 'パン'].forEach((text, i) =>
      applyLocalOp(ctx, 'checklist_item', ctx.newId(), { note_id: noteId, text, checked: 0, sort_key: `a${i}`, deleted: 0, created_at: now }),
    );
  });
}

const nowIso = () => new Date().toISOString();

/** 新しいメモを一覧の先頭に作る */
export function createNote(): string {
  const { ctx, tx } = openCore();
  return tx(() => {
    const id = ctx.newId();
    applyLocalOp(ctx, 'note', id, { title: '', body: '', pinned: 0, sort_key: keyBetween(null, minNoteKey()), deleted: 0, created_at: nowIso() });
    return id;
  });
}

/** メモのフィールド更新。値が変わっていないものは op を出さない */
export function updateNote(id: string, fields: { title?: string; body?: string; pinned?: number; deleted?: number }) {
  const cur = getNote(id) as Record<string, Json> | undefined;
  const changed = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== undefined && (k === 'deleted' || cur?.[k] !== v)));
  if (!Object.keys(changed).length) return;
  const { ctx, tx } = openCore();
  tx(() => applyLocalOp(ctx, 'note', id, changed as Record<string, Json>));
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

export function setReminderEnabled(id: string, enabled: boolean) {
  const { ctx, tx } = openCore();
  tx(() => applyLocalOp(ctx, 'reminder', id, { enabled: enabled ? 1 : 0 }));
}

export function deleteReminder(id: string) {
  const { ctx, tx } = openCore();
  tx(() => applyLocalOp(ctx, 'reminder', id, { deleted: 1 }));
}

export interface ProcessedImage {
  hash: string;
  thumbHash: string;
  width: number;
  height: number;
  size: number;
}

/** 画像は blobs に登録（端末に実体あり・未アップロード）し、メタデータだけを op で記録する（設計 §7.1） */
export function addAttachment(noteId: string, img: ProcessedImage): string {
  const { ctx, tx } = openCore();
  const now = nowIso();
  return tx(() => {
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
  });
}

/** 削除は墓標のみ。blob 本体は別メモから参照されうるので消さない（設計 §7.4） */
export function deleteAttachment(id: string) {
  const { ctx, tx } = openCore();
  tx(() => applyLocalOp(ctx, 'attachment', id, { deleted: 1 }));
}
