import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Empty } from '@/components/ui';
import { addTrial, ensureSession } from '@/db/repo';
import { manualProblem, parseNumber } from '@/domain/entry';
import { getMetric } from '@/domain/metrics';
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

  if (!def) return <Empty title="找不到这个项目" />;
  const value = parseNumber(raw);
  const problem = value == null ? null : manualProblem(def, value);

  async function save() {
    if (value == null || problem || !current || !def) return;
    setSaving(true);
    try {
      await ensureSession(db, session, current.id, def.code);
      await addTrial(db, { session_id: session, value, detail: { source: 'manual' } });
      router.replace({ pathname: '/measure/result', params: { metric, session, ...(from ? { from } : {}) } });
    } catch (e) {
      Alert.alert('保存失败', String(e));
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: def.name }} />
      <KeyboardAvoidingView behavior="padding" style={styles.body}>
        <Text style={text.muted}>输入这一次的成绩</Text>
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
        <View style={{ flex: 1 }} />
        <Button label="保存这一次" onPress={save} disabled={value == null || problem != null} busy={saving} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, padding: 20, gap: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, padding: 16, borderRadius: radius.card, backgroundColor: colors.surface },
  input: { flex: 1, color: colors.accent, fontFamily: fonts.numericBold, fontSize: 64, padding: 0 },
  unit: { color: colors.textMuted, fontSize: 20 },
  problem: { color: colors.warn, fontSize: 13 },
});
