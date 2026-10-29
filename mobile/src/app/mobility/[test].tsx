import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Inclinometer } from '@/components/Inclinometer';
import { Button, Card, Empty } from '@/components/ui';
import { addTrial, ensureSession, newSessionId } from '@/db/repo';
import { manualProblem, parseNumber } from '@/domain/entry';
import { formatValue, type MetricDef } from '@/domain/metrics';
import { asymmetry, getMobilityTest } from '@/domain/mobility';
import { tr } from '@/i18n';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius, text } from '@/theme';

type Side = { raw: string; measured: boolean };

/** Records both sides of one mobility test, typed in or read off the phone's inclinometer. */
export default function MobilityEntry() {
  const { test } = useLocalSearchParams<{ test: string }>();
  const t = getMobilityTest(test);
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [left, setLeft] = useState<Side>({ raw: '', measured: false });
  const [right, setRight] = useState<Side>({ raw: '', measured: false });
  const [meter, setMeter] = useState<'L' | 'R' | null>(null);
  const [saving, setSaving] = useState(false);

  if (!t) return <Empty title={tr('找不到这个测试')} />;
  const angles = t.unit === '°';
  const l = parseNumber(left.raw);
  const r = parseNumber(right.raw);
  const problems = [l != null && manualProblem(t.left, l), r != null && manualProblem(t.right, r)].filter(Boolean) as string[];
  const a = l != null && r != null ? asymmetry(t, l, r) : null;
  const canSave = (l != null || r != null) && problems.length === 0;

  async function save() {
    if (!current || !canSave) return;
    setSaving(true);
    try {
      for (const [def, v, side] of [[t!.left, l, left], [t!.right, r, right]] as const) {
        if (v == null) continue;
        const session = newSessionId();
        await ensureSession(db, session, current.id, def.code);
        await addTrial(db, { session_id: session, value: v, detail: { source: side.measured ? 'inclinometer' : 'manual' } });
      }
      router.back();
    } catch (e) {
      Alert.alert(tr('保存失败'), String(e));
      setSaving(false);
    }
  }

  const sideCard = (label: 'L' | 'R', def: MetricDef, side: Side, set: (s: Side) => void) => (
    <Card style={{ gap: 10 }}>
      <View style={styles.sideHead}>
        <Text style={text.section}>{label === 'L' ? tr('左侧') : tr('右侧')}</Text>
        {angles && (
          <Pressable accessibilityRole="button" onPress={() => setMeter(meter === label ? null : label)}>
            <Text style={styles.link}>{meter === label ? tr('收起量角') : tr('手机量角')}</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.inputRow}>
        <TextInput
          value={side.raw}
          onChangeText={(raw) => set({ raw, measured: false })}
          keyboardType="numbers-and-punctuation"
          placeholder={(0).toFixed(def.decimals)}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          accessibilityLabel={tr('{name}（{unit}）', { name: def.name, unit: def.unit })}
        />
        <Text style={styles.unit}>{def.unit}</Text>
      </View>
      {meter === label && (
        <Inclinometer
          onUse={(deg) => {
            set({ raw: String(deg), measured: true });
            setMeter(null);
          }}
        />
      )}
    </Card>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: t.name }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text style={text.muted}>{t.how}</Text>
        {sideCard('L', t.left, left, setLeft)}
        {sideCard('R', t.right, right, setRight)}
        {problems.map((p) => (
          <Text key={p} style={styles.problem}>
            {p}
          </Text>
        ))}
        {a && (
          <Text style={[styles.asym, a.flagged && { color: colors.warn }]}>{tr('左右差 {left}{unit}{p}{p2}', { left: formatValue(t.left, a.diff), unit: t.unit, p: a.pct != null ? tr('（{pct}%）', { pct: Math.round(a.pct * 100) }) : '', p2: a.flagged ? tr('，超过提醒线，多练弱侧') : tr('，在正常范围内') })}</Text>
        )}
      </ScrollView>
      <View style={styles.footer}>
        <Button label={tr('保存')} onPress={save} disabled={!canSave} busy={saving} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  sideHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { color: colors.purple, fontSize: 13, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  input: { flex: 1, height: 56, borderRadius: radius.chip, backgroundColor: colors.surfaceRaised, paddingHorizontal: 14, color: colors.text, fontFamily: fonts.numericBold, fontSize: 32 },
  unit: { color: colors.textMuted, fontSize: 18, width: 28 },
  problem: { color: colors.warn, fontSize: 13 },
  asym: { color: colors.textSoft, fontSize: 13 },
  footer: { paddingHorizontal: 16, paddingTop: 8 },
});
