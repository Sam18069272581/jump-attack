import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { latestResults, type SessionResult } from '@/db/repo';
import { formatValue, getCategory } from '@/domain/metrics';
import { asymmetry, MOBILITY_PAIRS } from '@/domain/mobility';
import { tr } from '@/i18n';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius, text } from '@/theme';

const COLOR = getCategory('mobility').color;

export default function Mobility() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [latest, setLatest] = useState<Record<string, SessionResult>>({});

  useFocusEffect(
    useCallback(() => {
      if (current) latestResults(db, current.id, 'mob_%').then(setLatest);
    }, [db, current]),
  );

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.table}>
        <View style={[styles.row, styles.head]}>
          <Text style={[text.caption, { flex: 1 }]}>{tr('测试项目')}</Text>
          <Text style={[text.caption, styles.side]}>{tr('左')}</Text>
          <Text style={[text.caption, styles.side]}>{tr('右')}</Text>
        </View>
        {MOBILITY_PAIRS.map((t) => {
          const l = latest[t.left.code]?.best;
          const r = latest[t.right.code]?.best;
          const a = l != null && r != null ? asymmetry(t, l, r) : null;
          const note = a?.flagged ? tr('左右差 {p} · {use}', { p: a.pct != null ? `${Math.round(a.pct * 100)}%` : `${formatValue(t.left, a.diff)}${t.unit}`, use: t.use }) : t.use;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="button"
              accessibilityLabel={tr('{name}，记录左右侧', { name: t.name })}
              onPress={() => router.push({ pathname: '/mobility/[test]', params: { test: t.key } })}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}
            >
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.name}>{t.name}</Text>
                <Text style={[styles.note, a?.flagged && { color: colors.warn }]}>{note}</Text>
              </View>
              <Text style={[styles.value, styles.side]}>{l != null ? `${formatValue(t.left, l)}${t.unit}` : '—'}</Text>
              <Text style={[styles.value, styles.side]}>{r != null ? `${formatValue(t.right, r)}${t.unit}` : '—'}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.foot}>{tr('左右差 ≥ 10% 标橙色提醒。点击项目记录左右两侧，角度可以用手机量角。')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 8, gap: 12 },
  table: { backgroundColor: colors.surface, borderRadius: radius.card, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  head: { paddingVertical: 10 },
  side: { width: 56, textAlign: 'right' },
  name: { color: colors.text, fontSize: 14, fontWeight: '500' },
  note: { color: colors.textMuted, fontSize: 11 },
  value: { color: COLOR, fontFamily: fonts.numeric, fontSize: 18 },
  foot: { color: colors.textMuted, fontSize: 12, lineHeight: 18, paddingHorizontal: 4 },
});
