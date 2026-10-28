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
import { addVbtSet, listVbtSets } from '@/db/vbt';
import { shortDate, toISODate } from '@/domain/dates';
import { parseNumber } from '@/domain/entry';
import { formatPrescription, formatRpe, isLoaded, personalNote, planDay, summarizeWorkout, type LoggedSet, type PersonalNumbers, type Prescription } from '@/domain/plan';
import { allowanceText, checkSet, setTarget, STATE_LABEL, usualWarmupLoad, type DayReading } from '@/domain/target';
import { LOAD_FROM_VBT } from '@/domain/vbt';
import { useAthlete } from '@/state/athlete';
import { beginWorkout, loadDay, loadPersonalNumbers, loadSuggestions, loadTraining, sessionFor, type Day, type LoadSuggestion, type TrainingData } from '@/state/training';
import { colors, fonts, radius, text } from '@/theme';

type Loaded =
  | {
      data: TrainingData;
      workout: Workout;
      sets: LoggedSet[];
      loads: Record<string, number>;
      suggested: Record<string, LoadSuggestion>;
      day: Day & DayReading;
      /** Usual warm-up load per VBT lift. */
      warmupKg: Record<string, number | null>;
      personal: PersonalNumbers;
    }
  | 'none';

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
    const planned = planDay(data.template, data.plan, date);
    const items = planned ? sessionFor(planned, workout, null).session.items : [];
    const day = await loadDay(db, data.plan, date, workout);
    const lifts = [...new Set(items.map((p) => LOAD_FROM_VBT[p.code]).filter((l): l is string => l != null))];
    const [sets, loads, suggested, warmups, personal] = await Promise.all([
      listSets(db, workout.id),
      lastLoads(db, current.id),
      loadSuggestions(db, current.id, items, date, day),
      Promise.all(lifts.map(async (l) => [l, usualWarmupLoad(await listVbtSets(db, current.id, l), date)] as const)),
      loadPersonalNumbers(db, current.id, date),
    ]);
    setLoaded({ data, workout, sets, loads, suggested, day, warmupKg: Object.fromEntries(warmups), personal });
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

  const { workout, sets, loads, suggested, day, warmupKg, personal } = loaded;
  // A session made up (or logged) on a later day than planned.
  const startedOn = toISODate(new Date(workout.startedAt));
  const { session } = sessionFor(planned, workout, null);
  const summary = summarizeWorkout(session, sets);
  const done = workout.finishedAt != null;
  const logged = (code: string, n: number) => sets.find((s) => s.exercise_code === code && s.set_no === n);
  const allowance = allowanceText(day.state, day.block);
  // Without a VBT estimate the weight lifted last time is eased instead.
  const fromLast = (code: string) => (loads[code] != null ? setTarget(loads[code], null, day.state, day.block) : null);

  async function toggle(p: Prescription, setNo: number, entry: LoggedSet | null) {
    Haptics.selectionAsync();
    if (entry) await logSet(db, workout.id, entry);
    else await unlogSet(db, workout.id, p.code, setNo);
    await reload();
    const v = entry?.mean_velocity;
    if (v == null) return;
    const others = sets.filter((s) => s.exercise_code === p.code && s.set_no !== setNo && s.mean_velocity != null).map((s) => s.mean_velocity!);
    const check = checkSet(v, suggested[p.code]?.minV ?? null, others.length ? Math.max(...others) : null);
    if (check.stop) Alert.alert('今天到这里为止', `${check.why}。${p.name}剩下的组今天不做了，硬练只会积累疲劳。`);
  }

  async function logWarmup(lift: string, kg: number, v: number) {
    if (!current) return;
    await addVbtSet(db, current.id, `warmup-${workout.id}-${lift}`, lift, { load: kg, v, reps: null, source: 'manual' });
    Haptics.selectionAsync();
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
        {startedOn > date && <Text style={styles.suggest}>{startedOn === toISODate(new Date()) ? '今天' : shortDate(startedOn)}补上这节课</Text>}

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

        <AdjustmentNote adjustments={workout.adjustments} reason={workout.reason} dropPct={workout.cmjDrop} />

        {(day.state === 'fair' || day.state === 'poor') && (
          <View style={[styles.dayNote, day.state === 'poor' && { borderColor: colors.warn }]}>
            <Text style={[styles.dayTitle, day.state === 'poor' && { color: colors.warn }]}>今天状态{STATE_LABEL[day.state]}</Text>
            {day.reasons.map((r) => (
              <Text key={r} style={styles.dayLine}>
                · {r}
              </Text>
            ))}
            {allowance && <Text style={styles.dayLine}>{allowance}</Text>}
            {day.state === 'poor' && <Text style={styles.dayLine}>今天的成绩不计入进步趋势。</Text>}
          </View>
        )}

        {session.items.map((p) => (
          <Card key={p.code} style={{ gap: 8 }}>
            <View style={styles.exHead}>
              <Text style={text.section}>{p.name}</Text>
              <Text style={styles.dose}>{formatPrescription(p)}</Text>
            </View>
            {p.cue ? <Text style={text.caption}>{p.cue}</Text> : null}
            {personalNote(p.code, personal) && <Text style={styles.suggest}>{personalNote(p.code, personal)}</Text>}
            {suggested[p.code] && <SuggestionLine p={p} s={suggested[p.code]} />}
            {!suggested[p.code] && isLoaded(p) && (fromLast(p.code)?.loadFactor ?? 1) < 1 && (
              <Text style={styles.suggest}>
                上次 {loads[p.code]} kg，今天状态{STATE_LABEL[day.state]}，建议 {fromLast(p.code)!.kg} kg
              </Text>
            )}
            {LOAD_FROM_VBT[p.code] && !done && (
              <WarmupRow
                usualKg={warmupKg[LOAD_FROM_VBT[p.code]] ?? null}
                reading={day.warmup}
                onLog={(kg, v) => logWarmup(LOAD_FROM_VBT[p.code], kg, v)}
              />
            )}
            {Array.from({ length: p.sets }, (_, i) => {
              const n = i + 1;
              const entry = logged(p.code, n);
              // This workout's previous set, then the VBT-based weight, then what was lifted last time (eased for the day).
              const prevKg = logged(p.code, n - 1)?.load_kg ?? suggested[p.code]?.kg ?? fromLast(p.code)?.kg ?? null;
              return (
                <SetRow
                  key={`${n}-${entry ? 'done' : 'open'}`}
                  p={p}
                  setNo={n}
                  entry={entry}
                  suggestedKg={prevKg}
                  minV={suggested[p.code]?.minV ?? null}
                  tracksVelocity={LOAD_FROM_VBT[p.code] != null}
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

/** The VBT-based weight, eased for the day, and the bar speed it should move at. */
function SuggestionLine({ p, s }: { p: Prescription; s: LoadSuggestion }) {
  const eased = s.loadFactor < 1 ? `，今天按状态减到 ${s.kg} kg` : '';
  const line =
    s.minV != null
      ? ` · 达标线 ${s.minV.toFixed(2)} m/s${s.velocityTolerance > 0 && s.targetV != null ? `（目标 ${s.targetV.toFixed(2)}，今天允许慢 ${Math.round(s.velocityTolerance * 100)}%）` : ''}`
      : '';
  return (
    <Text style={styles.suggest}>
      按{s.source === 'tested' ? '实测' : ' VBT 估算'} 1RM {Math.round(s.oneRm)} kg，{p.reps} 次 @ RPE {formatRpe(p.rpe ?? 8)} 建议 {s.baseKg} kg{eased}
      {line}
    </Text>
  );
}

/** A warm-up set at the usual load; its bar speed against the last 30 days is one of the day's signals. */
function WarmupRow({ usualKg, reading, onLog }: { usualKg: number | null; reading: DayReading['warmup']; onLog: (kg: number, v: number) => void }) {
  const [kg, setKg] = useState('');
  const [v, setV] = useState('');
  const load = parseNumber(kg) ?? usualKg;
  const velocity = parseNumber(v);
  const ok = load != null && load > 0 && velocity != null && velocity > 0 && velocity < 3;

  function save() {
    if (!ok) return Alert.alert('请检查数字', '填热身重量和最快一次的平均速度（m/s）');
    onLog(load!, velocity!);
    setV('');
  }

  return (
    <View style={styles.warmup}>
      <Text style={text.caption}>
        {reading
          ? `热身 ${reading.load} kg：${reading.v.toFixed(2)} m/s，是 30 天均值 ${reading.mean.toFixed(2)} 的 ${Math.round(reading.pct * 100)}%（${STATE_LABEL[reading.state]}）`
          : '热身速度：用平时的热身重量做一组，填最快一次的平均速度，和 30 天均值比判断今天的状态'}
      </Text>
      <View style={styles.setRow}>
        <Text style={styles.setNo}>热</Text>
        <Field value={kg} onChange={setKg} placeholder={usualKg != null ? String(usualKg) : '—'} unit="kg" label="热身重量" editable decimal />
        <Field value={v} onChange={setV} placeholder="0.00" unit="m/s" label="热身速度" editable decimal />
        <View style={{ flex: 1 }} />
        <Button label="记录" variant="secondary" onPress={save} />
      </View>
    </View>
  );
}

function SetRow({
  p,
  setNo,
  entry,
  suggestedKg,
  minV,
  tracksVelocity,
  locked,
  onToggle,
}: {
  p: Prescription;
  setNo: number;
  entry: LoggedSet | undefined;
  suggestedKg: number | null;
  /** Today's pass line for the set's bar speed. */
  minV: number | null;
  tracksVelocity: boolean;
  locked: boolean;
  onToggle: (e: LoggedSet | null) => void;
}) {
  const loaded = isLoaded(p);
  const [reps, setReps] = useState(entry ? String(entry.reps) : '');
  const [kg, setKg] = useState(entry?.load_kg != null ? String(entry.load_kg) : '');
  const [rpe, setRpe] = useState(entry?.rpe != null ? formatRpe(entry.rpe) : '');
  const [v, setV] = useState(entry?.mean_velocity != null ? entry.mean_velocity.toFixed(2) : '');
  const checked = entry != null;
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  const below = entry?.mean_velocity != null && minV != null && entry.mean_velocity < minV;

  function press() {
    if (checked) return onToggle(null);
    const r = num(reps) ?? p.reps;
    const load = loaded ? (num(kg) ?? suggestedKg) : null;
    const velocity = tracksVelocity ? num(v) : null;
    if (!Number.isFinite(r) || r <= 0 || (load != null && !Number.isFinite(load)) || (velocity != null && !(velocity > 0 && velocity < 3))) {
      Alert.alert('请检查数字', '次数、重量和速度要填数字');
      return;
    }
    onToggle({ exercise_code: p.code, set_no: setNo, reps: Math.round(r), load_kg: load, rpe: num(rpe) ?? p.rpe ?? null, mean_velocity: velocity });
  }

  return (
    <View style={[styles.setRow, checked && styles.setRowDone, below && styles.setRowBelow]}>
      <Text style={styles.setNo}>{setNo}</Text>
      <Field value={reps} onChange={setReps} placeholder={String(p.reps)} unit={p.perSide ? '次/侧' : '次'} editable={!checked && !locked} />
      {loaded && <Field value={kg} onChange={setKg} placeholder={suggestedKg != null ? String(suggestedKg) : '—'} unit="kg" editable={!checked && !locked} decimal />}
      {p.rpe != null && <Field value={rpe} onChange={setRpe} placeholder={formatRpe(p.rpe)} unit="RPE" editable={!checked && !locked} decimal />}
      {tracksVelocity && <Field value={v} onChange={setV} placeholder={minV != null ? minV.toFixed(2) : '—'} unit="m/s" editable={!checked && !locked} decimal />}
      <View style={{ flex: 1 }} />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled: locked }}
        accessibilityLabel={`${p.name} 第 ${setNo} 组${checked ? '已完成' : ''}`}
        disabled={locked}
        onPress={press}
        style={[styles.check, checked && styles.checkDone]}
      >
        <Icon name="check" size={18} strokeWidth={3} color={checked ? colors.onAccent : colors.textFaint} />
      </Pressable>
    </View>
  );
}

function Field({
  value,
  onChange,
  placeholder,
  unit,
  label,
  editable,
  decimal,
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder: string;
  unit: string;
  /** Spoken name; defaults to the unit. */
  label?: string;
  editable: boolean;
  decimal?: boolean;
}) {
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
        accessibilityLabel={label ?? unit}
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
  suggest: { color: colors.warn, fontSize: 12 },
  dayNote: { borderRadius: radius.row, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 4 },
  dayTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  dayLine: { color: colors.textSoft, fontSize: 12, lineHeight: 18 },
  warmup: { gap: 4, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  setRowBelow: { borderWidth: 1, borderColor: colors.warn },
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
