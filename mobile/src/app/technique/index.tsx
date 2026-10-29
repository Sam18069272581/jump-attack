import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Rise } from '@/components/motion';
import { PulseProgress } from '@/components/PulseProgress';
import { Button } from '@/components/ui';
import { newSessionId } from '@/db/repo';
import { deleteTechniqueTake, listTechniqueTakes, reachByDay, techniqueVideoUris, type TechniqueTake } from '@/db/technique';
import { shortDate, toISODate } from '@/domain/dates';
import { APPROACH_TOUCH } from '@/domain/metrics';
import type { MetricKey } from '@/domain/technique';
import { flagText, formatMeasured, METRIC_ORDER, METRIC_TEXT, shownFlags } from '@/domain/techniqueText';
import { clearPoseRuns, downloadPoseLib, POSE_DOWNLOAD_BYTES, poseLibReady } from '@/media/poseLib';
import { pruneTakes } from '@/media/takes';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius } from '@/theme';

/** What a take's card shows before it is opened. */
const HEADLINE: MetricKey[] = ['angle', 'approach', 'plant'];

const GUIDE = [
  '手机横放在三脚架上，放在助跑线侧面 7–10 米，镜头高约 1 米，对着起跳点。',
  '地上贴两条胶带：一条在起跳点，一条往回 3 米（量助跑速度用）。',
  '起跳脚那一侧对着手机；衣服颜色和背景要分得开，光线要够。',
  '最准的是 iPhone 慢动作（240 帧）拍完再导入；App 里直接拍最多 60 帧，触地时间测不准。',
];

const MODEL_MB = Math.round(POSE_DOWNLOAD_BYTES / 1e6);

