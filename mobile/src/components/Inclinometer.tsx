import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { angleBetween } from '@/domain/mobility';
import { needsMotionPermission, requestMotionPermission, startGravity, type Vec } from '@/media/gravity';
import { colors, fonts, radius } from '@/theme';

/** Live angle from the accelerometer: zero it in the start position, move the limb, then take the reading. */
export function Inclinometer({ onUse }: { onUse: (degrees: number) => void }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [now, setNow] = useState<Vec | null>(null);
  const [zero, setZero] = useState<Vec | null>(null);
  // In a browser on iOS the motion sensor stays silent until the user allows it with a tap.
  const [permitted, setPermitted] = useState(() => !needsMotionPermission());

  useEffect(() => {
    if (!permitted) return;
    let sub: { remove: () => void } | null = null;
    let alive = true;
    // Light smoothing so a steady hand reads a steady number.
    startGravity((m) => setNow((p) => (p ? { x: p.x * 0.7 + m.x * 0.3, y: p.y * 0.7 + m.y * 0.3, z: p.z * 0.7 + m.z * 0.3 } : m))).then((s) => {
      if (!alive) return s?.remove();
      sub = s;
      setAvailable(s != null);
    });
    return () => {
      alive = false;
      sub?.remove();
    };
  }, [permitted]);

  if (!permitted) {
    return (
      <View style={styles.box}>
        <Text style={styles.hint}>浏览器要先允许读取手机的运动传感器，才能用手机量角度。</Text>
        <Button label="允许使用运动传感器" variant="secondary" onPress={() => requestMotionPermission().then(setPermitted)} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  if (available === false) return <Text style={styles.hint}>这台设备没有可用的加速度计，请手动输入角度。</Text>;

  const angle = now && zero ? angleBetween(zero, now) : null;

  return (
    <View style={styles.box}>
      <Text style={styles.angle}>
        {angle != null ? Math.round(angle) : '—'}
        <Text style={styles.deg}>°</Text>
      </Text>
      <Text style={styles.hint}>{zero ? '移动到最大位置，手机停稳后点「用这个角度」' : '在起始位置把手机贴稳，点「归零」'}</Text>
      <View style={styles.buttons}>
        <Button
          label="归零"
          variant="secondary"
          onPress={() => setZero(now)}
          disabled={!now}
          style={{ flex: 1 }}
        />
        <Button label="用这个角度" onPress={() => angle != null && onUse(Math.round(angle))} disabled={angle == null} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8, padding: 14, borderRadius: radius.chip, backgroundColor: colors.bg, alignItems: 'center' },
  angle: { color: colors.purple, fontFamily: fonts.numericBold, fontSize: 56, lineHeight: 60 },
  deg: { color: colors.textMuted, fontSize: 24 },
  hint: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
});
