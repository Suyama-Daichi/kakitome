export interface SchedulerOptions {
  run: () => Promise<void>;
  /** false の間（未サインインなど）は何もしない */
  enabled?: () => boolean;
  onError?: (e: unknown) => void;
  debounceMs?: number;
}

/**
 * 同期の実行を束ねる: 同時に 1 つだけ走らせ、実行中の要求は終了後の 1 回にまとめる。
 * 失敗は例外にせず onError へ（次のトリガーが再試行になる）。
 */
export function createSyncScheduler({ run, enabled, onError, debounceMs = 5000 }: SchedulerOptions) {
  let current: Promise<void> | undefined;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function trigger(): Promise<void> {
    if (enabled && !enabled()) return Promise.resolve();
    if (current) {
      pending = true;
      return current;
    }
    current = (async () => {
      try {
        do {
          pending = false;
          try {
            await run();
          } catch (e) {
            pending = false; // 失敗時は再試行ループにしない
            onError?.(e);
          }
        } while (pending);
      } finally {
        current = undefined;
      }
    })();
    return current;
  }

  return {
    trigger,
    /** 編集のたびに呼ぶ。入力が止まって debounceMs 後に 1 回だけ実行 */
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => void trigger(), debounceMs);
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
