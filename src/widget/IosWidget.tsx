import { Button, HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { buttonStyle, font, foregroundStyle, lineLimit, padding, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget } from 'expo-widgets';

/** pending: ウィジェットで押したが、まだ DB に反映していないチェック。アプリが次に動いたときに applyLocalOp で反映する（設計 §8.2） */
export type IosWidgetProps = {
  title: string;
  done: number;
  total: number;
  items: { id: string; text: string; checked: boolean }[];
  pending: { id: string; checked: boolean }[];
  url: string;
};

// 'widget' の関数は隔離されたランタイムで動くため、モジュール定数や import 済みの関数は本体から使えない（modifiers は例外として公式の例が使っている）
const ChecklistWidget = (props: Partial<IosWidgetProps>, environment: { widgetFamily: string }) => {
  'widget';
  const items = props.items ?? []; // ギャラリーのプレビューなど、アプリがスナップショットを書く前は props が空
  const max = environment.widgetFamily === 'systemMedium' ? 4 : 10;
  // 項目を押すと、ウィジェットの表示をすぐ切り替え、押した内容を pending に残す（返した値が props に上書きされる）
  const toggle = (id: string) => () => {
    const next = items.map((x) => (x.id === id ? { ...x, checked: !x.checked } : x));
    const checked = next.find((x) => x.id === id)?.checked ?? false;
    return {
      items: next,
      done: next.filter((x) => x.checked).length,
      pending: [...(props.pending ?? []).filter((p) => p.id !== id), { id, checked }],
    };
  };
  return (
    <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 4 }), widgetURL(props.url ?? 'kakitome:///')]}>
      <HStack>
        <Text modifiers={[font({ size: 15, weight: 'bold' }), lineLimit(1), foregroundStyle({ type: 'hierarchical', style: 'primary' })]}>{props.title ?? 'kakitome'}</Text>
        <Spacer />
        {props.total ? <Text modifiers={[font({ size: 11 }), foregroundStyle('#00897B')]}>{`${props.done}/${props.total}`}</Text> : null}
      </HStack>
      {items.slice(0, max).map((it) => (
        <Button key={it.id} target={it.id} onPress={toggle(it.id)} modifiers={[buttonStyle('plain')]}>
          <HStack>
            <Text modifiers={[font({ size: 14 }), lineLimit(1), foregroundStyle({ type: 'hierarchical', style: it.checked ? 'tertiary' : 'primary' })]}>
              {`${it.checked ? '☑' : '☐'} ${it.text}`}
            </Text>
            <Spacer />
          </HStack>
        </Button>
      ))}
    </VStack>
  );
};

export default createWidget('Checklist', ChecklistWidget);
