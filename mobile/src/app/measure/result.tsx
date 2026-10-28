import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { RecordHero } from '@/components/RecordHero';
import { Button } from '@/components/ui';
import { deleteTrial, listMetricResults, listTrials, sessionTimings, updateTrialValue, type Trial } from '@/db/repo';
import { trendBaseline } from '@/domain/assess';
import { manualProblem, parseNumber } from '@/domain/entry';
import { getCategory, getMetric, sessionValue } from '@/domain/metrics';
import { personalRecord, recordable } from '@/domain/record';
import { assess, type Assessment } from '@/domain/verdict';
import { useAthlete } from '@/state/athlete';
import { loadPoorDaysOf, POOR_DAY_NOTE } from '@/state/training';
import { colors, fonts, radius } from '@/theme';

export default function Result() {
  const { metric, session, from } = useLocalSearchParams<{ metric: string; session: string; from?: string }>();
  const def = getMetric(metric);
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [data, setData] = useState<{ trials: Trial[]; assessment: Assessment | null; poorDay: boolean; record: { by: number } | null }>({ trials: [], assessment: null, poorDay: false, record: null });
  const [version, setVersion] = useState(0);
  // The typed-in attempt being corrected, opened from the history.
  const [editing, setEditing] = useState<{ id: number; n: number; raw: string } | null>(null);
  const fromHistory = from === 'history';
  const { trials, assessment, poorDay, record } = data;

  useEffect(() => {
    let alive = true;
    (async () => {
      const t = await listTrials(db, session);
      let a: Assessment | null = null;
      let poorDay = false;
      let record: { by: number } | null = null;
      if (def && current && t.length > 0) {
        const best = sessionValue(def, t.map((x) => x.value))!;
        const all = await listMetricResults(db, current.id, def);
        const baseline = trendBaseline(all, session, await loadPoorDaysOf(db, current.id, def.code, all));
        a = assess(def, baseline.previous, best);
        poorDay = baseline.poorDay;
        if (recordable(def) && !fromHistory) {
          // Sprint times only compare within one timing method (domain/timing.ts).
          const timings = def.category === 'speed' ? await sessionTimings(db, current.id, def.code) : null;
          const earlier = all.filter((r) => r.session_id !== session && (!timings || timings[r.session_id] === timings[session]));
          record = personalRecord(earlier.map((r) => r.best), best, def.lowerIsBetter);
        }
      }
      if (alive) setData({ trials: t, assessment: a, poorDay, record });
    })();
    return () => {
      alive = false;
    };
  }, [db, session, def, current, version, fromHistory]);

  function remove(t: Trial, n: number) {
    Alert.alert(`删除第 ${n} 次？`, '这次的成绩会从记录中去掉。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => (await deleteTrial(db, t.id), setVersion((v) => v + 1)) },
    ]);
  }

  if (!def) return null;
  const editValue = editing ? parseNumber(editing.raw) : null;
  const editProblem = editValue == null ? null : manualProblem(def, editValue);
  // Only typed-in attempts can be typed over; a filmed one is re-marked instead. VBT sets carry their load too.
  const editable = (t: Trial) => fromHistory && t.detail?.source === 'manual' && def.category !== 'vbt';

  async function saveEdit() {
    if (!editing || editValue == null || editProblem) return;
    await updateTrialValue(db, editing.id, editValue);
    setEditing(null);
    setVersion((v) => v + 1);
  }

  const best = sessionValue(def, trials.map((t) => t.value));
  const top3 = def.aggregate === 'top3' && trials.length > 1;
  const label = `${def.name} · ${top3 ? `最好 ${Math.min(3, trials.length)} 跳均值` : '最好成绩'}`;
  // The attempts the result is made of: the best one, or the best three.
  const counted = new Set(top3 ? [...trials].sort((a, b) => b.value - a.value).slice(0, 3).map((t) => t.id) : trials.filter((t) => t.value === best).map((t) => t.id));
  const scale = trials.length ? Math.max(...trials.map((t) => t.value)) * 1.1 : 1;
  const home = getCategory(def.category).href ?? '/';
  const flights = trials.filter((t) => t.flight_ms != null);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {record && best != null ? (
          <RecordHero
            label={label}
            value={best.toFixed(def.decimals)}
            unit={def.unit}
            gain={def.lowerIsBetter ? `快了 ${record.by.toFixed(def.decimals)} ${def.unit}` : `+${record.by.toFixed(def.decimals)} ${def.unit}`}
          />
        ) : (
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>{label}</Text>
            <Text style={styles.heroValue}>
              {best != null ? best.toFixed(def.decimals) : '—'} <Text style={styles.heroUnit}>{def.unit}</Text>
            </Text>
          </View>
        )}

        <View style={styles.card}>
          {trials.map((t, i) => (
            <View key={t.id} style={styles.trialRow}>
              <Text style={styles.trialN}>{i + 1}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.bar, { width: `${(t.value / scale) * 100}%`, backgroundColor: counted.has(t.id) ? colors.accent : colors.textFaint }]} />
              </View>
              <Text style={styles.trialValue}>{t.value.toFixed(def.decimals)}</Text>
              {editable(t) && (
                <Pressable accessibilityRole="button" accessibilityLabel={`改第 ${i + 1} 次`} onPress={() => setEditing({ id: t.id, n: i + 1, raw: String(t.value) })} style={styles.trash}>
                  <Icon name="edit" size={18} color={colors.textMuted} />
                </Pressable>
              )}
              <Pressable accessibilityRole="button" accessibilityLabel={`删除第 ${i + 1} 次`} onPress={() => remove(t, i + 1)} style={styles.trash}>
                <Icon name="trash" size={18} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
          {flights.length > 0 && def.capture.includes('flight') && (
            <Text style={styles.trialMeta}>
              滞空 {flights.map((t) => Math.round(t.flight_ms!)).join(' / ')} ms · {flights[0].fps} fps
            </Text>
          )}
          {trials.some((t) => t.detail?.source === 'manual') && <Text style={styles.trialMeta}>含手动输入的成绩</Text>}
        </View>

        {editing && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>改第 {editing.n} 次</Text>
            <TextInput
              value={editing.raw}
              onChangeText={(raw) => setEditing({ ...editing, raw })}
              keyboardType="decimal-pad"
              autoFocus
              style={styles.editInput}
              accessibilityLabel={`第 ${editing.n} 次（${def.unit}）`}
            />
            {editProblem ? <Text style={styles.problem}>{editProblem}</Text> : null}
            <View style={styles.editButtons}>
              <Button label="取消" variant="secondary" onPress={() => setEditing(null)} style={{ flex: 1 }} />
              <Button label="保存修改" onPress={saveEdit} disabled={editValue == null || editProblem != null} style={{ flex: 1 }} />
            </View>
          </View>
        )}

        {assessment && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>评估</Text>
            <Text style={[styles.assessText, { color: assessment.change.verdict === 'better' ? colors.good : assessment.change.verdict === 'worse' ? colors.warn : colors.textSoft }]}>
              {assessment.change.text}
            </Text>
            {assessment.readiness && (
              <Text style={[styles.assessText, { color: assessment.readiness.readiness === 'fatigued' ? colors.warn : colors.good }]}>{assessment.readiness.text}</Text>
            )}
            {poorDay && <Text style={[styles.assessText, { color: colors.textMuted }]}>{POOR_DAY_NOTE}</Text>}
          </View>
        )}

        {!fromHistory && (
          <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/history/[metric]', params: { metric } })}>
            <Text style={styles.link}>查看历史趋势</Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {fromHistory ? (
          <Button label="返回" variant="secondary" onPress={() => router.back()} style={{ flex: 1 }} />
        ) : (
          <>
            <Button label="再测一次" variant="secondary" onPress={() => router.back()} style={{ flex: 1 }} />
            <Button label="完成" onPress={() => (from === 'train' ? router.dismissAll() : router.dismissTo(home as Href))} style={{ flex: 1 }} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 16 },
  hero: { alignItems: 'center', gap: 4, paddingVertical: 8 },
  heroLabel: { color: colors.textMuted, fontSize: 13 },
  heroValue: { color: colors.accent, fontFamily: fonts.numericBold, fontSize: 72, lineHeight: 76 },
  heroUnit: { color: colors.textMuted, fontSize: 20 },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, gap: 12 },
  trialRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  trialN: { width: 16, color: colors.textMuted, fontFamily: fonts.numeric, fontSize: 16 },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.bg, overflow: 'hidden' },
  bar: { height: 10, borderRadius: 5 },
  trialValue: { width: 52, textAlign: 'right', color: colors.text, fontFamily: fonts.numeric, fontSize: 20 },
  trash: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  trialMeta: { color: colors.textMuted, fontSize: 11 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  assessText: { fontSize: 14, lineHeight: 20 },
  link: { color: colors.accent, fontSize: 14, textAlign: 'center', padding: 8 },
  editInput: { color: colors.accent, fontFamily: fonts.numericBold, fontSize: 40, padding: 0 },
  editButtons: { flexDirection: 'row', gap: 10 },
  problem: { color: colors.warn, fontSize: 13 },
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 8 },
});
