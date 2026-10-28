import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Chip } from '@/components/ui';
import { loadDiagnosis } from '@/db/dunk';
import { getActivePlan, startPlan } from '@/db/training';
import { firstBlock } from '@/domain/blocks';
import { addDays, mondayOf, shortDate, WEEKDAY_NAMES, type ISODate } from '@/domain/dates';
import { BLOCKS, MISSING_TEXT, type BlockType, type DunkDiagnosis } from '@/domain/dunk';
import { planDay, planWeeks, weekDays, type PlanSettings, type PlanTemplate } from '@/domain/plan';
import { defaultWeekdays, getTemplate, TEMPLATES } from '@/domain/templates';
import { useAthlete } from '@/state/athlete';
import { todayISO } from '@/state/training';
import { colors, radius, text } from '@/theme';

type Start = 'today' | 'nextMonday';

export default function NewPlan() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [code, setCode] = useState(TEMPLATES[0].code);
  const template = getTemplate(code)!;
  const [weekdays, setWeekdays] = useState(() => defaultWeekdays(template.sessions.length));
  const [start, setStart] = useState<Start>('today');
  const [saving, setSaving] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DunkDiagnosis | null>(null);
  // The first block of a block plan; null follows the diagnosis.
  const [picked, setPicked] = useState<BlockType | null>(null);

  useEffect(() => {
    if (!current) return;
    let alive = true;
    loadDiagnosis(db, current).then((d) => alive && setDiagnosis(d));
    return () => {
      alive = false;
    };
  }, [db, current]);

  const needed = template.sessions.length;
  const today = todayISO();
  const startDate: ISODate = start === 'today' ? today : addDays(mondayOf(today), 7);
  const ready = weekdays.length === needed;
  const goalDate = current?.goal_date ?? null;
  const block = template.blocks ? firstBlock(diagnosis, startDate, picked ?? undefined, goalDate) : null;
  const settings: PlanSettings = { templateCode: code, startDate, weekdays, goalDate, ...(block ? { blocks: [block] } : {}) };

  function pickTemplate(t: PlanTemplate) {
    setCode(t.code);
    setWeekdays(defaultWeekdays(t.sessions.length));
  }

  function toggleDay(d: number) {
    setWeekdays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : cur.length < needed ? [...cur, d] : cur));
  }

  async function create() {
    if (!current || !ready) return;
    const existing = await getActivePlan(db, current.id);
    const go = async () => {
      setSaving(true);
      try {
        await startPlan(db, current.id, settings);
        router.back();
      } catch (e) {
        Alert.alert('保存失败', String(e));
        setSaving(false);
      }
    };
    if (existing) {
      Alert.alert('更换计划？', `会结束现在的「${getTemplate(existing.templateCode)?.name ?? '计划'}」，已有的训练记录会保留。`, [
        { text: '取消', style: 'cancel' },
        { text: '更换', style: 'destructive', onPress: go },
      ]);
    } else {
      await go();
    }
  }

  // The first week the athlete will see, so the choice of days is concrete.
  const preview = weekDays(startDate)
    .map((d) => planDay(template, settings, d))
    .filter((p) => p != null);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>模板</Text>
        {TEMPLATES.map((t) => {
          const selected = t.code === code;
          const weeks = planWeeks(t);
          return (
            <Pressable
              key={t.code}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => pickTemplate(t)}
              style={[styles.template, selected && { borderColor: colors.accent }]}
            >
              <Text style={text.section}>{t.name}</Text>
              <Text style={styles.meta}>
                每周 {t.sessions.length} 练 · {weeks ? `共 ${weeks} 周` : `${t.weeks.length} 周一循环`}
              </Text>
              <Text style={text.muted}>{t.summary}</Text>
            </Pressable>
          );
        })}

        {block && (
          <>
            <Text style={styles.label}>第一块</Text>
            <View style={styles.days}>
              {(Object.keys(BLOCKS) as BlockType[]).map((b) => (
                <Chip key={b} label={`${BLOCKS[b].name}${diagnosis?.limiter === b ? '（诊断）' : ''}`} selected={block.type === b} onPress={() => setPicked(b)} />
              ))}
            </View>
            <View style={styles.preview}>
              <Text style={text.body}>{block.reason}</Text>
              <Text style={text.muted}>{BLOCKS[block.type].focus}</Text>
              {diagnosis && diagnosis.missing.length > 0 && <Text style={text.caption}>诊断还缺：{diagnosis.missing.map((m) => MISSING_TEXT[m]).join('；')}</Text>}
            </View>
          </>
        )}

        <Text style={styles.label}>训练日（选 {needed} 天，最好隔天）</Text>
        <View style={styles.days}>
          {WEEKDAY_NAMES.map((n, i) => (
            <Chip key={n} label={`周${n}`} selected={weekdays.includes(i + 1)} onPress={() => toggleDay(i + 1)} />
          ))}
        </View>

        <Text style={styles.label}>开始</Text>
        <View style={styles.days}>
          <Chip label="今天开始" selected={start === 'today'} onPress={() => setStart('today')} />
          <Chip label="下周一开始" selected={start === 'nextMonday'} onPress={() => setStart('nextMonday')} />
        </View>

        {ready && (
          <View style={styles.preview}>
            <Text style={styles.label}>第一周</Text>
            {preview.length ? (
              preview.map((p) => (
                <Text key={p.date} style={text.body}>
                  {shortDate(p.date)} · {p.session.code} {p.session.name}
                </Text>
              ))
            ) : (
              <Text style={text.muted}>这周剩下的日子没有训练日，下周开始。</Text>
            )}
          </View>
        )}
      </ScrollView>
      <View style={styles.footer}>
        <Button label={ready ? '开始这个计划' : `还要选 ${needed - weekdays.length} 天`} onPress={create} disabled={!ready} busy={saving} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  label: { color: colors.textMuted, fontSize: 12, marginTop: 8 },
  template: { padding: 16, gap: 6, borderRadius: radius.card, borderWidth: 1.5, borderColor: colors.surface, backgroundColor: colors.surface },
  meta: { color: colors.accent, fontSize: 12 },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preview: { gap: 6, padding: 14, borderRadius: radius.card, backgroundColor: colors.surface },
  footer: { paddingHorizontal: 16, paddingTop: 8 },
});
