import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Button } from '@/components/ui';
import { createAthlete, updateAthlete, type Athlete } from '@/db/repo';
import { useAthlete } from '@/state/athlete';
import { colors, radius, text } from '@/theme';

function toNumber(s: string): number | null {
  const n = Number(s.replace(',', '.'));
  return s.trim() === '' || Number.isNaN(n) ? null : n;
}

export default function Me() {
  const db = useSQLiteContext();
  const { athletes, current, select, reload } = useAthlete();

  function add() {
    Alert.prompt?.('添加测试对象', '输入名字', async (value) => {
      if (!value?.trim()) return;
      const id = await createAthlete(db, value.trim());
      await reload();
      select(id);
    });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={text.title}>我的</Text>

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
            {Platform.OS === 'ios' && <Button label="添加测试对象" variant="secondary" onPress={add} />}
          </View>

          {/* Keyed so the form starts fresh when switching athlete. */}
          {current && <ProfileForm key={current.id} athlete={current} onSaved={reload} />}

          <Text style={styles.footnote}>数据只保存在这台手机上。Apple 健康、训练计划和云同步会在后续版本加入。</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ProfileForm({ athlete, onSaved }: { athlete: Athlete; onSaved: () => Promise<void> }) {
  const db = useSQLiteContext();
  const [name, setName] = useState(athlete.name);
  const [mass, setMass] = useState(athlete.body_mass_kg?.toString() ?? '');
  const [reach, setReach] = useState(athlete.standing_reach_cm?.toString() ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    await updateAthlete(db, { ...athlete, name: name.trim(), body_mass_kg: toNumber(mass), standing_reach_cm: toNumber(reach) });
    await onSaved();
    setSaving(false);
  }

  return (
    <View style={{ gap: 10 }}>
      <Text style={text.section}>档案</Text>
      <Field label="名字" value={name} onChangeText={setName} />
      <Field label="体重（kg）" value={mass} onChangeText={setMass} keyboardType="decimal-pad" />
      <Field label="站立摸高（cm）" value={reach} onChangeText={setReach} keyboardType="decimal-pad" />
      <Button label="保存" onPress={save} busy={saving} disabled={!name.trim()} />
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
  field: { gap: 6 },
  fieldLabel: { color: colors.textMuted, fontSize: 12 },
  input: { height: 48, borderRadius: 12, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: 14, fontSize: 15 },
  footnote: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
});
