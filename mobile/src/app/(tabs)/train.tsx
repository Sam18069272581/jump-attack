import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlockReason, blockLabel, RetestCard, SuggestionCard } from '@/components/blocks';
import { Icon } from '@/components/Icon';
import { AdjustmentNote, SessionItems, WeekStrip, type DayStatus } from '@/components/training';
import { Button, Card } from '@/components/ui';
import { newSessionId } from '@/db/repo';
import { insertDeload } from '@/db/training';
import { addDays, daysBetween, shortDate, weekday, WEEKDAY_NAMES, type ISODate } from '@/domain/dates';
import { isRetestWeek, nextBlockStart, retestCodes } from '@/domain/blocks';
import { blockPosition, DELOAD_DAYS, missedThisWeek, nextSession, PHASE_NAMES, planDay, planFinished, planPosition, planWeekOf, planWeeks, weekDays } from '@/domain/plan';
import { DELOAD_STREAK } from '@/domain/readiness';
import { STATUS_TEXT } from '@/domain/recovery';
import { useAthlete } from '@/state/athlete';
import { acceptBlockSuggestion, declineBlockSuggestion, loadBlockAdvice, type BlockAdvice } from '@/state/blocks';
import { beginWorkout, loadReadiness, loadTraining, sessionFor, todayISO, type DayReadiness, type TrainingData } from '@/state/training';
import { colors, fonts, radius, text } from '@/theme';

type Loaded = { data: TrainingData | null; readiness: DayReadiness & { streak: number }; advice: BlockAdvice };

