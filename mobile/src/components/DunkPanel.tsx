import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, LayoutAnimation, Pressable, StyleSheet, Text, View } from 'react-native';

import { STATUS_COLOR } from '@/components/dunk';
import { Icon } from '@/components/Icon';
import { Card } from '@/components/ui';
import { openDunkTest } from '@/components/dunkTests';
import { BLOCKS, MISSING_TEXT, RIM_CM, reachRuler, type DunkDiagnosis, type DunkMetric, type Missing } from '@/domain/dunk';
import { gapHeading, touchNote } from '@/domain/dunkSummary';
import { colors, fonts, radius, text } from '@/theme';

function statusLabel(m: DunkMetric): string {
  switch (m.status) {
    case 'low':
      return m.key === 'contact' ? '偏慢' : '偏低';
    case 'mid':
      return m.key === 'fv' ? '不均衡' : '接近';
    case 'good':
      return '过线';
    case 'missing':
      return '未测';
  }
}

function valueText(m: DunkMetric): string {
  if (m.value == null) return '—';
  const v = m.value.toFixed(m.decimals);
  return m.unit === '×' || m.unit === '%' ? `${v}${m.unit}` : m.unit ? `${v} ${m.unit}` : v;
}

function targetText(m: DunkMetric): string {
  if (m.key === 'fv') return `均衡 ${m.low}–${m.threshold}%`;
  const unit = m.unit === '×' ? '×' : m.unit ? ` ${m.unit}` : '';
  if (m.lowerIsBetter) return `目标 ≤ ${m.threshold}${unit}`;
  const fixed = (x: number) => x.toFixed(Math.min(m.decimals, 1));
  return m.low === m.threshold ? `目标 ≥ ${fixed(m.threshold)}${unit}` : `目标 ≥ ${fixed(m.threshold)}${unit}，< ${fixed(m.low)}${unit} 偏低`;
}

/**
 * The gap to the dunk line, drawn as a reach ruler: from the standing reach on the left to the dunk line on the right,
 * with the rim marked and the latest touch filled in.
 */
export function DunkHero({ diagnosis: d, standingReach }: { diagnosis: DunkDiagnosis; standingReach: number | null }) {
  const ruler = reachRuler(d.touch.value, standingReach, d.line);
  const progress = ruler?.progress ?? 0;
  const rim = ruler?.rim ?? null;

  const [fill] = useState(() => new Animated.Value(0));
  const [width] = useState(() => fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }));
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (!live) return;
        if (reduce) fill.setValue(progress);
        else Animated.timing(fill, { toValue: progress, duration: 700, easing: Easing.out(Easing.exp), useNativeDriver: false }).start();
      });
    return () => {
      live = false;
    };
  }, [fill, progress]);

  return (
    <Card style={styles.hero}>
      {!ruler && <Text style={text.muted}>扣篮线 {d.line} cm</Text>}
      {d.gapCm == null ? (
        <>
          <Text style={text.heading}>还不知道离扣篮多远</Text>
          <Text style={text.muted}>测一次助跑摸高，或者在「我的」填站立摸高、再测一次 CMJ。</Text>
        </>
      ) : (
        <>
          <View style={styles.gapRow}>
            <Text style={styles.gapLabel}>{gapHeading(d).label}</Text>
            <Text style={styles.gap}>{d.gapCm > 0 ? d.gapCm.toFixed(1) : `+${(-d.gapCm).toFixed(1)}`}</Text>
            <Text style={styles.gapUnit}>cm</Text>
          </View>
          {ruler && (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="离扣篮线的进度"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
              style={styles.ruler}
            >
              {rim != null && (
                <View style={styles.rimRow}>
                  <Text style={[styles.rulerText, styles.rimLabel, { left: `${rim * 100}%` }]}>篮筐 {RIM_CM}</Text>
                </View>
              )}
              <View style={styles.track}>
                <Animated.View style={[styles.fill, { width }]} />
                {rim != null && <View style={[styles.rimTick, { left: `${rim * 100}%` }]} />}
              </View>
              <View style={styles.rulerLabels}>
                <Text style={styles.rulerText}>站立 {standingReach!.toFixed(0)}</Text>
                <Text style={styles.rulerText}>扣篮线 {d.line}</Text>
              </View>
            </View>
          )}
          <Text style={text.muted}>{touchNote(d)}</Text>
          {gapHeading(d).hint && <Text style={text.muted}>{gapHeading(d).hint}</Text>}
        </>
      )}
      {!d.missing.includes('approach') && (
        <Pressable accessibilityRole="button" accessibilityLabel="测助跑摸高" hitSlop={8} onPress={() => openDunkTest('approach')} style={styles.retest}>
          <Text style={styles.retestText}>再测助跑摸高</Text>
          <Icon name="chevronRight" size={14} color={colors.accent} />
        </Pressable>
      )}
    </Card>
  );
}

