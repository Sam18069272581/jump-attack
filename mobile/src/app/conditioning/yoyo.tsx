import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { countIn, useCues, useTimeline, type Cue } from '@/components/conditioning/cues';
import { confirmStop, RunningScreen, runStyles, Steps, Stepper, useSaveResult } from '@/components/conditioning/ui';
import { Button } from '@/components/ui';
import { clock, YOYO_IR1, yoyoCompletedAt, yoyoDistance, yoyoLabel, yoyoStateAt, yoyoVo2max } from '@/domain/conditioning';
import { decimal, localized, tr } from '@/i18n';
import { colors, fonts } from '@/theme';

const LEAD_IN_S = 5;

const STEPS = localized([
  '摆 3 个桶：起点线 A，A 前方 20 m 是折返线 B，A 后方 5 m 放恢复桶 C。',
  '手机放在起点旁，音量开大。静音键开着也会响。',
  '长音起跑，从 A 跑到 B，短音响时要踩到 B 线；转身跑回 A，下一声短音前回到 A。',
  '回到 A 后有 10 秒恢复：慢跑绕过 C 再回到 A 站好，等下一声长音。速度会一级级变快。',
  '第一次没按时到线算警告，第二次没到就结束，点「结束测试」。',
]);

function buildCues(): Cue[] {
  const cues: Cue[] = [{ at: -LEAD_IN_S, kind: 'say', text: tr('准备') }, ...countIn(0)];
  YOYO_IR1.forEach((s, i) => {
    if (i > 0) cues.push({ at: s.start, kind: 'go' });
    cues.push({ at: s.turn, kind: 'beep' }, { at: s.end, kind: 'beep' });
    const next = YOYO_IR1[i + 1];
    if (!next) cues.push({ at: s.end + 0.5, kind: 'say', text: tr('测试完成') });
    else if (next.level !== s.level) cues.push({ at: s.end + 1, kind: 'say', text: tr('下一趟，{level} 级', { level: next.level }) });
  });
  return cues;
}

const CUES = buildCues();

export default function YoyoTest() {
  const [phase, setPhase] = useState<'intro' | 'running' | 'confirm'>('intro');
  const [startAt, setStartAt] = useState<number | null>(null);
  const [completed, setCompleted] = useState(0);
  const stop = useCallback((n: number) => {
    setCompleted(n);
    setPhase('confirm');
  }, []);

  if (phase === 'running' && startAt != null) return <Running startAt={startAt} onStop={stop} />;
  if (phase === 'confirm') return <Confirm completed={completed} onChange={setCompleted} />;

  return (
    <SafeAreaView style={runStyles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lead}>{tr('间歇性 20 m 往返跑，越跑越快，测的是反复高强度跑动后的恢复能力，按总距离估算 VO2max。全程由手机报音，测前先充分热身。')}</Text>
        <Steps title={tr('怎么测')} steps={STEPS} />
      </ScrollView>
      <View style={runStyles.footer}>
        <Button
          label={tr('开始（{LEAD_IN_S} 秒后起跑）', { LEAD_IN_S })}
          style={{ flex: 1 }}
          onPress={() => {
            setStartAt(Date.now() + LEAD_IN_S * 1000);
            setPhase('running');
          }}
        />
      </View>
    </SafeAreaView>
  );
}

function Running({ startAt, onStop }: { startAt: number; onStop: (completed: number) => void }) {
  useKeepAwake();
  const player = useCues();
  const t = useTimeline(startAt, CUES, player);
  const state = yoyoStateAt(Math.max(0, t));
  const done = state.phase === 'done';

  useEffect(() => {
    if (done) onStop(YOYO_IR1.length);
  }, [done, onStop]);

  if (state.phase === 'done') return null;
  const shuttle = state.phase === 'rest' ? state.next : state.shuttle;
  const phaseText = t < 0 ? tr('准备起跑') : state.phase === 'rest' ? tr('恢复 · 慢跑绕后方桶') : state.leg === 'out' ? tr('去程 → 20 m 线') : tr('回程 → 起点');
  const phaseColor = t < 0 || state.phase === 'rest' ? colors.good : colors.accent;
  const toBeep = t < 0 ? -t : state.toBeep;

  return (
    <RunningScreen>
      <SafeAreaView style={runStyles.screen}>
        <View style={[runStyles.body, { justifyContent: 'center' }]}>
          <Text style={runStyles.label}>{tr('{p} · 第 {n} 趟 · {speedKmh} km/h', { p: state.phase === 'rest' || t < 0 ? tr('下一趟') : tr('当前'), n: shuttle.n, speedKmh: shuttle.speedKmh })}</Text>
          <Text style={[runStyles.huge, { color: phaseColor }]}>
            {shuttle.level}.{shuttle.inLevel}
          </Text>
          <Text style={[runStyles.phase, { color: phaseColor }]}>{phaseText}</Text>
          <Text style={styles.countdown}>{decimal(toBeep, 1)}</Text>
          <View style={runStyles.stats}>
            <View style={runStyles.stat}>
              <Text style={runStyles.statValue}>{yoyoDistance(yoyoCompletedAt(t))}</Text>
              <Text style={runStyles.statLabel}>{tr('已完成 m')}</Text>
            </View>
            <View style={runStyles.stat}>
              <Text style={runStyles.statValue}>{clock(Math.max(0, t))}</Text>
              <Text style={runStyles.statLabel}>{tr('用时')}</Text>
            </View>
          </View>
        </View>
        <View style={runStyles.footer}>
          <Button label={tr('结束测试')} variant="secondary" style={{ flex: 1 }} onPress={() => confirmStop(() => onStop(yoyoCompletedAt((Date.now() - startAt) / 1000)))} />
        </View>
      </SafeAreaView>
    </RunningScreen>
  );
}

function Confirm({ completed, onChange }: { completed: number; onChange: (n: number) => void }) {
  const { save, busy } = useSaveResult('yoyo_ir1');
  const distance = yoyoDistance(completed);

  return (
    <SafeAreaView style={runStyles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={runStyles.label}>{tr('最后完成的一趟')}</Text>
          <Text style={runStyles.big}>{yoyoLabel(completed)}</Text>
          <Text style={styles.distance}>
            {distance} m · VO2max ≈ {decimal(yoyoVo2max(distance), 1)}
          </Text>
        </View>
        <Stepper label={tr('完成趟数')} value={completed} onChange={onChange} max={YOYO_IR1.length} />
        <Text style={styles.hint}>{tr('成绩按最后一趟按时回到起点来算。最后一趟其实没赶上的话，减一趟；结束得晚了，也在这里改。')}</Text>
      </ScrollView>
      <View style={runStyles.footer}>
        <Button label={tr('保存成绩')} style={{ flex: 1 }} busy={busy} disabled={completed === 0} onPress={() => save([distance])} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 20 },
  lead: { color: colors.textSoft, fontSize: 14, lineHeight: 21 },
  countdown: { color: colors.text, fontFamily: fonts.numeric, fontSize: 44, textAlign: 'center' },
  distance: { color: colors.textSoft, fontFamily: fonts.numeric, fontSize: 22 },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
