import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import type { SessionResult } from '@/db/repo';
import type { DayState, DunkDiagnosis, DunkMetric, MetricStatus } from '@/domain/dunk';
import { formatMetric, stateLine } from '@/domain/dunkSummary';
import { changeTone, formatValue, type MetricDef } from '@/domain/metrics';
import { previousSameTiming, TIMING_NOTE, type Timing } from '@/domain/timing';
import { decimal, tr } from '@/i18n';
import { colors, fonts, radius, text } from '@/theme';

const STATE_COLOR: Record<DayState, string> = { good: colors.good, fair: colors.warn, poor: colors.record, unknown: colors.textMuted };
export const STATUS_COLOR: Record<MetricStatus, string> = { low: colors.record, mid: colors.warn, good: colors.good, missing: colors.textMuted };

/** Today's state from CMJ and recovery, and how far it relaxes the strength targets. Opens today's training. */
export function DayStateRow({ state }: { state: DayState }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={tr('今日状态')} onPress={() => router.push('/train')} style={styles.state}>
      <View style={[styles.dot, { backgroundColor: STATE_COLOR[state] }]} />
      <Text style={[styles.stateText, { flex: 1 }]}>{stateLine(state)}</Text>
      <Icon name="chevronRight" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

type Tile = { label: string; metric: DunkMetric | undefined; href: Href };

/** One tile per thing the jump is built from: strength, reactive strength and speed, each against its line. */
type Sprint = { def: MetricDef; results: SessionResult[]; timings?: Record<string, Timing> };

export function LimiterTiles({ diagnosis, sprint }: { diagnosis: DunkDiagnosis; sprint: Sprint | null }) {
  const m = (key: DunkMetric['key']) => diagnosis.metrics.find((x) => x.key === key);
  const tiles: Tile[] = [
    { label: tr('力量'), metric: m('squat_ratio'), href: '/vbt' },
    { label: tr('反应'), metric: m('rsi'), href: { pathname: '/history/[metric]', params: { metric: 'dj_rsi' } } },
  ];
  return (
    <View style={styles.tiles}>
      {tiles.map(({ label, metric, href }) => (
        <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={() => router.push(href)} style={styles.tile}>
          <Text style={text.caption}>{label}</Text>
          <Text style={[styles.tileValue, { color: STATUS_COLOR[metric?.status ?? 'missing'] }]}>{metric ? formatMetric(metric) : '—'}</Text>
          <Text style={styles.tileNote}>{metric ? tileNote(metric) : tr('未测')}</Text>
        </Pressable>
      ))}
      <SprintTile sprint={sprint} />
    </View>
  );
}

function tileNote(m: DunkMetric): string {
  const name = m.key === 'squat_ratio' ? tr('深蹲 ÷ 体重') : m.name;
  const fmt = (v: number) => `${decimal(v, 1)}${m.unit === '×' ? '×' : ''}`;
  switch (m.status) {
    case 'low':
      return tr('{name} · 低于 {low}', { name, low: fmt(m.low) });
    case 'mid':
      return tr('{name} · 目标 {threshold}', { name, threshold: fmt(m.threshold) });
    case 'good':
      return tr('{name} · 已过 {threshold}', { name, threshold: fmt(m.threshold) });
    default:
      return tr('{name} · 未测', { name });
  }
}

/** Speed has no line to pass; it shows the latest sprint and which way it moved against the last one timed the same way. */
function SprintTile({ sprint }: { sprint: Sprint | null }) {
  const timed = (sprint?.results ?? []).map((r) => ({ ...r, timing: sprint?.timings?.[r.session_id] ?? ('video' as Timing) }));
  const last = timed.at(-1);
  const prev = previousSameTiming(timed).at(-1);
  const delta = last && prev ? last.best - prev.best : null;
  // Earlier times exist but none taken this way: say how this one was timed instead of a change.
  const otherTiming = last != null && prev == null && timed.length > 1;
  const tone = sprint && delta != null ? changeTone(sprint.def, delta) : 'flat';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr('速度')}
      onPress={() => router.push(sprint ? { pathname: '/history/[metric]', params: { metric: sprint.def.code } } : '/speed')}
      style={styles.tile}
    >
      <Text style={text.caption}>{tr('速度')}</Text>
      <Text style={[styles.tileValue, { color: last ? colors.blue : colors.textMuted }]}>{last ? `${formatValue(sprint!.def, last.best)} s` : '—'}</Text>
      <Text style={[styles.tileNote, delta != null && { color: { good: colors.good, bad: colors.warn, flat: colors.textMuted }[tone] }]}>
        {!sprint || !last
          ? tr('冲刺 · 未测')
          : otherTiming
            ? `${sprint.def.name} · ${TIMING_NOTE[last.timing]}`
            : delta == null
              ? sprint.def.name
              : `${sprint.def.name} · ${delta <= 0 ? '−' : '+'}${decimal(Math.abs(delta), 2)} s`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  state: { backgroundColor: colors.surface, borderRadius: radius.row, minHeight: 52, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  stateText: { color: colors.text, fontSize: 14 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.row, padding: 12, gap: 2 },
  tileValue: { fontFamily: fonts.numericBold, fontSize: 26 },
  tileNote: { color: colors.textMuted, fontSize: 11 },
});
