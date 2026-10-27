import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Button, Card, Chip, Empty } from '@/components/ui';
import { deleteTrial, newSessionId } from '@/db/repo';
import { addTested1rm, addVbtSet, latestEstimate, listTested1rm, listVbtSets, type Tested1rm, type VbtSet } from '@/db/vbt';
import { manualProblem, parseNumber } from '@/domain/entry';
import { getCategory, getMetric, SQUAT_1RM } from '@/domain/metrics';
import { loadAt, ONE_RM_PROBLEMS, parseRepVelocities, roundLoad, STOP_LOSS, velocityLoss, ZONES, zoneOf } from '@/domain/vbt';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, text } from '@/theme';

const COLOR = getCategory('vbt').color;
/** An estimate this far from a lifted 1RM says the speeds were measured wrong, not that strength changed. */
const ESTIMATE_OFF = 0.1;

/** Logs the sets of one VBT exercise: load, reps and mean velocity, typed in, copied from VBTgo or tracked from video. */
export default function VbtSession() {
  const { lift, session } = useLocalSearchParams<{ lift: string; session: string }>();
  const def = getMetric(lift);
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [all, setAll] = useState<VbtSet[]>([]);
  const [kg, setKg] = useState('');
  const [reps, setReps] = useState('3');
  const [v, setV] = useState('');
  const [fromVbtgo, setFromVbtgo] = useState(false);
  const [tested, setTested] = useState<Tested1rm | null>(null);
  const [testedKg, setTestedKg] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!current) return;
    const rows = await listVbtSets(db, current.id, lift);
    setAll(rows);
    if (lift === 'vbt_squat') setTested((await listTested1rm(db, current.id)).at(-1) ?? null);
    const last = rows.at(-1);
    if (last) setKg((k) => k || String(last.load));
  }, [db, current, lift]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  if (!def) return <Empty title="找不到这个动作" />;
  const sets = all.filter((s) => s.session_id === session);
  const load = parseNumber(kg);
  // One mean velocity, or one per rep as VBTgo lists them; the set is logged at its fastest rep.
  const repV = parseRepVelocities(v);
  const velocity = repV ? Math.max(...repV) : null;
  const repsN = repV && repV.length > 1 ? repV.length : parseNumber(reps);
  const vProblem = v.trim() && !repV ? '速度填数字，多次之间用空格隔开' : (repV?.map((x) => manualProblem(def, x)).find((p) => p) ?? null);
  const loadOk = load != null && load >= 0 && load <= 400;
  const est = latestEstimate(all, lift);
  const today = est?.sessionId === session ? est : null;
  const testedValue = parseNumber(testedKg);
  const testedProblem = testedValue != null ? manualProblem(SQUAT_1RM, testedValue) : null;
  const off = est?.oneRm != null && tested ? est.oneRm / tested.kg - 1 : null;

  async function logManual() {
    if (!current || !loadOk || velocity == null || vProblem) return;
    setSaving(true);
    try {
      await addVbtSet(db, current.id, session, lift, {
        load: load!,
        v: velocity,
        reps: repsN != null ? Math.round(repsN) : null,
        source: fromVbtgo ? 'vbtgo' : 'manual',
        ...(repV && repV.length > 1 ? { repV } : {}),
      });
      Haptics.selectionAsync();
      setV('');
      await reload();
    } catch (e) {
      Alert.alert('保存失败', String(e));
    } finally {
      setSaving(false);
    }
  }

  function measureVideo() {
    if (!loadOk) return Alert.alert('先填这一组的重量');
    router.push({ pathname: '/vbt/track', params: { lift, session, load: String(load) } });
  }

  async function saveTested() {
    if (!current || testedValue == null || testedProblem) return;
    await addTested1rm(db, current.id, newSessionId(), testedValue);
    Haptics.selectionAsync();
    setTestedKg('');
    await reload();
  }

  function remove(s: VbtSet, n: number) {
    Alert.alert(`删除第 ${n} 组？`, '', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => (await deleteTrial(db, s.id), reload()) },
    ]);
  }

  // Fastest set at each load so far, the reference for velocity loss.
  const fastest = (upTo: number, kgAt: number) => Math.max(...sets.slice(0, upTo + 1).filter((s) => s.load === kgAt).map((s) => s.v));

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: def.name }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {sets.length > 0 ? (
          <Card style={{ gap: 4 }}>
            {sets.map((s, i) => {
              const loss = velocityLoss(fastest(i, s.load), s.v);
              const stop = loss >= STOP_LOSS;
              return (
                <View key={s.id} style={styles.setRow}>
                  <Text style={styles.setNo}>{i + 1}</Text>
                  <Text style={styles.setLoad}>
                    {s.load} kg{s.reps ? ` × ${s.reps}` : ''}
                  </Text>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={styles.setV}>{s.v.toFixed(2)} m/s</Text>
                    <Text style={[text.caption, stop && { color: colors.warn }]}>{stop ? `速度损失 ${Math.round(loss * 100)}%，建议停组` : zoneOf(s.v).name}</Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={`删除第 ${i + 1} 组`} onPress={() => remove(s, i + 1)} style={styles.trash}>
                    <Icon name="trash" size={16} color={colors.textMuted} />
                  </Pressable>
                </View>
              );
            })}
          </Card>
        ) : (
          <Text style={text.muted}>从轻重量开始逐组加重，每组记重量和平均速度。三个以上不同重量、最重一组够慢后，会估算 1RM。</Text>
        )}

        <Card style={{ gap: 12 }}>
          <Text style={text.section}>第 {sets.length + 1} 组</Text>
          <View style={styles.fields}>
            <Field label="重量" unit="kg" value={kg} onChange={setKg} />
            <Field label="次数" unit="次" value={repV && repV.length > 1 ? String(repV.length) : reps} onChange={setReps} integer />
          </View>
          <View style={styles.sourceRow}>
            <Text style={text.caption}>速度来自</Text>
            <Chip label="手填" selected={!fromVbtgo} onPress={() => setFromVbtgo(false)} color={COLOR} />
            <Chip label="照抄 VBTgo" selected={fromVbtgo} onPress={() => setFromVbtgo(true)} color={COLOR} />
          </View>
          <Field
            label={fromVbtgo ? '每次的 Mean V（空格隔开）' : '平均速度（多次用空格隔开）'}
            unit="m/s"
            value={v}
            onChange={setV}
            wide
          />
          {vProblem ? <Text style={styles.problem}>{vProblem}</Text> : null}
          {repV && repV.length > 1 && !vProblem ? <Text style={text.caption}>{repV.length} 次，按最快一次 {velocity!.toFixed(2)} m/s 记这一组</Text> : null}
          <Button label="记一组" onPress={logManual} disabled={!loadOk || velocity == null || vProblem != null} busy={saving} />
          <Button label="录像自动测速" variant="secondary" onPress={measureVideo} />
          <Text style={text.caption}>录像测速：侧面拍一整组，圈出 45 cm 杠铃片，自动跟踪算出每一次的平均速度，不用逐帧标。</Text>
        </Card>

        {lift === 'vbt_squat' && (
          <Card style={{ gap: 10 }}>
            <Text style={text.section}>实测 1RM</Text>
            <Text style={text.caption}>
              {tested ? `最近一次 ${tested.kg} kg（${tested.at.slice(0, 10)}）。` : ''}填你真正举起过的最大重量，训练计划和扣篮诊断会优先用它，不用速度估算。
            </Text>
            <View style={styles.videoRow}>
              <Field label="深蹲 1RM" unit="kg" value={testedKg} onChange={setTestedKg} />
              <Button label="保存" variant="secondary" onPress={saveTested} disabled={testedValue == null || testedProblem != null} style={{ flex: 1 }} />
            </View>
            {testedProblem ? <Text style={styles.problem}>{testedProblem}</Text> : null}
          </Card>
        )}

        {est && (
          <Card style={{ gap: 8 }}>
            <Text style={text.section}>{today ? '今天的载荷-速度曲线' : '最近一次的载荷-速度曲线'}</Text>
            {est.oneRm != null && (
              <Text style={styles.oneRm}>
                估算 1RM {Math.round(est.oneRm)} <Text style={styles.unit}>kg</Text>
              </Text>
            )}
            {est.problem && <Text style={text.caption}>不估 1RM：{ONE_RM_PROBLEMS[est.problem]}。</Text>}
            {off != null && Math.abs(off) > ESTIMATE_OFF && (
              <Text style={styles.problem}>
                比你实测的 {tested!.kg} kg {off > 0 ? '高' : '低'}了 {Math.round(Math.abs(off) * 100)}%：多半是速度测{off > 0 ? '快' : '慢'}了。训练计划仍按实测 1RM 推荐重量。
              </Text>
            )}
            {ZONES.slice(0, 4).map((z) => {
              const hi = roundLoad(loadAt(est.profile, z.min === 0 ? 0.3 : z.min));
              const lo = roundLoad(loadAt(est.profile, z.max));
              if (hi <= 0 || lo >= hi) return null;
              return (
                <View key={z.key} style={styles.zoneRow}>
                  <Text style={text.body}>{z.name}</Text>
                  <Text style={styles.zoneLoad}>
                    {Math.max(0, lo)}–{hi} kg
                  </Text>
                </View>
              );
            })}
            <Text style={text.caption}>
              按 {est.profile.n} 个重量（每个重量取最快一组）拟合。{tested ? '训练计划里的深蹲按实测 1RM 推荐重量。' : est.oneRm != null ? '训练计划里的深蹲会按估算 1RM 推荐重量。' : ''}
            </Text>
          </Card>
        )}
      </ScrollView>
      <View style={styles.footer}>
        <Button label="完成" variant={sets.length ? 'primary' : 'secondary'} onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

