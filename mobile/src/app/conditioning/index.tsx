import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { CONDITIONING_TESTS } from '@/domain/metrics';
import { localized, tr } from '@/i18n';
import { colors, fonts, radius, text } from '@/theme';

const GROUPS = localized([
  { title: '有氧能力 · VO2max', codes: ['yoyo_ir1', 'cooper'] },
  { title: '反复冲刺能力 · RSA', codes: ['rsa'] },
], 'title');

const ROUTES = { yoyo_ir1: '/conditioning/yoyo', cooper: '/conditioning/cooper', rsa: '/conditioning/rsa' } as const;

export default function ConditioningTests() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {GROUPS.map((g) => (
        <View key={g.title} style={{ gap: 10 }}>
          <Text style={text.section}>{g.title}</Text>
          {CONDITIONING_TESTS.filter((t) => g.codes.includes(t.code)).map((t) => (
            <Pressable
              key={t.code}
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}
              onPress={() => router.push(ROUTES[t.code as keyof typeof ROUTES])}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <View style={styles.titleRow}>
                  <Text style={[styles.code, { color: t.color }]}>{t.short}</Text>
                  <Text style={styles.name}>{t.name}</Text>
                </View>
                <Text style={styles.summary}>{t.summary}</Text>
                <Text style={text.caption}>{t.kit}</Text>
              </View>
              <Icon name="chevronRight" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>
      ))}
      <Text style={styles.note}>{tr('两种 VO2max 都是按跑动距离估算的，适合看自己前后的变化。Yo-Yo 的间歇跑动更接近球类比赛，有田径场时 Cooper 更省事。同一种测试隔 4–6 周复测一次，尽量在同一场地、同一时段。')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 8, gap: 20 },
  row: { backgroundColor: colors.surface, borderRadius: radius.row, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  code: { fontFamily: fonts.numericBold, fontSize: 22 },
  name: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  summary: { color: colors.textSoft, fontSize: 13, lineHeight: 19 },
  note: { color: colors.textMuted, fontSize: 12, lineHeight: 18, paddingHorizontal: 4 },
});
