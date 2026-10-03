import { getDb } from './index';

export interface Item { id: string; text: string; checked: number }
export interface NoteView { id: string; title: string; items: Item[] }

const widgetKey = (widgetId: number) => `widget_note:${widgetId}`;

/** ウィジェットごとの表示メモ（この端末だけの設定で、同期しない）。null は「一覧の先頭のメモ」 */
export function setWidgetNote(widgetId: number, noteId: string | null) {
  const db = getDb();
  if (noteId) db.runSync('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', widgetKey(widgetId), noteId);
  else db.runSync('DELETE FROM sync_state WHERE key = ?', widgetKey(widgetId));
}

/** §3.4: 完了は下へ。アプリもウィジェットも同じクエリ。競合コピーは除外。選んだメモが無い・削除済みなら先頭のメモ */
export function widgetNote(widgetId: number): NoteView | undefined {
  const db = getDb();
  const chosen = db.getFirstSync<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', widgetKey(widgetId))?.value;
  const note =
    (chosen && db.getFirstSync<{ id: string; title: string }>('SELECT id, title FROM notes WHERE id = ? AND deleted = 0', chosen)) ||
    db.getFirstSync<{ id: string; title: string }>(
      'SELECT id, title FROM notes WHERE deleted = 0 AND conflict_of IS NULL ORDER BY pinned DESC, sort_key, id LIMIT 1',
    );
  return note ? { ...note, items: listItems(note.id) } : undefined;
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
  sort_key: string;
  conflict_count: number;
  open_count: number;
  total_count: number;
  image_count: number;
  next_reminder: string | null;
  /** カードに出す未完了項目（最大3件） */
  preview: Item[];
}

/** 一覧: ピン留め優先、次に sort_key。競合コピーも表示する（バッジ用に conflict_of を返す） */
export function listNotes(): NoteRow[] {
  const db = getDb();
  const rows = db.getAllSync<Omit<NoteRow, 'preview'>>(
    `SELECT n.id, n.title, n.body, n.pinned, n.conflict_of, n.sort_key,
       (SELECT COUNT(*) FROM notes c WHERE c.conflict_of = n.id AND c.deleted = 0) AS conflict_count,
       (SELECT COUNT(*) FROM checklist_items i WHERE i.note_id = n.id AND i.deleted = 0 AND i.checked = 0) AS open_count,
       (SELECT COUNT(*) FROM checklist_items i WHERE i.note_id = n.id AND i.deleted = 0) AS total_count,
       (SELECT COUNT(*) FROM attachments a WHERE a.note_id = n.id AND a.deleted = 0) AS image_count,
       (SELECT MIN(r.fire_at) FROM reminders r WHERE r.note_id = n.id AND r.deleted = 0 AND r.enabled = 1) AS next_reminder
     FROM notes n WHERE n.deleted = 0 ORDER BY n.pinned DESC, n.sort_key, n.id`,
  );
  return rows.map((n) => ({
    ...n,
    preview: db.getAllSync<Item>(
      'SELECT id, text, checked FROM checklist_items WHERE note_id = ? AND deleted = 0 AND checked = 0 ORDER BY sort_key, id LIMIT 3',
      n.id,
    ),
  }));
}

export function getNote(id: string): Pick<NoteRow, 'id' | 'title' | 'body' | 'pinned' | 'conflict_of'> | undefined {
  return getDb().getFirstSync('SELECT id, title, body, pinned, conflict_of FROM notes WHERE id = ? AND deleted = 0', id) ?? undefined;
}

/** タイトル・本文・項目・リマインド・画像がすべて空の、作っただけのメモか */
export function isBlankNote(id: string): boolean {
  const n = getDb().getFirstSync<{ blank: number }>(
    `SELECT trim(title) = '' AND trim(body) = '' AND conflict_of IS NULL
       AND NOT EXISTS (SELECT 1 FROM checklist_items WHERE note_id = notes.id AND deleted = 0 AND trim(text) != '')
       AND NOT EXISTS (SELECT 1 FROM reminders WHERE note_id = notes.id AND deleted = 0)
       AND NOT EXISTS (SELECT 1 FROM attachments WHERE note_id = notes.id AND deleted = 0) AS blank
     FROM notes WHERE id = ? AND deleted = 0`,
    id,
  );
  return n?.blank === 1;
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

export interface ConflictView {
  /** 競合コピーのメモ ID */
  copyId: string;
  /** 元のメモ ID */
  noteId: string;
  field: 'title' | 'body';
  /** 競合コピーの値（負けた側） */
  theirs: string;
  /** 元メモの現在の値 */
  ours: string;
  /** 分岐元の値。圧縮などで取り出せないときは null */
  base: string | null;
}

/**
 * 分岐元の値: conflict_base_hlc を書いた op を ops から引いて取り出す（設計 §5.4）。
 * 圧縮で途中の op が無い端末では null（2 方向の比較だけを表示する）。
 */
export function baseValue(baseHlc: string | null, noteId: string, field: string): string | null {
  if (!baseHlc) return null;
  const rows = getDb().getAllSync<{ payload: string }>('SELECT payload FROM ops WHERE hlc = ?', baseHlc);
  for (const r of rows) {
    const op = JSON.parse(r.payload) as { entity: string; entityId: string; fields: Record<string, unknown> };
    if (op.entity === 'note' && op.entityId === noteId && typeof op.fields[field] === 'string') return op.fields[field] as string;
  }
  return null;
}

function toConflict(r: { id: string; conflict_of: string; conflict_field: string; conflict_base_hlc: string | null; copy_val: string; orig_val: string | null }): ConflictView {
  const field = r.conflict_field as 'title' | 'body';
  return { copyId: r.id, noteId: r.conflict_of, field, theirs: r.copy_val, ours: r.orig_val ?? '', base: baseValue(r.conflict_base_hlc, r.conflict_of, field) };
}

const CONFLICT_SQL = `SELECT c.id, c.conflict_of, c.conflict_field, c.conflict_base_hlc,
    CASE c.conflict_field WHEN 'title' THEN c.title ELSE c.body END AS copy_val,
    CASE c.conflict_field WHEN 'title' THEN o.title ELSE o.body END AS orig_val
  FROM notes c LEFT JOIN notes o ON o.id = c.conflict_of
  WHERE c.deleted = 0 AND c.conflict_of IS NOT NULL`;

/** メモに紐づく未解消の競合（元メモからも競合コピーからも引ける） */
export function conflictsFor(noteId: string): ConflictView[] {
  return getDb()
    .getAllSync<Parameters<typeof toConflict>[0]>(`${CONFLICT_SQL} AND (c.conflict_of = ? OR c.id = ?) ORDER BY c.sort_key`, noteId, noteId)
    .map(toConflict);
}

export const conflictCount = (noteId: string) =>
  getDb().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM notes WHERE deleted = 0 AND conflict_of = ?', noteId)?.n ?? 0;
