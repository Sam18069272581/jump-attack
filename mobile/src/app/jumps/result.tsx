import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Button } from '@/components/ui';
import { deleteTrial, listSessionResults, listTrials, type Trial } from '@/db/repo';
import { getMetric } from '@/domain/metrics';
import { assess, type Assessment } from '@/domain/verdict';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius } from '@/theme';

export default function Result() {
  const { metric, session, from } = useLocalSearchParams<{ metric: string; session: string; from?: string }>();
  const def = getMetric(metric);
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [data, setData] = useState<{ trials: Trial[]; assessment: Assessment | null }>({ trials: [], assessment: null });
  const [version, setVersion] = useState(0);
  const { trials, assessment } = data;

  useEffect(() => {
    let alive = true;
    (async () => {
      const t = await listTrials(db, session);
      let a: Assessment | null = null;
      if (def && current && t.length > 0) {
        const best = Math.max(...t.map((x) => x.value));
        const previous = (await listSessionResults(db, current.id, def.code, def.lowerIsBetter)).filter((r) => r.session_id !== session).map((r) => r.best);
        a = assess(def, previous, best);
      }
      if (alive) setData({ trials: t, assessment: a });
    })();
    return () => {
      alive = false;
    };
  }, [db, session, def, current, version]);

  function remove(t: Trial, n: number) {
    Alert.alert(`删除第 ${n} 次？`, '这次的成绩会从记录中去掉。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => (await deleteTrial(db, t.id), setVersion((v) => v + 1)) },
    ]);
  }

  if (!def) return null;
  const best = trials.length ? Math.max(...trials.map((t) => t.value)) : null;
  const scale = best ? best * 1.1 : 1;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>{def.name} · 最好成绩</Text>
          <Text style={styles.heroValue}>
            {best != null ? best.toFixed(def.decimals) : '—'} <Text style={styles.heroUnit}>{def.unit}</Text>
          </Text>
        </View>

        <View style={styles.card}>
          {trials.map((t, i) => (
            <View key={t.id} style={styles.trialRow}>
              <Text style={styles.trialN}>{i + 1}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.bar, { width: `${(t.value / scale) * 100}%`, backgroundColor: t.value === best ? colors.accent : colors.textFaint }]} />
              </View>
              <Text style={styles.trialValue}>{t.value.toFixed(def.decimals)}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`删除第 ${i + 1} 次`} onPress={() => remove(t, i + 1)} style={styles.trash}>
                <Icon name="trash" size={18} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
          {trials.length > 0 && (
            <Text style={styles.trialMeta}>
              滞空 {trials.map((t) => Math.round(t.flight_ms ?? 0)).join(' / ')} ms · {trials[0].fps} fps
            </Text>
          )}
        </View>

        {assessment && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>评估</Text>
            <Text style={[styles.assessText, { color: assessment.change.verdict === 'better' ? colors.good : assessment.change.verdict === 'worse' ? colors.warn : colors.textSoft }]}>
              {assessment.change.text}
            </Text>
            {assessment.readiness && (
              <Text style={[styles.assessText, { color: assessment.readiness.readiness === 'fatigued' ? colors.warn : colors.good }]}>{assessment.readiness.text}</Text>
            )}
          </View>
        )}

        <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/history/[metric]', params: { metric } })}>
          <Text style={styles.link}>查看历史趋势</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <Button label="再测一次" variant="secondary" onPress={() => router.back()} style={{ flex: 1 }} />
        <Button label="完成" onPress={() => (from === 'train' ? router.dismissAll() : router.dismissTo('/jumps'))} style={{ flex: 1 }} />
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
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 8 },
});
