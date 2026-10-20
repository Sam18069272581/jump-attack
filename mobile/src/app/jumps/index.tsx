import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { newSessionId } from '@/db/repo';
import { JUMP_TESTS } from '@/domain/metrics';
import { colors, fonts, radius } from '@/theme';

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
        <Text style={styles.noteText}>每次测试建议做 3 次，取最好成绩。DJ 跳深和 Pogo 连跳需要测触地时间，会在下一版加入。</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 8, gap: 10 },
  row: { backgroundColor: colors.surface, borderRadius: radius.row, height: 68, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  code: { width: 64, fontFamily: fonts.numericBold, fontSize: 26 },
  name: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '500' },
  note: { paddingHorizontal: 4, paddingTop: 8 },
  noteText: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
});
