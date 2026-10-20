import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { WEEKDAY_NAMES, type ISODate } from '@/domain/dates';
import { FATIGUE_DROP } from '@/domain/assess';
import { formatPrescription, type Adjustment, type SessionTemplate } from '@/domain/plan';
import { colors, fonts, radius } from '@/theme';

export type DayStatus = 'rest' | 'planned' | 'started' | 'done';

export function WeekStrip({
  days,
  today,
  selected,
  statusOf,
  onSelect,
  onShift,
}: {
  days: ISODate[];
  today: ISODate;
  selected: ISODate;
  statusOf: (d: ISODate) => DayStatus;
  onSelect: (d: ISODate) => void;
  onShift: (weeks: number) => void;
}) {
  return (
    <View style={styles.strip}>
      <Pressable accessibilityRole="button" accessibilityLabel="上一周" onPress={() => onShift(-1)} style={styles.shift}>
        <Icon name="chevronLeft" size={18} color={colors.textMuted} />
      </Pressable>
      {days.map((d, i) => {
        const status = statusOf(d);
        const isSelected = d === selected;
        return (
          <Pressable
            key={d}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`周${WEEKDAY_NAMES[i]}${status === 'rest' ? ' 休息' : status === 'done' ? ' 已完成' : ' 有训练'}`}
            onPress={() => onSelect(d)}
            style={[styles.day, isSelected && styles.daySelected, d === today && !isSelected && styles.dayToday]}
          >
            <Text style={[styles.dayName, isSelected && { color: colors.onAccent }]}>{WEEKDAY_NAMES[i]}</Text>
            <Text style={[styles.dayNum, isSelected && { color: colors.onAccent }]}>{Number(d.slice(8))}</Text>
            {status === 'done' ? (
              <Icon name="check" size={12} strokeWidth={3} color={isSelected ? colors.onAccent : colors.good} />
            ) : (
              <View style={[styles.dot, status === 'rest' && { opacity: 0 }, status === 'started' && { backgroundColor: colors.warn }, isSelected && { backgroundColor: colors.onAccent }]} />
            )}
          </Pressable>
        );
      })}
      <Pressable accessibilityRole="button" accessibilityLabel="下一周" onPress={() => onShift(1)} style={styles.shift}>
        <Icon name="chevronRight" size={18} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

export function SessionItems({ session }: { session: SessionTemplate }) {
  return (
    <View style={{ gap: 2 }}>
      {session.items.map((p) => (
        <View key={p.code} style={styles.item}>
          <Text style={styles.itemName}>{p.name}</Text>
          <Text style={styles.itemDose}>{formatPrescription(p)}</Text>
        </View>
      ))}
    </View>
  );
}

/** What the readiness rule changed and why. */
export function AdjustmentNote({ adjustments, dropPct }: { adjustments: Adjustment[]; dropPct: number | null }) {
  if (adjustments.length === 0) return null;
  return (
    <View style={styles.note}>
      <Text style={styles.noteTitle}>已按疲劳信号减量</Text>
      <Text style={styles.noteReason}>
        CMJ 比近期均值低 {dropPct != null ? `${(dropPct * 100).toFixed(1)}%` : '较多'}（超过 {FATIGUE_DROP * 100}%）：今天总量减约 30%，取消最大强度练习。
      </Text>
      {adjustments.map((a) => (
        <Text key={a.code} style={styles.noteLine}>
          · {a.name}：{a.change}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  shift: { width: 28, height: 64, alignItems: 'center', justifyContent: 'center' },
  day: { flex: 1, height: 64, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 2 },
  daySelected: { backgroundColor: colors.accent },
  dayToday: { borderWidth: 1, borderColor: colors.accent },
  dayName: { color: colors.textMuted, fontSize: 11 },
  dayNum: { color: colors.text, fontFamily: fonts.numeric, fontSize: 18 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  item: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  itemName: { color: colors.text, fontSize: 14 },
  itemDose: { color: colors.textSoft, fontFamily: fonts.numeric, fontSize: 15 },
  note: { borderRadius: radius.row, borderWidth: 1, borderColor: colors.warn, padding: 12, gap: 4 },
  noteTitle: { color: colors.warn, fontSize: 13, fontWeight: '700' },
  noteReason: { color: colors.textSoft, fontSize: 12, lineHeight: 18 },
  noteLine: { color: colors.textSoft, fontSize: 12 },
});
