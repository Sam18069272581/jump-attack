import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Button, Card } from '@/components/ui';
import { newSessionId, type Athlete } from '@/db/repo';
import { athleteName } from '@/domain/athletes';
import { toISODate } from '@/domain/dates';
import { nextTurn } from '@/domain/team';
import { nextStep } from '@/domain/testDay';
import { decimal, tr } from '@/i18n';
import { useAthlete } from '@/state/athlete';
import { loadTestDay, type TestDayRow } from '@/state/testDay';
import { colors, fonts, radius, text } from '@/theme';

const NOBODY: Athlete[] = [];

/**
 * CMJ, drop jumps and run-up touches in one pass; each test's 完成 comes back here. Several athletes can take turns:
 * everyone does a test before the next one starts (domain/team.ts nextTurn).
 */
export default function TestDay() {
  const db = useSQLiteContext();
  const { current, athletes = NOBODY, select } = useAthlete();
  // From the team board: everyone takes turns.
  const { crew: everyone } = useLocalSearchParams<{ crew?: string }>();
  // Who takes turns: everyone, some, or null for the current athlete alone.
  const [picked, setPicked] = useState<number[] | 'all' | null>(everyone === 'all' ? 'all' : null);
  // Each athlete's tests today, with whose they are, so a change of crew never shows one athlete's under another.
  const [loaded, setLoaded] = useState<{ ids: number[]; lanes: TestDayRow[][] }>({ ids: [], lanes: [] });
  const crew = useMemo(() => {
    if (picked === 'all' && athletes.length > 1) return athletes;
    if (Array.isArray(picked)) return athletes.filter((a) => picked.includes(a.id));
    return current ? [current] : [];
  }, [picked, athletes, current]);
  const lanes = loaded.ids.join() === crew.map((a) => a.id).join() ? loaded.lanes : [];

  useFocusEffect(
    useCallback(() => {
      const today = toISODate(new Date());
      const ids = crew.map((a) => a.id);
      Promise.all(ids.map((id) => loadTestDay(db, id, today))).then((lanes) => setLoaded({ ids, lanes }));
    }, [db, crew]),
  );

  function toggle(id: number) {
    const now = crew.map((a) => a.id);
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    if (next.length > 1) setPicked(next);
    else {
      setPicked(null);
      if (next[0] != null && next[0] !== current?.id) select(next[0]);
    }
  }

  // Today's session again when there is one, so a second batch of clips adds to the same result.
  const measure = (row: TestDayRow, athleteId?: number) => {
    if (athleteId != null && athleteId !== current?.id) select(athleteId);
    router.push({ pathname: '/measure/capture', params: { metric: row.metric, session: row.sessionId ?? newSessionId(), from: 'testday', ...(row.box ? { box: String(row.box) } : {}) } });
  };

  const picker = athletes.length > 1 && (
    <View style={{ gap: 8 }}>
      <Text style={text.section}>{tr('谁来测')}</Text>
      <View style={styles.chips}>
        {athletes.map((a) => {
          const on = crew.some((c) => c.id === a.id);
          return (
            <Pressable key={a.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(a.id)} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && { color: colors.onAccent }]}>{athleteName(a.name)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  if (crew.length > 1 && lanes.length > 0) {
    const turn = nextTurn(lanes);
    const up = turn && { athlete: crew[turn.athlete], row: lanes[turn.athlete][turn.step] };
    return (
      <ScrollView contentContainerStyle={styles.content}>
        {picker}
        <Text style={text.muted}>{tr('{length} 人轮流测：一项全员测完再换下一项，等别人跳的时候正好休息。点名字可以给任何人补测。', { length: crew.length })}</Text>
        {lanes[0].map((step, i) => (
          <Card key={step.metric} style={{ gap: 8 }}>
            <Text style={styles.name}>{tr('{i}. {name} · 每人 {jumps} 跳', { i: i + 1, name: step.def.name, jumps: step.jumps })}</Text>
            {crew.map((a, k) => {
              const row = lanes[k][i];
              const isNext = turn?.athlete === k && turn.step === i;
              return (
                <Pressable
                  key={a.id}
                  accessibilityRole="button"
                  accessibilityLabel={tr('{name} 测 {name2}', { name: athleteName(a.name), name2: step.def.name })}
                  onPress={() => measure(row, a.id)}
                  style={({ pressed }) => [styles.turn, isNext && styles.current, pressed && { opacity: 0.75 }]}
                >
                  <Text style={[styles.turnName, row.trials > 0 && { color: colors.good }]}>{athleteName(a.name)}</Text>
                  <Text style={styles.status}>{row.trials > 0 ? result(row) : row.box ? tr('{box} cm 箱', { box: row.box }) : tr('未测')}</Text>
                </Pressable>
              );
            })}
          </Card>
        ))}
        {up ? (
          <Button label={tr('下一位：{name} · {name2}', { name: athleteName(up.athlete.name), name2: up.row.def.name })} onPress={() => measure(up.row, up.athlete.id)} />
        ) : (
          <Card style={styles.done}>
            <Text style={text.section}>{tr('{p}三项都测完了', { p: crew.length === athletes.length ? tr('全队') : tr('{length} 人', { length: crew.length }) })}</Text>
            <Text style={text.muted}>{tr('每个人的扣篮诊断都已按今天的成绩更新。')}</Text>
            <Button label={tr('看团队排行')} onPress={() => router.push('/team')} />
          </Card>
        )}
      </ScrollView>
    );
  }

  const rows = crew.length > 1 ? [] : (lanes[0] ?? []);
  const next = rows.length ? nextStep(rows, Object.fromEntries(rows.map((r) => [r.metric, r]))) : null;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {picker}
      <Text style={text.muted}>{tr('按顺序测完这三项。慢动作视频可以从相册一次选好几段，按拍摄先后点选，测完一项会回到这里。')}</Text>
      {rows.map((row, i) => (
        <Step key={row.metric} n={i + 1} row={row} current={i === next} onPress={() => measure(row)} />
      ))}
      {rows.length > 0 && next != null && <Button label={tr('下一项：{name}', { name: rows[next].def.name })} onPress={() => measure(rows[next])} />}
      {rows.length > 0 && next == null && (
        <Card style={styles.done}>
          <Text style={text.section}>{tr('今天三项都测完了')}</Text>
          <Text style={text.muted}>{tr('扣篮诊断已按今天的成绩更新。')}</Text>
          <Button label={tr('看扣篮诊断')} onPress={() => router.push('/dunk')} />
        </Card>
      )}
    </ScrollView>
  );
}

/** E.g. "3 跳 · 41.5 cm", or the mean of the best three for run-up touches. */
function result(row: TestDayRow): string {
  const top3 = row.def.aggregate === 'top3' && row.trials > 1;
  return tr('{trials} 跳 · {p}{best} {unit}', { trials: row.trials, p: top3 ? tr('前 3 均值 ') : '', best: decimal(row.best!, row.def.decimals), unit: row.def.unit }).trim();
}

function Step({ n, row, current, onPress }: { n: number; row: TestDayRow; current: boolean; onPress: () => void }) {
  const done = row.trials > 0;
  const top3 = row.def.aggregate === 'top3' && row.trials > 1;
  const value = row.best != null ? `${decimal(row.best, row.def.decimals)} ${row.def.unit}`.trim() : '';
  const status = done ? tr('已测 {trials} 跳 · {p} {value}', { trials: row.trials, p: top3 ? tr('最好 {p} 跳均值', { p: Math.min(3, row.trials) }) : tr('最好'), value }) : tr('{jumps} 跳', { jumps: row.jumps });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr('测 {name}', { name: row.def.name })}
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: colors.border, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 14 },
  turn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, height: 44, borderRadius: 12, backgroundColor: colors.bg, borderWidth: 1.5, borderColor: 'transparent' },
  turnName: { flex: 1, color: colors.text, fontSize: 15 },
});
