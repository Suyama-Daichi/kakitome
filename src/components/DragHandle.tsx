import { MaterialIcons } from '@expo/vector-icons';
import { useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { usePalette } from '../ui/theme';

/** 「≡」を押したまま上下に動かして並び替える。指を離すまで他の操作を横取りされない */
export function DragHandle({ onStart, onMove, onEnd }: { onStart: () => void; onMove: (dy: number) => void; onEnd: () => void }) {
  const p = usePalette();
  const cb = useRef({ onStart, onMove, onEnd });
  cb.current = { onStart, onMove, onEnd };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => cb.current.onStart(),
      onPanResponderMove: (_, g) => cb.current.onMove(g.dy),
      onPanResponderRelease: () => cb.current.onEnd(),
      onPanResponderTerminate: () => cb.current.onEnd(),
    }),
  ).current;
  return (
    <View {...pan.panHandlers} style={styles.handle} accessibilityLabel="ドラッグして並び替え">
      <MaterialIcons name="drag-indicator" size={20} color={p.dragHandle} />
    </View>
  );
}

const styles = StyleSheet.create({ handle: { paddingHorizontal: 10, paddingVertical: 10 } });
