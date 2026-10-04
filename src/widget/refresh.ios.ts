import { widgetNote } from '../db/queries';
import ChecklistWidget from './IosWidget';

/** アプリ内の変更をホーム画面のウィジェットへ反映する（iOS。表示のみ。チェック操作はアプリ内、設計 §8.2）。表示するのは一覧の先頭のメモ */
export function refreshWidget() {
  const note = widgetNote(0);
  ChecklistWidget.updateSnapshot({
    title: note ? note.title || '無題のメモ' : 'メモがありません',
    done: note?.items.filter((it) => it.checked).length ?? 0,
    total: note?.items.length ?? 0,
    items: note?.items.map((it) => ({ text: it.text, checked: !!it.checked })) ?? [],
    url: note ? `kakitome:///note/${note.id}` : 'kakitome:///',
  });
}
