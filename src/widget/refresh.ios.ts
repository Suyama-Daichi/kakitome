import { notifyDbChanged } from '../db/changes';
import { toggleItem } from '../db/actions';
import { itemChecked, widgetNote } from '../db/queries';
import ChecklistWidget from './IosWidget';

/**
 * ウィジェットで押したチェック（pending）を、applyLocalOp 経由で DB に反映する。反映したら true。
 * ウィジェットの描画コードは隔離されたランタイムで動き DB を触れないため、押した内容をウィジェット側に残し、アプリが動いたときにここで取り込む（設計 §8.2）
 */
async function applyPending(): Promise<boolean> {
  const entries = await ChecklistWidget.getTimeline().catch(() => []);
  const pending = entries[entries.length - 1]?.props.pending ?? [];
  let changed = false;
  for (const p of pending) {
    if (!!itemChecked(p.id) === p.checked) continue; // 適用は冪等。すでに同じなら何もしない
    toggleItem(p.id);
    changed = true;
  }
  return changed;
}

let running: Promise<void> = Promise.resolve();

/** アプリ内の変更をホーム画面のウィジェットへ反映する（iOS。設計 §8.2）。表示するのは一覧の先頭のメモ。先に、ウィジェットで押したチェックを取り込む */
export function refreshWidget() {
  // 取り込む前にスナップショットで pending を消さないよう、呼び出しを 1 つずつ順に処理する
  running = running.then(async () => {
    if (await applyPending()) {
      notifyDbChanged();
      void import('../sync/auto').then((m) => m.scheduler.schedule()); // auto.ts がこのファイルを import するので、循環を避けて遅延 import
    }
    const note = widgetNote(0);
    ChecklistWidget.updateSnapshot({
      title: note ? note.title || '無題のメモ' : 'メモがありません',
      done: note?.items.filter((it) => it.checked).length ?? 0,
      total: note?.items.length ?? 0,
      items: note?.items.map((it) => ({ id: it.id, text: it.text, checked: !!it.checked })) ?? [],
      pending: [],
      url: note ? `kakitome:///note/${note.id}` : 'kakitome:///',
    });
  }).catch(() => {});
}
