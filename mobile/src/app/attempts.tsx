import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardDoneBar } from '@/components/KeyboardDoneBar';
import { PressScale } from '@/components/motion';
import { Card } from '@/components/ui';
import { addDunkAttempt, deleteDunkAttempt, listDunkAttempts } from '@/db/dunkAttempts';
import { shortDate, toISODate } from '@/domain/dates';
import { RIM_CM } from '@/domain/dunk';
import { attemptSummary, BALL_NAME, firstDunk, OUTCOME_NAME, rimProblem, type Ball, type DunkAttempt, type Outcome } from '@/domain/dunkAttempts';
import { parseNumber } from '@/domain/entry';
import { tr } from '@/i18n';
import { useAthlete } from '@/state/athlete';
import { todayISO } from '@/state/training';
import { colors, fonts, radius, text } from '@/theme';

const BALLS: Ball[] = ['basketball', 'volleyball'];
const OUTCOMES: Outcome[] = ['made', 'rim', 'short'];
const OUTCOME_COLOR: Record<Outcome, string> = { made: colors.good, rim: colors.rim, short: colors.textMuted };

const timeOf = (at: string) => new Date(at).toTimeString().slice(0, 5);

/** One tap per attempt at the rim: the real result that touch height only predicts. */
export default function Attempts() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const goalRim = current?.rim_height_cm ?? RIM_CM;
  const [attempts, setAttempts] = useState<DunkAttempt[]>([]);
  const [rimText, setRimText] = useState<string | null>(null);
  const [ball, setBall] = useState<Ball | null>(null);

  const load = useCallback(async () => {
    if (current) setAttempts(await listDunkAttempts(db, current.id));
  }, [db, current]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Until changed, carry on at the hoop and ball of the latest attempt; the athlete's own rim the first time.
  const last = attempts.at(-1);
  const rimInput = rimText ?? String(last?.rimCm ?? goalRim);
  const ballNow = ball ?? last?.ball ?? 'basketball';
  const rimCm = parseNumber(rimInput);
  const problem = rimCm == null ? rimProblem(Number.NaN) : rimProblem(rimCm);
  const summary = rimCm == null ? null : attemptSummary(attempts, { rimCm, ball: ballNow });
  const first = firstDunk(attempts, goalRim);
  const today = todayISO();
  const todays = attempts.filter((a) => toISODate(new Date(a.at)) === today).reverse();

  async function log(outcome: Outcome) {
    if (!current || rimCm == null || problem) return;
    try {
      await addDunkAttempt(db, current.id, { rimCm, ball: ballNow, outcome });
      await load();
    } catch (e) {
      Alert.alert(tr('没记上'), String(e));
    }
  }

  async function remove(id: number) {
    await deleteDunkAttempt(db, id);
    await load();
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Card style={{ gap: 6 }}>
          <Text style={text.muted}>
            {rimCm ?? '—'} cm · {BALL_NAME[ballNow]}
          </Text>
          {summary ? (
            <>
              <Text style={styles.headline}>{tr('最近 {total} 次扣进 {made} 次', { total: summary.total, made: summary.made })}</Text>
              <Text style={text.muted}>{tr('碰框没进 {rim} · 没够到 {short}', { rim: summary.rim, short: summary.short })}</Text>
            </>
          ) : (
            <Text style={styles.headline}>{tr('还没记录')}</Text>
          )}
          <Text style={text.muted}>
            {first ? tr('第一次扣进：{p}，{rimCm} cm 篮球', { p: shortDate(toISODate(new Date(first.at))), rimCm: first.rimCm }) : tr('还没在 {goalRim} cm 用篮球扣进过。降低篮筐或换排球练的，单独计数。', { goalRim })}
          </Text>
        </Card>

        <Card style={{ gap: 12 }}>
          <View style={styles.field}>
            <Text style={styles.fieldName}>{tr('篮筐高度')}</Text>
            <TextInput
              value={rimInput}
              onChangeText={setRimText}
              keyboardType="decimal-pad"
              style={styles.input}
              accessibilityLabel={tr('篮筐高度（cm）')}
            />
            <Text style={styles.unit}>cm</Text>
          </View>
          <View style={styles.segment}>
            {BALLS.map((b) => (
              <PressScale
                key={b}
                accessibilityLabel={BALL_NAME[b]}
                accessibilityState={{ selected: b === ballNow }}
                onPress={() => setBall(b)}
                style={[styles.segmentItem, b === ballNow && styles.segmentOn]}
              >
                <Text style={[styles.segmentText, b === ballNow && styles.segmentTextOn]}>{BALL_NAME[b]}</Text>
              </PressScale>
            ))}
          </View>
          {problem && <Text style={styles.problem}>{problem}</Text>}
        </Card>

        <View style={styles.outcomes}>
          {OUTCOMES.map((o) => (
            <PressScale
              key={o}
              accessibilityLabel={OUTCOME_NAME[o]}
              accessibilityState={{ disabled: !!problem }}
              disabled={!!problem}
              onPress={() => log(o)}
              style={[styles.outcome, { borderColor: OUTCOME_COLOR[o] }, !!problem && styles.disabled]}
            >
              <Text style={[styles.outcomeText, { color: OUTCOME_COLOR[o] }]}>{OUTCOME_NAME[o]}</Text>
            </PressScale>
          ))}
        </View>
        <Text style={[text.caption, { textAlign: 'center' }]}>{tr('每试一次点一下，记错了在下面删掉。')}</Text>

        {todays.length > 0 && (
          <Card style={{ gap: 4 }}>
            <Text style={text.section}>{tr('今天')}</Text>
            {todays.map((a) => (
              <View key={a.id} style={styles.row}>
                <Text style={styles.rowTime}>{timeOf(a.at)}</Text>
                <Text style={styles.rowText}>
                  {a.rimCm} cm · {BALL_NAME[a.ball]}
                </Text>
                <Text style={[styles.rowOutcome, { color: OUTCOME_COLOR[a.outcome] }]}>{OUTCOME_NAME[a.outcome]}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={tr('删除这次')} hitSlop={8} onPress={() => remove(a.id)}>
                  <Text style={styles.delete}>{tr('删除')}</Text>
                </Pressable>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
      <KeyboardDoneBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  headline: { color: colors.text, fontSize: 24, fontWeight: '700' },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldName: { flex: 1, color: colors.text, fontSize: 14 },
  input: { width: 90, height: 44, borderRadius: 12, backgroundColor: colors.surfaceRaised, color: colors.text, fontFamily: fonts.numeric, fontSize: 22, textAlign: 'center' },
  unit: { width: 28, color: colors.textMuted, fontSize: 12 },
  segment: { flexDirection: 'row', gap: 8 },
  segmentItem: { flex: 1, height: 40, borderRadius: radius.chip, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  segmentText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  segmentTextOn: { color: colors.onAccent },
  problem: { color: colors.warn, fontSize: 13 },
  outcomes: { flexDirection: 'row', gap: 10 },
  outcome: { flex: 1, height: 88, borderRadius: radius.card, borderWidth: 2, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  outcomeText: { fontSize: 17, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  rowTime: { width: 44, color: colors.textMuted, fontFamily: fonts.numeric, fontSize: 15 },
  rowText: { flex: 1, color: colors.text, fontSize: 14 },
  rowOutcome: { fontSize: 14, fontWeight: '700' },
  delete: { color: colors.textMuted, fontSize: 13 },
});
