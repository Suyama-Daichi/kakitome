// docs/design.md §3.2/§3.3 のスキーマ。docs との差: upsert を列単位で行うため NOT NULL 列に DEFAULT '' を付けている。
// ponytail: PoC。マイグレーション機構は無く、IF NOT EXISTS のみ。スキーマ変更時に user_version 管理へ
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  sort_key TEXT NOT NULL DEFAULT '',
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  conflict_of TEXT,
  conflict_field TEXT,
  conflict_base_hlc TEXT
);
CREATE TABLE IF NOT EXISTS checklist_items (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  checked INTEGER NOT NULL DEFAULT 0,
  sort_key TEXT NOT NULL DEFAULT '',
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL DEFAULT '',
  fire_at TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT '',
  rrule TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  thumb_hash TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  sort_key TEXT NOT NULL DEFAULT '',
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS field_clocks (
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  hlc TEXT NOT NULL,
  base TEXT,
  PRIMARY KEY (entity, entity_id, field)
);
CREATE TABLE IF NOT EXISTS ops (
  id TEXT PRIMARY KEY,
  hlc TEXT NOT NULL,
  device_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  uploaded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ops_hlc ON ops(hlc);
CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- fire_at にはトリガーと通知内容の署名を保存する（設計 §3.3 との差。繰り返し・内容変更の検知用）
CREATE TABLE IF NOT EXISTS scheduled_notifications (
  reminder_id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL,
  fire_at TEXT NOT NULL
);
`;

// リモート op の field 名は SQL に埋め込むため、必ずこの許可リストで検証する
export const TABLE = {
  note: 'notes',
  checklist_item: 'checklist_items',
  reminder: 'reminders',
  attachment: 'attachments',
} as const;

export const COLUMNS: Record<keyof typeof TABLE, readonly string[]> = {
  note: ['title', 'body', 'pinned', 'sort_key', 'deleted', 'created_at', 'conflict_of', 'conflict_field', 'conflict_base_hlc'],
  checklist_item: ['note_id', 'text', 'checked', 'sort_key', 'deleted', 'created_at'],
  reminder: ['note_id', 'fire_at', 'timezone', 'rrule', 'enabled', 'deleted'],
  attachment: ['note_id', 'hash', 'thumb_hash', 'mime', 'width', 'height', 'size', 'sort_key', 'deleted', 'created_at'],
};
