import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type PressableProps, type ViewStyle } from 'react-native';

import { PressScale } from '@/components/motion';
import { colors, radius } from '@/theme';

type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  busy?: boolean;
  style?: ViewStyle;
};

export function Button({ label, variant = 'primary', busy, disabled, style, ...rest }: ButtonProps) {
  const isPrimary = variant === 'primary';
  return (
    <PressScale
      disabled={disabled || busy}
      style={[styles.button, isPrimary ? styles.primary : variant === 'secondary' ? styles.secondary : styles.ghost, (disabled || busy) && styles.disabled, style]}
      {...rest}
    >
      {busy ? (
        <ActivityIndicator color={isPrimary ? colors.onAccent : colors.text} />
      ) : (
        <Text style={[styles.buttonLabel, { color: isPrimary ? colors.onAccent : colors.text }]}>{label}</Text>
      )}
    </PressScale>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Chip({ label, selected, onPress, color = colors.accent }: { label: string; selected: boolean; onPress: () => void; color?: string }) {
  return (
    <PressScale accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && { backgroundColor: color, borderColor: color }]}>
      <Text style={[styles.chipLabel, { color: selected ? colors.onAccent : colors.textMuted }]}>{label}</Text>
    </PressScale>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { height: 52, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  primary: { backgroundColor: colors.accent },
  secondary: { borderWidth: 1, borderColor: colors.border, backgroundColor: 'transparent' },
  ghost: { backgroundColor: colors.surface },
  disabled: { opacity: 0.4 },
  buttonLabel: { fontSize: 15, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16 },
  chip: { minWidth: 48, height: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  chipLabel: { fontSize: 15, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 6 },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  emptyHint: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
});
