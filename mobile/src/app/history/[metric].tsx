import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { TrendChart } from '@/components/TrendChart';
import { Empty } from '@/components/ui';
import { listMetricResults, listSessionValues, type SessionResult } from '@/db/repo';
import { judgeChange } from '@/domain/assess';
import { CONDITIONING_TESTS, JUMP_TESTS, formatValue, getMetric, resultNote } from '@/domain/metrics';
import { useAthlete } from '@/state/athlete';
import { colors, fonts } from '@/theme';

function shortDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fullDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${shortDate(iso)}`;
}

export default function MetricHistory() {
  const { metric } = useLocalSearchParams<{ metric: string }>();
  const def = getMetric(metric);
  const color = [...JUMP_TESTS, ...CONDITIONING_TESTS].find((m) => m.code === metric)?.color ?? colors.accent;
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [results, setResults] = useState<SessionResult[]>([]);
  // Each session's attempts, needed only for tests scored as a set (repeated sprints).
  const [attempts, setAttempts] = useState<Record<string, number[]>>({});

  useFocusEffect(
    useCallback(() => {
      if (!current || !def) return;
      listMetricResults(db, current.id, def).then(setResults);
      if (def.aggregate === 'mean') listSessionValues(db, current.id, def.code).then(setAttempts);
    }, [db, current, def]),
  );

  if (!def) return <Empty title="找不到这个指标" />;

  const latest = results.at(-1);
  const sinceFirst = results.length > 1 ? latest!.best - results[0].best : null;
  const goodDirection = (d: number) => (def.lowerIsBetter ? d < 0 : d > 0);
  const verdict = latest ? judgeChange(results.slice(0, -1).map((r) => r.best), latest.best, def.lowerIsBetter) : null;
  const recent = results.slice(-12);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: def.name }} />
      <Text style={styles.count}>
        {results.length} 条记录{verdict && verdict.swc > 0 ? ` · 最小有意义变化 ${verdict.swc.toFixed(def.decimals)} ${def.unit}` : ''}
      </Text>

      {latest ? (
        <>
          <View style={styles.headline}>
            <Text style={[styles.big, { color }]}>{formatValue(def, latest.best)}</Text>
            <Text style={styles.unit}>{def.unit}</Text>
            {sinceFirst != null && (
              <Text style={[styles.change, { color: Math.abs(sinceFirst) < 1e-9 ? colors.textMuted : goodDirection(sinceFirst) ? colors.good : colors.warn }]}>
                首次以来 {sinceFirst >= 0 ? '+' : '−'}
                {Math.abs(sinceFirst).toFixed(def.decimals)} {def.unit}
              </Text>
            )}
          </View>
          {resultNote(def, latest.best, attempts[latest.session_id]) && <Text style={styles.note}>{resultNote(def, latest.best, attempts[latest.session_id])}</Text>}

          <TrendChart color={color} points={recent.map((r) => ({ label: shortDate(r.started_at), value: r.best, display: formatValue(def, r.best) }))} />

          <View>
            <View style={[styles.tableRow, styles.tableHead]}>
              <Text style={styles.headCell}>日期</Text>
              <Text style={[styles.headCell, styles.right]}>成绩</Text>
              <Text style={[styles.headCell, styles.right]}>较上次</Text>
            </View>
            {results
              .map((r, i) => ({ r, prev: results[i - 1] }))
              .reverse()
              .map(({ r, prev }) => {
                const d = prev ? r.best - prev.best : null;
                const note = resultNote(def, r.best, attempts[r.session_id]);
                return (
                  <View key={r.session_id} style={styles.tableRow}>
                    <Text style={styles.dateCell}>{fullDate(r.started_at)}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.valueCell, styles.right]}>
                        {formatValue(def, r.best)} {def.unit}
                      </Text>
                      {note && <Text style={[styles.rowNote, styles.right]}>{note}</Text>}
                    </View>
                    <Text style={[styles.deltaCell, styles.right, { color: d == null || Math.abs(d) < 1e-9 ? colors.textMuted : goodDirection(d) ? colors.good : colors.warn }]}>
                      {d == null ? '—' : `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(def.decimals)}`}
                    </Text>
                  </View>
                );
              })}
          </View>
        </>
      ) : (
        <Empty title="还没有记录" />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 4, gap: 14 },
  count: { color: colors.textMuted, fontSize: 12 },
  headline: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  big: { fontFamily: fonts.numericBold, fontSize: 56, lineHeight: 60 },
  unit: { color: colors.textMuted, fontSize: 15 },
  change: { marginLeft: 'auto', fontSize: 12 },
  note: { color: colors.textSoft, fontSize: 13, marginTop: -6 },
  rowNote: { color: colors.textMuted, fontSize: 11 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.divider },
  tableHead: { paddingVertical: 8 },
  headCell: { flex: 1, color: colors.textMuted, fontSize: 12 },
  right: { textAlign: 'right' },
  dateCell: { flex: 1, color: colors.textSoft, fontSize: 13 },
  valueCell: { flex: 1, color: colors.text, fontFamily: fonts.numeric, fontSize: 18 },
  deltaCell: { flex: 1, fontFamily: fonts.numeric, fontSize: 15 },
});
