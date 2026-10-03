"use no memo"; // react-native-android-widget は React Compiler 変換後のコンポーネントを描画できない
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { NoteView } from '../db/queries';

export function ChecklistWidget({ note }: { note?: NoteView }) {
  return (
    <FlexWidget
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: '#ffffff', borderRadius: 16, padding: 12, flexDirection: 'column' }}
    >
      <TextWidget text={note?.title ?? 'メモがありません'} style={{ fontSize: 16, fontWeight: 'bold', color: '#111111', marginBottom: 8 }} />
      {note?.items.map((it) => (
        <FlexWidget
          key={it.id}
          clickAction="TOGGLE_ITEM"
          clickActionData={{ itemId: it.id }}
          style={{ width: 'match_parent', flexDirection: 'row', paddingVertical: 4 }}
        >
          <TextWidget text={it.checked ? '☑' : '☐'} style={{ fontSize: 16, color: '#111111', marginRight: 8 }} />
          <TextWidget text={it.text} style={{ fontSize: 16, color: it.checked ? '#999999' : '#111111' }} />
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}
