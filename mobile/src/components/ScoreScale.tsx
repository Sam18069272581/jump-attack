import { Pressable, StyleSheet, Text, View } from 'react-native';

import { tr } from '@/i18n';
import { colors, fonts } from '@/theme';

const SCORES = Array.from({ length: 11 }, (_, i) => i);

/** A 0–10 score in one tap: knee pain, or how hard a session was. Scores above `warnAbove` show in the warning colour. */
export function ScoreScale({
  label,
  value,
  onPick,
  hint,
  warnAbove = 10,
}: {
  label: string;
  value: number | null;
  onPick: (score: number) => void;
  /** What 0 and 10 mean. */
  hint: string;
  warnAbove?: number;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {SCORES.map((n) => {
          const selected = n === value;
          const tone = n > warnAbove ? colors.warn : colors.accent;
          return (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityLabel={tr('{label} {n} 分', { label, n })}
              accessibilityState={{ selected }}
              hitSlop={4}
              onPress={() => onPick(n)}
              style={[styles.dot, selected && { backgroundColor: tone, borderColor: tone }]}
            >
              <Text style={[styles.num, selected && { color: colors.onAccent }]}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  dot: { width: 28, height: 32, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  num: { color: colors.textMuted, fontFamily: fonts.numeric, fontSize: 15 },
  hint: { color: colors.textMuted, fontSize: 11 },
});
