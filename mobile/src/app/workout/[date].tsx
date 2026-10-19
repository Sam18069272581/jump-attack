import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AdjustmentNote } from '@/components/training';
import { Button, Card, Empty } from '@/components/ui';
import { finishWorkout, getWorkout, lastLoads, listSets, logSet, unlogSet, type Workout } from '@/db/training';
import { shortDate } from '@/domain/dates';
import { formatPrescription, formatRpe, isLoaded, planDay, summarizeWorkout, type LoggedSet, type Prescription } from '@/domain/plan';
import { useAthlete } from '@/state/athlete';
import { beginWorkout, loadTraining, sessionFor, type TrainingData } from '@/state/training';
import { colors, fonts, radius, text } from '@/theme';

type Loaded = { data: TrainingData; workout: Workout; sets: LoggedSet[]; loads: Record<string, number> } | 'none';

export default function WorkoutScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [finishing, setFinishing] = useState(false);

  const reload = useCallback(async () => {
    if (!current) return;
    const data = await loadTraining(db, current.id);
    // The training tab normally starts the workout; starting here too covers opening it directly.
    const workout = data && ((await getWorkout(db, data.plan.id, date)) ?? (await beginWorkout(db, data, date)));
    if (!data || !workout) return setLoaded('none');
    const [sets, loads] = await Promise.all([listSets(db, workout.id), lastLoads(db, current.id)]);
    setLoaded({ data, workout, sets, loads });
  }, [db, current, date]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  if (loaded === null) return null;
  const planned = loaded !== 'none' && planDay(loaded.data.template, loaded.data.plan, date);
  if (loaded === 'none' || !planned) {
    return (
      <SafeAreaView style={styles.screen}>
        <Empty title="这天没有安排训练" hint="回到训练页看看计划" />
      </SafeAreaView>
    );
  }

  const { workout, sets, loads } = loaded;
  const { session } = sessionFor(planned, workout, null);
  const summary = summarizeWorkout(session, sets);
  const done = workout.finishedAt != null;
  const logged = (code: string, n: number) => sets.find((s) => s.exercise_code === code && s.set_no === n);

  async function toggle(p: Prescription, setNo: number, entry: LoggedSet | null) {
    Haptics.selectionAsync();
    if (entry) await logSet(db, workout.id, entry);
    else await unlogSet(db, workout.id, p.code, setNo);
    await reload();
  }

  async function finish() {
    const go = async () => {
      setFinishing(true);
      await finishWorkout(db, workout.id);
      await reload();
      setFinishing(false);
    };
    if (summary.setsDone < summary.setsPlanned) {
      Alert.alert('结束训练？', `还有 ${summary.setsPlanned - summary.setsDone} 组没打勾，会按已完成的记录。`, [
        { text: '继续练', style: 'cancel' },
        { text: '结束', onPress: go },
      ]);
    } else {
      await go();
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: `${session.code} · ${session.name}` }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text style={text.muted}>
          {shortDate(date)} · {session.focus}
        </Text>

        {done && (
          <Card style={{ gap: 10 }}>
            <Text style={[text.section, { color: colors.good }]}>训练完成</Text>
            <View style={styles.stats}>
              <Stat label="完成组数" value={`${summary.setsDone}/${summary.setsPlanned}`} />
              <Stat label="跳跃次数" value={String(summary.jumps)} />
              <Stat label="训练量" value={`${summary.volumeKg}`} unit="kg" />
            </View>
            {workout.adjustments.length === 0 && <Text style={text.caption}>{workout.readiness === 'ready' ? '准备度正常，按计划完成。' : '没测 CMJ，按原计划完成。'}</Text>}
          </Card>
        )}

        <AdjustmentNote adjustments={workout.adjustments} dropPct={workout.cmjDrop} />

        {session.items.map((p) => (
          <Card key={p.code} style={{ gap: 8 }}>
            <View style={styles.exHead}>
              <Text style={text.section}>{p.name}</Text>
              <Text style={styles.dose}>{formatPrescription(p)}</Text>
            </View>
            {p.cue ? <Text style={text.caption}>{p.cue}</Text> : null}
            {Array.from({ length: p.sets }, (_, i) => {
              const n = i + 1;
              const entry = logged(p.code, n);
              const prevKg = logged(p.code, n - 1)?.load_kg ?? loads[p.code] ?? null;
              return (
                <SetRow
                  key={`${n}-${entry ? 'done' : 'open'}`}
                  p={p}
                  setNo={n}
                  entry={entry}
                  suggestedKg={prevKg}
                  locked={done}
                  onToggle={(e) => toggle(p, n, e)}
                />
              );
            })}
          </Card>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        {done ? <Button label="返回训练页" variant="secondary" onPress={() => router.back()} /> : <Button label="完成训练" onPress={finish} busy={finishing} />}
      </View>
    </SafeAreaView>
  );
}

function SetRow({
  p,
  setNo,
  entry,
  suggestedKg,
  locked,
  onToggle,
}: {
  p: Prescription;
  setNo: number;
  entry: LoggedSet | undefined;
  suggestedKg: number | null;
  locked: boolean;
  onToggle: (e: LoggedSet | null) => void;
}) {
  const loaded = isLoaded(p);
  const [reps, setReps] = useState(entry ? String(entry.reps) : '');
  const [kg, setKg] = useState(entry?.load_kg != null ? String(entry.load_kg) : '');
  const [rpe, setRpe] = useState(entry?.rpe != null ? formatRpe(entry.rpe) : '');
  const checked = entry != null;
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

  function press() {
    if (checked) return onToggle(null);
    const r = num(reps) ?? p.reps;
    const load = loaded ? (num(kg) ?? suggestedKg) : null;
    if (!Number.isFinite(r) || r <= 0 || (load != null && !Number.isFinite(load))) {
      Alert.alert('请检查数字', '次数和重量要填数字');
      return;
    }
    onToggle({ exercise_code: p.code, set_no: setNo, reps: Math.round(r), load_kg: load, rpe: num(rpe) ?? p.rpe ?? null });
  }

  return (
    <View style={[styles.setRow, checked && styles.setRowDone]}>
      <Text style={styles.setNo}>{setNo}</Text>
      <Field value={reps} onChange={setReps} placeholder={String(p.reps)} unit={p.perSide ? '次/侧' : '次'} editable={!checked && !locked} />
      {loaded && <Field value={kg} onChange={setKg} placeholder={suggestedKg != null ? String(suggestedKg) : '—'} unit="kg" editable={!checked && !locked} decimal />}
      {p.rpe != null && <Field value={rpe} onChange={setRpe} placeholder={formatRpe(p.rpe)} unit="RPE" editable={!checked && !locked} decimal />}
      <View style={{ flex: 1 }} />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled: locked }}
        accessibilityLabel={`第 ${setNo} 组${checked ? '已完成' : ''}`}
        disabled={locked}
        onPress={press}
        style={[styles.check, checked && styles.checkDone]}
      >
        <Icon name="check" size={18} strokeWidth={3} color={checked ? colors.onAccent : colors.textFaint} />
      </Pressable>
    </View>
  );
}

function Field({ value, onChange, placeholder, unit, editable, decimal }: { value: string; onChange: (s: string) => void; placeholder: string; unit: string; editable: boolean; decimal?: boolean }) {
  return (
    <View style={styles.field}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
        editable={editable}
        style={styles.input}
        accessibilityLabel={unit}
      />
      <Text style={styles.unit}>{unit}</Text>
    </View>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={text.caption}>{label}</Text>
      <Text style={styles.statValue}>
        {value}
        {unit ? <Text style={styles.unit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  exHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  dose: { color: colors.accent, fontFamily: fonts.numeric, fontSize: 16 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.chip },
  setRowDone: { backgroundColor: colors.accentTile },
  setNo: { width: 18, color: colors.textMuted, fontFamily: fonts.numeric, fontSize: 16, textAlign: 'center' },
  field: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  input: { minWidth: 44, height: 36, paddingHorizontal: 8, borderRadius: 10, backgroundColor: colors.surfaceRaised, color: colors.text, fontFamily: fonts.numeric, fontSize: 18, textAlign: 'center' },
  unit: { color: colors.textMuted, fontSize: 11 },
  check: { width: 40, height: 40, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  stats: { flexDirection: 'row', gap: 8 },
  statValue: { color: colors.text, fontFamily: fonts.numericBold, fontSize: 26 },
  footer: { paddingHorizontal: 16, paddingTop: 8 },
});
