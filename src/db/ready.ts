import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { initDb } from './index';

/** Web は DB を開き終えるまで画面を出せない。ネイティブは getDb が同期で開くので待たない */
export function useDbReady() {
  const [ready, setReady] = useState(Platform.OS !== 'web');
  useEffect(() => {
    if (!ready) void initDb().then(() => setReady(true));
  }, [ready]);
  return ready;
}
