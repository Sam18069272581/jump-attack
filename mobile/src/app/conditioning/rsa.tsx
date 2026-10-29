import { useKeepAwake } from 'expo-keep-awake';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { countIn, useCues, useTimeline, type Cue } from '@/components/conditioning/cues';
import { confirmStop, RunningScreen, runStyles, Steps, useSaveResult } from '@/components/conditioning/ui';
import { Button, Chip } from '@/components/ui';
import { RSA_PROTOCOL, rsaSummary } from '@/domain/conditioning';
import { decimal, tr } from '@/i18n';
import { colors, fonts, radius } from '@/theme';

const { sprints: SPRINTS, recoveryS: RECOVERY_S } = RSA_PROTOCOL;
const LEAD_IN_S = 10;
// A tap this soon after the start signal is a mis-tap, not a finished 40 m.
const MIN_SPRINT_S = 3;
const parse = (entry: string) => Number(entry.replace(',', '.'));
const valid = (s: number) => Number.isFinite(s) && s >= MIN_SPRINT_S && s <= 20;

const steps = () => [
  tr('量 20 m，两头各放一个桶。起跑线后 0.5 m 站好，前脚在后。'),
  tr('听到长音全力冲到 20 m 线，单脚踩线后转身冲回起跑线，这算一趟（40 m）。'),
  tr('冲过起跑线时同伴点「到线 · 停表」。之后原地休息 {RECOVERY_S} 秒，App 会倒数并报下一趟。', { RECOVERY_S }),
  tr('一共 {SPRINTS} 趟，每趟都要全力。测前充分热身，做 2–3 次加速跑。', { SPRINTS }),
];

type Mode = 'phone' | 'manual';

export default function RsaTest() {
  const [phase, setPhase] = useState<'intro' | 'running' | 'confirm'>('intro');
  const [mode, setMode] = useState<Mode>('phone');
  const [times, setTimes] = useState<number[]>([]);

  if (phase === 'running') {
    return (
      <Running
        onDone={(t) => {
          setTimes(t);
          setPhase('confirm');
        }}
      />
    );
  }
  if (phase === 'confirm') return <Confirm initial={times} />;

  return (
    <SafeAreaView style={runStyles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.lead}>{tr('{SPRINTS} 趟 20 m 折返冲刺，每趟间休 {RECOVERY_S} 秒。看两个数：平均时间代表反复冲刺能力，递减百分比代表后程掉速多少。', { SPRINTS, RECOVERY_S })}</Text>
        <Steps title={tr('怎么测')} steps={steps()} />
        <View style={{ gap: 10 }}>
          <Text style={styles.label}>{tr('计时方式')}</Text>
          <View style={styles.chips}>
            <Chip label={tr('手机计时')} selected={mode === 'phone'} onPress={() => setMode('phone')} />
            <Chip label={tr('手动填成绩')} selected={mode === 'manual'} onPress={() => setMode('manual')} />
          </View>
          <Text style={styles.hint}>
            {mode === 'phone'
              ? tr('手机从长音开始计时，所以每趟都含反应时间，比测速门慢 0.2–0.3 秒左右。每趟一样，不影响看掉速和前后对比。')
              : tr('用测速门或秒表测完，把每趟成绩填进来。')}
          </Text>
        </View>
      </ScrollView>
      <View style={runStyles.footer}>
        <Button label={mode === 'phone' ? tr('开始（{LEAD_IN_S} 秒后第 1 趟）', { LEAD_IN_S }) : tr('填写成绩')} style={{ flex: 1 }} onPress={() => setPhase(mode === 'phone' ? 'running' : 'confirm')} />
      </View>
    </SafeAreaView>
  );
}

function cuesFor(sprintNo: number): Cue[] {
  return [
    { at: -LEAD_IN_S + 0.3, kind: 'say', text: sprintNo === 1 ? tr('第 1 趟，准备') : tr('还有 10 秒，第 {sprintNo} 趟', { sprintNo }) },
    { at: -5, kind: 'say', text: tr('就位') },
    ...countIn(0),
  ];
}

