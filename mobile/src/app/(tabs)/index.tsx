import { Link, router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DayStateRow } from '@/components/dunk';
import { DunkSummary } from '@/components/DunkPanel';
import { Icon } from '@/components/Icon';
import { PressScale, Rise } from '@/components/motion';
import { ScoreScale } from '@/components/ScoreScale';
import { ReachHero } from '@/components/ReachHero';
import { Card } from '@/components/ui';
import { loadDiagnosis } from '@/db/dunk';
import { listDunkAttempts } from '@/db/dunkAttempts';
import { listPain, setPain } from '@/db/pain';
import { dayState, RIM_CM, type DayState, type DunkDiagnosis } from '@/domain/dunk';
import { addDays } from '@/domain/dates';
import { attemptSummary, BALL_NAME, type AttemptSummary } from '@/domain/dunkAttempts';
import { kneeStatus, PAIN_HINT, PAIN_LIMIT, type PainEntry } from '@/domain/pain';
import { CATEGORIES, SUPPORT_CATEGORIES, type CategoryDef } from '@/domain/metrics';
import { tr } from '@/i18n';
import { useAthlete } from '@/state/athlete';
import { loadGoalSummary } from '@/state/goal';
import { loadReadiness, todayISO } from '@/state/training';
import { colors, radius, text } from '@/theme';

/** Leads with how far the athlete is from dunking; every module below serves that. */
export default function Home() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [goal, setGoal] = useState<{ diagnosis: DunkDiagnosis; state: DayState; attempts: AttemptSummary | null; due: GoalText } | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const [pain, setPainEntries] = useState<PainEntry[]>([]);
  const today = todayISO();
  const main = CATEGORIES.filter((c) => !SUPPORT_CATEGORIES.includes(c.key));
  const support = CATEGORIES.filter((c) => SUPPORT_CATEGORIES.includes(c.key));

  useFocusEffect(
    useCallback(() => {
      if (!current) return;
      const today = todayISO();
      listPain(db, current.id).then(setPainEntries);
      Promise.all([loadDiagnosis(db, current), loadReadiness(db, current.id, today), listDunkAttempts(db, current.id)]).then(async ([diagnosis, readiness, attempts]) =>
        setGoal({
          diagnosis,
          state: dayState(readiness),
          // The goal setup first; practice at a lower rim or with a smaller ball when that is all there is.
          attempts: attemptSummary(attempts, { rimCm: current.rim_height_cm ?? RIM_CM, ball: 'basketball' }) ?? attemptSummary(attempts),
          due: await loadGoalSummary(db, current, diagnosis, today),
        }),
      );
    }, [db, current]),
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {goal && (
          <View style={styles.goal}>
            <ReachHero diagnosis={goal.diagnosis} standingReach={current?.standing_reach_cm ?? null} name={current?.name ?? ''} onSwitchAthlete={() => router.push('/me')} />
            <Rise index={1}>
              <DunkSummary diagnosis={goal.diagnosis} />
            </Rise>
            <Rise index={2}>
              <GoalRow due={goal.due} />
            </Rise>
            <Rise index={2}>
              <AttemptsRow summary={goal.attempts} />
            </Rise>
          </View>
        )}

        {current && (
          <MorningKnee
            entries={pain}
            today={today}
            onPick={async (score) => {
              await setPain(db, current.id, { date: today, kind: 'morning', score });
              setPainEntries(await listPain(db, current.id));
            }}
          />
        )}

        <Rise index={2} style={{ gap: 12 }}>
          <Text style={text.section}>{tr('训练和测试')}</Text>
          {goal && <DayStateRow state={goal.state} />}
          <View style={styles.list}>
            {main.map((c) => (
              <ModuleRow key={c.key} category={c} />
            ))}
            <PressScale accessibilityLabel={tr('辅助')} accessibilityState={{ expanded: supportOpen }} style={styles.support} onPress={() => setSupportOpen((open) => !open)}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.supportTitle}>{tr('辅助')}</Text>
                <Text style={styles.moduleSub} numberOfLines={1}>
                  {support.map((c) => c.name).join(' · ')}
                </Text>
              </View>
              <Icon name={supportOpen ? 'chevronDown' : 'chevronRight'} size={18} color={colors.textMuted} />
            </PressScale>
            {supportOpen && support.map((c) => <ModuleRow key={c.key} category={c} />)}
          </View>
        </Rise>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The morning after training with knee pain recorded: how is it today? The pain-monitoring model reads this
 * against the morning before (domain/pain.ts).
 */
