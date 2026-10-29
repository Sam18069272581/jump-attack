import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { DunkPanel } from '@/components/DunkPanel';
import { Button, Card } from '@/components/ui';
import { loadDiagnosis } from '@/db/dunk';
import type { DunkDiagnosis } from '@/domain/dunk';
import { tr } from '@/i18n';
import { useAthlete } from '@/state/athlete';
import { loadMassGain } from '@/state/bodyMass';
import { colors, text } from '@/theme';

/** How far the athlete is from dunking and which part of their training holds them back. */
export default function Dunk() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [d, setD] = useState<DunkDiagnosis | null>(null);
  const [mass, setMass] = useState<{ text: string; estimated: boolean } | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!current) return;
      loadDiagnosis(db, current).then(setD);
      loadMassGain(db, current).then(setMass);
    }, [db, current]),
  );

  if (!d) return <View style={styles.screen} />;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <DunkPanel diagnosis={d} standingReach={current?.standing_reach_cm ?? null} />
      {mass && (
        <Card style={{ gap: 4 }}>
          <Text style={text.section}>{tr('体重')}</Text>
          <Text style={mass.estimated ? text.body : text.muted}>{mass.text}</Text>
          <Text style={text.caption}>{tr('只是估算，不改诊断。')}</Text>
        </Card>
      )}
      <Button label={tr('改扣篮线')} variant="secondary" onPress={() => router.navigate('/me')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 8, gap: 12, paddingBottom: 40 },
});
