// 行単位の差分と 3 方向マージ（競合解消 UI 用。設計 §5.4）。純粋 TS。
export interface DiffLine {
  kind: 'same' | 'add' | 'del';
  text: string;
}

const lines = (s: string): string[] => (s === '' ? [] : s.split('\n'));

/** 最長共通部分列（LCS）のペア [aのindex, bのindex] */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const t: number[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push([i++, j++]);
    else if (t[i + 1][j] >= t[i][j + 1]) i++;
    else j++;
  }
  return out;
}

export function diffLines(a: string, b: string): DiffLine[] {
  const x = lines(a);
  const y = lines(b);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...lcs(x, y), [x.length, y.length] as [number, number]]) {
    while (i < pi) out.push({ kind: 'del', text: x[i++] });
    while (j < pj) out.push({ kind: 'add', text: y[j++] });
    if (pi < x.length) out.push({ kind: 'same', text: x[pi] });
    i = pi + 1;
    j = pj + 1;
  }
  return out;
}

export interface MergeResult {
  text: string;
  /** 衝突マーカーを入れた箇所の数 */
  conflicts: number;
}

/**
 * diff3 方式。base からの変更を ours・theirs それぞれ求め、重ならない変更は両方取り込む。
 * 同じ場所を違う内容に変えた箇所は、両方を衝突マーカーで挟んで残す（データを失わない）。
 * ponytail: 行単位。短い本文の編集では行全体が衝突になりやすい。文字単位が要るなら diff を差し替える
 */
export function mergeThreeWay(base: string, ours: string, theirs: string): MergeResult {
  const o = lines(base);
  const a = lines(ours);
  const b = lines(theirs);
  // base の各行について、ours・theirs で変わらず対応する行（アンカー）
  const ma = new Map(lcs(o, a));
  const mb = new Map(lcs(o, b));
  const anchors: [number, number, number][] = [];
  for (const [oi, ai] of ma) {
    const bi = mb.get(oi);
    if (bi !== undefined) anchors.push([oi, ai, bi]);
  }
  anchors.sort((x, y) => x[0] - y[0]);

  const out: string[] = [];
  let conflicts = 0;
  let po = 0;
  let pa = 0;
  let pb = 0;
  const flush = (eo: number, ea: number, eb: number) => {
    const bo = o.slice(po, eo);
    const ca = a.slice(pa, ea);
    const cb = b.slice(pb, eb);
    const same = (x: string[], y: string[]) => x.length === y.length && x.every((l, k) => l === y[k]);
    if (same(ca, bo)) out.push(...cb); // ours は変更なし → theirs を採る
    else if (same(cb, bo) || same(ca, cb)) out.push(...ca); // theirs は変更なし、または同じ変更
    else {
      conflicts++;
      out.push('<<<<<<< 現在', ...ca, '=======', ...cb, '>>>>>>> 競合コピー');
    }
  };
  for (const [oi, ai, bi] of anchors) {
    flush(oi, ai, bi);
    out.push(o[oi]);
    po = oi + 1;
    pa = ai + 1;
    pb = bi + 1;
  }
  flush(o.length, a.length, b.length);
  return { text: out.join('\n'), conflicts };
}
