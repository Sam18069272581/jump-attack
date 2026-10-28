import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LimiterTiles } from '@/components/dunk';
import { Icon } from '@/components/Icon';
import { TouchChart } from '@/components/TouchChart';
import { Empty } from '@/components/ui';
import { loadDiagnosis } from '@/db/dunk';
import { listMetricResults, sessionCounts, sessionTimings, type SessionResult } from '@/db/repo';
import { touchOffsetFor } from '@/db/touch';
import { MISSING_TEXT, type DunkDiagnosis } from '@/domain/dunk';
import { standingTouches } from '@/domain/dunkSummary';
import { APPROACH_TOUCH, CATEGORIES, METRICS, formatValue, getMetric, metricColor, resultNote, type MetricDef } from '@/domain/metrics';
import type { Timing } from '@/domain/timing';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius, text } from '@/theme';

type Row = { def: MetricDef; color: string; results: SessionResult[]; timings?: Record<string, Timing> };

/** The sprint the speed tile shows: the shortest distance tested, closest to a run-up. */
const SPRINT_ORDER = ['sprint_10', 'sprint_30'];

export default function History() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [rows, setRows] = useState<Row[]>([]);
  const [diagnosis, setDiagnosis] = useState<DunkDiagnosis | null>(null);
  const [offset, setOffset] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!current) return;
      (async () => {
        // Only metrics with data, in registry order; custom sprint distances aren't in the registry, so they come last.
        const counts = await sessionCounts(db, current.id);
        const known = METRICS.filter((m) => counts[m.code]);
        const extra = Object.keys(counts)
          .filter((c) => !known.some((m) => m.code === c))
          .map(getMetric)
          .filter((m): m is MetricDef => m != null);
        const defs = [...known, ...extra];
        setRows(
          await Promise.all(
            defs.map(async (m) => ({
              def: m,
              color: metricColor(m),
              results: await listMetricResults(db, current.id, m),
              ...(m.category === 'speed' ? { timings: await sessionTimings(db, current.id, m.code) } : {}),
            })),
          ),
        );
        setDiagnosis(await loadDiagnosis(db, current));
        setOffset(await touchOffsetFor(db, current.id));
      })();
    }, [db, current]),
  );

  const withData = rows.filter((r) => r.results.length > 0);
  const results = (code: string) => rows.find((r) => r.def.code === code)?.results ?? [];
  const approach = results(APPROACH_TOUCH.code).map((r) => ({ at: r.started_at, value: r.best }));
  const standing = standingTouches(results('cmj'), current?.standing_reach_cm ?? null, offset);
  const sprintRow =
    SPRINT_ORDER.map((c) => rows.find((r) => r.def.code === c)).find((r) => r != null) ?? rows.find((r) => r.def.category === 'speed') ?? null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={text.title}>历史</Text>

        {diagnosis && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="摸高历史"
            onPress={() => router.push({ pathname: '/history/[metric]', params: { metric: approach.length ? APPROACH_TOUCH.code : 'cmj' } })}
            style={styles.featured}
          >
            <View style={styles.featuredTop}>
              <Text style={text.muted}>摸高</Text>
              {diagnosis.gapCm != null && (
                <Text style={{ fontSize: 12, color: diagnosis.gapCm > 0 ? colors.textSoft : colors.good }}>
                  {diagnosis.gapCm > 0 ? `离扣篮线还差 ${diagnosis.gapCm.toFixed(1)} cm` : '已过扣篮线'}
                </Text>
              )}
            </View>
            {diagnosis.touch.value != null ? (
              <>
                <Text style={styles.featuredValue}>
                  {diagnosis.touch.value.toFixed(1)} <Text style={styles.featuredUnit}>cm</Text>
                </Text>
                <TouchChart approach={approach} standing={standing} line={diagnosis.line} />
                <View style={styles.legend}>
                  <Legend dot={{ backgroundColor: APPROACH_TOUCH.color }} label="助跑实测" />
                  <Legend dot={{ borderWidth: 1.5, borderColor: colors.textMuted }} label="原地估算" />
                  <Legend dot={{ height: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: colors.textSoft, width: 14 }} label={`扣篮线 ${diagnosis.line}`} />
                </View>
              </>
            ) : (
              <Text style={text.muted}>{MISSING_TEXT[diagnosis.missing.includes('standing_reach') ? 'standing_reach' : 'approach']}，摸高曲线就会出现在这里。</Text>
            )}
          </Pressable>
        )}

        {diagnosis && <LimiterTiles diagnosis={diagnosis} sprint={sprintRow} />}

        {withData.length === 0 && <Empty title="还没有记录" hint="去首页做一次测试，成绩会出现在这里。" />}

        {CATEGORIES.map((g) => {
          const groupRows = withData.filter((r) => r.def.category === g.key);
          if (groupRows.length === 0) return null;
          return (
            <View key={g.key} style={{ gap: 10 }}>
              <Text style={text.section}>{g.name}</Text>
              {groupRows.map(({ def, color, results }) => {
                const last = results.at(-1)!;
                const note = def.estimate ? resultNote(def, last.best) : def.aggregate === 'mean' ? '6 趟平均' : null;
                return (
                  <Pressable key={def.code} accessibilityRole="button" onPress={() => router.push({ pathname: '/history/[metric]', params: { metric: def.code } })} style={styles.row}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.rowName}>{def.name}</Text>
                      <Text style={text.caption}>
                        {results.length} 次测试{note ? ` · ${note}` : ''}
                      </Text>
                    </View>
                    <Text style={[styles.rowValue, { color }]}>
                      {formatValue(def, last.best)} <Text style={styles.rowUnit}>{def.unit}</Text>
                    </Text>
                    <Icon name="chevronRight" size={18} color={colors.textMuted} />
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function Legend({ dot, label }: { dot: ViewStyle; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, dot]} />
      <Text style={text.caption}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 28, gap: 20 },
  featured: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, gap: 8 },
  featuredTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  featuredValue: { color: APPROACH_TOUCH.color, fontFamily: fonts.numericBold, fontSize: 56, lineHeight: 60 },
  featuredUnit: { color: colors.textMuted, fontSize: 18 },
  legend: { flexDirection: 'row', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  row: { backgroundColor: colors.surface, borderRadius: radius.row, height: 68, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowName: { color: colors.text, fontSize: 15, fontWeight: '500' },
  rowValue: { fontFamily: fonts.numeric, fontSize: 20 },
  rowUnit: { color: colors.textMuted, fontSize: 13 },
});
