import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { countIn, useCues, useTimeline, type Cue } from '@/components/conditioning/cues';
import { confirmStop, RunningScreen, runStyles, Steps, useSaveResult } from '@/components/conditioning/ui';
import { Button, Chip } from '@/components/ui';
import { clock, COOPER_SECONDS, cooperVo2max } from '@/domain/conditioning';
import { colors, fonts, radius } from '@/theme';

const LEAD_IN_S = 5;
const LAPS = [400, 200, 0];

const STEPS = [
  '在 400 m 田径场或量好长度的环线上测。先慢跑热身 10 分钟。',
  '选好一圈多长。手机交给同伴，或者揣在身上。',
  '倒数后开跑，每过一圈点一下「+1 圈」。每分钟会报剩余时间，最后 10 秒倒数。',
  '时间到停在原地，量出最后一圈多跑的距离，在下一页补上。',
];

function buildCues(): Cue[] {
  const cues: Cue[] = [{ at: -LEAD_IN_S, kind: 'say', text: '准备' }, ...countIn(0)];
  for (let m = 1; m < 12; m++) cues.push({ at: m * 60, kind: 'say', text: m === 6 ? '过半，还剩 6 分钟' : `还剩 ${12 - m} 分钟` });
  cues.push({ at: COOPER_SECONDS - 30, kind: 'say', text: '最后 30 秒' });
  for (let s = 10; s >= 1; s--) cues.push({ at: COOPER_SECONDS - s, kind: 'beep' });
  cues.push({ at: COOPER_SECONDS, kind: 'go' }, { at: COOPER_SECONDS + 0.6, kind: 'say', text: '时间到，停在原地' });
  return cues;
}

const CUES = buildCues();

export default function CooperTest() {
  const [phase, setPhase] = useState<'intro' | 'running' | 'confirm'>('intro');
  const [lapM, setLapM] = useState(400);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [laps, setLaps] = useState(0);
  const stop = useCallback(() => setPhase('confirm'), []);

  if (phase === 'running' && startAt != null) {
    return <Running startAt={startAt} lapM={lapM} laps={laps} onLap={setLaps} onStop={stop} />;
  }
  if (phase === 'confirm') return <Confirm laps={laps} lapM={lapM} />;

  return (
    <SafeAreaView style={runStyles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lead}>12 分钟内跑尽量远，按距离估算 VO2max。要匀速，开头别冲太快。</Text>
        <Steps title="怎么测" steps={STEPS} />
        <View style={{ gap: 10 }}>
          <Text style={styles.label}>一圈多长</Text>
          <View style={styles.chips}>
            {LAPS.map((m) => (
              <Chip key={m} label={m ? `${m} m` : '不数圈'} selected={lapM === m} onPress={() => setLapM(m)} />
            ))}
          </View>
        </View>
      </ScrollView>
      <View style={runStyles.footer}>
        <Button
          label={`开始（${LEAD_IN_S} 秒后起跑）`}
          style={{ flex: 1 }}
          onPress={() => {
            setLaps(0);
            setStartAt(Date.now() + LEAD_IN_S * 1000);
            setPhase('running');
          }}
        />
      </View>
    </SafeAreaView>
  );
}

