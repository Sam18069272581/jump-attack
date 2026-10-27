import { Link, router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DayStateRow } from '@/components/dunk';
import { DunkHero, DunkSummary } from '@/components/DunkPanel';
import { Icon } from '@/components/Icon';
import { loadDiagnosis } from '@/db/dunk';
import { dayState, type DayState, type DunkDiagnosis } from '@/domain/dunk';
import { CATEGORIES } from '@/domain/metrics';
import { useAthlete } from '@/state/athlete';
import { loadReadiness, todayISO } from '@/state/training';
import { colors, radius, text } from '@/theme';

/** Leads with how far the athlete is from dunking; every module below serves that. */
export default function Home() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [goal, setGoal] = useState<{ diagnosis: DunkDiagnosis; state: DayState } | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!current) return;
      Promise.all([loadDiagnosis(db, current), loadReadiness(db, current.id, todayISO())]).then(([diagnosis, readiness]) =>
        setGoal({ diagnosis, state: dayState(readiness) }),
      );
    }, [db, current]),
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={{ gap: 2, flex: 1 }}>
            <Text style={text.muted}>你好，{current?.name ?? ''}</Text>
            <Text style={text.title}>今天练什么？</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="切换测试对象" style={styles.athlete} onPress={() => router.push('/me')}>
            <Icon name="user" size={16} />
            <Text style={styles.athleteName} numberOfLines={1}>
              {current?.name ?? '—'}
            </Text>
            <Icon name="chevronDown" size={14} />
          </Pressable>
        </View>

        {goal && (
          <View style={styles.goal}>
            <DunkHero diagnosis={goal.diagnosis} standingReach={current?.standing_reach_cm ?? null} />
            <DunkSummary diagnosis={goal.diagnosis} />
          </View>
        )}

        <View style={{ gap: 12 }}>
          <Text style={text.section}>训练和测试</Text>
          {goal && <DayStateRow state={goal.state} />}
          <View style={styles.grid}>
            {CATEGORIES.map((c) => {
              const href = c.href as Href | null;
              const card = (
                <View style={[styles.module, !href && styles.moduleDisabled]}>
                  <View style={[styles.tile, { backgroundColor: c.tile }]}>
                    <Icon name={c.icon} size={22} color={c.color} />
                  </View>
                  <View style={{ gap: 2 }}>
                    <Text style={styles.moduleTitle}>{c.name}</Text>
                    <Text style={styles.moduleSub} numberOfLines={2}>
                      {href ? c.subtitle : '即将上线'}
                    </Text>
                  </View>
                </View>
              );
              return href ? (
                <Link key={c.key} href={href} asChild>
                  <Pressable accessibilityRole="button" accessibilityLabel={c.name} style={({ pressed }) => [styles.cell, pressed && { opacity: 0.75 }]}>
                    {card}
                  </Pressable>
                </Link>
              ) : (
                <View key={c.key} accessibilityState={{ disabled: true }} style={styles.cell}>
                  {card}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 28, gap: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  athlete: { height: 44, maxWidth: 150, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 6 },
  athleteName: { color: colors.text, fontSize: 13, flexShrink: 1 },
  goal: { gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, rowGap: 12 },
  cell: { width: '50%', paddingHorizontal: 6 },
  module: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.card, padding: 14, gap: 12 },
  moduleDisabled: { opacity: 0.5 },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  moduleTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  moduleSub: { color: colors.textMuted, fontSize: 11, lineHeight: 15 },
});
