import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, lineLimit, padding, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget } from 'expo-widgets';

export type IosWidgetProps = { title: string; done: number; total: number; items: { text: string; checked: boolean }[]; url: string };

// 'widget' の関数は隔離されたランタイムで動くため、モジュール定数や import 済みの関数は本体から使えない（modifiers は例外として公式の例が使っている）
const ChecklistWidget = (props: Partial<IosWidgetProps>, environment: { widgetFamily: string }) => {
  'widget';
  const items = props.items ?? []; // ギャラリーのプレビューなど、アプリがスナップショットを書く前は props が空
  const max = environment.widgetFamily === 'systemMedium' ? 4 : 10;
  return (
    <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 4 }), widgetURL(props.url ?? 'kakitome:///')]}>
      <HStack>
        <Text modifiers={[font({ size: 15, weight: 'bold' }), lineLimit(1), foregroundStyle({ type: 'hierarchical', style: 'primary' })]}>{props.title ?? 'kakitome'}</Text>
        <Spacer />
        {props.total ? <Text modifiers={[font({ size: 11 }), foregroundStyle('#00897B')]}>{`${props.done}/${props.total}`}</Text> : null}
      </HStack>
      {items.slice(0, max).map((it, i) => (
        <Text key={i} modifiers={[font({ size: 14 }), lineLimit(1), foregroundStyle({ type: 'hierarchical', style: it.checked ? 'tertiary' : 'primary' })]}>
          {`${it.checked ? '☑' : '☐'} ${it.text}`}
        </Text>
      ))}
    </VStack>
  );
};

export default createWidget('Checklist', ChecklistWidget);
