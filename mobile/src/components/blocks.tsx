import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Card } from '@/components/ui';
import { newSessionId } from '@/db/repo';
import type { BlockSuggestion } from '@/domain/blocks';
import { shortDate, type ISODate } from '@/domain/dates';
import { BLOCKS, MISSING_TEXT, type DunkDiagnosis } from '@/domain/dunk';
import { getMetric } from '@/domain/metrics';
import { BLOCK_WEEKS, PHASE_NAMES, type BlockPosition, type PlanBlock, type WeekSpec } from '@/domain/plan';
import { tr } from '@/i18n';
import { colors, radius, text } from '@/theme';

/** e.g. "反应块 · 第 2/4 周 · 积累期". */
export function blockLabel(pos: BlockPosition, spec: WeekSpec | undefined): string {
  const phase = spec?.retest ? tr('减量复测周') : spec ? PHASE_NAMES[spec.phase] : '';
  return tr('{name} · 第 {week}/{BLOCK_WEEKS} 周{p}', { name: BLOCKS[pos.type].name, week: pos.week + 1, BLOCK_WEEKS, p: phase ? ` · ${phase}` : '' });
}

/** The block's one-line reason, with the numbers it was picked on. */
export function BlockReason({ block }: { block: PlanBlock }) {
  return (
    <View style={styles.reason}>
      <Text style={styles.reasonTitle}>{tr('为什么练{name}', { name: BLOCKS[block.type].name })}</Text>
      <Text style={styles.reasonText}>{block.reason ?? BLOCKS[block.type].focus}</Text>
    </View>
  );
}

function openTest(code: string) {
  const session = newSessionId();
  if (code === 'dj_rsi') router.push({ pathname: '/jumps/dj', params: { session } });
  else if (code.startsWith('vbt_')) router.push({ pathname: '/vbt/[lift]', params: { lift: code, session } });
  else router.push({ pathname: '/measure/capture', params: { metric: code, session, from: 'train' } });
}

/** The retest week's tests, and what the diagnosis still lacks. */
export function RetestCard({ codes, diagnosis, nextStart }: { codes: string[]; diagnosis: DunkDiagnosis | null; nextStart: ISODate | null }) {
  return (
    <Card style={styles.card}>
      <Text style={text.section}>{tr('本周复测')}</Text>
      <Text style={text.muted}>{tr('这周减量，状态好的一天把下面几项测一遍。测完会重新诊断，{p}下一块练什么跟着结果走。', { p: nextStart ? tr('{nextStart} 开始的', { nextStart: shortDate(nextStart) }) : '' })}</Text>
      <View style={styles.tests}>
        {codes.map((code) => (
          <Button key={code} label={tr('测 {name}', { name: getMetric(code)?.name ?? code })} variant="secondary" onPress={() => openTest(code)} style={styles.testButton} />
        ))}
      </View>
      <Button label={tr('测试日向导：按顺序测完三项跳跃')} variant="secondary" onPress={() => router.push('/test-day')} />
      {diagnosis && diagnosis.missing.length > 0 && <Text style={text.caption}>{tr('诊断还缺：{p}', { p: diagnosis.missing.map((m) => MISSING_TEXT[m]).join(tr('；')) })}</Text>}
      <Button label={tr('看扣篮诊断')} variant="ghost" onPress={() => router.push('/dunk')} />
    </Card>
  );
}

/** A suggestion to switch blocks or skip ahead; it only takes effect when accepted. */
export function SuggestionCard({ suggestion, busy, onAccept, onDecline }: { suggestion: BlockSuggestion; busy: boolean; onAccept: () => void; onDecline: () => void }) {
  const s = suggestion;
  const title = s.kind === 'switch' ? tr('建议下一块换成{name}', { name: BLOCKS[s.type].name }) : tr('建议提前进入{phase}', { phase: s.phase });
  const reasons = s.kind === 'switch' ? s.reasons : [s.reason];
  return (
    <Card style={{ ...styles.card, ...styles.suggestion }}>
      <Text style={[text.section, { color: colors.accent }]}>{title}</Text>
      {reasons.map((r) => (
        <Text key={r} style={styles.reasonText}>
          {r}
        </Text>
      ))}
      <Text style={text.caption}>
        {s.kind === 'switch'
          ? tr('接受后从 {start} 起练{name}：{focus}。', { start: shortDate(s.start), name: BLOCKS[s.type].name, focus: BLOCKS[s.type].focus })
          : tr('接受后从今天起按下一阶段练（今天已开练的话从明天起）。')}
      </Text>
      <View style={styles.actions}>
        <Button label={s.kind === 'switch' ? tr('换块') : tr('提前进入')} onPress={onAccept} busy={busy} style={{ flex: 1 }} />
        <Button label={s.kind === 'switch' ? tr('继续{name}', { name: BLOCKS[s.from].name }) : tr('按原计划')} variant="ghost" onPress={onDecline} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  suggestion: { borderWidth: 1, borderColor: colors.accent },
  reason: { borderRadius: radius.row, backgroundColor: colors.surface, padding: 12, gap: 4 },
  reasonTitle: { color: colors.textMuted, fontSize: 12 },
  reasonText: { color: colors.textSoft, fontSize: 13, lineHeight: 19 },
  tests: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  testButton: { height: 40, paddingHorizontal: 14 },
  actions: { flexDirection: 'row', gap: 10 },
});