function Running({ onDone }: { onDone: (times: number[]) => void }) {
  useKeepAwake();
  const player = useCues();
  const [times, setTimes] = useState<number[]>([]);
  const [goAt, setGoAt] = useState(() => Date.now() + LEAD_IN_S * 1000);
  const sprintNo = times.length + 1;
  const cues = useMemo(() => cuesFor(sprintNo), [sprintNo]);
  const t = useTimeline(goAt, cues, player);
  const sprinting = t >= 0;

  function stopClock() {
    const time = (Date.now() - goAt) / 1000;
    if (time < MIN_SPRINT_S) return;
    player.beep();
    const next = [...times, time];
    if (next.length === SPRINTS) {
      player.say(tr('测试完成'));
      onDone(next);
      return;
    }
    setTimes(next);
    setGoAt(Date.now() + RECOVERY_S * 1000);
  }

  return (
    <RunningScreen>
      <SafeAreaView style={runStyles.screen}>
        <View style={runStyles.body}>
          <Text style={runStyles.label}>{tr('第 {sprintNo} / {SPRINTS} 趟 · {p}', { sprintNo, SPRINTS, p: sprinting ? tr('冲刺中') : times.length ? tr('间歇') : tr('准备') })}</Text>
          <Text style={[runStyles.huge, { color: sprinting ? colors.accent : colors.good }]}>{sprinting ? decimal(t, 2) : Math.ceil(-t)}</Text>
          <View style={styles.splits}>
            {Array.from({ length: SPRINTS }, (_, i) => (
              <View key={i} style={styles.split}>
                <Text style={styles.splitN}>{i + 1}</Text>
                <Text style={[styles.splitValue, i === times.length && { color: colors.accent }]}>{times[i] != null ? decimal(times[i], 2) : '—'}</Text>
              </View>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={!sprinting}
            onPressIn={stopClock}
            style={({ pressed }) => [styles.stop, !sprinting && styles.stopIdle, pressed && { opacity: 0.7 }]}
          >
            <Text style={[styles.stopText, !sprinting && { color: colors.textMuted }]}>{sprinting ? tr('到线 · 停表') : tr('等待起跑音')}</Text>
          </Pressable>
        </View>
        <View style={runStyles.footer}>
          <Button label={tr('结束测试')} variant="secondary" style={{ flex: 1 }} onPress={() => confirmStop(() => onDone(times), tr('已完成的趟数会带到下一页，可以补填或修改。'))} />
        </View>
      </SafeAreaView>
    </RunningScreen>
  );
}

function Confirm({ initial }: { initial: number[] }) {
  const { save, busy } = useSaveResult('rsa');
  const [entries, setEntries] = useState<string[]>(() => Array.from({ length: SPRINTS }, (_, i) => (initial[i] != null ? decimal(initial[i], 2) : '')));
  const values = entries.map(parse).filter(valid);
  const complete = values.length === SPRINTS;
  const summary = values.length >= 2 ? rsaSummary(values) : null;

  return (
    <SafeAreaView style={runStyles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>{tr('每趟成绩（秒），可以改')}</Text>
        <View style={styles.inputs}>
          {entries.map((e, i) => (
            <View key={i} style={styles.inputCell}>
              <Text style={styles.splitN}>{i + 1}</Text>
              <TextInput
                style={[styles.input, e !== '' && !valid(parse(e)) && { borderColor: colors.warn }]}
                keyboardType="decimal-pad"
                value={e}
                placeholder="—"
                placeholderTextColor={colors.textFaint}
                onChangeText={(v) => setEntries((xs) => xs.map((x, j) => (j === i ? v : x)))}
              />
            </View>
          ))}
        </View>
        {summary && (
          <View style={runStyles.stats}>
            <View style={runStyles.stat}>
              <Text style={runStyles.statValue}>{decimal(summary.mean, 2)}</Text>
              <Text style={runStyles.statLabel}>{tr('平均 s')}</Text>
            </View>
            <View style={runStyles.stat}>
              <Text style={runStyles.statValue}>{decimal(summary.best, 2)}</Text>
              <Text style={runStyles.statLabel}>{tr('最快 s')}</Text>
            </View>
            <View style={runStyles.stat}>
              <Text style={runStyles.statValue}>{decimal(summary.sdec, 1)}%</Text>
              <Text style={runStyles.statLabel}>{tr('递减')}</Text>
            </View>
          </View>
        )}
        <Text style={styles.hint}>{complete ? tr('成绩按 6 趟的平均时间记录。') : tr('要 {SPRINTS} 趟都有成绩（{MIN_SPRINT_S}–20 秒）才能保存，这样前后才能比。', { SPRINTS, MIN_SPRINT_S })}</Text>
      </ScrollView>
      <View style={runStyles.footer}>
        <Button label={tr('保存成绩')} style={{ flex: 1 }} busy={busy} disabled={!complete} onPress={() => save(values)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 20 },
  lead: { color: colors.textSoft, fontSize: 14, lineHeight: 21 },
  label: { color: colors.textSoft, fontSize: 14 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  chips: { flexDirection: 'row', gap: 8 },
  splits: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radius.card, paddingVertical: 12, paddingHorizontal: 8 },
  split: { alignItems: 'center', gap: 2, flex: 1 },
  splitN: { color: colors.textMuted, fontFamily: fonts.numeric, fontSize: 13 },
  splitValue: { color: colors.text, fontFamily: fonts.numeric, fontSize: 20 },
  stop: { flex: 1, minHeight: 160, borderRadius: radius.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  stopIdle: { backgroundColor: colors.surface },
  stopText: { color: colors.onAccent, fontSize: 32, fontWeight: '800' },
  inputs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  inputCell: { width: '31%', flexGrow: 1, gap: 4, alignItems: 'center' },
  input: { alignSelf: 'stretch', height: 52, borderRadius: radius.button, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, fontFamily: fonts.numeric, fontSize: 24, textAlign: 'center' },
});
