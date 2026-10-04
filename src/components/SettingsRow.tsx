import { MaterialIcons } from '@expo/vector-icons';
import { Children, Fragment } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { space, type, useThemed, type Palette } from '../ui/theme';

type Icon = React.ComponentProps<typeof MaterialIcons>['name'];

/** 設定の行（アイコン・タイトル・補足・右側の部品）。カードは使わない */
export function Row({ icon, title, sub, right, onPress, danger, disabled }: {
  icon: Icon; title: string; sub?: React.ReactNode; right?: React.ReactNode; onPress?: () => void; danger?: boolean; disabled?: boolean;
}) {
  const [p, styles] = useThemed(makeStyles);
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && onPress && styles.pressed]} onPress={onPress} disabled={disabled || !onPress} accessibilityLabel={title}>
      <MaterialIcons name={icon} size={22} color={danger ? p.dangerFg : p.inkMuted} />
      <View style={styles.text}>
        <Text style={[styles.title, danger && styles.danger]} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

/** 同じグループの行の間に、アイコンの右から区切り線を引く */
export function Group({ children }: { children: React.ReactNode }) {
  const [, styles] = useThemed(makeStyles);
  return (
    <View>
      {Children.toArray(children).map((c, i) => (
        <Fragment key={i}>
          {i ? <View style={styles.divider} /> : null}
          {c}
        </Fragment>
      ))}
    </View>
  );
}

export function SectionHeading({ first, children }: { first?: boolean; children: string }) {
  const [, styles] = useThemed(makeStyles);
  return <Text style={[styles.heading, first && styles.headingFirst]}>{children}</Text>;
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingHorizontal: space.s },
    pressed: { opacity: 0.7 },
    text: { flex: 1, paddingVertical: 8 },
    title: { ...type.item, color: p.ink },
    danger: { color: p.dangerFg, fontWeight: '600' },
    sub: { ...type.caption, color: p.inkMuted },
    divider: { height: 1, backgroundColor: p.border, marginLeft: 42 },
    heading: { ...type.label, color: p.inkMuted, paddingHorizontal: space.s, marginTop: 20, marginBottom: 4 },
    headingFirst: { marginTop: 24 },
  });
