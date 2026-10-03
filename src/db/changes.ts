// 同期で DB が変わったことを画面へ知らせる（ローカル編集中の画面は、これを受けても入力欄を上書きしない）
const listeners = new Set<() => void>();

export function subscribeDbChanges(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export const notifyDbChanged = () => listeners.forEach((fn) => fn());
