import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FvChart } from '@/components/FvChart';
import { Icon } from '@/components/Icon';
import { TrendChart } from '@/components/TrendChart';
import { Button, Card, Chip } from '@/components/ui';
import { addLoadedJump, listLoadedJumps, profileSessions, type LoadedJump } from '@/db/jumps';
import { deleteTrial } from '@/db/repo';
import { parseNumber } from '@/domain/entry';
import { bandOf, EXERCISE_KINDS, fvProfile, heightPerLoad, MIN_R2, pushOff, suggestedLoads, suggestion, type FvProfile } from '@/domain/fvp';
import { getMetric } from '@/domain/metrics';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, text } from '@/theme';

const COLOR = '#4FD1FF';
const SIDE_TEXT = {
  force: '力量端偏弱：重负荷下推不动，轻负荷下的速度相对够用',
  balanced: '力量端和速度端比较均衡',
  velocity: '速度端偏弱：力量够，但轻负荷下动作不够快',
};

function shortDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Loaded squat jumps at several loads → force-velocity profile, how far it is from optimal, and what to train. */
export default function ForceVelocity() {
  const { session } = useLocalSearchParams<{ session: string }>();
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [all, setAll] = useState<LoadedJump[]>([]);
  const [kg, setKg] = useState('0');
  const [cm, setCm] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (current) setAll(await listLoadedJumps(db, current.id));
  }, [db, current]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const mass = current?.body_mass_kg ?? null;
  const hpo = current?.leg_length_cm != null && current.squat_height_cm != null ? pushOff(current.leg_length_cm, current.squat_height_cm) : null;

  if (mass == null || mass <= 0 || hpo == null) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={{ gap: 10 }}>
          <Text style={text.section}>先在「我的」填三个数</Text>
          <Text style={text.muted}>体重、腿长（踮脚站立，大转子到脚尖）、膝关节 90° 下蹲时大转子离地的高度。后两个只量一次，用来算蹬伸距离。</Text>
          <Button label="去填写" onPress={() => router.navigate('/me')} />
        </Card>
      </ScrollView>
    );
  }

  const today = all.filter((j) => j.session_id === session);
  const load = parseNumber(kg);
  const height = parseNumber(cm);
  const loadOk = load != null && load >= 0 && load <= 300;
  const sj = getMetric('sj')!;
  const heightOk = height != null && height >= 1 && height <= sj.range![1];

  const sessions = profileSessions(all);
  const history = sessions.map((s) => ({ ...s, profile: fvProfile(mass, hpo, s.jumps) })).filter((s): s is typeof s & { profile: FvProfile } => s.profile != null);
  const shown = history.find((s) => s.sessionId === session) ?? history.at(-1);
  const advice = suggestion(history.filter((s) => s.startedAt <= (shown?.startedAt ?? '')).map((s) => s.profile.fvPct));
  const loads = suggestedLoads(mass);

  async function logManual() {
    if (!current || !loadOk || !heightOk) return;
    setSaving(true);
    try {
      await addLoadedJump(db, current.id, session, load!, height!);
      Haptics.selectionAsync();
      setCm('');
      await reload();
    } catch (e) {
      Alert.alert('保存失败', String(e));
    } finally {
      setSaving(false);
    }
  }

  function measureVideo() {
    if (!loadOk) return Alert.alert('先填负重', '负重包括杠铃杆（史密斯机按机器标注的杆重算），徒手跳填 0。');
    router.push({ pathname: '/measure/capture', params: { metric: 'sj', session, from: 'fvp', load: String(load) } });
  }

  function remove(j: LoadedJump) {
    Alert.alert('删除这一跳？', '', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => (await deleteTrial(db, j.id), reload()) },
    ]);
  }

  const perLoad = heightPerLoad(today);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text style={text.muted}>
          史密斯机负重蹲跳：蹲到膝关节 90°（可以轻碰跳箱）停 2 秒，不往下顿，直接全力跳，落地时腿伸直。每级负重跳 2–3 次，次间休 2 分钟。
        </Text>

        {today.length > 0 && (
          <Card style={{ gap: 4 }}>
            {perLoad.map((p) => (
              <View key={p.loadKg} style={styles.loadRow}>
                <Text style={styles.load}>{p.loadKg} kg</Text>
                <View style={styles.jumps}>
                  {today
                    .filter((j) => j.loadKg === p.loadKg)
                    .map((j) => (
                      <Pressable key={j.id} accessibilityRole="button" accessibilityLabel={`删除 ${p.loadKg} kg 的 ${j.heightCm.toFixed(1)} cm`} onPress={() => remove(j)} style={styles.jump}>
                        <Text style={styles.jumpText}>{j.heightCm.toFixed(1)}</Text>
                        <Icon name="trash" size={12} color={colors.textMuted} />
                      </Pressable>
                    ))}
                </View>
                <Text style={styles.mean}>{p.heightCm.toFixed(1)} cm</Text>
              </View>
            ))}
            <Text style={text.caption}>右边是每级最好两跳的平均，用来算曲线。</Text>
          </Card>
        )}

        <Card style={{ gap: 12 }}>
          <Text style={text.section}>下一跳</Text>
          <View style={styles.chips}>
            {loads.map((l) => (
              <Chip key={l} label={`${l}`} selected={load === l} onPress={() => setKg(String(l))} color={COLOR} />
            ))}
          </View>
          <View style={styles.fields}>
            <Field label="负重（含杆）" unit="kg" value={kg} onChange={setKg} />
            <Field label="跳高（手填）" unit="cm" value={cm} onChange={setCm} />
          </View>
          <Button label="录像测这一跳" onPress={measureVideo} disabled={!loadOk} />
          <Button label="记手填的跳高" variant="secondary" onPress={logManual} disabled={!loadOk || !heightOk} busy={saving} />
          <Text style={text.caption}>建议负重约为体重的 0、25%、50%、75%，最重一级能跳 10 cm 左右最好。用 My Jump 等 App 测过的跳高也可以直接手填。</Text>
        </Card>

        {shown ? (
          <ProfileCard profile={shown.profile} isToday={shown.sessionId === session} date={shortDate(shown.startedAt)} hpo={hpo} />
        ) : (
          <Text style={text.muted}>至少两级不同负重后，这里会画出你的力-速度曲线。</Text>
        )}

        {advice && (
          <Card style={{ gap: 8 }}>
            <Text style={text.section}>训练建议 · {advice.band.name}</Text>
            {!advice.confirmed && (
              <Text style={[text.muted, { color: colors.warn }]}>单次测试的斜率误差较大。下次复测仍在这一侧，再按这个配比调整训练。</Text>
            )}
            <Text style={text.body}>每周 6 个下肢练习：{advice.band.mix.map((m) => `${m.kind} ${m.n}`).join(' · ')}</Text>
            <Text style={text.muted}>VBT 速度损失到 {Math.round(advice.band.velocityLoss * 100)}% 就停组。</Text>
            {EXERCISE_KINDS.filter((k) => advice.band.mix.some((m) => m.kind === k.kind)).map((k) => (
              <View key={k.kind} style={styles.kind}>
                <Text style={styles.kindName}>{k.kind}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={text.body}>{k.what}</Text>
                  <Text style={text.caption}>{k.zone}</Text>
                </View>
              </View>
            ))}
            <Text style={text.caption}>只是建议，不会改你的训练计划。每 4 周复测一次；约 8 周后 CMJ 和 Pmax 没涨，就换回均衡配比。</Text>
          </Card>
        )}

        {history.length > 1 && (
          <Card style={{ gap: 10 }}>
            <Text style={text.section}>历次测试 · FV%（100 = 均衡）</Text>
            <TrendChart color={COLOR} points={history.slice(-12).map((s) => ({ label: shortDate(s.startedAt), value: s.profile.fvPct, display: String(Math.round(s.profile.fvPct)) }))} />
            <Text style={text.section}>Pmax（W/kg）</Text>
            <TrendChart color={colors.accent} points={history.slice(-12).map((s) => ({ label: shortDate(s.startedAt), value: s.profile.pmax, display: s.profile.pmax.toFixed(1) }))} />
            <Text style={text.caption}>按现在的体重和蹬伸距离重算。</Text>
          </Card>
        )}
      </ScrollView>
      <View style={styles.footer}>
        <Button label="完成" variant={today.length ? 'primary' : 'secondary'} onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

