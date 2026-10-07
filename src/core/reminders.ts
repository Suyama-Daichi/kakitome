// リマインドの予約計画（純粋ロジック）。OS への予約は src/notifications/ が行う。
// 対応する繰り返しは FREQ=DAILY|WEEKLY|MONTHLY|YEARLY と INTERVAL のみ（docs/design.md §9）。

export interface ReminderRow {
  id: string;
  noteId: string;
  /** UTC ISO8601。繰り返しの基準（最初の時刻） */
  fireAt: string;
  /** 'Asia/Tokyo' など。時刻・曜日・日付はこのタイムゾーンのウォールクロックで数える */
  timezone: string;
  rrule: string | null;
  enabled: boolean;
}

export interface NoteInfo {
  title: string;
  body: string;
}

/** weekday: 0=日曜, month: 1-12。OS 固有の番号への変換は呼び出し側 */
export type Trigger =
  | { type: 'date'; at: string }
  | { type: 'daily'; hour: number; minute: number }
  | { type: 'weekly'; weekday: number; hour: number; minute: number }
  | { type: 'monthly'; day: number; hour: number; minute: number }
  | { type: 'yearly'; month: number; day: number; hour: number; minute: number };

export interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
}

const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

/** 未対応の書式は null（別の意味で繰り返してしまうより、単発として扱う） */
export function parseRule(rrule: string | null): Rule | null {
  if (!rrule) return null;
  const kv: Record<string, string | undefined> = {};
  for (const part of rrule.replace(/^RRULE:/, '').split(';')) {
    const [k, v] = part.split('=');
    kv[k] = v;
  }
  if (Object.keys(kv).some((k) => k !== 'FREQ' && k !== 'INTERVAL')) return null;
  if (!kv.FREQ || !FREQS.includes(kv.FREQ)) return null;
  const interval = kv.INTERVAL === undefined ? 1 : Number(kv.INTERVAL);
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) return null;
  return { freq: kv.FREQ as Rule['freq'], interval };
}

interface Wall {
  y: number;
  mo: number; // 1-12
  d: number;
  h: number;
  mi: number;
  wd: number; // 0=日曜
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function safeTz(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

function wall(ms: number, tz: string): Wall {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short',
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { y: +get('year'), mo: +get('month'), d: +get('day'), h: +get('hour'), mi: +get('minute'), wd: WEEKDAYS.indexOf(get('weekday')) };
}

/** タイムゾーン tz のウォールクロック → UTC ミリ秒（夏時間の隙間では近い時刻に寄る） */
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const target = Date.UTC(y, mo - 1, d, h, mi);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const w = wall(guess, tz);
    guess -= Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - target;
  }
  return guess;
}

const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

/** k 回目（0 が基準時刻）の発火時刻。存在しない日付（31日の無い月など）は null */
function occurrence(w: Wall, rule: Rule, k: number, tz: string): number | null {
  const n = k * rule.interval;
  if (rule.freq === 'DAILY' || rule.freq === 'WEEKLY') {
    const t = new Date(Date.UTC(w.y, w.mo - 1, w.d + n * (rule.freq === 'DAILY' ? 1 : 7)));
    return zonedToUtc(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), w.h, w.mi, tz);
  }
  const months = rule.freq === 'MONTHLY' ? n : n * 12;
  const total = w.mo - 1 + months;
  const y = w.y + Math.floor(total / 12);
  const mo = (total % 12) + 1;
  if (w.d > daysInMonth(y, mo)) return null;
  return zonedToUtc(y, mo, w.d, w.h, w.mi, tz);
}

/** now より後で最初の発火時刻。単発で過去、または見つからなければ null */
export function nextOccurrence(rem: ReminderRow, now: Date): Date | null {
  const start = Date.parse(rem.fireAt);
  if (Number.isNaN(start)) return null;
  const rule = parseRule(rem.rrule);
  if (!rule) return start > now.getTime() ? new Date(start) : null;

  const tz = safeTz(rem.timezone);
  const w = wall(start, tz);
  const nw = wall(now.getTime(), tz);
  const unit = { DAILY: 1, WEEKLY: 7 }[rule.freq as 'DAILY' | 'WEEKLY'];
  const elapsed =
    unit !== undefined
      ? (now.getTime() - start) / (86400_000 * unit)
      : rule.freq === 'MONTHLY'
        ? nw.y * 12 + nw.mo - (w.y * 12 + w.mo)
        : nw.y - w.y;
  const k0 = Math.max(0, Math.floor(elapsed / rule.interval) - 1);
  for (let k = k0; k < k0 + 5000; k++) {
    const t = occurrence(w, rule, k, tz);
    if (t !== null && t > now.getTime()) return new Date(t);
  }
  return null;
}

