import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { TrendChart } from '@/components/TrendChart';
import { Empty } from '@/components/ui';
import { listMetricResults, sessionCounts, type SessionResult } from '@/db/repo';
import { CATEGORIES, METRICS, formatValue, getMetric, metricColor, resultNote, type MetricDef } from '@/domain/metrics';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius, text } from '@/theme';

type Row = { def: MetricDef; color: string; results: SessionResult[] };


export default function History() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [rows, setRows] = useState<Row[]>([]);

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
        setRows(await Promise.all(defs.map(async (m) => ({ def: m, color: metricColor(m), results: await listMetricResults(db, current.id, m) }))));
      })();
    }, [db, current]),
  );

  const featured = rows.find((r) => r.def.code === 'cmj');
  const recentCmj = featured?.results.slice(-8) ?? [];
  const latest = recentCmj.at(-1);
  const change = recentCmj.length > 1 ? latest!.best - recentCmj[0].best : null;
  const withData = rows.filter((r) => r.results.length > 0);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={text.title}>历史</Text>

        {latest ? (
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/history/[metric]', params: { metric: 'cmj' } })} style={styles.featured}>
            <View style={styles.featuredTop}>
              <Text style={text.muted}>CMJ 反向跳</Text>
              {change != null && (
                <Text style={{ fontSize: 12, color: change >= 0 ? colors.good : colors.warn }}>
                  近 {recentCmj.length} 次 {change >= 0 ? '+' : '−'}
                  {Math.abs(change).toFixed(1)} cm
                </Text>
              )}
            </View>
            <Text style={styles.featuredValue}>
              {latest.best.toFixed(1)} <Text style={styles.featuredUnit}>cm</Text>
            </Text>
            <TrendChart points={recentCmj.map((r) => ({ label: '', value: r.best, display: '' }))} height={90} showLabels={false} />
            <Text style={text.caption}>点击查看每次数据</Text>
          </Pressable>
        ) : withData.length === 0 ? (
          <Empty title="还没有记录" hint="去首页做一次测试，成绩会出现在这里。" />
        ) : null}

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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 28, gap: 20 },
  featured: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, gap: 8 },
  featuredTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  featuredValue: { color: colors.accent, fontFamily: fonts.numericBold, fontSize: 56, lineHeight: 60 },
  featuredUnit: { color: colors.textMuted, fontSize: 18 },
  row: { backgroundColor: colors.surface, borderRadius: radius.row, height: 68, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowName: { color: colors.text, fontSize: 15, fontWeight: '500' },
  rowValue: { fontFamily: fonts.numeric, fontSize: 20 },
  rowUnit: { color: colors.textMuted, fontSize: 13 },
});
