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
import { listPain } from '@/db/pain';
import { insertDeload } from '@/db/training';
import { addDays, daysBetween, shortDate, weekday, weekdayNames, type ISODate } from '@/domain/dates';
import { isRetestWeek, nextBlockStart, retestCodes } from '@/domain/blocks';
import { blockPosition, DELOAD_DAYS, missedThisWeek, nextSession, PHASE_NAMES, planDay, planFinished, planPosition, planWeekOf, planWeeks, weekDays } from '@/domain/plan';
import { APPROACH_TOUCH } from '@/domain/metrics';
import { loadNote } from '@/domain/load';
import { kneeStatus, type PainEntry } from '@/domain/pain';
import { DELOAD_STREAK } from '@/domain/readiness';
import { STATUS_TEXT } from '@/domain/recovery';
import { tr } from '@/i18n';
import { useAthlete } from '@/state/athlete';
import { acceptBlockSuggestion, declineBlockSuggestion, loadBlockAdvice, type BlockAdvice } from '@/state/blocks';
import { loadTrainingLoads } from '@/state/load';
import { beginWorkout, loadReadiness, loadTraining, sessionFor, todayISO, type DayReadiness, type TrainingData } from '@/state/training';
import { colors, fonts, radius, text } from '@/theme';

type LoadLine = { text: string; high: boolean };
type Loaded = { data: TrainingData | null; readiness: DayReadiness & { streak: number }; advice: BlockAdvice; pain: PainEntry[]; loads: LoadLine[] };