function MorningKnee({ entries, today, onPick }: { entries: PainEntry[]; today: string; onPick: (score: number) => void }) {
  const askedYesterday = entries.some((e) => e.kind === 'session' && e.date === addDays(today, -1));
  if (!askedYesterday) return null;
  const morning = entries.find((e) => e.kind === 'morning' && e.date === today)?.score ?? null;
  const knee = morning != null ? kneeStatus(entries, today) : null;
  return (
    <Card style={{ gap: 8 }}>
      <ScoreScale label={tr('今早膝盖几分')} value={morning} onPick={onPick} hint={tr(PAIN_HINT)} warnAbove={PAIN_LIMIT} />
      {knee?.reasons.map((r) => (
        <Text key={r} style={[text.muted, (knee.light === 'red' || knee.light === 'stop') && { color: colors.warn }]}>
          {r}
        </Text>
      ))}
      {knee?.light === 'green' && <Text style={text.muted}>{tr('膝盖没问题，照常练。')}</Text>}
    </Card>
  );
}

type GoalText = { title: string; lines: string[] };

/** The goal date: the countdown, when the touch trend reaches the line, and what that does to training. Set in 我的. */
function GoalRow({ due }: { due: GoalText }) {
  return (
    <PressScale accessibilityLabel={tr('目标日')} style={styles.module} onPress={() => router.push('/me')}>
      <View style={[styles.tile, { backgroundColor: colors.surfaceRaised }]}>
        <Icon name="plan" size={22} color={colors.accent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.moduleTitle}>{due.title}</Text>
        {due.lines.map((l) => (
          <Text key={l} style={styles.moduleSub}>
            {l}
          </Text>
        ))}
      </View>
      <Icon name="chevronRight" size={18} color={colors.textMuted} />
    </PressScale>
  );
}

/** The real result: recent dunk attempts, and the way into logging them. */
function AttemptsRow({ summary: s }: { summary: AttemptSummary | null }) {
  return (
    <PressScale accessibilityLabel={tr('扣篮尝试')} style={styles.module} onPress={() => router.push('/attempts')}>
      <View style={[styles.tile, { backgroundColor: colors.surfaceRaised }]}>
        <Icon name="jump" size={22} color={colors.rim} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.moduleTitle}>{tr('扣篮尝试')}</Text>
        <Text style={styles.moduleSub} numberOfLines={1}>
          {s ? tr('{rimCm} cm {BALL_NAME}：最近 {total} 次扣进 {made} 次', { rimCm: s.rimCm, BALL_NAME: BALL_NAME[s.ball], total: s.total, made: s.made }) : tr('去篮下试扣，每试一次点一下')}
        </Text>
      </View>
      <Icon name="chevronRight" size={18} color={colors.textMuted} />
    </PressScale>
  );
}

function ModuleRow({ category: c }: { category: CategoryDef }) {
  const href = c.href as Href | null;
  const row = (
    <View style={[styles.module, !href && styles.moduleDisabled]}>
      <View style={[styles.tile, { backgroundColor: c.tile }]}>
        <Icon name={c.icon} size={22} color={c.color} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.moduleTitle}>{c.name}</Text>
        <Text style={styles.moduleSub} numberOfLines={1}>
          {c.subtitle}
        </Text>
      </View>
      {href ? <Icon name="chevronRight" size={18} color={colors.textMuted} /> : <Text style={styles.moduleSub}>{tr('即将上线')}</Text>}
    </View>
  );
  return href ? (
    <Link href={href} asChild>
      <PressScale accessibilityLabel={c.name}>{row}</PressScale>
    </Link>
  ) : (
    <View accessibilityState={{ disabled: true }}>{row}</View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 12, gap: 24 },
  goal: { gap: 12 },
  list: { gap: 10 },
  module: { backgroundColor: colors.surface, borderRadius: radius.row, minHeight: 68, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 14 },
  moduleDisabled: { opacity: 0.5 },
  tile: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  moduleTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  moduleSub: { color: colors.textMuted, fontSize: 12 },
  support: { minHeight: 52, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.row, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 14 },
  supportTitle: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
});
