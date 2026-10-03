import { applyLocalOp } from '../core/merge';
import { openCore } from './index';
import { firstNoteWithItems, itemChecked } from './queries';

/** アプリ・ウィジェット共通。変更は必ず applyLocalOp 経由 */
export function toggleItem(itemId: string) {
  const { ctx, tx } = openCore();
  tx(() => applyLocalOp(ctx, 'checklist_item', itemId, { checked: itemChecked(itemId) ? 0 : 1 }));
}

/** PoC 用のデモデータ。ノートが無いときだけ投入 */
export function seedDemo() {
  if (firstNoteWithItems()) return;
  const { ctx, tx } = openCore();
  const now = new Date().toISOString();
  tx(() => {
    const noteId = ctx.newId();
    applyLocalOp(ctx, 'note', noteId, { title: '買い物', body: '', pinned: 0, sort_key: 'a0', deleted: 0, created_at: now });
    ['牛乳', '卵', 'パン'].forEach((text, i) =>
      applyLocalOp(ctx, 'checklist_item', ctx.newId(), { note_id: noteId, text, checked: 0, sort_key: `a${i}`, deleted: 0, created_at: now }),
    );
  });
}