export default function Train() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const today = todayISO();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<ISODate>(today);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    if (!current) return;
    const [data, readiness] = await Promise.all([loadTraining(db, current.id), loadReadiness(db, current.id, todayISO())]);
    const advice = data ? await loadBlockAdvice(db, current, data, todayISO()) : { diagnosis: null, suggestion: null };
    setLoaded({ data, readiness, advice });
  }, [db, current]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!loaded) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  const { data, readiness, advice } = loaded;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {data ? (
          <PlanView
            data={data}
            readiness={readiness}
            advice={advice}
            today={today}
            selected={selected}
            onSelect={setSelected}
            starting={starting}
            onDeload={async () => {
              await insertDeload(db, data.plan, today);
              await load();
            }}
            onSuggestion={async (accept) => {
              if (!advice.suggestion) return;
              setStarting(true);
              try {
                if (accept) await acceptBlockSuggestion(db, data, advice.suggestion, advice.diagnosis, today);
                else await declineBlockSuggestion(db, data, advice.suggestion, today);
                await load();
              } finally {
                setStarting(false);
              }
            }}
            onStart={async (date, makeUp) => {
              setStarting(true);
              try {
                await beginWorkout(db, data, date, makeUp);
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
  advice,
  today,
  selected,
  onSelect,
  starting,
  onStart,
  onDeload,
  onSuggestion,
}: {
  data: TrainingData;
  readiness: DayReadiness & { streak: number };
  advice: BlockAdvice;
  today: ISODate;
  selected: ISODate;
  onSelect: (d: ISODate) => void;
  starting: boolean;
  onStart: (date: ISODate, makeUp?: boolean) => void;
  onDeload: () => void;
  onSuggestion: (accept: boolean) => void;
}) {
  const { plan, template, workouts } = data;
  const byDate = new Map(workouts.map((w) => [w.date, w]));
  const statusOf = (d: ISODate): DayStatus => {
    const w = byDate.get(d);
    if (w) return w.finishedAt ? 'done' : 'started';
    return planDay(template, plan, d) ? 'planned' : 'rest';
  };

  const total = planWeeks(template);
  const week = planWeekOf(plan, today);
  const todayPlan = planDay(template, plan, today);
  const finished = planFinished(template, plan, today);
  const inDeload = planPosition(plan, today).inserted;
  const phase = todayPlan?.phase ?? template.weeks[Math.max(0, week) % template.weeks.length].phase;
  const block = blockPosition(plan, today);
  const blockSpec = block ? template.blocks?.[block.type].weeks[block.week] : undefined;
  const retest = block && !inDeload && isRetestWeek(template, block);
  const subtitle = finished
    ? '计划已完成'
    : daysBetween(plan.startDate, today) < 0
      ? `${shortDate(plan.startDate)} 开始`
      : inDeload
        ? '插入的减量周 · 之后的计划顺延一周'
        : block
          ? blockLabel(block, blockSpec)
          : `第 ${week + 1}${total ? ` / ${total}` : ''} 周 · ${PHASE_NAMES[phase]}`;
  // One suggestion per fatigue spell: not while a deload is running or right after one.
  const recentDeload = (plan.deloads ?? []).some((d) => daysBetween(d, today) < DELOAD_DAYS * 2);
  const suggestDeload = readiness.streak >= DELOAD_STREAK && !finished && !recentDeload;

  const planned = planDay(template, plan, selected);
  const workout = byDate.get(selected);
  const isToday = selected === today;
  const shown = planned ? sessionFor(planned, workout, isToday ? readiness.readiness : null) : null;
  const next = planned ? null : nextSession(template, plan, addDays(selected, 1));
  // A rest day today can take a session missed earlier this week.
  const missed = isToday && !planned ? missedThisWeek(template, plan, workouts.map((w) => w.date), today) : [];

  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="查看整个计划" onPress={() => router.push('/plan')} style={styles.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={text.muted}>{subtitle}</Text>
          <Text style={text.heading}>{template.name}</Text>
        </View>
        <Icon name="chevronRight" size={18} color={colors.textMuted} />
      </Pressable>

      {block && plan.blocks && <BlockReason block={plan.blocks[block.index]} />}

      {advice.suggestion && (
        <SuggestionCard suggestion={advice.suggestion} busy={starting} onAccept={() => onSuggestion(true)} onDecline={() => onSuggestion(false)} />
      )}

      {retest && template.blocks && (
        <RetestCard codes={retestCodes(template, block.type, advice.diagnosis)} diagnosis={advice.diagnosis} nextStart={nextBlockStart(plan, today)} />
      )}

      <WeekStrip
        days={weekDays(selected)}
        today={today}
        selected={selected}
        statusOf={statusOf}
        onSelect={onSelect}
        onShift={(n) => onSelect(addDays(selected, n * 7))}
      />

      {isToday && <ReadinessCard readiness={readiness} />}

      {isToday && suggestDeload && (
        <Card style={styles.deload}>
          <Text style={[text.section, { color: colors.warn }]}>建议插入一周减量</Text>
          <Text style={text.muted}>
            最近 {readiness.streak} 次测量都有疲劳信号。从今天起练 {DELOAD_DAYS} 天减量版（组数约 −40%，RPE −1.5，取消最大强度），之后的计划顺延一周。
          </Text>
          <Button label="从今天开始减量周" onPress={onDeload} />
        </Card>
      )}

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
                {planned.session.focus} · {planned.block && !planned.inserted && template.blocks?.[planned.block.type].weeks[planned.block.week].retest ? '减量复测周' : PHASE_NAMES[planned.phase]}
                {planned.inserted ? '（疲劳后插入）' : ''}
              </Text>
            </View>
            <AdjustmentNote
              adjustments={shown.adjustments}
              reason={workout ? workout.reason : readiness.signals.join('；') || null}
              dropPct={workout ? workout.cmjDrop : readiness.dropPct}
            />
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
            {missed.map((m) => (
              <View key={m.date} style={styles.makeUp}>
                <Text style={text.body}>
                  周{WEEKDAY_NAMES[weekday(m.date) - 1]}的 {m.session.code} · {m.session.name} 还没练
                </Text>
                <Button label="今天补练" variant="secondary" busy={starting} onPress={() => onStart(m.date, true)} />
              </View>
            ))}
          </View>
        )}
      </Card>
    </>
  );
}

function ReadinessCard({ readiness }: { readiness: DayReadiness }) {
  const testCmj = () => router.push({ pathname: '/measure/capture', params: { metric: 'cmj', session: newSessionId(), from: 'train' } });

  if (readiness.today == null) {
    return (
      <Card style={styles.readiness}>
        <View style={{ flex: 1, gap: 4 }}>
          {readiness.readiness === 'fatigued' ? (
            <>
              <Text style={[styles.readinessLabel, { color: colors.warn }]}>疲劳信号</Text>
              <Text style={text.muted}>{readiness.signals.join('；')}，今天已自动减量。</Text>
            </>
          ) : (
            <>
              <Text style={text.section}>今日准备度</Text>
              <Text style={text.muted}>练之前测一次 CMJ，状态差的话今天的训练会自动减量。</Text>
            </>
          )}
          <RecoveryLine readiness={readiness} />
        </View>
        <Button label="测 CMJ" onPress={testCmj} style={{ paddingHorizontal: 18 }} />
      </Card>
    );
  }

  const label = { ready: '状态正常', fatigued: '疲劳信号', unknown: '基线不足' }[readiness.readiness];
  const color = { ready: colors.good, fatigued: colors.warn, unknown: colors.textMuted }[readiness.readiness];
  const detail =
    readiness.readiness === 'fatigued'
      ? `${readiness.signals.join('；')}，今天已自动减量`
      : readiness.readiness === 'unknown'
        ? '至少要有 3 天的 CMJ 记录才能判断，先照计划练。'
        : `CMJ 比近期均值${readiness.dropPct > 0 ? '低' : '高'} ${Math.abs(readiness.dropPct * 100).toFixed(1)}%`;

  return (
    <Card style={styles.readiness}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.readinessLabel, { color }]}>{label}</Text>
        <Text style={text.muted}>{detail}</Text>
        <RecoveryLine readiness={readiness} />
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

/** Today's recovery read (HRV, resting HR, sleep), which also counts towards readiness. */
function RecoveryLine({ readiness }: { readiness: DayReadiness }) {
  const r = readiness.recovery;
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push('/recovery')}>
      <Text style={[text.caption, r.status === 'poor' && { color: colors.warn }]}>
        {r.status === 'unknown' ? '记录 HRV 和静息心率，判断会更准 ›' : `恢复：${STATUS_TEXT[r.status].label} ›`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingTop: 28, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  makeUp: { gap: 8, marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.divider },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tag: { fontSize: 12, fontWeight: '700' },
  readiness: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.card },
  readinessLabel: { fontSize: 17, fontWeight: '700' },
  deload: { gap: 10, borderWidth: 1, borderColor: colors.warn },
  cmj: { color: colors.text, fontFamily: fonts.numericBold, fontSize: 32 },
  cmjUnit: { color: colors.textMuted, fontSize: 14 },
});
