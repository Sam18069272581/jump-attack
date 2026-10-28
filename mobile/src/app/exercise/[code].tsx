import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { DemoFigure } from '@/components/DemoFigure';
import { Icon } from '@/components/Icon';
import { Button, Card, Empty } from '@/components/ui';
import { demoClipProblem, demoFor } from '@/domain/demos';
import { exerciseIn, TEMPLATES } from '@/domain/templates';
import { deleteDemoClip, demoClip, saveDemoClip } from '@/media/demos';
import { colors, radius, text } from '@/theme';

/** How an exercise is done: drawn start and key positions, the steps, the mistakes, and the athlete's own clip. */
export default function ExerciseDemo() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const demo = demoFor(code);
  const name = TEMPLATES.map((t) => exerciseIn(t.code, code)).find((p) => p)?.name ?? '';
  const [clip, setClip] = useState(() => demoClip(code));
  const [problem, setProblem] = useState<string | null>(null);

  async function pickClip() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
    const asset = res.canceled ? undefined : res.assets[0];
    if (!asset) return;
    const p = demoClipProblem(asset.duration);
    setProblem(p);
    if (!p) setClip(await saveDemoClip(code, asset.uri));
  }

  function removeClip() {
    deleteDemoClip(code);
    setClip(null);
  }

  if (!demo) return <Empty title="这个动作还没有示范" />;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: name }} />
      {clip ? (
        <OwnClip uri={clip} />
      ) : (
        <View style={styles.poses}>
          <Pose label="起始" pose={demo.poses[0]} />
          <Icon name="chevronRight" size={20} color={colors.textMuted} />
          <Pose label="关键动作" pose={demo.poses[1]} />
        </View>
      )}

      <Card style={styles.card}>
        <Text style={text.section}>怎么做</Text>
        {demo.steps.map((s, i) => (
          <Text key={s} style={styles.line}>
            {`${i + 1}. ${s}`}
          </Text>
        ))}
      </Card>
      <Card style={styles.card}>
        <Text style={text.section}>常见错误</Text>
        {demo.mistakes.map((m) => (
          <Text key={m} style={styles.line}>
            {`· ${m}`}
          </Text>
        ))}
      </Card>

      <View style={styles.own}>
        {clip && (
          <View style={styles.poses}>
            <Pose label="起始" pose={demo.poses[0]} small />
            <Pose label="关键动作" pose={demo.poses[1]} small />
          </View>
        )}
        <Button label={clip ? '换一段自己的视频' : '用自己拍的视频'} variant="secondary" onPress={pickClip} />
        {clip && <Button label="删掉自己的视频" variant="ghost" onPress={removeClip} />}
        {problem && <Text style={styles.problem}>{problem}</Text>}
        <Text style={text.caption}>自己拍的示范只存在这台手机上，不进备份；30 秒以内、几次标准动作就够。</Text>
      </View>
    </ScrollView>
  );
}

function Pose({ label, pose, small }: { label: string; pose: Parameters<typeof DemoFigure>[0]['pose']; small?: boolean }) {
  return (
    <View style={styles.pose}>
      <DemoFigure pose={pose} size={small ? 96 : 140} />
      <Text style={text.caption}>{label}</Text>
    </View>
  );
}

function OwnClip({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <View style={styles.video}>
      <VideoView player={player} contentFit="contain" nativeControls style={StyleSheet.absoluteFill} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 12, gap: 12 },
  poses: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  pose: { alignItems: 'center', gap: 2, backgroundColor: colors.surface, borderRadius: radius.card, padding: 6 },
  video: { height: 320, borderRadius: radius.card, overflow: 'hidden', backgroundColor: '#000' },
  card: { gap: 8 },
  line: { color: colors.textSoft, fontSize: 14, lineHeight: 21 },
  own: { gap: 8 },
  problem: { color: colors.warn, fontSize: 13 },
});
