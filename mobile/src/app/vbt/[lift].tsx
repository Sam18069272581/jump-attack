import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Button, Card, Empty } from '@/components/ui';
import { deleteTrial } from '@/db/repo';
import { addVbtSet, latestEstimate, listVbtSets, type VbtSet } from '@/db/vbt';
import { manualProblem, parseNumber } from '@/domain/entry';
import { getCategory, getMetric } from '@/domain/metrics';
import { loadAt, roundLoad, STOP_LOSS, velocityLoss, ZONES, zoneOf } from '@/domain/vbt';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, text } from '@/theme';

const COLOR = getCategory('vbt').color;
/** Typical bar travel (cm) for a first video measurement; the athlete's own value is kept after that. */
const DEFAULT_ROM: Record<string, number> = { vbt_squat: 55, vbt_squat_jump: 45, vbt_clean: 80, vbt_pull: 65 };

/** Logs the sets of one VBT exercise: load, reps and mean velocity, typed in or measured from video. */
export default function VbtSession() {
  const { lift, session } = useLocalSearchParams<{ lift: string; session: string }>();
  const def = getMetric(lift);
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [all, setAll] = useState<VbtSet[]>([]);
  const [kg, setKg] = useState('');
  const [reps, setReps] = useState('3');
  const [v, setV] = useState('');
  const [rom, setRom] = useState(String(DEFAULT_ROM[lift] ?? DEFAULT_ROM[lift.replace(/_(floor|hang|power)$/, '')] ?? 60));
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!current) return;
    const rows = await listVbtSets(db, current.id, lift);
    setAll(rows);
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
  const velocity = parseNumber(v);
  const repsN = parseNumber(reps);
  const vProblem = velocity != null ? manualProblem(def, velocity) : null;
  const loadOk = load != null && load >= 0 && load <= 400;
  const est = latestEstimate(all, lift);
  const today = est?.sessionId === session ? est : null;

  async function logManual() {
    if (!current || !loadOk || velocity == null || vProblem) return;
    setSaving(true);
    try {
      await addVbtSet(db, current.id, session, lift, { load: load!, v: velocity, reps: repsN != null ? Math.round(repsN) : null, source: 'manual' });
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
    const romCm = parseNumber(rom);
    if (!loadOk || romCm == null || romCm <= 0) return Alert.alert('先填重量和杠铃行程', '行程是杠铃从最低点到最高点的距离，用卷尺量一次就行。');
    router.push({ pathname: '/measure/capture', params: { metric: lift, session, from: 'vbt', load: String(load), reps: String(repsN ?? ''), rom: String(romCm) } });
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
          <Text style={text.muted}>从轻重量开始逐组加重，每组记重量和平均速度。两个以上不同重量后会算出今天的载荷-速度曲线。</Text>
        )}

        <Card style={{ gap: 12 }}>
          <Text style={text.section}>第 {sets.length + 1} 组</Text>
          <View style={styles.fields}>
            <Field label="重量" unit="kg" value={kg} onChange={setKg} />
            <Field label="次数" unit="次" value={reps} onChange={setReps} integer />
            <Field label="平均速度" unit="m/s" value={v} onChange={setV} />
          </View>
          {vProblem ? <Text style={styles.problem}>{vProblem}</Text> : null}
          <Button label="记一组" onPress={logManual} disabled={!loadOk || velocity == null || vProblem != null} busy={saving} />
          <View style={styles.videoRow}>
            <Field label="杠铃行程" unit="cm" value={rom} onChange={setRom} />
            <Button label="录像测速" variant="secondary" onPress={measureVideo} style={{ flex: 1 }} />
          </View>
          <Text style={text.caption}>没有测速设备时，用慢动作拍一组里最快的一次，逐帧标出向心开始和结束，按行程 ÷ 时间算平均速度。</Text>
        </Card>

        {est && (
          <Card style={{ gap: 8 }}>
            <Text style={text.section}>{today ? '今天的载荷-速度曲线' : '最近一次的载荷-速度曲线'}</Text>
            {est.oneRm != null && (
              <Text style={styles.oneRm}>
                估算 1RM {Math.round(est.oneRm)} <Text style={styles.unit}>kg</Text>
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
              按 {est.profile.n} 组数据拟合{est.profile.r2 < 0.8 ? '，数据点比较散，结果仅供参考' : ''}。训练计划里的深蹲会按估算 1RM 推荐重量。
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

function Field({ label, unit, value, onChange, integer }: { label: string; unit: string; value: string; onChange: (s: string) => void; integer?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={text.caption}>{label}</Text>
      <View style={styles.fieldRow}>
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType={integer ? 'number-pad' : 'decimal-pad'}
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
  oneRm: { color: COLOR, fontFamily: fonts.numericBold, fontSize: 36 },
  zoneRow: { flexDirection: 'row', justifyContent: 'space-between' },
  zoneLoad: { color: colors.textSoft, fontFamily: fonts.numeric, fontSize: 17 },
  footer: { paddingHorizontal: 16, paddingTop: 8 },
});
