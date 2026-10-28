import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Button } from '@/components/ui';
import type { TeamRow } from '@/domain/team';
import { useAthlete } from '@/state/athlete';
import { loadTeam } from '@/state/team';
import { colors, fonts, radius, text } from '@/theme';

/** The coach's view: everyone on this phone, how far each is from their dunk line, what holds them back, recent touches. */
export default function Team() {
  const db = useSQLiteContext();
  const { athletes, select } = useAthlete();
  const [rows, setRows] = useState<TeamRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadTeam(db, athletes).then(setRows);
    }, [db, athletes]),
  );

  const open = (id: number) => {
    select(id);
    router.push('/dunk');
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={text.muted}>按离各自扣篮线的差距排，扣篮线按每个人自己的篮筐高度和过筐余量算。点一个人看他的扣篮诊断。</Text>
      {rows.map((row) => (
        <Member key={row.id} row={row} onPress={() => open(row.id)} />
      ))}
      <Button label="测试日 · 全队轮流测" variant="secondary" onPress={() => router.push('/test-day')} />
    </ScrollView>
  );
}

function Member({ row, onPress }: { row: TeamRow; onPress: () => void }) {
  const change = row.change == null ? null : `${row.change > 0 ? '+' : ''}${row.change.toFixed(1)}`;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`看 ${row.name} 的扣篮诊断`} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}>
      <Text style={styles.rank}>{row.rank ?? '–'}</Text>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.line}>
          <Text style={styles.name}>{row.name}</Text>
          <Text style={[styles.gap, row.gap.startsWith('过线') && { color: colors.good }]}>{row.gap}</Text>
        </View>
        <Text style={styles.detail}>{row.weakness.startsWith('先测') ? row.weakness : `短板：${row.weakness}`}</Text>
        {row.recent.length > 0 && (
          <View style={styles.line}>
            <Text style={styles.detail}>{row.recent.map((t) => t.value.toFixed(1)).join(' · ')}</Text>
            {change && <Text style={[styles.detail, { color: row.change! > 0 ? colors.good : row.change! < 0 ? colors.warn : colors.textMuted }]}>{change}</Text>}
            <Text style={[styles.detail, { marginLeft: 'auto' }]}>{shortDate(row.lastAt!)}</Text>
          </View>
        )}
      </View>
      <Icon name="chevronRight" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 12, gap: 12 },
  row: { backgroundColor: colors.surface, borderRadius: radius.row, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  rank: { width: 28, textAlign: 'center', color: colors.accent, fontFamily: fonts.numericBold, fontSize: 24 },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  name: { color: colors.text, fontSize: 15, fontWeight: '600' },
  gap: { marginLeft: 'auto', color: colors.text, fontFamily: fonts.numeric, fontSize: 18 },
  detail: { color: colors.textMuted, fontSize: 12 },
});
