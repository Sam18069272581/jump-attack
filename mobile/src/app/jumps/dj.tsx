import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Button, Card, Chip } from '@/components/ui';
import { addDropJump, listDropJumps, type DropJumpTrial } from '@/db/jumps';
import { deleteTrial } from '@/db/repo';
import { BOX_HEIGHTS_CM, dropJump, FAST_CONTACT_S, flightFromHeight, ladder, type DropJumpProblem } from '@/domain/dropJump';
import { parseNumber } from '@/domain/entry';
import { DROP_JUMP } from '@/domain/metrics';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, text } from '@/theme';

const COLOR = DROP_JUMP.color;
const PROBLEMS: Partial<Record<DropJumpProblem, string>> = {
  'contact-short': '触地不到 80 ms，检查一下数字',
  'contact-long': '触地超过 1 秒，这是下蹲而不是反弹',
  'flight-short': '跳高太低，检查一下数字',
  'flight-long': '跳高超出范围，检查一下数字',
};

/** Drop jumps from rising boxes: RSI at each height, and the height where it peaks. */
export default function DropJumpLadder() {
  const { session } = useLocalSearchParams<{ session: string }>();
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [all, setAll] = useState<DropJumpTrial[]>([]);
  const [box, setBox] = useState(BOX_HEIGHTS_CM[0]);
  const [contact, setContact] = useState('');
  const [cm, setCm] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (current) setAll(await listDropJumps(db, current.id));
  }, [db, current]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const today = all.filter((j) => j.session_id === session);
  const result = ladder(today);
  const contactMs = parseNumber(contact);
  const heightCm = parseNumber(cm);
  const typed = contactMs != null && heightCm != null && heightCm > 0 ? dropJump(contactMs / 1000, flightFromHeight(heightCm)) : null;
  const scale = Math.max(...result.steps.map((s) => s.rsi), 0.1) * 1.1;

  async function logManual() {
    if (!current || !typed?.ok) return;
    setSaving(true);
    try {
      await addDropJump(db, current.id, session, { boxCm: box, rsi: typed.value.rsi, contactMs: contactMs!, heightCm: typed.value.heightCm, flightS: typed.value.flightS });
      Haptics.selectionAsync();
      setContact('');
      setCm('');
      await reload();
    } catch (e) {
      Alert.alert('保存失败', String(e));
    } finally {
      setSaving(false);
    }
  }

  function measureVideo() {
    router.push({ pathname: '/measure/capture', params: { metric: DROP_JUMP.code, session, from: 'dj', box: String(box) } });
  }

  function remove(j: DropJumpTrial) {
    Alert.alert(`删除 ${j.boxCm} cm 的这一跳？`, '', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => (await deleteTrial(db, j.id), reload()) },
    ]);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text style={text.muted}>
          从 {BOX_HEIGHTS_CM[0]} cm 开始，每级加 10 cm，每级跳 2 次。从箱子上迈出落下，一着地就尽快弹起，双手叉腰。RSI 开始下降、或触地超过 {FAST_CONTACT_S * 1000} ms 就不用再加高。
        </Text>

        {result.steps.length > 0 && (
          <Card style={{ gap: 4 }}>
            {result.steps.map((s) => {
              const isBest = s === result.best;
              return (
                <View key={s.boxCm} style={styles.stepRow}>
                  <Text style={styles.box}>{s.boxCm} cm</Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.bar, { width: `${(s.rsi / scale) * 100}%`, backgroundColor: isBest ? COLOR : colors.textFaint }]} />
                  </View>
                  <View style={{ width: 92, alignItems: 'flex-end' }}>
                    <Text style={[styles.rsi, isBest && { color: COLOR }]}>{s.rsi.toFixed(2)}</Text>
                    <Text style={[text.caption, s.contactMs > FAST_CONTACT_S * 1000 && { color: colors.warn }]}>
                      {s.contactMs} ms · {s.heightCm.toFixed(1)} cm
                    </Text>
                  </View>
                </View>
              );
            })}
            <View style={styles.jumps}>
              {today.map((j) => (
                <Pressable key={j.id} accessibilityRole="button" accessibilityLabel={`删除 ${j.boxCm} cm 的 RSI ${j.rsi.toFixed(2)}`} onPress={() => remove(j)} style={styles.jump}>
                  <Text style={styles.jumpText}>
                    {j.boxCm}: {j.rsi.toFixed(2)}
                  </Text>
                  <Icon name="trash" size={12} color={colors.textMuted} />
                </Pressable>
              ))}
            </View>
            <Text style={text.caption}>每级显示最好的一跳：RSI、触地时间、跳高。</Text>
          </Card>
        )}

        {result.best && (
          <Card style={{ gap: 8 }}>
            <Text style={text.section}>最佳跳深高度</Text>
            <Text style={styles.bestBox}>
              {result.best.boxCm} <Text style={styles.unit}>cm</Text>
            </Text>
            <Text style={text.body}>
              这个高度的 RSI 最高（{result.best.rsi.toFixed(2)}）。做跳深训练就用这个高度的箱子。
            </Text>
            {result.tryHigher && <Text style={text.muted}>RSI 在你试过的最高一级还在涨，下次可以再加一级看看。</Text>}
            {result.slowContact && (
              <Text style={[text.muted, { color: colors.warn }]}>
                最好那一跳触地 {result.best.contactMs} ms，超过 {FAST_CONTACT_S * 1000} ms，用的是慢速反弹。先降低箱高，练「一碰就走」的快速离地。
              </Text>
            )}
          </Card>
        )}

        <Card style={{ gap: 12 }}>
          <Text style={text.section}>下一跳</Text>
          <View style={styles.chips}>
            {BOX_HEIGHTS_CM.map((h) => (
              <Chip key={h} label={`${h}`} selected={box === h} onPress={() => setBox(h)} color={COLOR} />
            ))}
          </View>
          <Button label={`录像测 ${box} cm 这一跳`} onPress={measureVideo} />
          <View style={styles.fields}>
            <Field label="触地（手填）" unit="ms" value={contact} onChange={setContact} />
            <Field label="跳高（手填）" unit="cm" value={cm} onChange={setCm} />
          </View>
          {typed && !typed.ok && PROBLEMS[typed.problem] ? <Text style={styles.problem}>{PROBLEMS[typed.problem]}</Text> : null}
          <Button label="记手填的这一跳" variant="secondary" onPress={logManual} disabled={!typed?.ok} busy={saving} />
          <Text style={text.caption}>录像要拍到箱子边缘和落地点。用 My Jump 等 App 测过的触地时间和跳高也可以直接手填。</Text>
        </Card>

        <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/history/[metric]', params: { metric: DROP_JUMP.code } })}>
          <Text style={styles.link}>查看 RSI 历史趋势</Text>
        </Pressable>
      </ScrollView>
      <View style={styles.footer}>
        <Button label="完成" variant={today.length ? 'primary' : 'secondary'} onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

