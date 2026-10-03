// 固定長 HLC: 物理時刻ms(13桁):カウンタ(4桁):端末ID。文字列比較だけで大小が決まる。
export interface Hlc {
  ms: number;
  counter: number;
  device: string;
}

export const formatHlc = ({ ms, counter, device }: Hlc): string =>
  `${String(ms).padStart(13, '0')}:${String(counter).padStart(4, '0')}:${device}`;

export function parseHlc(s: string): Hlc {
  const i = s.indexOf(':');
  const j = s.indexOf(':', i + 1);
  if (i !== 13 || j !== 18) throw new Error(`invalid hlc: ${s}`);
  return { ms: Number(s.slice(0, i)), counter: Number(s.slice(i + 1, j)), device: s.slice(j + 1) };
}

export interface Clock {
  /** 送信用: 直前のどの HLC よりも大きい HLC を返す */
  now(): string;
  /** 受信用: 以後の now() が remote より大きくなるよう進める */
  receive(remote: string): void;
  /** 永続化用: 最後に払い出した（または受信した）状態 */
  last(): string;
}

/** `last` は前回起動時の last()。端末時計が巻き戻っても単調性を保つため。 */
export function createClock(device: string, now: () => number = Date.now, last?: string): Clock {
  let ms = 0;
  let counter = 0;
  if (last) ({ ms, counter } = parseHlc(last));

  const set = (m: number, c: number) => {
    // ponytail: カウンタ溢れ(10000/ms)は ms を進めて逃がす。実運用では起きない
    if (c > 9999) [m, c] = [m + 1, 0];
    ms = m;
    counter = c;
  };

  return {
    now() {
      const pt = now();
      if (pt > ms) set(pt, 0);
      else set(ms, counter + 1);
      return formatHlc({ ms, counter, device });
    },
    receive(remote) {
      const r = parseHlc(remote);
      const m = Math.max(ms, r.ms, now());
      const c = Math.max(m === ms ? counter : -1, m === r.ms ? r.counter : -1);
      set(m, c + 1);
    },
    last: () => formatHlc({ ms, counter, device }),
  };
}