export default function Train() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const today = todayISO();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<ISODate>(today);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    if (!current) return;
    const [data, readiness, pain, loads] = await Promise.all([
      loadTraining(db, current.id),
      loadReadiness(db, current.id, todayISO()),
      listPain(db, current.id),
      loadTrainingLoads(db, current.id),
    ]);
    const advice = data ? await loadBlockAdvice(db, current, data, todayISO()) : { diagnosis: null, suggestion: null };
    const notes = loads.map((l) => loadNote(l.name, l.entries, todayISO())).filter((n): n is LoadLine => n != null);
    setLoaded({ data, readiness, advice, pain, loads: notes });
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

  const { data, readiness, advice, pain, loads } = loaded;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {data ? (
          <PlanView
            data={data}
            readiness={readiness}
            advice={advice}
            pain={pain}
            loads={loads}
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
                Alert.alert(tr('无法开始训练'), String(e));
              } finally {
                setStarting(false);
              }
            }}
          />
        ) : (
          <>
            <Text style={text.title}>{tr('训练')}</Text>
            <ReadinessCard readiness={readiness} loads={loads} />
            <Card style={{ gap: 12 }}>
              <Text style={text.section}>{tr('还没有训练计划')}</Text>
              <Text style={text.muted}>{tr('选一个模板，按你的训练日生成每周的训练。每次练之前测一次 CMJ，状态差时自动减量。')}</Text>
              <Button label={tr('选择训练计划')} onPress={() => router.push('/plan/new')} />
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
  pain,
  loads,
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
  pain: PainEntry[];
  loads: LoadLine[];
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
    ? tr('计划已完成')
    : daysBetween(plan.startDate, today) < 0
      ? tr('{startDate} 开始', { startDate: shortDate(plan.startDate) })
      : inDeload
        ? tr('插入的减量周 · 之后的计划顺延一周')
        : block
          ? blockLabel(block, blockSpec)
          : tr('第 {week}{p} 周 · {PHASE_NAMES}', { week: week + 1, p: total ? ` / ${total}` : '', PHASE_NAMES: PHASE_NAMES[phase] });
  // One suggestion per fatigue spell: not while a deload is running or right after one.
  const recentDeload = (plan.deloads ?? []).some((d) => daysBetween(d, today) < DELOAD_DAYS * 2);
  const suggestDeload = readiness.streak >= DELOAD_STREAK && !finished && !recentDeload;

  const planned = planDay(template, plan, selected);
  const workout = byDate.get(selected);
  const isToday = selected === today;
  const knee = kneeStatus(pain, selected);
  const shown = planned ? sessionFor(planned, workout, isToday ? readiness.readiness : null, knee?.light) : null;
  const next = planned ? null : nextSession(template, plan, addDays(selected, 1));
  // A rest day today can take a session missed earlier this week.
  const missed = isToday && !planned ? missedThisWeek(template, plan, workouts.map((w) => w.date), today) : [];

  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={tr('查看整个计划')} onPress={() => router.push('/plan')} style={styles.header}>
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

      {isToday && <ReadinessCard readiness={readiness} loads={loads} />}

      {isToday && (knee?.light === 'yellow' || knee?.light === 'stop') && (
        <Card style={{ gap: 4 }}>
          <Text style={[text.section, knee.light === 'stop' && { color: colors.warn }]}>{knee.light === 'stop' ? tr('膝盖：暂停跳跃') : tr('膝盖：黄灯')}</Text>
          {knee.reasons.map((r) => (
            <Text key={r} style={text.muted}>
              {r}
            </Text>
          ))}
        </Card>
      )}

      {isToday && suggestDeload && (
        <Card style={styles.deload}>
          <Text style={[text.section, { color: colors.warn }]}>{tr('建议插入一周减量')}</Text>
          <Text style={text.muted}>{tr('最近 {streak} 次测量都有疲劳信号。从今天起练 {DELOAD_DAYS} 天减量版（组数约 −40%，RPE −1.5，取消最大强度），之后的计划顺延一周。', { streak: readiness.streak, DELOAD_DAYS })}</Text>
          <Button label={tr('从今天开始减量周')} onPress={onDeload} />
        </Card>
      )}

      <Card style={{ gap: 12 }}>
        <View style={styles.dayHead}>
          <Text style={text.muted}>{isToday ? tr('今天') : shortDate(selected)}</Text>
          {workout?.finishedAt ? <Text style={[styles.tag, { color: colors.good }]}>{tr('已完成')}</Text> : workout ? <Text style={[styles.tag, { color: colors.warn }]}>{tr('进行中')}</Text> : null}
        </View>
        {planned && shown ? (
          <>
            <View style={{ gap: 2 }}>
              <Text style={text.heading}>
                {planned.session.code} · {planned.session.name}
              </Text>
              <Text style={text.muted}>
                {planned.session.focus} ·{' '}
                {planned.goal === 'test'
                  ? tr('目标日')
                  : planned.goal === 'taper'
                    ? tr('赛前减量：量减半，强度不变')
                    : planned.block && !planned.inserted && template.blocks?.[planned.block.type].weeks[planned.block.week].retest
                      ? tr('减量复测周')
                      : PHASE_NAMES[planned.phase]}
                {planned.inserted && !planned.goal ? tr('（疲劳后插入）') : ''}
              </Text>
            </View>
            <AdjustmentNote
              adjustments={shown.adjustments}
              reason={workout ? workout.reason : readiness.signals.join(tr('；')) || null}
              dropPct={workout ? workout.cmjDrop : readiness.dropPct}
              kneeReasons={knee?.reasons}
            />
            <SessionItems session={shown.session} />
            {planned.goal === 'test' ? (
              <TestDayActions today={isToday} />
            ) : daysBetween(selected, today) >= 0 ? (
              <Button
                label={workout?.finishedAt ? tr('查看训练记录') : workout ? tr('继续训练') : isToday ? tr('开始训练') : tr('补记这次训练')}
                variant={workout?.finishedAt ? 'secondary' : 'primary'}
                busy={starting}
                onPress={() => onStart(selected)}
              />
            ) : (
              <Text style={text.caption}>{tr('到那天再开始')}</Text>
            )}
          </>
        ) : (
          <View style={{ gap: 4 }}>
            <Text style={text.heading}>{finished && daysBetween(selected, today) <= 0 ? tr('计划已完成') : tr('休息日')}</Text>
            <Text style={text.muted}>
              {next ? tr('下次：{date} · {code} {name}', { date: shortDate(next.date), code: next.session.code, name: next.session.name }) : finished ? tr('测一次 CMJ 看看提升，再选下一个计划。') : ''}
            </Text>
            {missed.map((m) => (
              <View key={m.date} style={styles.makeUp}>
                <Text style={text.body}>{tr('周{day}的 {code} · {name} 还没练', { day: weekdayNames()[weekday(m.date) - 1], code: m.session.code, name: m.session.name })}</Text>
                <Button label={tr('今天补练')} variant="secondary" busy={starting} onPress={() => onStart(m.date, true)} />
              </View>
            ))}
          </View>
        )}
      </Card>
    </>
  );
}

