import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { OUTCOME_COLOR } from '@/components/OutcomeButtons';
import { Button, Chip } from '@/components/ui';
import { deleteDunkAttempt, listDunkAttempts } from '@/db/dunkAttempts';
import { listTechniqueTakes, techniqueVideoUris, type TechniqueTake } from '@/db/technique';
import { shortDate, toISODate } from '@/domain/dates';
import { BALL_NAME, formatJumpHeight, jumpHeightCm, OUTCOME_NAME, type DunkAttempt } from '@/domain/dunkAttempts';
import { flagText, formatMeasured, METRIC_ORDER, METRIC_TEXT, shownFlags } from '@/domain/techniqueText';
import { tr } from '@/i18n';
import { pruneTakes, takeUri } from '@/media/takes';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius } from '@/theme';

/** Played back this many times slower: a jump at 240 fps is a blur in real time. */
const SLOW = 0.25;

function setRate(player: VideoPlayer, rate: number) {
  player.playbackRate = rate;
}

function when(at: string): string {
  const d = new Date(at);
  return `${shortDate(toISODate(d))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** One dunk attempt played back: its video, how it went, and the take-off analysis with the jump height it measured. */
export default function AttemptView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [attempt, setAttempt] = useState<DunkAttempt | null>(null);
  const [take, setTake] = useState<TechniqueTake | null>(null);
  const [slow, setSlow] = useState(false);

  const athleteId = current?.id;
  useEffect(() => {
    if (athleteId == null) return;
    let live = true;
    (async () => {
      const a = (await listDunkAttempts(db, athleteId)).find((x) => String(x.id) === id) ?? null;
      const t = a?.trialId != null ? ((await listTechniqueTakes(db, athleteId)).find((x) => x.id === a.trialId) ?? null) : null;
      if (!live) return;
      setAttempt(a);
      setTake(t);
    })();
    return () => {
      live = false;
    };
  }, [db, athleteId, id]);

  // The app's copy where it is now; null when it isn't on this phone (restored from a backup on another one).
  const video = attempt?.videoUri ? takeUri(attempt.videoUri) : null;
  const player = useVideoPlayer(video, (p) => {
    p.loop = true;
  });

  function toggleSlow() {
    setRate(player, slow ? 1 : SLOW);
    setSlow(!slow);
  }

  function remove() {
    if (!attempt) return;
    Alert.alert(tr('删除这次尝试？'), attempt.videoUri ? tr('录像和起跳分析也会一起删掉。') : undefined, [
      { text: tr('取消'), style: 'cancel' },
      {
        text: tr('删除'),
        style: 'destructive',
        onPress: async () => {
          await deleteDunkAttempt(db, attempt.id);
          pruneTakes(await techniqueVideoUris(db));
          router.back();
        },
      },
    ]);
  }

  if (!attempt) return <View style={styles.screen} />;
  const vz = take?.metrics.vz;
  const height = vz ? jumpHeightCm(vz) : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.muted}>{when(attempt.at)}</Text>
          <Text style={styles.title}>{`${attempt.rimCm} cm · ${BALL_NAME[attempt.ball]}`}</Text>
        </View>
        <Text style={[styles.outcome, { color: OUTCOME_COLOR[attempt.outcome] }]}>{OUTCOME_NAME[attempt.outcome]}</Text>
      </View>

      {video ? (
        <>
          <View accessibilityLabel={tr('录像')} style={styles.video}>
            <VideoView player={player} nativeControls contentFit="contain" style={StyleSheet.absoluteFill} />
          </View>
          <View style={{ flexDirection: 'row' }}>
            <Chip label={tr('慢放 ¼')} selected={slow} onPress={toggleSlow} />
          </View>
        </>
      ) : (
        attempt.videoUri && <Text style={styles.muted}>{tr('录像不在这台手机上：录像只存在拍它的手机里，不进备份。')}</Text>
      )}

      {take ? (
        <View style={styles.card}>
          {height && (
            <View style={{ gap: 2 }}>
              <Text style={styles.muted}>{tr('弹跳高度')}</Text>
              <Text style={[styles.height, height.status !== 'ok' && { color: colors.textMuted }]}>{formatJumpHeight(height)}</Text>
              <Text style={styles.muted}>{tr('离地后重心升高多少：起跳垂直速度² ÷ 2g，不是摸高')}</Text>
            </View>
          )}
          {METRIC_ORDER.filter((k) => take.metrics[k]).map((k) => (
            <View key={k} style={styles.metric}>
              <Text style={styles.metricName}>{METRIC_TEXT[k].name}</Text>
              <Text style={styles.metricValue}>{formatMeasured(k, take.metrics[k]!)}</Text>
            </View>
          ))}
          {shownFlags(take.flags).map((f) => (
            <Text key={f} style={styles.warn}>
              {flagText(f, take.flags)}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={styles.muted}>{tr('这次没有起跳分析。')}</Text>
      )}

      <Button label={tr('删除这次尝试')} accessibilityLabel={tr('删除这次尝试')} variant="secondary" onPress={remove} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  outcome: { fontSize: 17, fontWeight: '700' },
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.card, overflow: 'hidden', backgroundColor: '#000' },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 14, gap: 10 },
  height: { color: colors.accent, fontFamily: fonts.numericBold, fontSize: 32 },
  metric: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  metricName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  metricValue: { color: colors.text, fontFamily: fonts.numeric, fontSize: 16 },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  warn: { color: colors.warn, fontSize: 12, lineHeight: 18 },
});
