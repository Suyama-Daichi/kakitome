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
  return { ...note, items: listItems(note.id) };
}

export function itemChecked(id: string): number {
  return getDb().getFirstSync<{ checked: number }>('SELECT checked FROM checklist_items WHERE id = ?', id)?.checked ?? 0;
}

export interface NoteRow {
  id: string;
  title: string;
  body: string;
  pinned: number;
  conflict_of: string | null;
  open_count: number;
  total_count: number;
}

/** 一覧: ピン留め優先、次に sort_key。競合コピーも表示する（バッジ用に conflict_of を返す） */
export function listNotes(): NoteRow[] {
  return getDb().getAllSync<NoteRow>(
    `SELECT n.id, n.title, n.body, n.pinned, n.conflict_of,
       (SELECT COUNT(*) FROM checklist_items i WHERE i.note_id = n.id AND i.deleted = 0 AND i.checked = 0) AS open_count,
       (SELECT COUNT(*) FROM checklist_items i WHERE i.note_id = n.id AND i.deleted = 0) AS total_count
     FROM notes n WHERE n.deleted = 0 ORDER BY n.pinned DESC, n.sort_key, n.id`,
  );
}

export function getNote(id: string): Pick<NoteRow, 'id' | 'title' | 'body' | 'pinned'> | undefined {
  return getDb().getFirstSync('SELECT id, title, body, pinned FROM notes WHERE id = ? AND deleted = 0', id) ?? undefined;
}

export function listItems(noteId: string): Item[] {
  return getDb().getAllSync<Item>(
    'SELECT id, text, checked FROM checklist_items WHERE note_id = ? AND deleted = 0 ORDER BY checked ASC, sort_key ASC, id',
    noteId,
  );
}

export const minNoteKey = () =>
  getDb().getFirstSync<{ k: string | null }>("SELECT MIN(sort_key) AS k FROM notes WHERE sort_key != ''")?.k ?? null;
export const maxItemKey = (noteId: string) =>
  getDb().getFirstSync<{ k: string | null }>("SELECT MAX(sort_key) AS k FROM checklist_items WHERE note_id = ? AND sort_key != ''", noteId)?.k ?? null;

export const unsentOpCount = () => getDb().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM ops WHERE uploaded = 0')?.n ?? 0;
export const lastSyncAt = () => getDb().getFirstSync<{ value: string }>("SELECT value FROM sync_state WHERE key = 'last_sync_at'")?.value ?? null;
export const lastSyncError = () => getDb().getFirstSync<{ value: string }>("SELECT value FROM sync_state WHERE key = 'last_error'")?.value ?? null;

export interface ReminderView {
  id: string;
  fire_at: string;
  timezone: string;
  rrule: string | null;
  enabled: number;
}

export const listReminders = (noteId: string) =>
  getDb().getAllSync<ReminderView>(
    'SELECT id, fire_at, timezone, rrule, enabled FROM reminders WHERE note_id = ? AND deleted = 0 ORDER BY fire_at',
    noteId,
  );

/** 調停の入力。通知の本文は「最初の未完了項目、なければ本文の1行目」 */
export function reminderInputs() {
  const db = getDb();
  const reminders = db
    .getAllSync<{ id: string; note_id: string; fire_at: string; timezone: string; rrule: string | null; enabled: number }>(
      'SELECT id, note_id, fire_at, timezone, rrule, enabled FROM reminders WHERE deleted = 0',
    )
    .map((r) => ({ id: r.id, noteId: r.note_id, fireAt: r.fire_at, timezone: r.timezone, rrule: r.rrule, enabled: !!r.enabled }));
  const notes = new Map<string, { title: string; body: string }>();
  for (const noteId of new Set(reminders.map((r) => r.noteId))) {
    const n = db.getFirstSync<{ title: string; body: string }>('SELECT title, body FROM notes WHERE id = ? AND deleted = 0', noteId);
    if (!n) continue;
    const item = db.getFirstSync<{ text: string }>(
      "SELECT text FROM checklist_items WHERE note_id = ? AND deleted = 0 AND checked = 0 AND text != '' ORDER BY sort_key LIMIT 1",
      noteId,
    );
    notes.set(noteId, { title: n.title || '無題のメモ', body: item?.text ?? n.body.split('\n')[0] });
  }
  return { reminders, notes };
}

export const scheduledNotifications = () =>
  getDb()
    .getAllSync<{ reminder_id: string; notification_id: string; fire_at: string }>('SELECT reminder_id, notification_id, fire_at FROM scheduled_notifications')
    .map((r) => ({ reminderId: r.reminder_id, notificationId: r.notification_id, signature: r.fire_at }));

export interface AttachmentView {
  id: string;
  hash: string;
  thumb_hash: string;
  width: number;
  height: number;
  has_thumb: number;
  has_body: number;
}

export const listAttachments = (noteId: string) =>
  getDb().getAllSync<AttachmentView>(
    `SELECT a.id, a.hash, a.thumb_hash, a.width, a.height,
       EXISTS (SELECT 1 FROM blobs b WHERE b.hash = a.thumb_hash AND b.local_path IS NOT NULL) AS has_thumb,
       EXISTS (SELECT 1 FROM blobs b WHERE b.hash = a.hash AND b.local_path IS NOT NULL) AS has_body
     FROM attachments a WHERE a.note_id = ? AND a.deleted = 0 ORDER BY a.sort_key, a.id`,
    noteId,
  );

export const maxAttachmentKey = (noteId: string) =>
  getDb().getFirstSync<{ k: string | null }>("SELECT MAX(sort_key) AS k FROM attachments WHERE note_id = ? AND sort_key != ''", noteId)?.k ?? null;
