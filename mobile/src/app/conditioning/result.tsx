import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { listMetricResults, listTrials } from '@/db/repo';
import { rsaRating, rsaSummary, vo2maxBand, yoyoLabel, YOYO_SHUTTLE_M } from '@/domain/conditioning';
import { CONDITIONING_TESTS, formatValue } from '@/domain/metrics';
import { assess, type Assessment } from '@/domain/verdict';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius } from '@/theme';

export default function ConditioningResult() {
  const { metric, session } = useLocalSearchParams<{ metric: string; session: string }>();
  const def = CONDITIONING_TESTS.find((m) => m.code === metric);
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [data, setData] = useState<{ values: number[]; result: number | null; assessment: Assessment | null }>({ values: [], result: null, assessment: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!def || !current) return;
      const values = (await listTrials(db, session)).map((t) => t.value);
      const all = await listMetricResults(db, current.id, def);
      const mine = all.find((r) => r.session_id === session);
      const previous = all.filter((r) => r.session_id !== session).map((r) => r.best);
      if (alive && mine) setData({ values, result: mine.best, assessment: assess(def, previous, mine.best) });
    })();
    return () => {
      alive = false;
    };
  }, [db, session, def, current]);

  if (!def) return null;
  const { values, result, assessment } = data;
  const vo2 = def.estimate && result != null ? def.estimate.from(result) : null;
  const rsa = def.code === 'rsa' && values.length > 1 ? rsaSummary(values) : null;
  const rating = rsa ? rsaRating(rsa.sdec) : null;
  const slowest = values.length ? Math.max(...values) : 1;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>{def.name}</Text>
          {vo2 != null ? (
            <>
              <Text style={[styles.heroValue, { color: def.color }]}>{vo2.toFixed(1)}</Text>
              <Text style={styles.heroUnit}>VO2max 估算 · ml/kg/min</Text>
              <Text style={styles.sub}>
                {formatValue(def, result!)} m{def.code === 'yoyo_ir1' ? ` · 第 ${yoyoLabel(result! / YOYO_SHUTTLE_M)} 趟` : ''}
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.heroValue, { color: def.color }]}>{result != null ? formatValue(def, result) : '—'}</Text>
              <Text style={styles.heroUnit}>平均时间 · 秒</Text>
            </>
          )}
        </View>

        {rsa && (
          <View style={styles.card}>
            <View style={styles.stats}>
              <Stat value={rsa.best.toFixed(2)} label="最快 s" />
              <Stat value={rsa.total.toFixed(2)} label="总时间 s" />
              <Stat value={`${rsa.sdec.toFixed(1)}%`} label="递减" />
            </View>
            {values.map((v, i) => (
              <View key={i} style={styles.barRow}>
                <Text style={styles.barN}>{i + 1}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.bar, { width: `${(v / slowest) * 100}%`, backgroundColor: v === rsa.best ? def.color : colors.textFaint }]} />
                </View>
                <Text style={styles.barValue}>{v.toFixed(2)}</Text>
              </View>
            ))}
          </View>
        )}

        {(assessment || vo2 != null || rating) && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>评估</Text>
            {vo2 != null && <Text style={[styles.assessText, { color: colors.textSoft }]}>VO2max {vo2maxBand(vo2)}（以年轻男性运动员为参考，场地测试是估算值）</Text>}
            {rating && <Text style={[styles.assessText, { color: rating.rating === 'poor' ? colors.warn : rating.rating === 'good' ? colors.good : colors.textSoft }]}>{rating.text}</Text>}
            {assessment && (
              <Text style={[styles.assessText, { color: assessment.change.verdict === 'better' ? colors.good : assessment.change.verdict === 'worse' ? colors.warn : colors.textSoft }]}>
                {assessment.change.text}
              </Text>
            )}
          </View>
        )}

        <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/history/[metric]', params: { metric: def.code } })}>
          <Text style={styles.link}>查看历史趋势</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <Button label="完成" onPress={() => router.dismissTo('/conditioning')} style={{ flex: 1 }} />
      </View>
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 16 },
  hero: { alignItems: 'center', gap: 4, paddingVertical: 8 },
  heroLabel: { color: colors.textMuted, fontSize: 13 },
  heroValue: { fontFamily: fonts.numericBold, fontSize: 72, lineHeight: 76 },
  heroUnit: { color: colors.textMuted, fontSize: 13 },
  sub: { color: colors.textSoft, fontFamily: fonts.numeric, fontSize: 20, marginTop: 4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, gap: 12 },
  stats: { flexDirection: 'row', justifyContent: 'space-around' },
  statValue: { color: colors.text, fontFamily: fonts.numeric, fontSize: 26 },
  statLabel: { color: colors.textMuted, fontSize: 11 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  barN: { width: 16, color: colors.textMuted, fontFamily: fonts.numeric, fontSize: 16 },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.bg, overflow: 'hidden' },
  bar: { height: 10, borderRadius: 5 },
  barValue: { width: 52, textAlign: 'right', color: colors.text, fontFamily: fonts.numeric, fontSize: 20 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  assessText: { fontSize: 14, lineHeight: 20 },
  link: { color: colors.accent, fontSize: 14, textAlign: 'center', padding: 8 },
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 8 },
});