/** The goal day is the real test: the touch test, then attempts at the rim. Nothing to tick off as a workout. */
function TestDayActions({ today }: { today: boolean }) {
  if (!today) return <Text style={text.caption}>{tr('到那天：热身，测助跑摸高，再去篮下试扣。')}</Text>;
  return (
    <View style={{ gap: 10 }}>
      <Button label={tr('测助跑摸高')} onPress={() => router.push({ pathname: '/measure/capture', params: { metric: APPROACH_TOUCH.code, session: newSessionId(), from: 'train' } })} />
      <Button label={tr('记扣篮尝试')} variant="secondary" onPress={() => router.push('/attempts')} />
    </View>
  );
}

function ReadinessCard({ readiness, loads }: { readiness: DayReadiness; loads: LoadLine[] }) {
  const testCmj = () => router.push({ pathname: '/measure/capture', params: { metric: 'cmj', session: newSessionId(), from: 'train' } });

  if (readiness.today == null) {
    return (
      <Card style={styles.readiness}>
        <View style={{ flex: 1, gap: 4 }}>
          {readiness.readiness === 'fatigued' ? (
            <>
              <Text style={[styles.readinessLabel, { color: colors.warn }]}>{tr('疲劳信号')}</Text>
              <Text style={text.muted}>{tr('{signals}，今天已自动减量。', { signals: readiness.signals.join(tr('；')) })}</Text>
            </>
          ) : (
            <>
              <Text style={text.section}>{tr('今日准备度')}</Text>
              <Text style={text.muted}>{tr('练之前测一次 CMJ，状态差的话今天的训练会自动减量。')}</Text>
            </>
          )}
          <RecoveryLine readiness={readiness} />
          <LoadLines loads={loads} />
        </View>
        <Button label={tr('测 CMJ')} onPress={testCmj} style={{ paddingHorizontal: 18 }} />
      </Card>
    );
  }

  const label = { ready: tr('状态正常'), fatigued: tr('疲劳信号'), unknown: tr('基线不足') }[readiness.readiness];
  const color = { ready: colors.good, fatigued: colors.warn, unknown: colors.textMuted }[readiness.readiness];
  const detail =
    readiness.readiness === 'fatigued'
      ? tr('{signals}，今天已自动减量', { signals: readiness.signals.join(tr('；')) })
      : readiness.readiness === 'unknown'
        ? tr('至少要有 3 天的 CMJ 记录才能判断，先照计划练。')
        : tr('CMJ 比近期均值{p} {dropPct}%', { p: readiness.dropPct > 0 ? tr('低') : tr('高'), dropPct: Math.abs(readiness.dropPct * 100).toFixed(1) });

  return (
    <Card style={styles.readiness}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.readinessLabel, { color }]}>{label}</Text>
        <Text style={text.muted}>{detail}</Text>
        <RecoveryLine readiness={readiness} />
        <LoadLines loads={loads} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={tr('再测一次 CMJ')} onPress={testCmj} style={{ alignItems: 'flex-end' }}>
        <Text style={styles.cmj}>
          {readiness.today.toFixed(1)}
          <Text style={styles.cmjUnit}> cm</Text>
        </Text>
        <Text style={text.caption}>{tr('今日 CMJ 均值')}</Text>
      </Pressable>
    </Card>
  );
}

/** Training load this week against usual (domain/load.ts); well above usual counts only with another signal. */
function LoadLines({ loads }: { loads: LoadLine[] }) {
  return loads.map((l) => (
    <Text key={l.text} style={[text.caption, l.high && { color: colors.warn }]}>
      {l.text}
    </Text>
  ));
}

/** Today's recovery read (HRV, resting HR, sleep), which also counts towards readiness. */
function RecoveryLine({ readiness }: { readiness: DayReadiness }) {
  const r = readiness.recovery;
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push('/recovery')}>
      <Text style={[text.caption, r.status === 'poor' && { color: colors.warn }]}>
        {r.status === 'unknown' ? tr('记录 HRV 和静息心率，判断会更准 ›') : tr('恢复：{label} ›', { label: STATUS_TEXT[r.status].label })}
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
