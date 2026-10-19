import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { TrendChart } from '@/components/TrendChart';
import { Empty } from '@/components/ui';
import { listSessionResults, type SessionResult } from '@/db/repo';
import { JUMP_TESTS, formatValue } from '@/domain/metrics';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius, text } from '@/theme';

type Row = { code: string; name: string; unit: string; color: string; results: SessionResult[] };

export default function History() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [rows, setRows] = useState<Row[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!current) return;
      Promise.all(JUMP_TESTS.map(async (m) => ({ code: m.code, name: m.name, unit: m.unit, color: m.color, results: await listSessionResults(db, current.id, m.code, m.lowerIsBetter) }))).then(setRows);
    }, [db, current]),
  );

  const featured = rows.find((r) => r.code === 'cmj');
  const recentCmj = featured?.results.slice(-8) ?? [];
  const latest = recentCmj.at(-1);
  const change = recentCmj.length > 1 ? latest!.best - recentCmj[0].best : null;
  const withData = rows.filter((r) => r.results.length > 0);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={text.title}>历史</Text>

        {latest ? (
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/history/[metric]', params: { metric: 'cmj' } })} style={styles.featured}>
            <View style={styles.featuredTop}>
              <Text style={text.muted}>CMJ 反向跳</Text>
              {change != null && (
                <Text style={{ fontSize: 12, color: change >= 0 ? colors.good : colors.warn }}>
                  近 {recentCmj.length} 次 {change >= 0 ? '+' : '−'}
                  {Math.abs(change).toFixed(1)} cm
                </Text>
              )}
            </View>
            <Text style={styles.featuredValue}>
              {latest.best.toFixed(1)} <Text style={styles.featuredUnit}>cm</Text>
            </Text>
            <TrendChart points={recentCmj.map((r) => ({ label: '', value: r.best, display: '' }))} height={90} showLabels={false} />
            <Text style={text.caption}>点击查看每次数据</Text>
          </Pressable>
        ) : (
          <Empty title="还没有记录" hint="去首页做一次跳跃测试，成绩会出现在这里。" />
        )}

        {withData.length > 0 && (
          <View style={{ gap: 10 }}>
            <Text style={text.section}>跳跃测试</Text>
            {withData.map((r) => {
              const last = r.results.at(-1)!;
              const def = JUMP_TESTS.find((m) => m.code === r.code)!;
              return (
                <Pressable key={r.code} accessibilityRole="button" onPress={() => router.push({ pathname: '/history/[metric]', params: { metric: r.code } })} style={styles.row}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rowName}>{r.name}</Text>
                    <Text style={text.caption}>{r.results.length} 次测试</Text>
                  </View>
                  <Text style={[styles.rowValue, { color: r.color }]}>
                    {formatValue(def, last.best)} <Text style={styles.rowUnit}>{r.unit}</Text>
                  </Text>
                  <Icon name="chevronRight" size={18} color={colors.textMuted} />
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 28, gap: 20 },
  featured: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, gap: 8 },
  featuredTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  featuredValue: { color: colors.accent, fontFamily: fonts.numericBold, fontSize: 56, lineHeight: 60 },
  featuredUnit: { color: colors.textMuted, fontSize: 18 },
  row: { backgroundColor: colors.surface, borderRadius: radius.row, height: 68, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowName: { color: colors.text, fontSize: 15, fontWeight: '500' },
  rowValue: { fontFamily: fonts.numeric, fontSize: 20 },
  rowUnit: { color: colors.textMuted, fontSize: 13 },
});
