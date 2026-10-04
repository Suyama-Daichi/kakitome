"use no memo"; // react-native-android-widget は React Compiler 変換後のコンポーネントを描画できない
import { createElement } from 'react';
import { FlexWidget, ListWidget, TextWidget } from 'react-native-android-widget';
import type { NoteView } from '../db/queries';
import { palettes, type Palette } from '../ui/theme';

function Widget({ note, p }: { note?: NoteView; p: Palette }) {
  const done = note?.items.filter((it) => it.checked).length ?? 0;
  const total = note?.items.length ?? 0;
  return (
    <FlexWidget
      style={{
        height: 'match_parent', width: 'match_parent', backgroundColor: p.bg as `#${string}`, borderRadius: 20, padding: 14,
        borderWidth: 1, borderColor: p.border as `#${string}`, flexDirection: 'column',
      }}
    >
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget text={note?.title || (note ? '無題のメモ' : 'メモがありません')} style={{ fontSize: 15, fontWeight: 'bold', color: p.ink as `#${string}` }} />
        </FlexWidget>
        {total ? <TextWidget text={`${done}/${total}`} style={{ fontSize: 11, color: p.yellowText as `#${string}` }} /> : null}
      </FlexWidget>
      {total ? (
        <FlexWidget style={{ width: 'match_parent', height: 3, borderRadius: 2, backgroundColor: p.border as `#${string}`, marginBottom: 6, flexDirection: 'row' }}>
          {done ? <FlexWidget style={{ flex: done, height: 3, borderRadius: 2, backgroundColor: p.accent as `#${string}` }} /> : null}
          {total - done ? <FlexWidget style={{ flex: total - done, height: 3 }} /> : null}
        </FlexWidget>
      ) : null}
      {/* 項目が多いときはスクロールできるよう ListWidget に入れる（各項目は画像として描かれ、項目全体のタップが TOGGLE_ITEM になる） */}
      <ListWidget style={{ width: 'match_parent', height: 'match_parent' }}>
      {note?.items.map((it) => (
        <FlexWidget
          key={it.id}
          clickAction="TOGGLE_ITEM"
          clickActionData={{ itemId: it.id }}
          style={{ width: 'match_parent', height: 34, flexDirection: 'row', alignItems: 'center' }}
        >
          <FlexWidget
            style={{
              width: 18, height: 18, borderRadius: 5, marginRight: 10, alignItems: 'center', justifyContent: 'center',
              borderWidth: 1.5, borderColor: (it.checked ? p.accent : p.checkboxBorder) as `#${string}`,
              backgroundColor: (it.checked ? p.accent : p.bg) as `#${string}`,
            }}
          >
            {it.checked ? <TextWidget text="✓" style={{ fontSize: 12, color: '#ffffff' }} /> : null}
          </FlexWidget>
          <TextWidget text={it.text} style={{ fontSize: 14, color: (it.checked ? p.inkDone : p.ink) as `#${string}` }} />
        </FlexWidget>
      ))}
      </ListWidget>
    </FlexWidget>
  );
}

/** 端末のライト／ダーク設定に合わせて切り替わる表現を返す */
export const checklistWidget = (note?: NoteView) => ({
  light: createElement(Widget, { note, p: palettes.light }),
  dark: createElement(Widget, { note, p: palettes.dark }),
});
