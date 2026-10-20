import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Button } from '@/components/ui';
import { latestResults, newSessionId, type SessionResult } from '@/db/repo';
import { parseNumber } from '@/domain/entry';
import { sprintDistance } from '@/domain/interval';
import { formatValue, getCategory, sprintMetric, SPRINT_DISTANCES, type MetricDef } from '@/domain/metrics';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius, text } from '@/theme';

const COLOR = getCategory('speed').color;

export default function SpeedTests() {
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const [latest, setLatest] = useState<Record<string, SessionResult>>({});
  const [custom, setCustom] = useState('');

  useFocusEffect(
    useCallback(() => {
      if (current) latestResults(db, current.id, 'sprint_%').then(setLatest);
    }, [db, current]),
  );

  // The standard distances, then any other distance already tested.
  const tested = Object.keys(latest)
    .map(sprintDistance)
    .filter((m): m is number => m != null && !SPRINT_DISTANCES.includes(m));
  const distances = [...SPRINT_DISTANCES, ...tested.sort((a, b) => a - b)];

  const start = (def: MetricDef) => router.push({ pathname: '/measure/capture', params: { metric: def.code, session: newSessionId() } });
  const customM = parseNumber(custom);
  const customOk = customM != null && Number.isInteger(customM) && customM >= 5 && customM <= 400;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      {distances.map((m) => {
        const def = sprintMetric(m);
        const last = latest[def.code];
        return (
          <Pressable key={m} accessibilityRole="button" accessibilityLabel={def.name} style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]} onPress={() => start(def)}>
            <Text style={[styles.code, { color: COLOR }]}>{m} m</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name}>冲刺</Text>
              <Text style={text.caption}>{last ? `最近 ${formatValue(def, last.best)} s` : '还没测过'}</Text>
            </View>
            <Icon name="chevronRight" size={18} color={colors.textMuted} />
          </Pressable>
        );
      })}

      <View style={styles.custom}>
        <Text style={styles.name}>自定义距离</Text>
        <View style={styles.customRow}>
          <TextInput
            value={custom}
            onChangeText={setCustom}
            keyboardType="number-pad"
            placeholder="20"
            placeholderTextColor={colors.textFaint}
            style={styles.customInput}
            accessibilityLabel="自定义距离（米）"
          />
          <Text style={styles.unit}>m</Text>
          <Button label="开始" disabled={!customOk} onPress={() => customOk && start(sprintMetric(customM))} style={{ flex: 1 }} />
        </View>
      </View>

      <Text style={styles.note}>每次建议跑 2–3 趟，取最好成绩。用手机慢动作拍下起跑和冲线，逐帧算时间；也可以用光电门或秒表计时后手动输入。</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 8, gap: 10 },
  row: { backgroundColor: colors.surface, borderRadius: radius.row, height: 68, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  code: { width: 84, fontFamily: fonts.numericBold, fontSize: 26 },
  name: { color: colors.text, fontSize: 15, fontWeight: '500' },
  custom: { backgroundColor: colors.surface, borderRadius: radius.row, padding: 16, gap: 10 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  customInput: { width: 84, height: 52, borderRadius: 14, backgroundColor: colors.surfaceRaised, color: colors.text, fontFamily: fonts.numeric, fontSize: 24, textAlign: 'center' },
  unit: { color: colors.textMuted, fontSize: 15 },
  note: { color: colors.textMuted, fontSize: 12, lineHeight: 18, paddingHorizontal: 4, paddingTop: 8 },
});
