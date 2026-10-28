import { File, Paths } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { PulseProgress } from '@/components/PulseProgress';
import { Button, Empty } from '@/components/ui';
import { analysisKindFor } from '@/domain/analysisTrials';
import { toISODate } from '@/domain/dates';
import { analyseJumps, type JumpEvents } from '@/domain/jumpAnalysis';
import { getMetric } from '@/domain/metrics';
import { stageForGrabbing, unstage } from '@/media/frameGrabber';
import { replayConfig } from '@/media/replayConfig';
import { replayHtml } from '@/media/replayHtml';
import { colors, radius } from '@/theme';

type Web = WebView<Record<never, never>>;

type Msg =
  | { type: 'ready' }
  | { type: 'progress'; done: number; total: number }
  | { type: 'file'; mime: string; part: number; parts: number; data: string }
  | { type: 'unsupported' }
  | { type: 'error'; message: string };

/**
 * Replays an analysed set in slow motion with its numbers on top (media/replayHtml), and exports it as a portrait video
 * for the share sheet: save to Photos, send to the team, post it.
 */
export default function Replay() {
  const params = useLocalSearchParams<{ uri: string; metric: string; fileFps: string; captureFps: string; from: string; to: string; events: string; box?: string; focus?: string }>();
  const def = getMetric(params.metric);
  const kind = def ? analysisKindFor(def) : null;
  const web = useRef<Web>(null);
  const file = useRef<File | null>(null);
  const [stage, setStage] = useState<{ page: string; dir: string } | null>(null);
  const [state, setState] = useState<{ name: 'loading' | 'ready' | 'sharing' } | { name: 'exporting'; done: number; total: number } | { name: 'problem'; text: string }>({ name: 'loading' });

  const config = useMemo(() => {
    if (!def || !kind) return null;
    const events = JSON.parse(params.events) as (JumpEvents & { counted: boolean })[];
    const captureFps = Number(params.captureFps);
    const analysis = analyseJumps(events, { kind, captureFps, boxCm: Number(params.box) || undefined, keep: events.flatMap((e, i) => (e.counted ? [i] : [])) });
    return replayConfig({
      def,
      kind,
      analysis,
      video: '',
      fileFps: Number(params.fileFps),
      captureFps,
      from: Number(params.from),
      to: Number(params.to),
      date: toISODate(new Date()),
      colors: { ink: colors.text, paper: colors.bg, card: colors.surface, accent: colors.accent, rim: colors.rim, muted: colors.textMuted, touch: colors.purple },
      ...(params.focus ? { focus: JSON.parse(params.focus) } : {}),
    });
  }, [def, kind, params.events, params.captureFps, params.fileFps, params.from, params.to, params.box, params.focus]);

  useEffect(() => {
    if (!config) return;
    let gone = false;
    let dir: string | null = null;
    stageForGrabbing(params.uri, (video) => replayHtml({ ...config, video }))
      .then((s) => {
        if (gone) return unstage(s.dir);
        dir = s.dir;
        setStage(s);
      })
      .catch(() => !gone && setState({ name: 'problem', text: '视频打不开' }));
    return () => {
      gone = true;
      if (dir) unstage(dir);
    };
  }, [params.uri, config]);

  const call = (js: string) => web.current?.injectJavaScript(`${js}; true;`);

  async function onMessage(e: WebViewMessageEvent) {
    let m: Msg;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.type === 'ready') {
      setState({ name: 'ready' });
      return call('window.replay.play()');
    }
    if (m.type === 'progress') return setState({ name: 'exporting', done: m.done, total: m.total });
    if (m.type === 'unsupported') return setState({ name: 'problem', text: '这台手机的系统录不了这个画面。可以点「再放一次」，用系统录屏录下来。' });
    if (m.type === 'error') return setState({ name: 'problem', text: `出错了：${m.message}` });
    // The video arrives in parts, each written as it comes: base64 to bytes, no copy of the whole video in memory.
    const mp4 = m.mime.includes('mp4');
    if (m.part === 0) {
      file.current = new File(Paths.cache, `jump-attack-${params.metric}-${Date.now()}.${mp4 ? 'mp4' : 'webm'}`);
      file.current.create({ overwrite: true });
    }
    file.current?.write(m.data, m.part === 0 ? { encoding: 'base64' } : { encoding: 'base64', append: true });
    if (m.part < m.parts - 1 || !file.current) return;
    setState({ name: 'sharing' });
    try {
      await Sharing.shareAsync(file.current.uri, { mimeType: mp4 ? 'video/mp4' : 'video/webm', UTI: mp4 ? 'public.mpeg-4' : 'org.webmproject.webm', dialogTitle: '保存或分享视频' });
    } finally {
      setState({ name: 'ready' });
    }
  }

  if (!config) return <Empty title="这个项目不能回放" />;
  const exporting = state.name === 'exporting';

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <View style={styles.stage}>
        {stage && (
          <WebView<Record<never, never>>
            ref={web}
            source={{ uri: stage.page }}
            originWhitelist={['*']}
            allowingReadAccessToURL={stage.dir}
            allowFileAccess
            allowFileAccessFromFileURLs
            allowUniversalAccessFromFileURLs
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            scrollEnabled={false}
            bounces={false}
            onMessage={onMessage}
            onError={() => setState({ name: 'problem', text: '视频打不开' })}
            style={{ backgroundColor: colors.bg }}
          />
        )}
      </View>
      <View style={styles.footer}>
        {exporting && <PulseProgress progress={state.done / state.total} label="正在导出视频…" />}
        {state.name === 'problem' && <Text style={styles.problem}>{state.text}</Text>}
        <View style={styles.row}>
          <Button label="再放一次" variant="secondary" onPress={() => call('window.replay.play()')} disabled={state.name === 'loading' || exporting} style={{ flex: 1 }} />
          <Button label="导出视频" onPress={() => call('window.replay.exportVideo()')} disabled={state.name !== 'ready'} busy={exporting || state.name === 'sharing'} style={{ flex: 1 }} />
        </View>
        <Text style={styles.note}>竖屏 720 × 1280，带水印、起跳曲线和每跳数据，可以存到相册或直接发出去。</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  stage: { flex: 1, margin: 12, borderRadius: radius.card, overflow: 'hidden' },
  footer: { paddingHorizontal: 16, paddingTop: 4, gap: 8 },
  row: { flexDirection: 'row', gap: 10 },
  problem: { color: colors.warn, fontSize: 13, lineHeight: 19 },
  note: { color: colors.textMuted, fontSize: 11, textAlign: 'center' },
});
