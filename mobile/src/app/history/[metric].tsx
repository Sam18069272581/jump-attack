import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { TrendChart } from '@/components/TrendChart';
import { Empty } from '@/components/ui';
import { listMetricResults, listSessionValues, sessionTimings, type SessionResult } from '@/db/repo';
import { fastestSetLoads, listVbtSets } from '@/db/vbt';
import { judgeChange } from '@/domain/assess';
import { dunkLine } from '@/domain/dunk';
import { APPROACH_TOUCH, changeTone, formatValue, getMetric, metricColor, resultNote } from '@/domain/metrics';
import { previousSameTiming, TIMING_NOTE, type Timing } from '@/domain/timing';
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
  const color = def ? metricColor(def) : colors.accent;
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [results, setResults] = useState<SessionResult[]>([]);
  // Each session's attempts, needed only for tests scored as a set (repeated sprints).
  const [attempts, setAttempts] = useState<Record<string, number[]>>({});
  // For VBT lifts, the load of each session's fastest set: velocities only compare at the same load.
  const [loads, setLoads] = useState<Record<string, number>>({});
  // For sprints, how each session was timed: times only compare within one method.
  const [timings, setTimings] = useState<Record<string, Timing>>({});

  useFocusEffect(
    useCallback(() => {
      if (!current || !def) return;
      listMetricResults(db, current.id, def).then(setResults);
      if (def.aggregate === 'mean') listSessionValues(db, current.id, def.code).then(setAttempts);
      if (def.category === 'vbt') listVbtSets(db, current.id, def.code).then((sets) => setLoads(fastestSetLoads(sets)));
      if (def.category === 'speed') sessionTimings(db, current.id, def.code).then(setTimings);
    }, [db, current, def]),
  );

  if (!def) return <Empty title="找不到这个指标" />;
  const timed = results.map((r) => ({ ...r, timing: timings[r.session_id] ?? 'video' }));
  const previous = previousSameTiming(timed);
  const mixed = new Set(timed.map((r) => r.timing)).size > 1;
  const note = (r: (typeof timed)[number]) =>
    [resultNote(def, r.best, attempts[r.session_id]) ?? (loads[r.session_id] != null ? `@ ${loads[r.session_id]} kg` : null), mixed ? TIMING_NOTE[r.timing] : null]
      .filter((n) => n != null)
      .join(' · ') || null;

  const latest = timed.at(-1);
  // Change, verdict and trend only against results timed the same way as the latest.
  const same = latest ? timed.filter((r) => r.timing === latest.timing) : [];
  const sinceFirst = same.length > 1 ? latest!.best - same[0].best : null;
  const tone = (d: number) => ({ good: colors.good, bad: colors.warn, flat: colors.textMuted })[changeTone(def, d)];
  const verdict = latest ? judgeChange(same.slice(0, -1).map((r) => r.best), latest.best, def.lowerIsBetter) : null;
  const recent = same.slice(-12);
  // Touch heights are read against the dunk line.
  const line = def.code === APPROACH_TOUCH.code && current ? dunkLine(current.rim_height_cm, current.dunk_clearance_cm) : null;

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
              <Text style={[styles.change, { color: tone(sinceFirst) }]}>
                首次以来 {sinceFirst >= 0 ? '+' : '−'}
                {Math.abs(sinceFirst).toFixed(def.decimals)} {def.unit}
              </Text>
            )}
          </View>
          {mixed ? (
            <Text style={styles.note}>
              {[resultNote(def, latest.best, attempts[latest.session_id]), `${TIMING_NOTE[latest.timing]}，只和${TIMING_NOTE[latest.timing]}的成绩比较`].filter((n) => n != null).join(' · ')}
            </Text>
          ) : (
            note(latest) && <Text style={styles.note}>{note(latest)}</Text>
          )}
          {line != null && <Text style={styles.note}>{latest.best < line ? `离扣篮线 ${line} cm 还差 ${(line - latest.best).toFixed(1)} cm` : `已过扣篮线 ${line} cm`}</Text>}

          <TrendChart
            color={color}
            points={recent.map((r) => ({ label: shortDate(r.started_at), value: r.best, display: formatValue(def, r.best) }))}
            target={line != null ? { value: line, label: `扣篮线 ${line}` } : undefined}
          />

          <View>
            <View style={[styles.tableRow, styles.tableHead]}>
              <Text style={styles.headCell}>日期</Text>
              <Text style={[styles.headCell, styles.right]}>成绩</Text>
              <Text style={[styles.headCell, styles.right]}>较上次</Text>
            </View>
            {timed
              .map((r, i) => ({ r, prev: previous[i] }))
              .reverse()
              .map(({ r, prev }) => {
                const d = prev ? r.best - prev.best : null;
                const rowNote = note(r);
                return (
                  <View key={r.session_id} style={styles.tableRow}>
                    <Text style={styles.dateCell}>{fullDate(r.started_at)}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.valueCell, styles.right]}>
                        {formatValue(def, r.best)} {def.unit}
                      </Text>
                      {rowNote && <Text style={[styles.rowNote, styles.right]}>{rowNote}</Text>}
                    </View>
                    <Text style={[styles.deltaCell, styles.right, { color: d == null ? colors.textMuted : tone(d) }]}>
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