function Field({ label, unit, value, onChange }: { label: string; unit: string; value: string; onChange: (s: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={text.caption}>{label}</Text>
      <View style={styles.fieldRow}>
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          placeholder="—"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          accessibilityLabel={`${label}（${unit}）`}
        />
        <Text style={styles.unit}>{unit}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  box: { width: 56, color: colors.text, fontFamily: fonts.numeric, fontSize: 18 },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.bg, overflow: 'hidden' },
  bar: { height: 10, borderRadius: 5 },
  rsi: { color: colors.text, fontFamily: fonts.numericBold, fontSize: 20 },
  jumps: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 6 },
  jump: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 28, borderRadius: 14, backgroundColor: colors.surfaceRaised },
  jumpText: { color: colors.textSoft, fontFamily: fonts.numeric, fontSize: 14 },
  bestBox: { color: COLOR, fontFamily: fonts.numericBold, fontSize: 48, lineHeight: 52 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fields: { flexDirection: 'row', gap: 10 },
  field: { flex: 1, gap: 4 },
  fieldRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  input: { flex: 1, height: 44, borderRadius: 12, backgroundColor: colors.surfaceRaised, color: colors.text, fontFamily: fonts.numeric, fontSize: 20, textAlign: 'center' },
  unit: { color: colors.textMuted, fontSize: 11 },
  problem: { color: colors.warn, fontSize: 13 },
  link: { color: COLOR, fontSize: 14, textAlign: 'center', padding: 8 },
  footer: { paddingHorizontal: 16, paddingTop: 8 },
});