/**
 * 通知の「完了」ボタンで適用するフィールド。単発（未対応の繰り返しを含む）は無効にし、繰り返しは変えない（次回も鳴る）。
 * 何もしなくてよいときは null（無効化済みなら op を出さないので、同じ操作が重複して届いても 1 回だけになる）
 */
export function completeFields(rem: Pick<ReminderRow, 'rrule' | 'enabled'>): { enabled: 0 } | null {
  return rem.enabled && !parseRule(rem.rrule) ? { enabled: 0 } : null;
}

/** 通知の形式の版。通知に付ける内容（ボタンなど）を変えたら上げて、予約済みの通知を作り直させる */
const NOTIFICATION_FORMAT = 2;

export interface Desired {
  reminderId: string;
  noteId: string;
  trigger: Trigger;
  title: string;
  body: string;
  /** トリガーと通知内容の署名。変わったら取り消して予約し直す */
  signature: string;
  nextAt: number;
}

export interface ScheduledEntry {
  reminderId: string;
  notificationId: string;
  signature: string;
}

export interface PlanInput {
  reminders: ReminderRow[];
  /** 削除されていないメモのみ */
  notes: Map<string, NoteInfo>;
  scheduled: ScheduledEntry[];
  now: Date;
  /** iOS の予約上限（64 件）に備える */
  cap?: number;
}

export interface Plan {
  cancel: { reminderId: string; notificationId: string }[];
  schedule: Desired[];
}

function triggerFor(rem: ReminderRow, next: Date): Trigger {
  const rule = parseRule(rem.rrule);
  // 間隔 1 の繰り返しは OS のネイティブ繰り返し（アプリを開かなくても鳴り続ける）。それ以外は次の 1 回だけ
  if (!rule || rule.interval !== 1) return { type: 'date', at: next.toISOString() };
  const w = wall(Date.parse(rem.fireAt), safeTz(rem.timezone));
  const t = { hour: w.h, minute: w.mi };
  switch (rule.freq) {
    case 'DAILY': return { type: 'daily', ...t };
    case 'WEEKLY': return { type: 'weekly', weekday: w.wd, ...t };
    case 'MONTHLY': return { type: 'monthly', day: w.d, ...t };
    case 'YEARLY': return { type: 'yearly', month: w.mo, day: w.d, ...t };
  }
}

/** 望ましい予約と現状の差分（取り消し・新規予約）を返す。適用後に再計画すると差分は空になる */
export function planReminders({ reminders, notes, scheduled, now, cap = 60 }: PlanInput): Plan {
  const desired: Desired[] = [];
  for (const rem of reminders) {
    const info = notes.get(rem.noteId);
    if (!rem.enabled || !info) continue;
    const next = nextOccurrence(rem, now);
    if (!next) continue;
    const trigger = triggerFor(rem, next);
    desired.push({
      reminderId: rem.id, noteId: rem.noteId, trigger, title: info.title, body: info.body,
      signature: JSON.stringify([trigger, info.title, info.body, rem.noteId, NOTIFICATION_FORMAT]), nextAt: next.getTime(),
    });
  }
  desired.sort((a, b) => a.nextAt - b.nextAt || (a.reminderId < b.reminderId ? -1 : 1));
  const wanted = new Map(desired.slice(0, cap).map((d) => [d.reminderId, d]));

  const cancel = scheduled
    .filter((s) => wanted.get(s.reminderId)?.signature !== s.signature)
    .map((s) => ({ reminderId: s.reminderId, notificationId: s.notificationId }));
  const kept = new Set(scheduled.filter((s) => wanted.get(s.reminderId)?.signature === s.signature).map((s) => s.reminderId));
  return { cancel, schedule: [...wanted.values()].filter((d) => !kept.has(d.reminderId)) };
}
