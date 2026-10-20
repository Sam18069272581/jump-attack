import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AdjustmentNote, SessionItems, WeekStrip, type DayStatus } from '@/components/training';
import { Button, Card } from '@/components/ui';
import { newSessionId } from '@/db/repo';
import { addDays, daysBetween, mondayOf, shortDate, type ISODate } from '@/domain/dates';
import { nextSession, PHASE_NAMES, planDay, planFinished, planWeeks, weekDays } from '@/domain/plan';
import { useAthlete } from '@/state/athlete';
import { beginWorkout, loadReadiness, loadTraining, sessionFor, todayISO, type DayReadiness, type TrainingData } from '@/state/training';
import { colors, fonts, radius, text } from '@/theme';

type Loaded = { data: TrainingData | null; readiness: DayReadiness };

export default function Train() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const today = todayISO();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<ISODate>(today);
  const [starting, setStarting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!current) return;
      let alive = true;
      Promise.all([loadTraining(db, current.id), loadReadiness(db, current.id, todayISO())]).then(
        ([data, readiness]) => alive && setLoaded({ data, readiness }),
      );
      return () => {
        alive = false;
      };
    }, [db, current]),
  );

  if (!loaded) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  const { data, readiness } = loaded;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {data ? (
          <PlanView
            data={data}
            readiness={readiness}
            today={today}
            selected={selected}
            onSelect={setSelected}
            starting={starting}
            onStart={async (date) => {
              setStarting(true);
              try {
                await beginWorkout(db, data, date);
                router.push({ pathname: '/workout/[date]', params: { date } });
              } catch (e) {
                Alert.alert('无法开始训练', String(e));
              } finally {
                setStarting(false);
              }
            }}
          />
        ) : (
          <>
            <Text style={text.title}>训练</Text>
            <ReadinessCard readiness={readiness} />
            <Card style={{ gap: 12 }}>
              <Text style={text.section}>还没有训练计划</Text>
              <Text style={text.muted}>选一个模板，按你的训练日生成每周的训练。每次练之前测一次 CMJ，状态差时自动减量。</Text>
              <Button label="选择训练计划" onPress={() => router.push('/plan/new')} />
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PlanView({
  data,
  readiness,
  today,
  selected,
  onSelect,
  starting,
  onStart,
}: {
  data: TrainingData;
  readiness: DayReadiness;
  today: ISODate;
  selected: ISODate;
  onSelect: (d: ISODate) => void;
  starting: boolean;
  onStart: (date: ISODate) => void;
}) {
  const { plan, template, workouts } = data;
  const byDate = new Map(workouts.map((w) => [w.date, w]));
  const statusOf = (d: ISODate): DayStatus => {
    const w = byDate.get(d);
    if (w) return w.finishedAt ? 'done' : 'started';
    return planDay(template, plan, d) ? 'planned' : 'rest';
  };

  const total = planWeeks(template);
  const week = Math.floor(daysBetween(mondayOf(plan.startDate), today) / 7);
  const todayPlan = planDay(template, plan, today);
  const finished = planFinished(template, plan, today);
  const phase = todayPlan?.phase ?? template.weeks[Math.max(0, week) % template.weeks.length].phase;
  const subtitle = finished
    ? '计划已完成'
    : week < 0
      ? `${shortDate(plan.startDate)} 开始`
      : `第 ${week + 1}${total ? ` / ${total}` : ''} 周 · ${PHASE_NAMES[phase]}`;

  const planned = planDay(template, plan, selected);
  const workout = byDate.get(selected);
  const isToday = selected === today;
  const shown = planned ? sessionFor(planned, workout, isToday ? readiness.readiness : null) : null;
  const next = planned ? null : nextSession(template, plan, addDays(selected, 1));

  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="查看整个计划" onPress={() => router.push('/plan')} style={styles.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={text.muted}>{subtitle}</Text>
          <Text style={text.heading}>{template.name}</Text>
        </View>
        <Icon name="chevronRight" size={18} color={colors.textMuted} />
      </Pressable>

      <WeekStrip
        days={weekDays(selected)}
        today={today}
        selected={selected}
        statusOf={statusOf}
        onSelect={onSelect}
        onShift={(n) => onSelect(addDays(selected, n * 7))}
      />

      {isToday && <ReadinessCard readiness={readiness} />}

      <Card style={{ gap: 12 }}>
        <View style={styles.dayHead}>
          <Text style={text.muted}>{isToday ? '今天' : shortDate(selected)}</Text>
          {workout?.finishedAt ? <Text style={[styles.tag, { color: colors.good }]}>已完成</Text> : workout ? <Text style={[styles.tag, { color: colors.warn }]}>进行中</Text> : null}
        </View>
        {planned && shown ? (
          <>
            <View style={{ gap: 2 }}>
              <Text style={text.heading}>
                {planned.session.code} · {planned.session.name}
              </Text>
              <Text style={text.muted}>
                {planned.session.focus} · {PHASE_NAMES[planned.phase]}
              </Text>
            </View>
            <AdjustmentNote adjustments={shown.adjustments} dropPct={workout ? workout.cmjDrop : readiness.dropPct} />
            <SessionItems session={shown.session} />
            {daysBetween(selected, today) >= 0 ? (
              <Button
                label={workout?.finishedAt ? '查看训练记录' : workout ? '继续训练' : isToday ? '开始训练' : '补记这次训练'}
                variant={workout?.finishedAt ? 'secondary' : 'primary'}
                busy={starting}
                onPress={() => onStart(selected)}
              />
            ) : (
              <Text style={text.caption}>到那天再开始</Text>
            )}
          </>
        ) : (
          <View style={{ gap: 4 }}>
            <Text style={text.heading}>{finished && daysBetween(selected, today) <= 0 ? '计划已完成' : '休息日'}</Text>
            <Text style={text.muted}>
              {next ? `下次：${shortDate(next.date)} · ${next.session.code} ${next.session.name}` : finished ? '测一次 CMJ 看看提升，再选下一个计划。' : ''}
            </Text>
          </View>
        )}
      </Card>
    </>
  );
}

function ReadinessCard({ readiness }: { readiness: DayReadiness }) {
  const testCmj = () => router.push({ pathname: '/jumps/capture', params: { metric: 'cmj', session: newSessionId(), from: 'train' } });

  if (readiness.today == null) {
    return (
      <Card style={styles.readiness}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={text.section}>今日准备度</Text>
          <Text style={text.muted}>练之前测一次 CMJ，状态差的话今天的训练会自动减量。</Text>
        </View>
        <Button label="测 CMJ" onPress={testCmj} style={{ paddingHorizontal: 18 }} />
      </Card>
    );
  }

  const label = { ready: '状态正常', fatigued: '疲劳信号', unknown: '基线不足' }[readiness.readiness];
  const color = { ready: colors.good, fatigued: colors.warn, unknown: colors.textMuted }[readiness.readiness];
  const detail =
    readiness.readiness === 'unknown'
      ? '至少要有 3 天的 CMJ 记录才能判断，先照计划练。'
      : `比近期均值${readiness.dropPct > 0 ? '低' : '高'} ${Math.abs(readiness.dropPct * 100).toFixed(1)}%${readiness.readiness === 'fatigued' ? '，今天已自动减量' : ''}`;

  return (
    <Card style={styles.readiness}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.readinessLabel, { color }]}>{label}</Text>
        <Text style={text.muted}>{detail}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="再测一次 CMJ" onPress={testCmj} style={{ alignItems: 'flex-end' }}>
        <Text style={styles.cmj}>
          {readiness.today.toFixed(1)}
          <Text style={styles.cmjUnit}> cm</Text>
        </Text>
        <Text style={text.caption}>今日 CMJ</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingTop: 28, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tag: { fontSize: 12, fontWeight: '700' },
  readiness: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.card },
  readinessLabel: { fontSize: 17, fontWeight: '700' },
  cmj: { color: colors.text, fontFamily: fonts.numericBold, fontSize: 32 },
  cmjUnit: { color: colors.textMuted, fontSize: 14 },
});
