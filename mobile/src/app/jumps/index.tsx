import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { loadDiagnosis } from '@/db/dunk';
import { newSessionId } from '@/db/repo';
import { BLOCKS, type DunkDiagnosis } from '@/domain/dunk';
import { APPROACH_TOUCH, DROP_JUMP, JUMP_TESTS, LOADED_SJ, REPEATED_JUMP } from '@/domain/metrics';
import { localized, tr } from '@/i18n';
import { isWeb } from '@/media/runtime';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius } from '@/theme';

/** Multi-step tests that each log several jumps on their own screen. */
const PROFILES = localized([
  { key: 'dj', pathname: '/jumps/dj', short: DROP_JUMP.short, color: DROP_JUMP.color, name: 'DJ 跳深 · 找最佳箱高', hint: '逐级加高箱子，看哪个高度 RSI 最高' },
  { key: 'fvp', pathname: '/jumps/fvp', short: LOADED_SJ.short, color: LOADED_SJ.color, name: '力-速度曲线', hint: '史密斯机负重蹲跳 4 级，看缺力量还是缺速度' },
] as const, 'name', 'hint');

/** Tests the dunk diagnosis is waiting for, or that measure the current limiter. */
function suggested(d: DunkDiagnosis | null): Set<string> {
  const out = new Set<string>();
  if (!d) return out;
  if (d.missing.includes('approach')) out.add(APPROACH_TOUCH.code);
  if (d.missing.includes('cmj')) out.add('cmj');
  if (d.missing.includes('drop_jump') || d.limiter === 'reactive') out.add('dj');
  return out;
}

function gapLine(d: DunkDiagnosis | null): string {
  if (!d || d.gapCm == null) return tr('离扣篮还差多少、缺哪一块');
  const gap = d.gapCm > 0 ? tr('还差 {gapCm} cm', { gapCm: d.gapCm.toFixed(1) }) : tr('够到扣篮线了');
  return d.limiter ? tr('{gap} · 短板：{name}', { gap, name: BLOCKS[d.limiter].name }) : gap;
}

export default function JumpTests() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [diagnosis, setDiagnosis] = useState<DunkDiagnosis | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (current) loadDiagnosis(db, current).then(setDiagnosis);
    }, [db, current]),
  );

  const todo = suggested(diagnosis);
  const capture = (metric: string) => router.push({ pathname: '/measure/capture', params: { metric, session: newSessionId() } });
  const profiles = [...PROFILES].sort((a, b) => Number(todo.has(b.key)) - Number(todo.has(a.key)));

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{tr('扣篮')}</Text>
      <Row icon="plan" color={colors.accent} name={tr('测试日 · 按顺序测完三项')} hint={tr('CMJ → 跳深 → 助跑摸高，视频可以一次多选')} onPress={() => router.push('/test-day')} />
      <Row code={APPROACH_TOUCH.short} color={APPROACH_TOUCH.color} name={APPROACH_TOUCH.name} hint={tr('录像或手填摸到的高度')} tag={todo.has(APPROACH_TOUCH.code)} onPress={() => capture(APPROACH_TOUCH.code)} />
      <Row icon="jump" color={colors.accent} name={tr('扣篮诊断')} hint={gapLine(diagnosis)} onPress={() => router.push('/dunk')} />
      {/* Reads video with the pose model in a WebView: not in the web version. */}
      {!isWeb && <Row code={tr('起跳')} color={colors.purple} name={tr('起跳技术 · 骨架分析')} hint={tr('侧面拍一次助跑起跳，测起跳速度、角度和助跑速度')} onPress={() => router.push('/technique')} />}

      <Text style={styles.heading}>{tr('纵跳')}</Text>
      {JUMP_TESTS.map((t) => (
        <Row key={t.code} code={t.short} color={t.color} name={t.name} tag={todo.has(t.code)} onPress={() => capture(t.code)} />
      ))}
      <View style={styles.note}>
        <Text style={styles.noteText}>{tr('每次测试建议做 3 次，取最好成绩。')}</Text>
      </View>

      <Text style={styles.heading}>{tr('找短板')}</Text>
      {profiles.map((p) => (
        <Row
          key={p.pathname}
          code={p.short}
          color={p.color}
          name={p.name}
          hint={p.hint}
          tag={todo.has(p.key)}
          onPress={() => router.push({ pathname: p.pathname, params: { session: newSessionId() } })}
        />
      ))}
      <Row code={REPEATED_JUMP.short} color={REPEATED_JUMP.color} name={REPEATED_JUMP.name} hint={tr('原地连跳 10 次，看 RSI 和触地稳不稳')} onPress={() => capture(REPEATED_JUMP.code)} />
    </ScrollView>
  );
}

function Row({ code, icon, color, name, hint, tag, onPress }: { code?: string; icon?: 'jump' | 'plan'; color: string; name: string; hint?: string; tag?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" style={({ pressed }) => [styles.row, hint != null && styles.tallRow, pressed && { opacity: 0.75 }]} onPress={onPress}>
      {icon ? (
        <View style={styles.code}>
          <Icon name={icon} size={26} color={color} />
        </View>
      ) : (
        <Text style={[styles.code, { color }]}>{code}</Text>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.name}>{name}</Text>
        {hint != null && <Text style={styles.noteText}>{hint}</Text>}
      </View>
      {tag && <Text style={styles.tag}>{tr('建议测')}</Text>}
      <Icon name="chevronRight" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 8, gap: 10 },
  row: { backgroundColor: colors.surface, borderRadius: radius.row, height: 68, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  tallRow: { height: 76 },
  code: { width: 64, fontFamily: fonts.numericBold, fontSize: 26 },
  name: { color: colors.text, fontSize: 15, fontWeight: '500' },
  note: { paddingHorizontal: 4, paddingTop: 2 },
  heading: { color: colors.text, fontSize: 15, fontWeight: '700', paddingTop: 12, paddingHorizontal: 4 },
  noteText: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  tag: { color: colors.onAccent, backgroundColor: colors.accent, fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
});
