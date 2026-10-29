import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Empty } from '@/components/ui';
import { endPlan } from '@/db/training';
import { addDays, daysBetween, mondayOf, shortDate } from '@/domain/dates';
import { BLOCKS } from '@/domain/dunk';
import { BLOCK_WEEKS, PHASE_NAMES, planDay, planWeekOf, planWeeks, type PlannedSession } from '@/domain/plan';
import { tr } from '@/i18n';
import { useAthlete } from '@/state/athlete';
import { loadTraining, todayISO, type TrainingData } from '@/state/training';
import { colors, radius, text } from '@/theme';

export default function PlanOverview() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [data, setData] = useState<TrainingData | null | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      if (!current) return;
      let alive = true;
      loadTraining(db, current.id).then((d) => alive && setData(d));
      return () => {
        alive = false;
      };
    }, [db, current]),
  );

  if (data === undefined) return null;
  if (data === null) {
    return (
      <SafeAreaView style={styles.screen}>
        <Empty title={tr('还没有训练计划')} />
        <Button label={tr('选择训练计划')} onPress={() => router.replace('/plan/new')} style={{ margin: 16 }} />
      </SafeAreaView>
    );
  }

  const { plan, template, workouts } = data;
  const today = todayISO();
  const firstMonday = mondayOf(plan.startDate);
  const currentWeek = Math.max(0, Math.floor(daysBetween(firstMonday, today) / 7));
  const total = planWeeks(template);
  // Calendar weeks. Each inserted deload adds a week, and one that starts mid-week spreads over two.
  const deloads = plan.deloads ?? [];
  const inserted = deloads.length + (deloads.some((d) => d !== mondayOf(d)) ? 1 : 0);
  // A repeating plan shows the week before this one and one full cycle ahead.
  const fromWeek = total ? 0 : Math.max(0, currentWeek - 1);
  const toWeek = total != null ? total + inserted : currentWeek + template.weeks.length;
  const byDate = new Map(workouts.map((w) => [w.date, w]));

  const weeks = Array.from({ length: toWeek - fromWeek }, (_, i) => {
    const week = fromWeek + i;
    const monday = addDays(firstMonday, week * 7);
    const sessions = Array.from({ length: 7 }, (_, d) => planDay(template, plan, addDays(monday, d))).filter((p): p is PlannedSession => p != null);
    const phase = sessions[0]?.phase ?? template.weeks[Math.max(0, planWeekOf(plan, monday)) % template.weeks.length].phase;
    const block = sessions.find((p) => !p.inserted)?.block;
    const spec = block && template.blocks?.[block.type].weeks[block.week];
    const label = block && spec ? `${BLOCKS[block.type].name} ${block.week + 1}/${BLOCK_WEEKS} · ${spec.retest ? tr('减量复测') : PHASE_NAMES[spec.phase]}` : PHASE_NAMES[phase];
    return { week, label, deload: sessions.some((p) => p.inserted), sessions };
  }).filter((w) => total == null || w.sessions.length > 0);

  function confirmEnd() {
    Alert.alert(tr('结束这个计划？'), tr('训练记录会保留，之后可以再选一个新计划。'), [
      { text: tr('取消'), style: 'cancel' },
      {
        text: tr('结束计划'),
        style: 'destructive',
        onPress: async () => {
          await endPlan(db, plan.id);
          router.back();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={{ gap: 4 }}>
          <Text style={text.heading}>{template.name}</Text>
          <Text style={text.muted}>{template.summary}</Text>
        </View>

        {weeks.map(({ week, label, deload, sessions }) => (
          <View key={week} style={[styles.week, week === currentWeek && { borderColor: colors.accent }]}>
            <Text style={text.section}>{tr('第 {week} 周 · {p}', { week: week + 1, p: deload ? tr('减量（疲劳后插入）') : label })}</Text>
            {sessions.map((p) => {
              const w = byDate.get(p.date);
              const status = w?.finishedAt ? tr('已完成') : w ? tr('进行中') : p.date === today ? tr('今天') : daysBetween(p.date, today) > 0 ? tr('未练') : '';
              const color = w?.finishedAt ? colors.good : w ? colors.warn : p.date === today ? colors.accent : colors.textMuted;
              const canOpen = daysBetween(p.date, today) >= 0;
              return (
                <Pressable
                  key={p.date}
                  accessibilityRole="button"
                  disabled={!w}
                  onPress={() => router.push({ pathname: '/workout/[date]', params: { date: p.date } })}
                  style={styles.row}
                >
                  <Text style={styles.date}>{shortDate(p.date)}</Text>
                  <Text style={[text.body, { flex: 1 }]}>
                    {p.session.code} · {p.session.name}
                  </Text>
                  <Text style={[styles.status, { color }]}>{canOpen || w ? status : ''}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}

        <View style={{ gap: 10, marginTop: 8 }}>
          <Button label={tr('更换计划')} variant="secondary" onPress={() => router.push('/plan/new')} />
          <Button label={tr('结束计划')} variant="ghost" onPress={confirmEnd} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  week: { padding: 14, gap: 4, borderRadius: radius.card, borderWidth: 1, borderColor: colors.surface, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  date: { width: 76, color: colors.textMuted, fontSize: 12 },
  status: { fontSize: 12, fontWeight: '700' },
});
