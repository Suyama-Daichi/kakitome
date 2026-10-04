// Google Keep（Google Takeout）の JSON → kakitome のメモへの変換。UI にも DB にも依存しない

export interface KeepNote {
  /** 取り込み済みの判定に使う（同じメモを 2 回取り込まない） */
  key: string;
  title: string;
  body: string;
  pinned: boolean;
  trashed: boolean;
  archived: boolean;
  items: { text: string; checked: boolean }[];
  createdAt: string;
  editedAt: number;
  /** Takeout 内のファイル名と MIME タイプ */
  attachments: { name: string; mime: string }[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Takeout の 1 メモ分の JSON。Keep のメモでなければ null */
export function parseKeepNote(json: unknown): KeepNote | null {
  const j = rec(json);
  if (!('userEditedTimestampUsec' in j) && !('createdTimestampUsec' in j) && !('textContent' in j) && !('listContent' in j)) return null;

  const created = Number(j.createdTimestampUsec) || 0;
  const edited = Number(j.userEditedTimestampUsec) || created;
  const items = arr(j.listContent).map((it) => ({ text: str(rec(it).text), checked: rec(it).isChecked === true }));
  const labels = arr(j.labels).map((l) => str(rec(l).name)).filter(Boolean);
  const text = str(j.textContent);
  // kakitome にラベルは無いので、本文の末尾に残す
  const body = [text, labels.length ? `ラベル: ${labels.join(', ')}` : ''].filter(Boolean).join('\n\n');
  const title = str(j.title);

  return {
    key: `keep:${created || `${title}\0${text}`}`,
    title,
    body,
    pinned: j.isPinned === true,
    trashed: j.isTrashed === true,
    archived: j.isArchived === true,
    items,
    createdAt: new Date(created / 1000 || Date.now()).toISOString(),
    editedAt: edited / 1000,
    attachments: arr(j.attachments).map((a) => ({ name: str(rec(a).filePath), mime: str(rec(a).mimetype) })).filter((a) => a.name),
  };
}

/** 中身が何も無いメモ（Keep には空のメモが残ることがある） */
export const isEmptyNote = (n: KeepNote) => !n.title && !n.body && !n.items.some((i) => i.text) && !n.attachments.length;
