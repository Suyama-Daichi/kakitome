import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import { radius, useThemed, type Palette } from '../ui/theme';

/**
 * 下から出るシート。背景はフェードし、シートだけを上下させる（Modal の slide は背景ごと動くため）。
 * children に渡す close で閉じると、シートを下げてから onClose を呼ぶ
 */
export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: (close: () => void) => ReactNode }) {
  const [, styles] = useThemed(makeStyles);
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    rise.setValue(0);
    Animated.timing(rise, { toValue: 1, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [visible, rise]);
  const close = () => Animated.timing(rise, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => onClose());

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close}>
        <Animated.View style={{ transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }] }}>
          <Pressable style={styles.sheet}>
            <View style={styles.grip} />
            {visible ? children(close) : null}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    scrim: { flex: 1, backgroundColor: p.scrim, justifyContent: 'flex-end' },
    sheet: { backgroundColor: p.surfaceBar, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderTopWidth: 1, borderColor: p.borderStrong, paddingTop: 10, paddingHorizontal: 16, paddingBottom: 30, gap: 12 },
    grip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: p.borderStrong },
  });
