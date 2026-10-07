import fc from 'fast-check';
import { completeFields, nextOccurrence, parseRule, planReminders, type NoteInfo, type PlanInput, type ReminderRow } from './reminders';

const NOW = new Date('2026-10-03T00:00:00Z');
const TOKYO = 'Asia/Tokyo';
const note: NoteInfo = { title: '買い物', body: '牛乳' };
const alive = new Map([['n1', note]]);
const r = (o: Partial<ReminderRow> = {}): ReminderRow => ({
  id: 'r1', noteId: 'n1', fireAt: '2026-10-04T00:00:00Z', timezone: TOKYO, rrule: null, enabled: true, ...o,
});
const plan = (reminders: ReminderRow[], extra: Partial<PlanInput> = {}) =>
  planReminders({ reminders, notes: alive, scheduled: [], now: NOW, ...extra });

describe('parseRule', () => {
  test('対応する書式', () => {
    expect(parseRule(null)).toBeNull();
    expect(parseRule('FREQ=DAILY')).toEqual({ freq: 'DAILY', interval: 1 });
    expect(parseRule('FREQ=WEEKLY;INTERVAL=2')).toEqual({ freq: 'WEEKLY', interval: 2 });
  });
  test('未対応のキー・値は null（誤って別の意味で繰り返さない）', () => {
    expect(parseRule('FREQ=WEEKLY;BYDAY=MO')).toBeNull();
    expect(parseRule('FREQ=HOURLY')).toBeNull();
    expect(parseRule('FREQ=DAILY;INTERVAL=0')).toBeNull();
    expect(parseRule('FREQ=DAILY;COUNT=3')).toBeNull();
    expect(parseRule('garbage')).toBeNull();
  });
});

