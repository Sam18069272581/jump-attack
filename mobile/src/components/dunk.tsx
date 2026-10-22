import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import type { SessionResult } from '@/db/repo';
import { MISSING_TEXT, type DayState, type DunkDiagnosis, type DunkMetric, type MetricStatus } from '@/domain/dunk';
import { formatMetric, limiterLine, stateLine, touchProgress } from '@/domain/dunkSummary';
import { APPROACH_TOUCH, changeTone, formatValue, type MetricDef } from '@/domain/metrics';
import { colors, fonts, radius, text } from '@/theme';

const STATE_COLOR: Record<DayState, string> = { good: colors.good, fair: colors.warn, poor: colors.record, unknown: colors.textMuted };
export const STATUS_COLOR: Record<MetricStatus, string> = { low: colors.record, mid: colors.warn, good: colors.good, missing: colors.textMuted };

/**
 * The home screen's first card: how far the touch is from the dunk line, what holds the athlete back, and how
 * today's state relaxes the targets.
 */
export function DunkGoalCard({ diagnosis: d, standingReach, state }: { diagnosis: DunkDiagnosis; standingReach: number | null; state: DayState }) {
  const touch = d.touch.value;
  const limiter = limiterLine(d);
  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityLabel="扣篮诊断" onPress={() => router.push('/dunk')} style={{ gap: 12 }}>
        <View style={styles.head}>
          <Text style={styles.kicker}>扣篮目标</Text>
          <Icon name="chevronRight" size={18} color={colors.textMuted} />
        </View>
        {touch != null && d.gapCm != null ? (
          <>
            <View style={styles.gapRow}>
              {d.gapCm > 0 ? (
                <Text style={styles.gap}>
                  还差 {d.gapCm.toFixed(1)}
                  <Text style={styles.gapUnit}> cm</Text>
                </Text>
              ) : (
                <Text style={styles.gap}>够到扣篮线了</Text>
              )}
              <Text style={styles.touch}>
                摸高 {touch.toFixed(1)} / {d.line}
              </Text>
            </View>
            <View style={styles.bar} accessibilityRole="progressbar" accessibilityValue={{ now: Math.round(touchProgress(touch, d.line, standingReach) * 100), min: 0, max: 100 }}>
              <View style={[styles.fill, { width: `${touchProgress(touch, d.line, standingReach) * 100}%` }]} />
            </View>
            <Text style={text.caption}>
              {d.touch.source === 'approach' ? '助跑摸高实测' : '原地估算：站立摸高 + CMJ'}
              {standingReach != null ? ` · 从站立摸高 ${standingReach} 算起` : ''}
            </Text>
          </>
        ) : (
          <View style={{ gap: 4 }}>
            <Text style={text.heading}>扣篮线 {d.line} cm</Text>
            <Text style={text.muted}>{MISSING_TEXT[d.missing.includes('standing_reach') ? 'standing_reach' : 'approach']}，就能算出离扣篮还差多少。</Text>
          </View>
        )}
        <View style={styles.divider} />
        <View style={{ gap: 2 }}>
          <Text style={text.section}>{limiter.title}</Text>
          <Text style={text.muted}>{limiter.detail}</Text>
        </View>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => router.push('/train')} style={styles.state}>
        <View style={[styles.dot, { backgroundColor: STATE_COLOR[state] }]} />
        <Text style={[text.muted, { flex: 1 }]}>{stateLine(state)}</Text>
      </Pressable>
    </View>
  );
}

type Tile = { label: string; metric: DunkMetric | undefined; href: Href };

/** One tile per thing the jump is built from: strength, reactive strength and speed, each against its line. */
export function LimiterTiles({ diagnosis, sprint }: { diagnosis: DunkDiagnosis; sprint: { def: MetricDef; results: SessionResult[] } | null }) {
  const m = (key: DunkMetric['key']) => diagnosis.metrics.find((x) => x.key === key);
  const tiles: Tile[] = [
    { label: '力量', metric: m('squat_ratio'), href: '/vbt' },
    { label: '反应', metric: m('rsi'), href: { pathname: '/history/[metric]', params: { metric: 'dj_rsi' } } },
  ];
  return (
    <View style={styles.tiles}>
      {tiles.map(({ label, metric, href }) => (
        <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={() => router.push(href)} style={styles.tile}>
          <Text style={text.caption}>{label}</Text>
          <Text style={[styles.tileValue, { color: STATUS_COLOR[metric?.status ?? 'missing'] }]}>{metric ? formatMetric(metric) : '—'}</Text>
          <Text style={styles.tileNote}>{metric ? tileNote(metric) : '未测'}</Text>
        </Pressable>
      ))}
      <SprintTile sprint={sprint} />
    </View>
  );
}

function tileNote(m: DunkMetric): string {
  const name = m.key === 'squat_ratio' ? '深蹲 ÷ 体重' : m.name;
  const fmt = (v: number) => `${v.toFixed(1)}${m.unit === '×' ? '×' : ''}`;
  switch (m.status) {
    case 'low':
      return `${name} · 低于 ${fmt(m.low)}`;
    case 'mid':
      return `${name} · 目标 ${fmt(m.threshold)}`;
    case 'good':
      return `${name} · 已过 ${fmt(m.threshold)}`;
    default:
      return `${name} · 未测`;
  }
}

/** Speed has no line to pass; it shows the latest sprint and which way it moved. */
function SprintTile({ sprint }: { sprint: { def: MetricDef; results: SessionResult[] } | null }) {
  const last = sprint?.results.at(-1);
  const prev = sprint?.results.at(-2);
  const delta = last && prev ? last.best - prev.best : null;
  const tone = sprint && delta != null ? changeTone(sprint.def, delta) : 'flat';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="速度"
      onPress={() => router.push(sprint ? { pathname: '/history/[metric]', params: { metric: sprint.def.code } } : '/speed')}
      style={styles.tile}
    >
      <Text style={text.caption}>速度</Text>
      <Text style={[styles.tileValue, { color: last ? colors.blue : colors.textMuted }]}>{last ? `${formatValue(sprint!.def, last.best)} s` : '—'}</Text>
      <Text style={[styles.tileNote, delta != null && { color: { good: colors.good, bad: colors.warn, flat: colors.textMuted }[tone] }]}>
        {!sprint || !last ? '冲刺 · 未测' : delta == null ? sprint.def.name : `${sprint.def.name} · ${delta <= 0 ? '−' : '+'}${Math.abs(delta).toFixed(2)} s`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, gap: 12, borderWidth: 1, borderColor: APPROACH_TOUCH.color + '55' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kicker: { color: APPROACH_TOUCH.color, fontSize: 13, fontWeight: '700' },
  gapRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  gap: { color: colors.text, fontFamily: fonts.numericBold, fontSize: 40, lineHeight: 44 },
  gapUnit: { color: colors.textMuted, fontSize: 16 },
  touch: { color: colors.textSoft, fontFamily: fonts.numeric, fontSize: 16 },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: APPROACH_TOUCH.color },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
  state: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.row, padding: 12, gap: 2 },
  tileValue: { fontFamily: fonts.numericBold, fontSize: 26 },
  tileNote: { color: colors.textMuted, fontSize: 11 },
});
