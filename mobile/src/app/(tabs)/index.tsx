import { Link, router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DunkGoalCard } from '@/components/dunk';
import { Icon } from '@/components/Icon';
import { loadDiagnosis } from '@/db/dunk';
import { dayState, type DayState, type DunkDiagnosis } from '@/domain/dunk';
import { CATEGORIES } from '@/domain/metrics';
import { useAthlete } from '@/state/athlete';
import { loadReadiness, todayISO } from '@/state/training';
import { colors, radius, text } from '@/theme';

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

        {goal && <DunkGoalCard diagnosis={goal.diagnosis} standingReach={current?.standing_reach_cm ?? null} state={goal.state} />}

        <View style={{ gap: 12 }}>
          {CATEGORIES.map((c) => {
            const href = c.href as Href | null;
            const ready = href != null;
            const card = (
              <View style={[styles.card, !ready && styles.cardDisabled]}>
                <View style={[styles.tile, { backgroundColor: c.tile }]}>
                  <Icon name={c.icon} size={28} color={c.color} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.cardTitle}>{c.name}</Text>
                  <Text style={styles.cardSub}>{c.subtitle}</Text>
                </View>
                {ready ? <Icon name="chevronRight" size={18} color={colors.textMuted} /> : <Text style={styles.soon}>即将上线</Text>}
              </View>
            );
            return href ? (
              <Link key={c.key} href={href} asChild>
                <Pressable accessibilityRole="button">{card}</Pressable>
              </Link>
            ) : (
              <View key={c.key} accessibilityState={{ disabled: true }}>
                {card}
              </View>
            );
          })}
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
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 16 },
  cardDisabled: { opacity: 0.5 },
  tile: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  cardSub: { color: colors.textMuted, fontSize: 12 },
  soon: { color: colors.textMuted, fontSize: 11 },
});
