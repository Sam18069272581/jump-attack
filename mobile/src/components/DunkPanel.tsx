import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Card } from '@/components/ui';
import { openDunkTest } from '@/components/dunkTests';
import { BLOCKS, MISSING_TEXT, type DunkDiagnosis, type DunkMetric } from '@/domain/dunk';
import { colors, fonts, radius, text } from '@/theme';

function statusOf(m: DunkMetric): { label: string; color: string } {
  switch (m.status) {
    case 'low':
      return { label: m.key === 'contact' ? '偏慢' : '偏低', color: colors.warn };
    case 'mid':
      return { label: m.key === 'fv' ? '不均衡' : '接近', color: colors.blue };
    case 'good':
      return { label: '过线', color: colors.good };
    case 'missing':
      return { label: '未测', color: colors.textFaint };
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
 * How far the athlete is from dunking and which part of their training holds them back: the gap to the dunk line,
 * the limiter with its reasons, every metric against its line, and what to measure next. Shown on the home screen
 * and the dunk diagnosis screen.
 */
export function DunkPanel({ diagnosis: d, standingReach }: { diagnosis: DunkDiagnosis; standingReach: number | null }) {
  const progress = standingReach != null && d.touch.value != null && d.line > standingReach ? Math.max(0, Math.min(1, (d.touch.value - standingReach) / (d.line - standingReach))) : null;

  return (
    <View style={styles.panel}>
      <Card style={styles.hero}>
        <Text style={text.muted}>扣篮线 {d.line} cm</Text>
        {d.gapCm == null ? (
          <>
            <Text style={text.heading}>还不知道离扣篮多远</Text>
            <Text style={text.muted}>测一次助跑摸高，或者在「我的」填站立摸高、再测一次 CMJ。</Text>
          </>
        ) : (
          <>
            <View style={styles.gapRow}>
              <Text style={styles.gapLabel}>{d.gapCm > 0 ? '还差' : '够到扣篮线了'}</Text>
              <Text style={styles.gap}>{d.gapCm > 0 ? d.gapCm.toFixed(1) : `+${(-d.gapCm).toFixed(1)}`}</Text>
              <Text style={styles.gapUnit}>cm</Text>
            </View>
            {progress != null && (
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${progress * 100}%` }]} />
              </View>
            )}
            <Text style={text.muted}>
              {d.touch.source === 'approach' ? `助跑摸高 ${d.touch.approach!.toFixed(1)} cm（最近一次）` : `原地估算 ${d.touch.standing!.toFixed(1)} cm（站立摸高 + CMJ），测一次助跑摸高更准`}
            </Text>
            {d.gapCm <= 0 && <Text style={text.muted}>下一步是比赛里稳定扣：累了也能摸到这个高度。</Text>}
          </>
        )}
        {!d.missing.includes('approach') && (
          <Pressable accessibilityRole="button" accessibilityLabel="测助跑摸高" hitSlop={8} onPress={() => openDunkTest('approach')} style={styles.retest}>
            <Text style={styles.retestText}>再测助跑摸高</Text>
            <Icon name="chevronRight" size={14} color={colors.accent} />
          </Pressable>
        )}
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={text.muted}>当前短板</Text>
        {d.limiter ? (
          <>
            <View style={styles.limiterRow}>
              <Text style={styles.limiter}>{BLOCKS[d.limiter].name}</Text>
              <Text style={[styles.badge, d.confirmed ? styles.badgeConfirmed : styles.badgePending]}>{d.confirmed ? '两次测试一致' : '再测一次确认'}</Text>
            </View>
            <Text style={text.body}>{BLOCKS[d.limiter].focus}</Text>
          </>
        ) : (
          <Text style={text.body}>还缺数据，先做下面「下一步」里的测试。</Text>
        )}
        {d.reasons.map((r) => (
          <Text key={r} style={styles.reason}>
            · {r}
          </Text>
        ))}
      </Card>

      <Text style={text.section}>指标</Text>
      {d.metrics.map((m) => {
        const s = statusOf(m);
        return (
          <Pressable key={m.key} accessibilityRole="button" accessibilityLabel={m.name} onPress={() => openDunkTest(m.key)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.rowName}>{m.name}</Text>
              <Text style={styles.rowTarget}>{targetText(m)}</Text>
            </View>
            <Text style={styles.rowValue}>{valueText(m)}</Text>
            <Text style={[styles.status, { color: s.color }]}>{s.label}</Text>
          </Pressable>
        );
      })}

      {d.missing.length > 0 && (
        <>
          <Text style={text.section}>下一步</Text>
          {d.missing.map((k) => (
            <Pressable key={k} accessibilityRole="button" onPress={() => openDunkTest(k)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}>
              <Text style={[styles.rowName, { flex: 1 }]}>{MISSING_TEXT[k]}</Text>
              <Icon name="chevronRight" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12 },
  hero: { gap: 8 },
  gapRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  gapLabel: { color: colors.text, fontSize: 17, fontWeight: '600' },
  gap: { color: colors.accent, fontFamily: fonts.numericBold, fontSize: 64 },
  gapUnit: { color: colors.textMuted, fontSize: 18 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  retest: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingTop: 4 },
  retestText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  limiterRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  limiter: { color: colors.text, fontSize: 24, fontWeight: '700' },
  badge: { fontSize: 12, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  badgeConfirmed: { color: colors.onAccent, backgroundColor: colors.good },
  badgePending: { color: colors.text, backgroundColor: colors.surfaceRaised },
  reason: { color: colors.textSoft, fontSize: 13, lineHeight: 20 },
  row: { backgroundColor: colors.surface, borderRadius: radius.row, minHeight: 60, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowName: { color: colors.text, fontSize: 15, fontWeight: '500' },
  rowTarget: { color: colors.textMuted, fontSize: 12 },
  rowValue: { color: colors.text, fontFamily: fonts.numeric, fontSize: 22 },
  status: { width: 44, textAlign: 'right', fontSize: 12, fontWeight: '600' },
});
