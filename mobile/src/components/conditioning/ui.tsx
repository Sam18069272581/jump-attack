import { router, Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { newSessionId, saveSession } from '@/db/repo';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius } from '@/theme';

/** Numbered set-up and running instructions shown before a test. */
export function Steps({ title, steps }: { title: string; steps: string[] }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {steps.map((s, i) => (
        <View key={s} style={styles.step}>
          <Text style={styles.stepN}>{i + 1}</Text>
          <Text style={styles.stepText}>{s}</Text>
        </View>
      ))}
    </View>
  );
}

/** While a test runs: no header and no swipe-back, so a stray gesture can't abandon it. */
export function RunningScreen({ children }: { children: ReactNode }) {
  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      {children}
    </>
  );
}

export function Stepper({ value, onChange, min = 0, max = Infinity, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  return (
    <View style={styles.stepper}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}减一`} disabled={value <= min} onPress={() => onChange(value - 1)} style={[styles.stepBtn, value <= min && styles.off]}>
        <Text style={styles.stepBtnText}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}加一`} disabled={value >= max} onPress={() => onChange(value + 1)} style={[styles.stepBtn, value >= max && styles.off]}>
        <Text style={styles.stepBtnText}>+</Text>
      </Pressable>
    </View>
  );
}

/** Asks before ending a test that is still running. */
export function confirmStop(onStop: () => void, message = '会按现在的进度出成绩。') {
  Alert.alert('结束测试？', message, [
    { text: '继续测试', style: 'cancel' },
    { text: '结束', style: 'destructive', onPress: onStop },
  ]);
}

/** Saves a finished test for the current athlete and opens its result. */
export function useSaveResult(metricCode: string) {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [busy, setBusy] = useState(false);

  async function save(values: number[]) {
    if (!current || busy) return;
    setBusy(true);
    try {
      const session = newSessionId();
      await saveSession(db, session, current.id, metricCode, values);
      router.replace({ pathname: '/conditioning/result', params: { metric: metricCode, session } });
    } catch (e) {
      setBusy(false);
      Alert.alert('保存失败', String(e));
    }
  }

  return { save, busy };
}

export const runStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, padding: 20, gap: 16 },
  label: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  huge: { color: colors.text, fontFamily: fonts.numericBold, fontSize: 120, lineHeight: 124, textAlign: 'center' },
  big: { color: colors.accent, fontFamily: fonts.numericBold, fontSize: 64, lineHeight: 68, textAlign: 'center' },
  phase: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  stats: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: colors.surface, borderRadius: radius.card, paddingVertical: 14 },
  stat: { alignItems: 'center', gap: 2 },
  statValue: { color: colors.text, fontFamily: fonts.numeric, fontSize: 28 },
  statLabel: { color: colors.textMuted, fontSize: 11 },
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 8 },
});

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, gap: 12 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  step: { flexDirection: 'row', gap: 12 },
  stepN: { width: 18, color: colors.accent, fontFamily: fonts.numericBold, fontSize: 17, lineHeight: 20 },
  stepText: { flex: 1, color: colors.textSoft, fontSize: 14, lineHeight: 20 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
  stepBtn: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { color: colors.text, fontSize: 26, lineHeight: 30 },
  stepValue: { minWidth: 60, color: colors.text, fontFamily: fonts.numericBold, fontSize: 40, textAlign: 'center' },
  off: { opacity: 0.3 },
});