function LimiterHead({ d }: { d: DunkDiagnosis }) {
  if (!d.limiter) return <Text style={text.body}>还缺数据，先做「下一步」里的测试。</Text>;
  return (
    <>
      <View style={styles.limiterRow}>
        <Text style={styles.limiter}>{BLOCKS[d.limiter].name}</Text>
        <Text style={[styles.badge, d.confirmed ? styles.badgeConfirmed : styles.badgePending]}>{d.confirmed ? '两次测试一致' : '再测一次确认'}</Text>
      </View>
      <Text style={text.body}>{BLOCKS[d.limiter].focus}</Text>
    </>
  );
}

function Reasons({ d }: { d: DunkDiagnosis }) {
  return d.reasons.map((r) => (
    <Text key={r} style={styles.reason}>
      · {r}
    </Text>
  ));
}

function MetricRow({ m, flat }: { m: DunkMetric; flat?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={m.name} onPress={() => openDunkTest(m.key)} style={({ pressed }) => [flat ? styles.flatRow : styles.row, pressed && styles.pressed]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowName}>{m.name}</Text>
        <Text style={styles.rowTarget}>{targetText(m)}</Text>
      </View>
      <Text style={styles.rowValue}>{valueText(m)}</Text>
      <Text style={[styles.status, { color: STATUS_COLOR[m.status] }]}>{statusLabel(m)}</Text>
    </Pressable>
  );
}

