import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { initDb } from './index';

/** 遷移直後は前のページのワーカーが DB を手放すまでの間、開けないことがある */
async function initWithRetry() {
  for (let i = 0; ; i++) {
    try {
      return await initDb();
    } catch (e) {
      if (i >= 4) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/** Web は DB を開き終えるまで画面を出せない。ネイティブは getDb が同期で開くので待たない。開けなかったときは error */
export function useDbReady(): { ready: boolean; error: Error | null } {
  const [state, setState] = useState<{ ready: boolean; error: Error | null }>({ ready: Platform.OS !== 'web', error: null });
  useEffect(() => {
    if (state.ready) return;
    initWithRetry().then(
      () => setState({ ready: true, error: null }),
      (e) => setState({ ready: false, error: e instanceof Error ? e : new Error(String(e)) }),
    );
  }, [state.ready]);
  return state;
}
