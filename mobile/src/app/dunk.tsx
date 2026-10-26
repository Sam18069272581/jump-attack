import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { DunkPanel } from '@/components/DunkPanel';
import { Button } from '@/components/ui';
import { loadDiagnosis } from '@/db/dunk';
import type { DunkDiagnosis } from '@/domain/dunk';
import { useAthlete } from '@/state/athlete';
import { colors } from '@/theme';

/** How far the athlete is from dunking and which part of their training holds them back. */
export default function Dunk() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [d, setD] = useState<DunkDiagnosis | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (current) loadDiagnosis(db, current).then(setD);
    }, [db, current]),
  );

  if (!d) return <View style={styles.screen} />;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <DunkPanel diagnosis={d} standingReach={current?.standing_reach_cm ?? null} />
      <Button label="改扣篮线" variant="secondary" onPress={() => router.navigate('/me')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 8, gap: 12, paddingBottom: 40 },
});
