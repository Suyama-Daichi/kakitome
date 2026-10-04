import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { initDb } from './index';

const RETRY_KEY = 'kakitome.db-retry';
const MAX_RELOADS = 5;

/**
 * Web は DB を開き終えるまで画面を出せない。ネイティブは getDb が同期で開くので待たない。開けなかったときは error。
 * 前のページ（再サインインの遷移直後など）や別のタブが DB を握っていると開けず、しかも一度失敗した SQLite は
 * ページ内でやり直しても直らない（Invalid VFS state）ので、少し待ってページごと読み込み直す
 */
export function useDbReady(): { ready: boolean; error: Error | null } {
  const [state, setState] = useState<{ ready: boolean; error: Error | null }>({ ready: Platform.OS !== 'web', error: null });
  useEffect(() => {
    if (state.ready) return;
    initDb().then(
      () => {
        sessionStorage.removeItem(RETRY_KEY);
        setState({ ready: true, error: null });
      },
      (e) => {
        const tries = Number(sessionStorage.getItem(RETRY_KEY) ?? 0);
        if (tries < MAX_RELOADS) {
          sessionStorage.setItem(RETRY_KEY, String(tries + 1));
          setTimeout(() => location.reload(), 1000);
        } else {
          setState({ ready: false, error: e instanceof Error ? e : new Error(String(e)) });
        }
      },
    );
  }, [state.ready]);
  return state;
}
