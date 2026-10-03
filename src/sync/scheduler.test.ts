import { createSyncScheduler } from './scheduler';

afterEach(() => jest.useRealTimers());

/** 手動で完了させられる非同期処理 */
function controlled() {
  const resolvers: (() => void)[] = [];
  const run = jest.fn(() => new Promise<void>((res) => resolvers.push(res)));
  return { run, finish: () => resolvers.shift()!() };
}
const flush = () => new Promise<void>((r) => setImmediate(() => r()));

test('実行中の追加要求は 1 回に束ねられ、終了後にちょうど 1 回だけ再実行される', async () => {
  const { run, finish } = controlled();
  const s = createSyncScheduler({ run });
  const p = s.trigger();
  s.trigger(); s.trigger(); s.trigger();
  expect(run).toHaveBeenCalledTimes(1);
  finish();
  await flush();
  expect(run).toHaveBeenCalledTimes(2);
  finish();
  await p;
  expect(run).toHaveBeenCalledTimes(2);
});

test('並列実行しない（実行中に次の run を始めない）', async () => {
  let active = 0;
  let max = 0;
  const s = createSyncScheduler({
    run: async () => { active++; max = Math.max(max, active); await flush(); active--; },
  });
  await Promise.all([s.trigger(), s.trigger(), s.trigger()]);
  expect(max).toBe(1);
});

test('schedule はデバウンスされ、連続した要求は 1 回の実行になる', async () => {
  jest.useFakeTimers();
  const run = jest.fn(async () => {});
  const s = createSyncScheduler({ run, debounceMs: 5000 });
  s.schedule(); jest.advanceTimersByTime(3000);
  s.schedule(); jest.advanceTimersByTime(3000);
  s.schedule(); jest.advanceTimersByTime(4999);
  expect(run).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(run).toHaveBeenCalledTimes(1);
});

test('失敗しても例外を投げず onError に渡し、次の要求で再実行できる', async () => {
  const onError = jest.fn();
  const run = jest.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined);
  const s = createSyncScheduler({ run, onError });
  await expect(s.trigger()).resolves.toBeUndefined();
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'network' }));
  await s.trigger();
  expect(run).toHaveBeenCalledTimes(2);
});

test('失敗した実行中の追加要求で無限に再試行しない', async () => {
  const run = jest.fn(async () => { throw new Error('x'); });
  const s = createSyncScheduler({ run, onError: () => {} });
  const p = s.trigger();
  s.trigger();
  await p;
  expect(run).toHaveBeenCalledTimes(1);
});

test('無効（未サインイン）の間は実行しない', async () => {
  const run = jest.fn(async () => {});
  const s = createSyncScheduler({ run, enabled: () => false });
  await s.trigger();
  expect(run).not.toHaveBeenCalled();
});

test('dispose 後は予約された実行が走らない', () => {
  jest.useFakeTimers();
  const run = jest.fn(async () => {});
  const s = createSyncScheduler({ run, debounceMs: 100 });
  s.schedule();
  s.dispose();
  jest.advanceTimersByTime(1000);
  expect(run).not.toHaveBeenCalled();
});
