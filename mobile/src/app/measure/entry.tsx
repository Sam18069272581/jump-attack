import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Chip, Empty } from '@/components/ui';
import { addTrial, ensureSession } from '@/db/repo';
import { manualProblem, parseNumber } from '@/domain/entry';
import { getMetric } from '@/domain/metrics';
import { TIMING_NAME, TYPED_TIMINGS } from '@/domain/timing';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius, text } from '@/theme';

/** Types in one attempt from a stopwatch, timing gates or another device, then shows the session result. */
export default function ManualEntry() {
  const { metric, session, from } = useLocalSearchParams<{ metric: string; session: string; from?: string }>();
  const def = getMetric(metric);
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [raw, setRaw] = useState('');
  const [saving, setSaving] = useState(false);
  const [timing, setTiming] = useState<(typeof TYPED_TIMINGS)[number] | null>(null);

  if (!def) return <Empty title="找不到这个项目" />;
  const value = parseNumber(raw);
  const problem = value == null ? null : manualProblem(def, value);
  // Sprint times only compare within one timing method (domain/timing.ts).
  const askTiming = def.category === 'speed';

  async function save() {
    if (value == null || problem || !current || !def) return;
    setSaving(true);
    try {
      await ensureSession(db, session, current.id, def.code);
      await addTrial(db, { session_id: session, value, detail: { source: 'manual', ...(timing ? { timing } : {}) } });
      router.replace({ pathname: '/measure/result', params: { metric, session, ...(from ? { from } : {}) } });
    } catch (e) {
      Alert.alert('保存失败', String(e));
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: def.name }} />
      {/* The button sits right under the field: the number pad has no return key and would cover anything lower. */}
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={text.muted}>{def.entryHint ?? '输入这一次的成绩'}</Text>
        {askTiming && (
          <View style={{ gap: 8 }}>
            <Text style={text.muted}>怎么计时的？不同计时方式差 0.1–0.3 秒，成绩只和同一种方式比较。</Text>
            <View style={styles.chips}>
              {TYPED_TIMINGS.map((t) => (
                <Chip key={t} label={TIMING_NAME[t]} selected={timing === t} onPress={() => setTiming(timing === t ? null : t)} />
              ))}
            </View>
          </View>
        )}
        <View style={styles.inputRow}>
          <TextInput
            value={raw}
            onChangeText={setRaw}
            keyboardType="decimal-pad"
            placeholder={(0).toFixed(def.decimals)}
            placeholderTextColor={colors.textFaint}
            autoFocus
            style={styles.input}
            accessibilityLabel={`${def.name}（${def.unit}）`}
          />
          <Text style={styles.unit}>{def.unit}</Text>
        </View>
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <Button label="保存这一次" onPress={save} disabled={value == null || problem != null} busy={saving} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 20, gap: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, padding: 16, borderRadius: radius.card, backgroundColor: colors.surface },
  input: { flex: 1, color: colors.accent, fontFamily: fonts.numericBold, fontSize: 64, padding: 0 },
  unit: { color: colors.textMuted, fontSize: 20 },
  problem: { color: colors.warn, fontSize: 13 },
  chips: { flexDirection: 'row', gap: 8 },
});
