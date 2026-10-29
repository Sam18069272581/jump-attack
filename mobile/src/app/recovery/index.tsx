import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Chip } from '@/components/ui';
import { listRecoveryDays, saveRecoveryDay, type RecoverySource } from '@/db/recovery';
import { addDays, shortDate, type ISODate } from '@/domain/dates';
import { manualProblem, parseNumber } from '@/domain/entry';
import { parseHealthImport } from '@/domain/healthImport';
import { formatValue, getCategory, getMetric } from '@/domain/metrics';
import { readRecovery, RECOVERY_CODES, STATUS_TEXT, type RecoveryDay, type RecoveryKey } from '@/domain/recovery';
import { localized, tr } from '@/i18n';
import { useAthlete } from '@/state/athlete';
import { CONSENT_TITLE, consentText, hasHealthConsent, setHealthConsent } from '@/state/healthConsent';
import { todayISO } from '@/state/training';
import { colors, fonts, radius, text } from '@/theme';

const COLOR = getCategory('recovery').color;
const KEYS = Object.keys(RECOVERY_CODES) as RecoveryKey[];
const HINT: Record<RecoveryKey, string> = localized({
  hrv: '早上醒来，「健康」App → 浏览 → 心脏 → 心率变异性',
  rhr: '「健康」App → 心脏 → 静息心率，或手表上的晨起心率',
  sleep: '昨晚实际睡着的时间',
  resp: '「健康」App → 呼吸 → 呼吸速率（可不填）',
});
const STATUS_COLOR = { good: colors.good, fair: colors.warn, poor: colors.record, unknown: colors.textMuted };

type Form = Record<RecoveryKey, string>;
type Sources = Partial<Record<RecoveryKey, RecoverySource>>;

/** Asks once, before the first import, whether Apple Health data may be pasted in. */
function askConsent(): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(tr(CONSENT_TITLE), consentText(), [
      { text: tr('不同意'), style: 'cancel', onPress: () => resolve(false) },
      { text: tr('同意并导入'), onPress: () => resolve(true) },
    ]),
  );
}

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
  const [sources, setSources] = useState<Sources>({});
  const [importNote, setImportNote] = useState<string | null>(null);

  const load = useCallback(
    async (d: ISODate) => {
      if (!current) return;
      const rows = await listRecoveryDays(db, current.id);
      setDays(rows);
      setForm(toForm(rows.find((r) => r.date === d)));
      setSources({});
      setImportNote(null);
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


  async function importFromHealth() {
    if (!(await hasHealthConsent())) {
      if (!(await askConsent())) return;
      await setHealthConsent(true);
    }
    const parsed = parseHealthImport(await Clipboard.getStringAsync());
    if (!parsed || !Object.keys(parsed.values).length) {
      Alert.alert(tr('剪贴板里没有健康数据'), parsed?.problems.join('\n') || tr('先运行「恢复数据」快捷指令，再回来点导入。'), [
        { text: tr('好'), style: 'cancel' },
        { text: tr('查看设置方法'), onPress: () => router.push('/recovery/health') },
      ]);
      return;
    }
    const keys = KEYS.filter((k) => parsed.values[k] != null);
    setForm((f) => ({ ...f, ...Object.fromEntries(keys.map((k) => [k, String(parsed.values[k])])) }));
    setSources((s) => ({ ...s, ...Object.fromEntries(keys.map((k) => [k, 'health'])) }));
    const names = keys.map((k) => getMetric(RECOVERY_CODES[k])!.short ?? getMetric(RECOVERY_CODES[k])!.name).join(tr('、'));
    setImportNote([tr('已从健康导入{names}，核对后点保存。', { names }), ...parsed.problems].join('\n'));
  }

  function edit(k: RecoveryKey, t: string) {
    setForm((f) => ({ ...f, [k]: t }));
    setSources((s) => {
      const next = { ...s };
      delete next[k]; // typed over, so no longer from Health
      return next;
    });
  }

  async function save() {
    if (!current || problems.length) return;
    setSaving(true);
    try {
      await saveRecoveryDay(db, current.id, { date, ...values }, sources);
      await load(date);
    } catch (e) {
      Alert.alert(tr('保存失败'), String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Card style={{ gap: 6 }}>
          <Text style={text.muted}>{tr('今日恢复状态')}</Text>
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
                ? tr('今天还没记')
                : !base
                  ? k === 'hrv' || k === 'rhr'
                    ? tr('记满 3 天后显示基线')
                    : ''
                  : k === 'hrv'
                    ? tr('基线 {low}–{high}', { low: Math.round(base.low), high: Math.round(base.high) })
                    : tr('比 7 天平均 {p}{v}', { p: v - base.mean >= 0 ? '+' : '−', v: Math.abs(Math.round(v - base.mean)) });
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
            <Text style={text.section}>{tr('记录')}</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Chip label={tr('今天')} selected={date === today} onPress={() => setDate(today)} color={COLOR} />
              <Chip label={tr('昨天')} selected={date === addDays(today, -1)} onPress={() => setDate(addDays(today, -1))} color={COLOR} />
            </View>
          </View>
          <Text style={text.caption}>{tr('{date} · 起床后记一次。可以从苹果健康导入，也可以手填。', { date: shortDate(date) })}</Text>
          <Button label={tr('从苹果健康导入')} variant="secondary" onPress={importFromHealth} />
          <Pressable accessibilityRole="link" onPress={() => router.push('/recovery/health')}>
            <Text style={styles.smallLink}>{tr('怎么设置快捷指令 · 隐私说明')}</Text>
          </Pressable>
          {importNote && <Text style={styles.note}>{importNote}</Text>}
          {KEYS.map((k) => {
            const def = getMetric(RECOVERY_CODES[k])!;
            return (
              <View key={k} style={{ gap: 4 }}>
                <View style={styles.field}>
                  <Text style={styles.fieldName}>{def.name}</Text>
                  <TextInput
                    value={form[k]}
                    onChangeText={(t) => edit(k, t)}
                    keyboardType="decimal-pad"
                    placeholder="—"
                    placeholderTextColor={colors.textFaint}
                    style={styles.input}
                    accessibilityLabel={tr('{name}（{unit}）', { name: def.name, unit: def.unit })}
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
          <Button label={tr('保存')} onPress={save} busy={saving} disabled={problems.length > 0} />
        </Card>

        <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/history/[metric]', params: { metric: RECOVERY_CODES.hrv } })}>
          <Text style={styles.link}>{tr('在「历史」查看 HRV 与心率趋势')}</Text>
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
  smallLink: { color: COLOR, fontSize: 13, textAlign: 'center' },
  note: { color: colors.good, fontSize: 13 },
});
