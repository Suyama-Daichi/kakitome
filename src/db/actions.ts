import { keyBetween } from '../core/fractional';
import { applyLocalOp } from '../core/merge';
import type { Json } from '../core/ops';
import { openCore } from './index';
import { firstNoteWithItems, getNote, itemChecked, maxItemKey, minNoteKey } from './queries';

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