function Field({ label, unit, value, onChange, integer, wide }: { label: string; unit: string; value: string; onChange: (s: string) => void; integer?: boolean; wide?: boolean }) {
  return (
    <View style={wide ? { gap: 4 } : styles.field}>
      <Text style={text.caption}>{label}</Text>
      <View style={styles.fieldRow}>
        <TextInput
          value={value}
          onChangeText={onChange}
          // Several speeds need a space between them, which the decimal pad doesn't have.
          keyboardType={integer ? 'number-pad' : wide ? 'numbers-and-punctuation' : 'decimal-pad'}
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
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  setNo: { width: 18, color: colors.textMuted, fontFamily: fonts.numeric, fontSize: 16 },
  setLoad: { color: colors.text, fontFamily: fonts.numeric, fontSize: 18 },
  setV: { color: COLOR, fontFamily: fonts.numericBold, fontSize: 20 },
  trash: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  fields: { flexDirection: 'row', gap: 10 },
  field: { flex: 1, gap: 4 },
  fieldRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  input: { flex: 1, height: 44, borderRadius: 12, backgroundColor: colors.surfaceRaised, color: colors.text, fontFamily: fonts.numeric, fontSize: 20, textAlign: 'center' },
  unit: { color: colors.textMuted, fontSize: 11 },
  problem: { color: colors.warn, fontSize: 13 },
  videoRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  oneRm: { color: COLOR, fontFamily: fonts.numericBold, fontSize: 36 },
  zoneRow: { flexDirection: 'row', justifyContent: 'space-between' },
  zoneLoad: { color: colors.textSoft, fontFamily: fonts.numeric, fontSize: 17 },
  footer: { paddingHorizontal: 16, paddingTop: 8 },
});
