import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { tr } from '@/i18n';
import { colors } from '@/theme';

export function CaptureHeader({ title, subtitle, onClose, right }: { title: string; subtitle: string; onClose: () => void; right?: ReactNode }) {
  return (
    <View style={styles.top}>
      <Pressable accessibilityRole="button" accessibilityLabel={tr('关闭')} onPress={onClose} style={styles.iconButton}>
        <Icon name="close" />
      </Pressable>
      <View style={{ alignItems: 'center' }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { height: 64, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 11 },
  right: { minWidth: 44, flexDirection: 'row', justifyContent: 'flex-end', gap: 4 },
});