function ProfileCard({ profile, isToday, date, hpo }: { profile: FvProfile; isToday: boolean; date: string; hpo: number }) {
  const band = bandOf(profile.fvPct);
  const unloaded = profile.points.find((p) => p.loadKg === 0);
  return (
    <Card style={{ gap: 10 }}>
      <Text style={text.section}>{isToday ? '今天的力-速度曲线' : `最近一次的力-速度曲线 · ${date}`}</Text>
      <FvChart profile={profile} color={COLOR} />
      <View style={styles.legend}>
        <View style={[styles.swatch, { backgroundColor: COLOR }]} />
        <Text style={text.caption}>你的曲线</Text>
        <View style={[styles.swatch, { backgroundColor: colors.textSoft, height: 1 }]} />
        <Text style={text.caption}>同样功率下跳得最高的曲线</Text>
      </View>
      <View style={styles.stats}>
        <Stat label="F0" value={profile.f0.toFixed(1)} unit="N/kg" />
        <Stat label="v0" value={profile.v0.toFixed(2)} unit="m/s" />
        <Stat label="Pmax" value={profile.pmax.toFixed(1)} unit="W/kg" />
        <Stat label="FV%" value={String(Math.round(profile.fvPct))} unit="" main />
      </View>
      <Text style={text.body}>{SIDE_TEXT[band.side]}（{band.name}）。</Text>
      {unloaded && profile.optimalHeightCm > unloaded.heightCm + 0.5 && (
        <Text style={text.muted}>
          功率不变、只把曲线调到最优，徒手蹲跳约从 {unloaded.heightCm.toFixed(1)} 到 {profile.optimalHeightCm.toFixed(1)} cm；更大的进步要靠 Pmax 本身提高。
        </Text>
      )}
      {profile.r2 < MIN_R2 && <Text style={[text.muted, { color: colors.warn }]}>几个点不太在一条直线上（R² {profile.r2.toFixed(2)}），检查有没有标错帧或跳之前往下顿了，可以把偏离的那级重跳。</Text>}
      <Text style={text.caption}>
        按 {profile.points.length} 级负重、蹬伸距离 {Math.round(hpo * 100)} cm 计算（Samozino 简易法）。
      </Text>
    </Card>
  );
}

