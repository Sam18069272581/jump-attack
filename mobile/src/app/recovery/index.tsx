import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Chip } from '@/components/ui';
import { listRecoveryDays, saveRecoveryDay } from '@/db/recovery';
import { addDays, shortDate, type ISODate } from '@/domain/dates';
import { manualProblem, parseNumber } from '@/domain/entry';
import { formatValue, getCategory, getMetric } from '@/domain/metrics';
import { readRecovery, RECOVERY_CODES, STATUS_TEXT, type RecoveryDay, type RecoveryKey } from '@/domain/recovery';
import { useAthlete } from '@/state/athlete';
import { todayISO } from '@/state/training';
import { colors, fonts, radius, text } from '@/theme';

const COLOR = getCategory('recovery').color;
const KEYS = Object.keys(RECOVERY_CODES) as RecoveryKey[];
const HINT: Record<RecoveryKey, string> = {
  hrv: '早上醒来，「健康」App → 浏览 → 心脏 → 心率变异性',
  rhr: '「健康」App → 心脏 → 静息心率，或手表上的晨起心率',
  sleep: '昨晚实际睡着的时间',
  resp: '「健康」App → 呼吸 → 呼吸速率（可不填）',
};
const STATUS_COLOR = { good: colors.good, fair: colors.warn, poor: colors.record, unknown: colors.textMuted };

type Form = Record<RecoveryKey, string>;

const toForm = (d: RecoveryDay | undefined): Form =>
  Object.fromEntries(KEYS.map((k) => [k, d?.[k] != null ? String(d[k]) : ''])) as Form;

/** Today's recovery read and the daily log of HRV, resting heart rate, sleep and breathing rate. */
export default function Recovery() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const today = todayISO();
  const [days, setDays] = useState<RecoveryDay[]>([]);
  const [date, setDate] = useState<ISODate>(today);
  const [form, setForm] = useState<Form>(toForm(undefined));
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (d: ISODate) => {
      if (!current) return;
      const rows = await listRecoveryDays(db, current.id);
      setDays(rows);
      setForm(toForm(rows.find((r) => r.date === d)));
    },
    [db, current],
  );

  useFocusEffect(
    useCallback(() => {
      load(date);
    }, [load, date]),
  );

  const read = readRecovery(days, today);
  const todayRow = days.find((d) => d.date === today);
  const values = Object.fromEntries(KEYS.map((k) => [k, parseNumber(form[k])])) as Record<RecoveryKey, number | null>;
  const problems = KEYS.map((k) => values[k] != null && manualProblem(getMetric(RECOVERY_CODES[k])!, values[k]!)).filter(Boolean) as string[];


  async function save() {
    if (!current || problems.length) return;
    setSaving(true);
    try {
      await saveRecoveryDay(db, current.id, { date, ...values });
      await load(date);
    } catch (e) {
      Alert.alert('保存失败', String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Card style={{ gap: 6 }}>
          <Text style={text.muted}>今日恢复状态</Text>
          <Text style={[styles.status, { color: STATUS_COLOR[read.status] }]}>{STATUS_TEXT[read.status].label}</Text>
          <Text style={text.body}>{STATUS_TEXT[read.status].advice}</Text>
          {read.reasons.map((r) => (
            <Text key={r} style={text.muted}>
              · {r}
            </Text>
          ))}
        </Card>

        <View style={styles.tiles}>
          {KEYS.map((k) => {
            const def = getMetric(RECOVERY_CODES[k])!;
            const v = todayRow?.[k];
            const base = k === 'hrv' ? read.hrv : k === 'rhr' ? read.rhr : null;
            const cmp =
              v == null
                ? '今天还没记'
                : !base
                  ? k === 'hrv' || k === 'rhr'
                    ? '记满 3 天后显示基线'
                    : ''
                  : k === 'hrv'
                    ? `基线 ${Math.round(base.low)}–${Math.round(base.high)}`
                    : `比 7 天平均 ${v - base.mean >= 0 ? '+' : '−'}${Math.abs(Math.round(v - base.mean))}`;
            return (
              <View key={k} style={styles.tile}>
                <Text style={text.caption}>{def.name}</Text>
                <Text style={styles.tileValue}>
                  {v != null ? formatValue(def, v) : '—'} <Text style={styles.tileUnit}>{def.unit}</Text>
                </Text>
                <Text style={text.caption}>{cmp}</Text>
              </View>
            );
          })}
        </View>

        <Card style={{ gap: 12 }}>
          <View style={styles.formHead}>
            <Text style={text.section}>记录</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Chip label="今天" selected={date === today} onPress={() => setDate(today)} color={COLOR} />
              <Chip label="昨天" selected={date === addDays(today, -1)} onPress={() => setDate(addDays(today, -1))} color={COLOR} />
            </View>
          </View>
          <Text style={text.caption}>{shortDate(date)} · 起床后记一次。数据可以从 iPhone「健康」App 或手表里看到。</Text>
          {KEYS.map((k) => {
            const def = getMetric(RECOVERY_CODES[k])!;
            return (
              <View key={k} style={{ gap: 4 }}>
                <View style={styles.field}>
                  <Text style={styles.fieldName}>{def.name}</Text>
                  <TextInput
                    value={form[k]}
                    onChangeText={(t) => setForm((f) => ({ ...f, [k]: t }))}
                    keyboardType="decimal-pad"
                    placeholder="—"
                    placeholderTextColor={colors.textFaint}
                    style={styles.input}
                    accessibilityLabel={`${def.name}（${def.unit}）`}
                  />
                  <Text style={styles.unit}>{def.unit}</Text>
                </View>
                <Text style={text.caption}>{HINT[k]}</Text>
              </View>
            );
          })}
          {problems.map((p) => (
            <Text key={p} style={styles.problem}>
              {p}
            </Text>
          ))}
          <Button label="保存" onPress={save} busy={saving} disabled={problems.length > 0} />
        </Card>

        <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/history/[metric]', params: { metric: RECOVERY_CODES.hrv } })}>
          <Text style={styles.link}>在「历史」查看 HRV 与心率趋势</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  status: { fontSize: 28, fontWeight: '700' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.row, padding: 14, gap: 4 },
  tileValue: { color: COLOR, fontFamily: fonts.numericBold, fontSize: 32 },
  tileUnit: { color: colors.textMuted, fontSize: 13 },
  formHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldName: { flex: 1, color: colors.text, fontSize: 14 },
  input: { width: 90, height: 44, borderRadius: 12, backgroundColor: colors.surfaceRaised, color: colors.text, fontFamily: fonts.numeric, fontSize: 22, textAlign: 'center' },
  unit: { width: 44, color: colors.textMuted, fontSize: 12 },
  problem: { color: colors.warn, fontSize: 13 },
  link: { color: COLOR, fontSize: 14, textAlign: 'center', padding: 8 },
});
