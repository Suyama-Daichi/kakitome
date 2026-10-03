import { getDb } from './index';

export interface Item { id: string; text: string; checked: number }
export interface NoteView { id: string; title: string; items: Item[] }

/** §3.4: 完了は下へ。アプリもウィジェットも同じクエリ。競合コピーは除外 */
export function firstNoteWithItems(): NoteView | undefined {
  const db = getDb();
  const note = db.getFirstSync<{ id: string; title: string }>(
    "SELECT id, title FROM notes WHERE deleted = 0 AND conflict_of IS NULL ORDER BY sort_key, id LIMIT 1",
  );
  if (!note) return undefined;
  const items = db.getAllSync<Item>(
    'SELECT id, text, checked FROM checklist_items WHERE note_id = ? AND deleted = 0 ORDER BY checked ASC, sort_key ASC',
    note.id,
  );
  return { ...note, items };
}

export function itemChecked(id: string): number {
  return getDb().getFirstSync<{ checked: number }>('SELECT checked FROM checklist_items WHERE id = ?', id)?.checked ?? 0;
}
