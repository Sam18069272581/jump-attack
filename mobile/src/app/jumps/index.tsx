import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { newSessionId } from '@/db/repo';
import { DROP_JUMP, JUMP_TESTS } from '@/domain/metrics';
import { colors, fonts, radius } from '@/theme';

/** Multi-step tests that each log several jumps on their own screen. */
const PROFILES = [
  { pathname: '/jumps/fvp', short: 'F-V', color: '#4FD1FF', name: '力-速度曲线', hint: '史密斯机负重蹲跳 4 级，看缺力量还是缺速度' },
  { pathname: '/jumps/dj', short: DROP_JUMP.short, color: DROP_JUMP.color, name: 'DJ 跳深 · 找最佳箱高', hint: '逐级加高箱子，看哪个高度 RSI 最高' },
] as const;

export default function JumpTests() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {JUMP_TESTS.map((t) => (
        <Pressable
          key={t.code}
          accessibilityRole="button"
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}
          onPress={() => router.push({ pathname: '/measure/capture', params: { metric: t.code, session: newSessionId() } })}
        >
          <Text style={[styles.code, { color: t.color }]}>{t.short}</Text>
          <Text style={styles.name}>{t.name}</Text>
          <Icon name="chevronRight" size={18} color={colors.textMuted} />
        </Pressable>
      ))}
      <View style={styles.note}>
        <Text style={styles.noteText}>每次测试建议做 3 次，取最好成绩。</Text>
      </View>

      <Text style={styles.heading}>找短板</Text>
      {PROFILES.map((p) => (
        <Pressable
          key={p.pathname}
          accessibilityRole="button"
          style={({ pressed }) => [styles.row, styles.profileRow, pressed && { opacity: 0.75 }]}
          onPress={() => router.push({ pathname: p.pathname, params: { session: newSessionId() } })}
        >
          <Text style={[styles.code, { color: p.color }]}>{p.short}</Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.name}>{p.name}</Text>
            <Text style={styles.noteText}>{p.hint}</Text>
          </View>
          <Icon name="chevronRight" size={18} color={colors.textMuted} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 8, gap: 10 },
  row: { backgroundColor: colors.surface, borderRadius: radius.row, height: 68, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  code: { width: 64, fontFamily: fonts.numericBold, fontSize: 26 },
  name: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '500' },
  note: { paddingHorizontal: 4, paddingTop: 8 },
  heading: { color: colors.text, fontSize: 15, fontWeight: '700', paddingTop: 12, paddingHorizontal: 4 },
  profileRow: { height: 76 },
  noteText: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
});
