// 分数インデックス: 文字列の辞書順で並べ、移動した1件の sort_key だけを変えれば済むようにする（設計 §3.1）。
// 桁は 0-9a-z。生成した鍵は末尾が最小桁('0')にならず、常に前後に挿入する余地が残る。
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const idx = (c: string) => DIGITS.indexOf(c);

function mid(a: string, b: string | null): string {
  if (b !== null) {
    // 共通接頭辞（a は不足分を最小桁で埋めて比較）を切り出して再帰
    let n = 0;
    while (n < b.length && (a[n] ?? DIGITS[0]) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + mid(a.slice(n), b.slice(n));
  }
  const da = a ? idx(a[0]) : 0;
  const db = b !== null ? idx(b[0]) : BASE;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
  // 先頭桁が連続している
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[da] + mid(a.slice(1), null);
}

/**
 * a < 戻り値 < b となる鍵を返す。a=null は先頭、b=null は末尾。
 * ponytail: 端への挿入は約5回ごとに1桁伸びる（1000回で約200桁）。問題になれば整数部を持つ方式（rocicorp/fractional-indexing 相当）へ。
 * ponytail: 2端末が同じ隙間に同時挿入すると同じ鍵になり得る。表示は (sort_key, id) の順で決定的に並ぶので許容
 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) throw new Error(`keyBetween: ${a} >= ${b}`);
  return mid(a ?? '', b);
}