function when(at: string): string {
  const d = new Date(at);
  return `${shortDate(toISODate(d))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function styleText(s: TechniqueTake['style']): string {
  return s.kind === 'two' ? '双脚起跳' : `单脚起跳（${s.foot === 'left' ? '左' : '右'}脚）`;
}

/**
 * Run-up take-off technique from a side-on video: film it here with the setup checks, or import a slow-motion clip.
 * Every saved take is listed with the run-up touch of its day. It measures and shows only: the dunk diagnosis doesn't
 * use it until real footage has confirmed its errors.
 */
export default function Technique() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [ready, setReady] = useState(() => poseLibReady());
  const [download, setDownload] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [takes, setTakes] = useState<TechniqueTake[]>([]);
  const [reach, setReach] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    // Folders a reading page left when the app was closed mid-analysis.
    clearPoseRuns();
    return () => abort.current?.abort();
  }, []);

  const athleteId = current?.id;
  const refresh = useCallback(async () => {
    if (athleteId == null) return;
    setTakes(await listTechniqueTakes(db, athleteId));
    setReach(await reachByDay(db, athleteId));
    // Films of takes never saved (the screen was left) or since deleted.
    pruneTakes(await techniqueVideoUris(db));
  }, [db, athleteId]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function getModel() {
    const ctl = new AbortController();
    abort.current = ctl;
    setFailed(null);
    setDownload(0);
    try {
      await downloadPoseLib(setDownload, ctl.signal);
      setReady(poseLibReady());
    } catch (e) {
      if (!ctl.signal.aborted) setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setDownload(null);
    }
  }

  async function importClip() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      // Keep the original high-frame-rate file instead of a re-encoded copy.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    if (res.canceled || !res.assets[0]) return;
    router.push({ pathname: '/technique/analyse', params: { uri: res.assets[0].uri, fps: '0', source: 'import', session: newSessionId() } });
  }

  function remove(t: TechniqueTake) {
    Alert.alert('删除这条记录？', t.videoUri ? '这次在 App 里拍的录像也会一起删掉。' : undefined, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteTechniqueTake(db, t.id);
          setOpen(null);
          await refresh();
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.lead}>从侧面拍一次助跑起跳，测起跳垂直速度、起跳角度、助跑速度、最后一步触地时间和步长。只测量和显示，不下诊断；每个数都带误差，测不准的会标出来。</Text>

      {!ready && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>先下载骨架识别模型</Text>
          <Text style={styles.muted}>第一次用要下载约 {MODEL_MB} MB，存在手机上，以后没网也能用。视频只在手机上分析，不上传。</Text>
          {download != null ? (
            <PulseProgress progress={download} label={`正在下载 ${Math.round(download * 100)}%`} />
          ) : (
            <Button label="下载模型" onPress={getModel} />
          )}
          {failed && <Text style={styles.warn}>下载失败：{failed}</Text>}
        </View>
      )}

      <Button label="现场拍摄" onPress={() => router.push({ pathname: '/technique/camera', params: { session: newSessionId() } })} disabled={!ready} />
      <Button label="导入慢动作视频" variant="secondary" onPress={importClip} disabled={!ready} />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>怎么拍</Text>
        {GUIDE.map((g, i) => (
          <View key={i} style={styles.guideRow}>
            <Text style={styles.guideNo}>{i + 1}</Text>
            <Text style={styles.guideText}>{g}</Text>
          </View>
        ))}
      </View>

      {takes.length > 0 && <Text style={styles.heading}>记录</Text>}
      {takes.map((t, i) => {
        const vz = t.metrics.vz;
        const dayReach = reach[toISODate(new Date(t.at))];
        const expanded = open === t.id;
        return (
          <Rise key={t.id} index={i}>
            <View style={styles.card}>
              <Pressable accessibilityRole="button" accessibilityLabel={`展开第 ${i + 1} 条`} onPress={() => setOpen(expanded ? null : t.id)} style={{ gap: 6 }}>
                <View style={styles.takeHead}>
                  <Text style={styles.muted}>
                    {when(t.at)} · {t.source === 'camera' ? 'App 拍摄' : '导入'} · {t.captureFps} 帧
                  </Text>
                  <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={16} color={colors.textMuted} />
                </View>
                <Text style={styles.cardTitle}>{styleText(t.style)}</Text>
                {vz && (
                  <Text style={[styles.main, vz.status !== 'ok' && { color: colors.textMuted }]}>
                    {METRIC_TEXT.vz.name} {formatMeasured('vz', vz)}
                  </Text>
                )}
                {HEADLINE.filter((k) => t.metrics[k]).map((k) => (
                  <Text key={k} style={styles.line}>
                    {METRIC_TEXT[k].name} {formatMeasured(k, t.metrics[k]!)}
                  </Text>
                ))}
                <Text style={styles.reach}>{dayReach != null ? `当天助跑摸高 ${dayReach.toFixed(APPROACH_TOUCH.decimals)} cm` : '当天没测助跑摸高'}</Text>
              </Pressable>
              {expanded && (
                <View style={{ gap: 6 }}>
                  {METRIC_ORDER.filter((k) => k !== 'vz' && !HEADLINE.includes(k) && t.metrics[k]).map((k) => (
                    <Text key={k} style={styles.line}>
                      {METRIC_TEXT[k].name} {formatMeasured(k, t.metrics[k]!)}
                    </Text>
                  ))}
                  {shownFlags(t.flags).map((f) => (
                    <Text key={f} style={styles.warn}>
                      {flagText(f, t.flags)}
                    </Text>
                  ))}
                  <Button label="删除这条记录" variant="secondary" onPress={() => remove(t)} />
                </View>
              )}
            </View>
          </Rise>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 8, gap: 12 },
  lead: { color: colors.textSoft, fontSize: 13, lineHeight: 20 },
  heading: { color: colors.text, fontSize: 15, fontWeight: '700', paddingTop: 8, paddingHorizontal: 4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, gap: 8 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  warn: { color: colors.warn, fontSize: 12, lineHeight: 18 },
  guideRow: { flexDirection: 'row', gap: 10 },
  guideNo: { color: colors.accent, fontFamily: fonts.numericBold, fontSize: 18, width: 14 },
  guideText: { flex: 1, color: colors.textSoft, fontSize: 13, lineHeight: 19 },
  takeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  main: { color: colors.accent, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  line: { color: colors.text, fontSize: 13, lineHeight: 19 },
  reach: { color: colors.rim, fontSize: 13, fontWeight: '700' },
});
