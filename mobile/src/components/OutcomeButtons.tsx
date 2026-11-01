import { StyleSheet, Text, View } from 'react-native';

import { PressScale } from '@/components/motion';
import { OUTCOME_NAME, OUTCOMES, type Outcome } from '@/domain/dunkAttempts';
import { colors, radius } from '@/theme';

export const OUTCOME_COLOR: Record<Outcome, string> = { made: colors.good, rim: colors.rim, short: colors.textMuted };

/** How a dunk attempt went, one tap each: the attempts screen logs it, the take-off analysis saves the filmed one. */
export function OutcomeButtons({ onPick, disabled, height = 88 }: { onPick: (o: Outcome) => void; disabled?: boolean; height?: number }) {
  return (
    <View style={styles.outcomes}>
      {OUTCOMES.map((o) => (
        <PressScale
          key={o}
          accessibilityLabel={OUTCOME_NAME[o]}
          accessibilityState={{ disabled: !!disabled }}
          disabled={disabled}
          onPress={() => onPick(o)}
          style={[styles.outcome, { height, borderColor: OUTCOME_COLOR[o] }, disabled && styles.disabled]}
        >
          <Text style={[styles.outcomeText, { color: OUTCOME_COLOR[o] }]}>{OUTCOME_NAME[o]}</Text>
        </PressScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  outcomes: { flexDirection: 'row', gap: 10 },
  outcome: { flex: 1, borderRadius: radius.card, borderWidth: 2, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  outcomeText: { fontSize: 17, fontWeight: '700' },
  disabled: { opacity: 0.4 },
});