function Stat({ label, value, unit, main }: { label: string; value: string; unit: string; main?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={text.caption}>{label}</Text>
      <Text style={[styles.statValue, main && { color: COLOR }]}>{value}</Text>
      <Text style={text.caption}>{unit}</Text>
    </View>
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
  loadRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  load: { width: 64, color: colors.text, fontFamily: fonts.numeric, fontSize: 18 },
  jumps: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  jump: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 28, borderRadius: 14, backgroundColor: colors.surfaceRaised },
  jumpText: { color: colors.textSoft, fontFamily: fonts.numeric, fontSize: 15 },
  mean: { color: COLOR, fontFamily: fonts.numericBold, fontSize: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fields: { flexDirection: 'row', gap: 10 },
  field: { flex: 1, gap: 4 },
  fieldRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  input: { flex: 1, height: 44, borderRadius: 12, backgroundColor: colors.surfaceRaised, color: colors.text, fontFamily: fonts.numeric, fontSize: 20, textAlign: 'center' },
  unit: { color: colors.textMuted, fontSize: 11 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  swatch: { width: 16, height: 3, borderRadius: 2 },
  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', gap: 2, flex: 1 },
  statValue: { color: colors.text, fontFamily: fonts.numericBold, fontSize: 26 },
  kind: { flexDirection: 'row', gap: 10, paddingTop: 6 },
  kindName: { width: 72, color: COLOR, fontSize: 13, fontWeight: '700' },
  footer: { paddingHorizontal: 16, paddingTop: 8 },
});
