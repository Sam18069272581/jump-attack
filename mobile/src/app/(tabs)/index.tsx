import { Link, router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DayStateRow } from '@/components/dunk';
import { DunkSummary } from '@/components/DunkPanel';
import { Icon } from '@/components/Icon';
import { PressScale, Rise } from '@/components/motion';
import { ReachHero } from '@/components/ReachHero';
import { loadDiagnosis } from '@/db/dunk';
import { listDunkAttempts } from '@/db/dunkAttempts';
import { dayState, RIM_CM, type DayState, type DunkDiagnosis } from '@/domain/dunk';
import { attemptSummary, BALL_NAME, type AttemptSummary } from '@/domain/dunkAttempts';
import { CATEGORIES, SUPPORT_CATEGORIES, type CategoryDef } from '@/domain/metrics';
import { useAthlete } from '@/state/athlete';
import { loadReadiness, todayISO } from '@/state/training';
import { colors, radius, text } from '@/theme';

/** Leads with how far the athlete is from dunking; every module below serves that. */
export default function Home() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [goal, setGoal] = useState<{ diagnosis: DunkDiagnosis; state: DayState; attempts: AttemptSummary | null } | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const main = CATEGORIES.filter((c) => !SUPPORT_CATEGORIES.includes(c.key));
  const support = CATEGORIES.filter((c) => SUPPORT_CATEGORIES.includes(c.key));

  useFocusEffect(
    useCallback(() => {
      if (!current) return;
      Promise.all([loadDiagnosis(db, current), loadReadiness(db, current.id, todayISO()), listDunkAttempts(db, current.id)]).then(([diagnosis, readiness, attempts]) =>
        setGoal({
          diagnosis,
          state: dayState(readiness),
          // The goal setup first; practice at a lower rim or with a smaller ball when that is all there is.
          attempts: attemptSummary(attempts, { rimCm: current.rim_height_cm ?? RIM_CM, ball: 'basketball' }) ?? attemptSummary(attempts),
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
              <AttemptsRow summary={goal.attempts} />
            </Rise>
          </View>
        )}

        <Rise index={2} style={{ gap: 12 }}>
          <Text style={text.section}>训练和测试</Text>
          {goal && <DayStateRow state={goal.state} />}
          <View style={styles.list}>
            {main.map((c) => (
              <ModuleRow key={c.key} category={c} />
            ))}
            <PressScale accessibilityLabel="辅助" accessibilityState={{ expanded: supportOpen }} style={styles.support} onPress={() => setSupportOpen((open) => !open)}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.supportTitle}>辅助</Text>
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

/** The real result: recent dunk attempts, and the way into logging them. */
function AttemptsRow({ summary: s }: { summary: AttemptSummary | null }) {
  return (
    <PressScale accessibilityLabel="扣篮尝试" style={styles.module} onPress={() => router.push('/attempts')}>
      <View style={[styles.tile, { backgroundColor: colors.surfaceRaised }]}>
        <Icon name="jump" size={22} color={colors.rim} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.moduleTitle}>扣篮尝试</Text>
        <Text style={styles.moduleSub} numberOfLines={1}>
          {s ? `${s.rimCm} cm ${BALL_NAME[s.ball]}：最近 ${s.total} 次扣进 ${s.made} 次` : '去篮下试扣，每试一次点一下'}
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
      {href ? <Icon name="chevronRight" size={18} color={colors.textMuted} /> : <Text style={styles.moduleSub}>即将上线</Text>}
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
