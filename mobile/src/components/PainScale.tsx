import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/theme';

const SCORES = Array.from({ length: 11 }, (_, i) => i);

/** Knee pain 0–10 in one tap. Above 5 shows in the warning colour, as the pain-monitoring model's limit. */
export function PainScale({ label, value, onPick }: { label: string; value: number | null; onPick: (score: number) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {SCORES.map((n) => {
          const selected = n === value;
          const tone = n > 5 ? colors.warn : colors.accent;
          return (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${n} 分`}
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
      <Text style={styles.hint}>0 不疼 · 10 最疼</Text>
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