describe('nextOccurrence', () => {
  test('毎日: now 以降で最初の同じ時刻（タイムゾーンのウォールクロック）', () => {
    // 2026-10-04 09:00 JST から毎日
    expect(nextOccurrence(r({ rrule: 'FREQ=DAILY' }), new Date('2026-10-10T01:00:00Z'))?.toISOString()).toBe('2026-10-11T00:00:00.000Z');
  });
  test('2週間おき', () => {
    expect(nextOccurrence(r({ rrule: 'FREQ=WEEKLY;INTERVAL=2' }), new Date('2026-10-05T00:00:00Z'))?.toISOString()).toBe('2026-10-18T00:00:00.000Z');
  });
  test('毎月31日は 31 日の無い月を飛ばす', () => {
    const rr = r({ fireAt: '2026-01-31T00:00:00Z', timezone: 'UTC', rrule: 'FREQ=MONTHLY' });
    expect(nextOccurrence(rr, new Date('2026-02-01T00:00:00Z'))?.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });
  test('毎年 2/29 は閏年だけ', () => {
    const rr = r({ fireAt: '2024-02-29T00:00:00Z', timezone: 'UTC', rrule: 'FREQ=YEARLY' });
    expect(nextOccurrence(rr, new Date('2026-01-01T00:00:00Z'))?.toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });
  test('夏時間をまたいでも現地の同じ時刻', () => {
    // ニューヨーク 2026-03-07 09:00 EST (14:00Z) から毎日。3/8 に夏時間開始 → 3/9 09:00 EDT = 13:00Z
    const rr = r({ fireAt: '2026-03-07T14:00:00Z', timezone: 'America/New_York', rrule: 'FREQ=DAILY' });
    expect(nextOccurrence(rr, new Date('2026-03-09T00:00:00Z'))?.toISOString()).toBe('2026-03-09T13:00:00.000Z');
  });
  test('単発: 未来ならその時刻、過去なら null', () => {
    expect(nextOccurrence(r(), NOW)?.toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(nextOccurrence(r({ fireAt: '2026-10-02T00:00:00Z' }), NOW)).toBeNull();
  });
  test('不正なタイムゾーンでも落ちない（UTC として扱う）', () => {
    expect(nextOccurrence(r({ timezone: 'Not/AZone', rrule: 'FREQ=DAILY' }), NOW)).not.toBeNull();
  });
});

describe('planReminders', () => {
  test('単発（未来）は date トリガー、過去は予約しない', () => {
    expect(plan([r()]).schedule[0]).toMatchObject({ reminderId: 'r1', trigger: { type: 'date', at: '2026-10-04T00:00:00.000Z' }, title: '買い物', body: '牛乳', noteId: 'n1' });
    expect(plan([r({ fireAt: '2026-10-02T00:00:00Z' })]).schedule).toEqual([]);
  });

  test('間隔 1 の繰り返しは OS のネイティブ繰り返しトリガー（ウォールクロック成分）', () => {
    const t = (rrule: string) => plan([r({ rrule })]).schedule[0].trigger;
    expect(t('FREQ=DAILY')).toEqual({ type: 'daily', hour: 9, minute: 0 });
    expect(t('FREQ=WEEKLY')).toEqual({ type: 'weekly', weekday: 0, hour: 9, minute: 0 }); // 2026-10-04 は日曜
    expect(t('FREQ=MONTHLY')).toEqual({ type: 'monthly', day: 4, hour: 9, minute: 0 });
    expect(t('FREQ=YEARLY')).toEqual({ type: 'yearly', month: 10, day: 4, hour: 9, minute: 0 });
  });

  test('曜日・日付はタイムゾーン側で数える（UTC では前日でも JST では翌日）', () => {
    // 2026-10-03T16:00Z = 2026-10-04 01:00 JST（日曜）
    expect(plan([r({ fireAt: '2026-10-03T16:00:00Z', rrule: 'FREQ=WEEKLY' })]).schedule[0].trigger).toEqual({ type: 'weekly', weekday: 0, hour: 1, minute: 0 });
  });

  test('間隔 2 以上・未対応の rrule は、次の 1 回だけを date で予約', () => {
    expect(plan([r({ rrule: 'FREQ=DAILY;INTERVAL=2' })]).schedule[0].trigger).toEqual({ type: 'date', at: '2026-10-04T00:00:00.000Z' });
    expect(plan([r({ rrule: 'FREQ=WEEKLY;BYDAY=MO' })]).schedule[0].trigger).toEqual({ type: 'date', at: '2026-10-04T00:00:00.000Z' });
  });

  test('無効・削除済みメモのリマインドは予約しない', () => {
    expect(plan([r({ enabled: false })]).schedule).toEqual([]);
    expect(plan([r({ noteId: 'gone' })]).schedule).toEqual([]);
  });

  test('予約済みと同じなら何もしない。内容・時刻が変われば取り消して再予約', () => {
    const first = plan([r()]).schedule[0];
    const scheduled = [{ reminderId: 'r1', notificationId: 'N1', signature: first.signature }];
    expect(plan([r()], { scheduled })).toEqual({ cancel: [], schedule: [] });
    const moved = plan([r({ fireAt: '2026-10-05T00:00:00Z' })], { scheduled });
    expect(moved.cancel).toEqual([{ reminderId: 'r1', notificationId: 'N1' }]);
    expect(moved.schedule).toHaveLength(1);
    const renamed = planReminders({ reminders: [r()], notes: new Map([['n1', { title: '別名', body: '牛乳' }]]), scheduled, now: NOW });
    expect(renamed.cancel).toHaveLength(1);
    expect(renamed.schedule[0].title).toBe('別名');
  });

  test('不要になった予約（削除・無効・発火済み）は取り消す', () => {
    const scheduled = [{ reminderId: 'r1', notificationId: 'N1', signature: 'x' }];
    expect(plan([], { scheduled }).cancel).toEqual([{ reminderId: 'r1', notificationId: 'N1' }]);
    expect(plan([r({ fireAt: '2026-10-02T00:00:00Z' })], { scheduled }).cancel).toHaveLength(1);
  });

  test('上限を超えるときは直近のものを優先する', () => {
    const many = Array.from({ length: 10 }, (_, i) => r({ id: `r${i}`, fireAt: new Date(NOW.getTime() + (10 - i) * 3600_000).toISOString() }));
    const p = plan(many, { cap: 3 });
    expect(p.schedule.map((s) => s.reminderId).sort()).toEqual(['r7', 'r8', 'r9']);
  });

  test('計画を適用してもう一度計画すると差分は空（冪等）', () => {
    const rule = fc.constantFrom(null, 'FREQ=DAILY', 'FREQ=WEEKLY;INTERVAL=3', 'FREQ=MONTHLY', 'FREQ=BAD');
    const rem = fc.record({
      id: fc.uuid(), noteId: fc.constantFrom('n1', 'gone'), fireAt: fc.integer({ min: 0, max: 400 }).map((d) => new Date(NOW.getTime() + (d - 100) * 86400_000).toISOString()),
      timezone: fc.constantFrom(TOKYO, 'UTC', 'America/New_York'), rrule: rule, enabled: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(rem, { maxLength: 15 }), fc.integer({ min: 1, max: 20 }), (reminders, cap) => {
        const p1 = plan(reminders, { cap });
        const scheduled = p1.schedule.map((s, i) => ({ reminderId: s.reminderId, notificationId: `N${i}`, signature: s.signature }));
        const p2 = plan(reminders, { cap, scheduled });
        expect(p2).toEqual({ cancel: [], schedule: [] });
        expect(p1.schedule.length).toBeLessThanOrEqual(cap);
      }),
      { numRuns: 100 },
    );
  });
});

describe('completeFields（通知の「完了」）', () => {
  test('有効な単発は無効にする', () => {
    expect(completeFields({ rrule: null, enabled: true })).toEqual({ enabled: 0 });
  });
  test('未対応の繰り返し（単発として鳴る）も無効にする', () => {
    expect(completeFields({ rrule: 'FREQ=WEEKLY;BYDAY=MO', enabled: true })).toEqual({ enabled: 0 });
  });
  test('繰り返しは変えない（次回も鳴る）', () => {
    expect(completeFields({ rrule: 'FREQ=DAILY', enabled: true })).toBeNull();
    expect(completeFields({ rrule: 'FREQ=WEEKLY;INTERVAL=2', enabled: true })).toBeNull();
  });
  test('無効化済みなら op を出さない（重複して届いても 1 回だけ）', () => {
    expect(completeFields({ rrule: null, enabled: false })).toBeNull();
  });
});