function NextRow({ k, flat }: { k: Missing; flat?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => openDunkTest(k)} style={({ pressed }) => [flat ? styles.flatRow : styles.row, pressed && styles.pressed]}>
      <Text style={[styles.rowName, { flex: 1 }]}>{MISSING_TEXT[k]}</Text>
      <Icon name="chevronRight" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

/**
 * The whole diagnosis on one page: the gap, the limiter with its reasons, every metric against its line, and what to
 * measure next. The dunk diagnosis screen shows it; the home screen shows {@link DunkSummary} instead.
 */
export function DunkPanel({ diagnosis: d, standingReach }: { diagnosis: DunkDiagnosis; standingReach: number | null }) {
  return (
    <View style={styles.panel}>
      <DunkHero diagnosis={d} standingReach={standingReach} />

      <Card style={{ gap: 10 }}>
        <Text style={text.muted}>当前短板</Text>
        <LimiterHead d={d} />
        <Reasons d={d} />
      </Card>

      <Text style={text.section}>指标</Text>
      {d.metrics.map((m) => (
        <MetricRow key={m.key} m={m} />
      ))}

      {d.missing.length > 0 && (
        <>
          <Text style={text.section}>下一步</Text>
          {d.missing.map((k) => (
            <NextRow key={k} k={k} />
          ))}
        </>
      )}
    </View>
  );
}

/**
 * The limiter, every metric as one cell of a grid coloured by where it stands, and the single next test, in one card.
 * The reasons, each metric's target and the rest of the to-do list open in place when asked for.
 */
export function DunkSummary({ diagnosis: d }: { diagnosis: DunkDiagnosis }) {
  const [open, setOpen] = useState(false);
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
    setOpen((o) => !o);
  };
  const [next, ...later] = d.missing;

  return (
    <Card style={styles.summary}>
      <View style={styles.summaryHead}>
        <Text style={text.muted}>当前短板</Text>
        <LimiterHead d={d} />
      </View>

      <View style={styles.grid}>
        {d.metrics.map((m) => (
          <Pressable
            key={m.key}
            accessibilityRole="button"
            accessibilityLabel={`${m.name}，${statusLabel(m)}`}
            onPress={() => openDunkTest(m.key)}
            style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
          >
            <Text style={[styles.cellValue, m.value == null && { color: colors.textFaint }]} numberOfLines={1}>
              {valueText(m)}
            </Text>
            <View style={styles.cellLabel}>
              <View style={[styles.dot, { backgroundColor: STATUS_COLOR[m.status] }]} />
              <Text style={styles.cellName} numberOfLines={1}>
                {m.name}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>

      {next && (
        <Pressable accessibilityRole="button" accessibilityLabel={MISSING_TEXT[next]} onPress={() => openDunkTest(next)} style={({ pressed }) => [styles.next, pressed && styles.pressed]}>
          <Text style={styles.nextLabel}>下一步</Text>
          <Text style={styles.nextText} numberOfLines={2}>
            {MISSING_TEXT[next]}
          </Text>
          <Icon name="chevronRight" size={16} color={colors.accent} />
        </Pressable>
      )}

      {open && (
        <View style={styles.more}>
          {d.reasons.length > 0 && (
            <View style={{ gap: 4 }}>
              <Text style={styles.moreTitle}>为什么</Text>
              <Reasons d={d} />
            </View>
          )}
          <View>
            <Text style={styles.moreTitle}>各项目标</Text>
            {d.metrics.map((m) => (
              <MetricRow key={m.key} m={m} flat />
            ))}
          </View>
          {later.length > 0 && (
            <View>
              <Text style={styles.moreTitle}>之后再测</Text>
              {later.map((k) => (
                <NextRow key={k} k={k} flat />
              ))}
            </View>
          )}
        </View>
      )}

      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={open ? '收起诊断详情' : '展开诊断详情'} onPress={toggle} style={[styles.toggle, open && { borderTopWidth: 0 }]}>
        <Text style={styles.toggleText}>{open ? '收起' : later.length > 0 ? `理由、目标和另外 ${later.length} 项待测` : '理由和各项目标'}</Text>
        <View style={open && { transform: [{ rotate: '180deg' }] }}>
          <Icon name="chevronDown" size={16} color={colors.textMuted} />
        </View>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12 },
  hero: { gap: 8 },
  gapRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  gapLabel: { color: colors.text, fontSize: 17, fontWeight: '600' },
  gap: { color: colors.accent, fontFamily: fonts.numericBold, fontSize: 64 },
  gapUnit: { color: colors.textMuted, fontSize: 18 },
  ruler: { gap: 4, paddingVertical: 4 },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5, backgroundColor: colors.accent },
  rimTick: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: colors.bg },
  rulerLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  rulerText: { color: colors.textMuted, fontFamily: fonts.numeric, fontSize: 13 },
  rimRow: { height: 16 },
  rimLabel: { position: 'absolute', width: 64, marginLeft: -32, textAlign: 'center' },
  retest: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingTop: 4 },
  retestText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  limiterRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  limiter: { color: colors.text, fontSize: 24, fontWeight: '700' },
  badge: { fontSize: 12, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  badgeConfirmed: { color: colors.onAccent, backgroundColor: colors.good },
  badgePending: { color: colors.text, backgroundColor: colors.surfaceRaised },
  reason: { color: colors.textSoft, fontSize: 13, lineHeight: 20 },
  row: { backgroundColor: colors.surface, borderRadius: radius.row, minHeight: 60, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  flatRow: { minHeight: 56, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  pressed: { opacity: 0.7 },
  rowName: { color: colors.text, fontSize: 15, fontWeight: '500' },
  rowTarget: { color: colors.textMuted, fontSize: 12 },
  rowValue: { color: colors.text, fontFamily: fonts.numeric, fontSize: 22 },
  status: { width: 44, textAlign: 'right', fontSize: 12, fontWeight: '600' },
  summary: { gap: 16 },
  summaryHead: { gap: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, paddingTop: 12 },
  cell: { width: '33.333%', minHeight: 56, paddingVertical: 6, paddingRight: 8, gap: 2 },
  cellValue: { color: colors.text, fontFamily: fonts.numericBold, fontSize: 24 },
  cellLabel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  cellName: { color: colors.textMuted, fontSize: 11, flexShrink: 1 },
  next: { minHeight: 48, borderRadius: radius.chip, backgroundColor: colors.accentTile, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  nextLabel: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  nextText: { color: colors.text, fontSize: 14, flex: 1 },
  more: { gap: 16 },
  moreTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '600', paddingBottom: 2 },
  toggle: { minHeight: 44, marginTop: -8, marginBottom: -8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  toggleText: { color: colors.textMuted, fontSize: 13 },
});
