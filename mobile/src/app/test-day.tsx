import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Button, Card } from '@/components/ui';
import { newSessionId } from '@/db/repo';
import { toISODate } from '@/domain/dates';
import { nextStep } from '@/domain/testDay';
import { useAthlete } from '@/state/athlete';
import { loadTestDay, type TestDayRow } from '@/state/testDay';
import { colors, fonts, radius, text } from '@/theme';

/** CMJ, drop jumps and run-up touches in one pass; each test's 完成 comes back here. */
export default function TestDay() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [rows, setRows] = useState<TestDayRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (current) loadTestDay(db, current.id, toISODate(new Date())).then(setRows);
    }, [db, current]),
  );

  // Today's session again when there is one, so a second batch of clips adds to the same result.
  const measure = (row: TestDayRow) =>
    router.push({ pathname: '/measure/capture', params: { metric: row.metric, session: row.sessionId ?? newSessionId(), from: 'testday', ...(row.box ? { box: String(row.box) } : {}) } });

  const next = rows.length ? nextStep(rows, Object.fromEntries(rows.map((r) => [r.metric, r]))) : null;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={text.muted}>按顺序测完这三项。慢动作视频可以从相册一次选好几段，按拍摄先后点选，测完一项会回到这里。</Text>
      {rows.map((row, i) => (
        <Step key={row.metric} n={i + 1} row={row} current={i === next} onPress={() => measure(row)} />
      ))}
      {rows.length > 0 && next != null && <Button label={`下一项：${rows[next].def.name}`} onPress={() => measure(rows[next])} />}
      {rows.length > 0 && next == null && (
        <Card style={styles.done}>
          <Text style={text.section}>今天三项都测完了</Text>
          <Text style={text.muted}>扣篮诊断已按今天的成绩更新。</Text>
          <Button label="看扣篮诊断" onPress={() => router.push('/dunk')} />
        </Card>
      )}
    </ScrollView>
  );
}

function Step({ n, row, current, onPress }: { n: number; row: TestDayRow; current: boolean; onPress: () => void }) {
  const done = row.trials > 0;
  const top3 = row.def.aggregate === 'top3' && row.trials > 1;
  const value = row.best != null ? `${row.best.toFixed(row.def.decimals)} ${row.def.unit}`.trim() : '';
  const status = done ? `已测 ${row.trials} 跳 · ${top3 ? `最好 ${Math.min(3, row.trials)} 跳均值` : '最好'} ${value}` : `${row.jumps} 跳`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`测 ${row.def.name}`}
      onPress={onPress}
      style={({ pressed }) => [styles.step, current && styles.current, pressed && { opacity: 0.75 }]}
    >
      <View style={[styles.badge, done && styles.badgeDone]}>
        {done ? <Icon name="check" size={18} color={colors.onAccent} /> : <Text style={styles.badgeText}>{n}</Text>}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.name}>{row.def.name}</Text>
        <Text style={styles.hint}>{row.hint}</Text>
        <Text style={[styles.status, done && { color: colors.good }]}>{status}</Text>
      </View>
      <Icon name="chevronRight" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 12, gap: 12 },
  step: { backgroundColor: colors.surface, borderRadius: radius.row, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1.5, borderColor: 'transparent' },
  current: { borderColor: colors.accent },
  badge: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  badgeDone: { backgroundColor: colors.good, borderColor: colors.good },
  badgeText: { color: colors.textMuted, fontFamily: fonts.numericBold, fontSize: 16 },
  name: { color: colors.text, fontSize: 15, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  status: { color: colors.textSoft, fontSize: 12 },
  done: { gap: 10 },
});