function Running({ startAt, lapM, laps, onLap, onStop }: { startAt: number; lapM: number; laps: number; onLap: (n: number) => void; onStop: () => void }) {
  useKeepAwake();
  const player = useCues();
  const t = useTimeline(startAt, CUES, player);
  const over = t >= COOPER_SECONDS;

  useEffect(() => {
    if (!over) return;
    const id = setTimeout(onStop, 1500);
    return () => clearTimeout(id);
  }, [over, onStop]);

  return (
    <RunningScreen>
      <SafeAreaView style={runStyles.screen}>
        <View style={[runStyles.body, { justifyContent: 'center' }]}>
          <Text style={runStyles.label}>{t < 0 ? '准备起跑' : over ? '时间到' : '剩余时间'}</Text>
          <Text style={[runStyles.huge, { color: t < 0 ? colors.good : colors.accent }]}>{t < 0 ? Math.ceil(-t) : clock(COOPER_SECONDS - t)}</Text>
          {lapM > 0 && (
            <View style={runStyles.stats}>
              <View style={runStyles.stat}>
                <Text style={runStyles.statValue}>{laps}</Text>
                <Text style={runStyles.statLabel}>圈</Text>
              </View>
              <View style={runStyles.stat}>
                <Text style={runStyles.statValue}>{laps * lapM}</Text>
                <Text style={runStyles.statLabel}>m</Text>
              </View>
            </View>
          )}
          {lapM > 0 && (
            <View style={styles.lapRow}>
              <Pressable accessibilityRole="button" accessibilityLabel="少记一圈" disabled={laps === 0} onPress={() => onLap(laps - 1)} style={[styles.undo, laps === 0 && { opacity: 0.3 }]}>
                <Text style={styles.undoText}>−1</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={t < 0} onPress={() => onLap(laps + 1)} style={({ pressed }) => [styles.lap, (pressed || t < 0) && { opacity: 0.6 }]}>
                <Text style={styles.lapText}>+1 圈</Text>
              </Pressable>
            </View>
          )}
        </View>
        <View style={runStyles.footer}>
          <Button label="提前结束" variant="secondary" style={{ flex: 1 }} onPress={() => confirmStop(onStop, '不足 12 分钟的距离没法估算 VO2max，下一页可以手动填完整成绩。')} />
        </View>
      </SafeAreaView>
    </RunningScreen>
  );
}

function Confirm({ laps, lapM }: { laps: number; lapM: number }) {
  const { save, busy } = useSaveResult('cooper');
  const [extra, setExtra] = useState('');
  const [total, setTotal] = useState('');
  const counted = laps * lapM;
  const distance = lapM ? counted + (Number(extra) || 0) : Number(total) || 0;
  // Outside 1000–5500 m is almost certainly a typo for a 12-minute run.
  const plausible = distance >= 1000 && distance <= 5500;

  return (
    <SafeAreaView style={runStyles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {lapM ? (
          <>
            <Text style={styles.label}>
              记了 {laps} 圈 × {lapM} m = {counted} m
            </Text>
            <Text style={styles.label}>最后一圈多跑了多少米</Text>
            <TextInput style={styles.input} keyboardType="number-pad" value={extra} onChangeText={setExtra} placeholder="0" placeholderTextColor={colors.textFaint} />
          </>
        ) : (
          <>
            <Text style={styles.label}>12 分钟跑了多少米</Text>
            <TextInput style={styles.input} keyboardType="number-pad" value={total} onChangeText={setTotal} placeholder="例如 2800" placeholderTextColor={colors.textFaint} autoFocus />
          </>
        )}
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={runStyles.label}>总距离</Text>
          <Text style={runStyles.big}>{distance} m</Text>
          {plausible && <Text style={styles.vo2}>VO2max ≈ {cooperVo2max(distance).toFixed(1)}</Text>}
        </View>
      </ScrollView>
      <View style={runStyles.footer}>
        <Button label="保存成绩" style={{ flex: 1 }} busy={busy} disabled={!plausible} onPress={() => save([distance])} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 20 },
  lead: { color: colors.textSoft, fontSize: 14, lineHeight: 21 },
  label: { color: colors.textSoft, fontSize: 14 },
  chips: { flexDirection: 'row', gap: 8 },
  lapRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  lap: { flex: 1, height: 120, borderRadius: radius.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  lapText: { color: colors.onAccent, fontSize: 32, fontWeight: '800' },
  undo: { width: 72, height: 120, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  undoText: { color: colors.text, fontFamily: fonts.numeric, fontSize: 24 },
  input: { height: 56, borderRadius: radius.button, backgroundColor: colors.surface, color: colors.text, fontFamily: fonts.numeric, fontSize: 28, paddingHorizontal: 16 },
  vo2: { color: colors.textSoft, fontFamily: fonts.numeric, fontSize: 22 },
});
