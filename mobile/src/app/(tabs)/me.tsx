import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Button } from '@/components/ui';
import { exportAthlete, findSameAthlete, importAthlete } from '@/db/athleteData';
import { listBodyMass, recordBodyMass } from '@/db/bodyMass';
import { LATEST_VERSION } from '@/db/migrations';
import { clearSavedVideoUris, createAthlete, updateAthlete, type Athlete } from '@/db/repo';
import { describeBackup, parseAthleteFile } from '@/domain/backup';
import { CLEARANCE_CM, dunkLine, RIM_CM } from '@/domain/dunk';
import { toISODate } from '@/domain/dates';
import { pushOff } from '@/domain/fvp';
import { parseGoalDate } from '@/domain/goal';
import { deleteSavedVideos, savedVideos } from '@/media/videos';
import { pickBackupText, shareAthleteFile } from '@/sync/files';
import { useAthlete } from '@/state/athlete';
import { colors, radius, text } from '@/theme';

function toNumber(s: string): number | null {
  const n = Number(s.replace(',', '.'));
  return s.trim() === '' || Number.isNaN(n) ? null : n;
}

export default function Me() {
  const { current, reload } = useAthlete();

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={text.title}>我的</Text>

          <Athletes />

          {/* Keyed so the form starts fresh when switching athlete. */}
          {current && <ProfileForm key={current.id} athlete={current} onSaved={reload} />}

          <Pressable accessibilityRole="button" onPress={() => router.push('/backup')} style={styles.athlete}>
            <Icon name="cloud" size={18} color={colors.textMuted} />
            <Text style={styles.athleteName}>数据备份与同步</Text>
            <Icon name="chevronRight" size={18} color={colors.textMuted} />
          </Pressable>

          {/* Copies of clips in the app's folder: only the native app ever made them. */}
          {Platform.OS !== 'web' && <OldVideos />}

          {Platform.OS === 'web' && (
            <Text style={styles.footnote}>
              网页版的数据保存在这个浏览器里，换浏览器或清除网站数据就看不到了，登录上面的云端同步就不怕丢。iPhone 上用 Safari 点「分享 → 添加到主屏幕」，之后从主屏幕图标打开，数据保存更稳。
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Everyone who uses this phone: pick whose data the app shows, add people, and move one person's data in or out. */
function Athletes() {
  const db = useSQLiteContext();
  const { athletes, current, select, reload } = useAthlete();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

  async function add() {
    if (!name.trim()) return;
    const id = await createAthlete(db, name.trim());
    setName('');
    await reload();
    select(id);
  }

  async function exportFile() {
    if (!current) return;
    setBusy('export');
    try {
      await shareAthleteFile(await exportAthlete(db, current.id));
    } finally {
      setBusy(null);
    }
  }

  async function importFile() {
    const picked = await pickBackupText();
    if (picked == null) return;
    const parsed = parseAthleteFile(picked, LATEST_VERSION);
    if (!parsed.ok) {
      Alert.alert('没有导入', parsed.problem);
      return;
    }
    const file = parsed.file;
    const run = async (replace?: number) => {
      setBusy('import');
      const r = await importAthlete(db, file, { replace });
      setBusy(null);
      if (!r.ok) {
        Alert.alert('没有导入', r.problem);
        return;
      }
      await reload();
      select(r.athleteId);
    };
    const same = await findSameAthlete(db, file);
    if (!same) {
      // Added next to everyone else, so nothing on the phone changes.
      await run();
      return;
    }
    Alert.alert(`更新${same.name}的数据？`, `文件里：${describeBackup(file)}\n\n${same.name}在这台手机上的记录会换成文件里的，不能撤销；其他人的数据不受影响。`, [
      { text: '取消', style: 'cancel' },
      { text: '更新', style: 'destructive', onPress: () => void run(same.id) },
    ]);
  }

  return (
    <View style={{ gap: 10 }}>
      <Text style={text.section}>测试对象</Text>
      {athletes.map((a) => {
        const selected = a.id === current?.id;
        return (
          <Pressable key={a.id} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => select(a.id)} style={[styles.athlete, selected && styles.athleteSelected]}>
            <Icon name="user" size={18} color={selected ? colors.accent : colors.textMuted} />
            <Text style={[styles.athleteName, selected && { color: colors.accent }]}>{a.name}</Text>
            {selected && <Icon name="check" size={18} color={colors.accent} />}
          </Pressable>
        );
      })}
      <View style={styles.addRow}>
        <TextInput
          accessibilityLabel="新运动员的名字"
          value={name}
          onChangeText={setName}
          onSubmitEditing={add}
          placeholder="添加一个人：输入名字"
          placeholderTextColor={colors.textFaint}
          returnKeyType="done"
          style={[styles.input, { flex: 1 }]}
        />
        <Button label="添加" variant="secondary" onPress={add} disabled={!name.trim()} style={{ paddingHorizontal: 18 }} />
      </View>
      {athletes.length > 1 && (
        <Pressable accessibilityRole="button" onPress={() => router.push('/team')} style={styles.athlete}>
          <Icon name="trend" size={18} color={colors.textMuted} />
          <Text style={styles.athleteName}>团队总览</Text>
          <Icon name="chevronRight" size={18} color={colors.textMuted} />
        </Pressable>
      )}
      <View style={styles.addRow}>
        {current && <Button label={`导出 ${current.name} 的数据`} variant="ghost" onPress={exportFile} busy={busy === 'export'} style={{ flex: 1 }} />}
        <Button label="导入运动员" variant="ghost" onPress={importFile} busy={busy === 'import'} style={{ flex: 1 }} />
      </View>
      <Text style={styles.footnote}>一台手机可以记好几个人，测之前先点选是谁。导出的文件只含这个人的数据，可以发给本人导入到他自己的手机；云端同步备份的是这台手机上的所有人。</Text>
    </View>
  );
}

function ProfileForm({ athlete, onSaved }: { athlete: Athlete; onSaved: () => Promise<void> }) {
  const db = useSQLiteContext();
  const [name, setName] = useState(athlete.name);
  const [mass, setMass] = useState(athlete.body_mass_kg?.toString() ?? '');
  const [reach, setReach] = useState(athlete.standing_reach_cm?.toString() ?? '');
  const [leg, setLeg] = useState(athlete.leg_length_cm?.toString() ?? '');
  const [squat, setSquat] = useState(athlete.squat_height_cm?.toString() ?? '');
  const [rim, setRim] = useState(athlete.rim_height_cm?.toString() ?? '');
  const [clearance, setClearance] = useState(athlete.dunk_clearance_cm?.toString() ?? '');
  const [goal, setGoal] = useState(athlete.goal_date ?? '');
  const [saving, setSaving] = useState(false);
  const goalDate = parseGoalDate(goal);
  const legCm = toNumber(leg);
  const squatCm = toNumber(squat);
  const hpo = legCm != null && squatCm != null ? pushOff(legCm, squatCm) : null;

  async function save() {
    if (!name.trim() || !goalDate.ok) return;
    setSaving(true);
    // A new weight goes into the history too, so tests are read against the mass of their own week.
    const kg = toNumber(mass);
    if (kg != null && (kg !== athlete.body_mass_kg || (await listBodyMass(db, athlete.id)).length === 0)) {
      await recordBodyMass(db, athlete.id, kg, toISODate(new Date()));
    }
    await updateAthlete(db, {
      ...athlete,
      name: name.trim(),
      body_mass_kg: toNumber(mass),
      standing_reach_cm: toNumber(reach),
      leg_length_cm: legCm,
      squat_height_cm: squatCm,
      rim_height_cm: toNumber(rim),
      dunk_clearance_cm: toNumber(clearance),
      goal_date: goalDate.date,
    });
    await onSaved();
    setSaving(false);
  }

  return (
    <View style={{ gap: 10 }}>
      <Text style={text.section}>档案</Text>
      <Field label="名字" value={name} onChangeText={setName} />
      <Field label="体重（kg）" value={mass} onChangeText={setMass} keyboardType="decimal-pad" />
      <Field label="站立摸高（cm）" value={reach} onChangeText={setReach} keyboardType="decimal-pad" />
      <Field label="腿长（cm）· 踮脚站立，大转子到脚尖" value={leg} onChangeText={setLeg} keyboardType="decimal-pad" />
      <Field label="90° 下蹲时大转子离地（cm）" value={squat} onChangeText={setSquat} keyboardType="decimal-pad" />
      <Text style={styles.footnote}>
        {hpo != null
          ? `蹬伸距离 ${Math.round(hpo * 100)} cm，用于力-速度曲线。`
          : legCm != null && squatCm != null
            ? '腿长减下蹲高度应在 15–70 cm 之间，检查一下两个数。'
            : '后两项用于力-速度曲线：大转子是大腿外侧最突出的骨点，下蹲到膝关节 90°、脚跟着地时量。'}
      </Text>
      <Text style={[text.section, { paddingTop: 8 }]}>扣篮目标</Text>
      <Field label="篮筐高度（cm）" value={rim} onChangeText={setRim} keyboardType="decimal-pad" placeholder={String(RIM_CM)} />
      <Field label="过筐余量（cm）· 手要高出篮筐多少才扣得进" value={clearance} onChangeText={setClearance} keyboardType="decimal-pad" placeholder={String(CLEARANCE_CM)} />
      <Text style={styles.footnote}>
        扣篮线 {dunkLine(toNumber(rim), toNumber(clearance))} cm。单手能抓住球约需高出篮筐 15 cm；手小要托球或想双手扣，余量再加大。
      </Text>
      <Field label="目标日 · 哪天前要扣进" value={goal} onChangeText={setGoal} placeholder="2026-12-01" autoCapitalize="none" autoCorrect={false} />
      <Text style={[styles.footnote, !goalDate.ok && { color: colors.warn }]}>
        {goalDate.ok ? '计划按它倒推：不到 6 周不再开力量块，最后 10 天量减半，当天测摸高、试扣。' : goalDate.problem}
      </Text>
      <Button label="保存" onPress={save} busy={saving} disabled={!name.trim() || !goalDate.ok} />
    </View>
  );
}

/** Copies of marked clips that earlier versions kept; the originals are still in the photo library. */
function OldVideos() {
  const db = useSQLiteContext();
  const [stored, setStored] = useState<{ count: number; bytes: number } | null>(null);

  useEffect(() => {
    savedVideos().then(setStored, () => setStored(null));
  }, []);

  if (!stored?.count) return null;
  const mb = Math.round(stored.bytes / 1e6);

  function confirmClear() {
    Alert.alert('清理旧录像？', `删除 App 里保存的 ${stored!.count} 段录像副本，释放约 ${mb} MB。原视频还在相册里，测试成绩不受影响。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '清理',
        style: 'destructive',
        onPress: async () => {
          await deleteSavedVideos();
          await clearSavedVideoUris(db);
          setStored({ count: 0, bytes: 0 });
        },
      },
    ]);
  }

  return (
    <View style={{ gap: 10 }}>
      <Text style={text.section}>存储</Text>
      <Text style={text.muted}>
        {stored.count} 段旧录像，共 {mb} MB
      </Text>
      <Button label="清理旧录像" variant="secondary" onPress={confirmClear} />
    </View>
  );
}

function Field({ label, ...input }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={colors.textFaint} style={styles.input} {...input} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 28, gap: 24 },
  athlete: { height: 56, borderRadius: radius.row, backgroundColor: colors.surface, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: 'transparent' },
  athleteSelected: { borderColor: colors.accent },
  athleteName: { flex: 1, color: colors.text, fontSize: 15 },
  addRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  field: { gap: 6 },
  fieldLabel: { color: colors.textMuted, fontSize: 12 },
  input: { height: 48, borderRadius: 12, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: 14, fontSize: 15 },
  footnote: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
});
