import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Chip } from '@/components/ui';
import { newSessionId } from '@/db/repo';
import { latestEstimate, listVbtSets, type VbtSet } from '@/db/vbt';
import { getCategory, VBT_LIFTS } from '@/domain/metrics';
import { ZONES } from '@/domain/vbt';
import { localized, tr } from '@/i18n';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, text } from '@/theme';

const COLOR = getCategory('vbt').color;
const POSITIONS = localized([
  { key: 'floor', name: '地面' },
  { key: 'hang', name: '悬垂' },
  { key: 'power', name: '发力位' },
], 'name');

/** A card per lift; the Olympic pulls pick a start position. */
const LIFTS = localized([
  { name: '深蹲', code: 'vbt_squat', zone: '常用区间：绝对力量 / 加速力量' },
  { name: '高翻', base: 'vbt_clean', zone: '常用区间：速度-力量' },
  { name: '高拉', base: 'vbt_pull', zone: '常用区间：速度-力量 / 速度' },
  { name: '深蹲跳', code: 'vbt_squat_jump', zone: '轻负荷 · 速度 / 速度-力量' },
], 'name', 'zone');

export default function Vbt() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [sets, setSets] = useState<Record<string, VbtSet[]>>({});
  const [pos, setPos] = useState<Record<string, string>>({ vbt_clean: 'hang', vbt_pull: 'floor' });

  useFocusEffect(
    useCallback(() => {
      if (!current) return;
      Promise.all(VBT_LIFTS.map(async (l) => [l.code, await listVbtSets(db, current.id, l.code)] as const)).then((rows) => setSets(Object.fromEntries(rows)));
    }, [db, current]),
  );

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={text.muted}>{tr('追踪杠铃速度，按速度区间控制训练强度')}</Text>
      {LIFTS.map((l) => {
        const code = l.code ?? `${l.base}_${pos[l.base!]}`;
        const lift = VBT_LIFTS.find((x) => x.code === code)!;
        const mine = sets[code] ?? [];
        const last = mine.at(-1);
        const est = latestEstimate(mine, code);
        return (
          <Card key={l.name} style={{ gap: 10 }}>
            <View style={styles.head}>
              <Text style={text.heading}>{lift.name}</Text>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={text.caption}>{tr('上次平均')}</Text>
                <Text style={styles.v}>
                  {last ? last.v.toFixed(2) : '—'} <Text style={styles.unit}>m/s{last?.load ? ` @ ${last.load} kg` : ''}</Text>
                </Text>
              </View>
            </View>
            {l.base && (
              <View style={styles.chips}>
                {POSITIONS.map((p) => (
                  <Chip key={p.key} label={p.name} selected={pos[l.base!] === p.key} onPress={() => setPos((s) => ({ ...s, [l.base!]: p.key }))} color={COLOR} />
                ))}
              </View>
            )}
            <View style={styles.foot}>
              <Text style={[text.caption, { flex: 1 }]}>
                {l.zone}
                {est?.oneRm ? tr(' · 估算 1RM {oneRm} kg', { oneRm: Math.round(est.oneRm) }) : ''}
              </Text>
              <Button label={tr('开始')} onPress={() => router.push({ pathname: '/vbt/[lift]', params: { lift: code, session: newSessionId() } })} style={{ height: 40, paddingHorizontal: 18 }} />
            </View>
          </Card>
        );
      })}

      <Card style={{ gap: 8 }}>
        <Text style={text.section}>{tr('速度区间（平均速度 m/s）')}</Text>
        {ZONES.map((z) => (
          <View key={z.key} style={styles.zone}>
            <Text style={text.body}>{z.name}</Text>
            <Text style={styles.zoneRange}>{z.max === Infinity ? `> ${z.min}` : z.min === 0 ? `< ${z.max}` : `${z.min}–${z.max}`}</Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 8, gap: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  v: { color: COLOR, fontFamily: fonts.numericBold, fontSize: 26 },
  unit: { color: colors.textMuted, fontSize: 12 },
  chips: { flexDirection: 'row', gap: 8 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  zone: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  zoneRange: { color: colors.textSoft, fontFamily: fonts.numeric, fontSize: 16 },
});
