import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { KeyboardDoneBar } from '@/components/KeyboardDoneBar';
import { PressScale } from '@/components/motion';
import { OUTCOME_COLOR, OutcomeButtons } from '@/components/OutcomeButtons';
import { Button, Card } from '@/components/ui';
import { addDunkAttempt, deleteDunkAttempt, listDunkAttempts } from '@/db/dunkAttempts';
import { newSessionId } from '@/db/repo';
import { listTechniqueTakes, techniqueVideoUris } from '@/db/technique';
import { shortDate, toISODate } from '@/domain/dates';
import { RIM_CM } from '@/domain/dunk';
import { attemptSummary, BALL_NAME, firstDunk, jumpHeightCm, OUTCOME_NAME, rimProblem, type Ball, type DunkAttempt, type Outcome } from '@/domain/dunkAttempts';
import { parseNumber } from '@/domain/entry';
import type { Measured } from '@/domain/technique';
import { decimal, tr } from '@/i18n';
import { poseLibReady } from '@/media/poseLib';
import { isWeb } from '@/media/runtime';
import { pruneTakes } from '@/media/takes';
import { useAthlete } from '@/state/athlete';
import { todayISO } from '@/state/training';
import { colors, fonts, radius, text } from '@/theme';

const BALLS: Ball[] = ['basketball', 'volleyball'];

/** The filmed attempts listed below today's. */
const FILMED_SHOWN = 20;

const timeOf = (at: string) => new Date(at).toTimeString().slice(0, 5);
const filmed = (a: DunkAttempt) => a.videoUri != null || a.trialId != null;

/**
 * Each attempt at the rim: the real result that touch height only predicts. Filmed (in the app or a slow-motion clip),
 * the take-off analysis measures how high the jump went and the attempt keeps its video; one tap logs it without.
 */
export default function Attempts() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const goalRim = current?.rim_height_cm ?? RIM_CM;
  const [attempts, setAttempts] = useState<DunkAttempt[]>([]);
  const [rimText, setRimText] = useState<string | null>(null);
  const [ball, setBall] = useState<Ball | null>(null);
  /** The jump height of each analysed attempt, by its analysis's trial id. */
  const [heights, setHeights] = useState<Record<number, Measured>>({});
  const [poseReady, setPoseReady] = useState(false);

  const load = useCallback(async () => {
    if (!current) return;
    setAttempts(await listDunkAttempts(db, current.id));
    const takes = await listTechniqueTakes(db, current.id);
    setHeights(Object.fromEntries(takes.filter((t) => t.metrics.vz).map((t) => [t.id, jumpHeightCm(t.metrics.vz!)])));
    if (isWeb) return;
    setPoseReady(poseLibReady());
    // Videos of attempts deleted, or of filming never saved.
    pruneTakes(await techniqueVideoUris(db));
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

  const setupParams = () => ({ session: newSessionId(), rim: String(rimCm), ball: ballNow });

  function film() {
    router.push({ pathname: '/technique/camera', params: setupParams() });
  }

  async function importClip() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      // Keep the original high-frame-rate file instead of a re-encoded copy.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    if (res.canceled || !res.assets[0]) return;
    router.push({ pathname: '/technique/analyse', params: { uri: res.assets[0].uri, fps: '0', source: 'import', ...setupParams() } });
  }

  const earlier = attempts
    .filter((a) => filmed(a) && toISODate(new Date(a.at)) !== today)
    .reverse()
    .slice(0, FILMED_SHOWN);

  function row(a: DunkAttempt, opts: { date?: boolean; deletable?: boolean }) {
    const h = a.trialId != null ? heights[a.trialId] : undefined;
    const body = (
      <>
        <Text style={styles.rowTime}>{opts.date ? shortDate(toISODate(new Date(a.at))) : timeOf(a.at)}</Text>
        <Text style={styles.rowText}>
          {a.rimCm} cm · {BALL_NAME[a.ball]}
        </Text>
        {h && <Text style={[styles.rowHeight, h.status !== 'ok' && { color: colors.textMuted }]}>{tr('弹跳 {h} cm', { h: decimal(h.value, 0) })}</Text>}
        <Text style={[styles.rowOutcome, { color: OUTCOME_COLOR[a.outcome] }]}>{OUTCOME_NAME[a.outcome]}</Text>
      </>
    );
    return (
      <View key={a.id} style={styles.row}>
        {filmed(a) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('看这次录像')}
            onPress={() => router.push({ pathname: '/attempt', params: { id: String(a.id) } })}
            style={styles.rowMain}
          >
            {body}
            <Icon name="chevronRight" size={14} color={colors.textMuted} />
          </Pressable>
        ) : (
          <View style={styles.rowMain}>{body}</View>
        )}
        {opts.deletable && (
          <Pressable accessibilityRole="button" accessibilityLabel={tr('删除这次')} hitSlop={8} onPress={() => remove(a.id)}>
            <Text style={styles.delete}>{tr('删除')}</Text>
          </Pressable>
        )}
      </View>
    );
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

        {!isWeb && (
          <View style={{ gap: 8 }}>
            {poseReady ? (
              <>
                <Button label={tr('拍这一次')} accessibilityLabel={tr('拍这一次')} onPress={film} disabled={!!problem} />
                <Button label={tr('导入慢动作视频')} accessibilityLabel={tr('导入慢动作视频')} variant="secondary" onPress={importClip} disabled={!!problem} />
              </>
            ) : (
              <Button label={tr('先下载骨架识别模型')} accessibilityLabel={tr('先下载骨架识别模型')} variant="secondary" onPress={() => router.push('/technique')} />
            )}
            <Text style={[text.caption, { textAlign: 'center' }]}>{tr('从侧面拍下来，会测出这次的弹跳高度，录像和结果一起存档。没拍就直接点结果。')}</Text>
          </View>
        )}

        <OutcomeButtons onPick={log} disabled={!!problem} />
        <Text style={[text.caption, { textAlign: 'center' }]}>{tr('每试一次点一下，记错了在下面删掉。')}</Text>

        {todays.length > 0 && (
          <Card style={{ gap: 4 }}>
            <Text style={text.section}>{tr('今天')}</Text>
            {todays.map((a) => row(a, { deletable: true }))}
          </Card>
        )}

        {earlier.length > 0 && (
          <Card style={{ gap: 4 }}>
            <Text style={text.section}>{tr('录像记录')}</Text>
            {earlier.map((a) => row(a, { date: true }))}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowHeight: { color: colors.accent, fontFamily: fonts.numeric, fontSize: 15 },
  rowTime: { width: 44, color: colors.textMuted, fontFamily: fonts.numeric, fontSize: 15 },
  rowText: { flex: 1, color: colors.text, fontSize: 14 },
  rowOutcome: { fontSize: 14, fontWeight: '700' },
  delete: { color: colors.textMuted, fontSize: 13 },
});
