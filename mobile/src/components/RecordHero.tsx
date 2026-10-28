import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { cheer, useReduceMotion } from '@/components/motion';
import { colors, fonts } from '@/theme';

const SIZE = 300;
const RAYS = 18;

/** Sunburst wedges around the centre, every other slice filled. */
const RAY_PATH = Array.from({ length: RAYS }, (_, i) => {
  const a0 = (i / RAYS) * Math.PI * 2;
  const a1 = a0 + Math.PI / RAYS;
  const r = SIZE;
  return `M0 0L${(Math.cos(a0) * r).toFixed(1)} ${(Math.sin(a0) * r).toFixed(1)}L${(Math.cos(a1) * r).toFixed(1)} ${(Math.sin(a1) * r).toFixed(1)}Z`;
}).join('');

/**
 * The result screen's hero when a test beats every earlier session: a street-poster moment. A flash, a sunburst
 * opening behind, the number slamming in and shaking, a 新纪录 stamp and a sticker with the margin, plus a success
 * buzz. Shows the end state at once when the phone asks for less motion.
 */
export function RecordHero({ label, value, unit, gain }: { label: string; value: string; unit: string; gain: string }) {
  const reduce = useReduceMotion();
  const [p] = useState(() => new Animated.Value(0));
  const [shake] = useState(() => new Animated.Value(0));
  const [flash] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce == null) return;
    cheer();
    if (reduce) {
      p.setValue(1);
      return;
    }
    const a = Animated.parallel([
      Animated.sequence([
        Animated.timing(flash, { toValue: 1, duration: 90, useNativeDriver: true }),
        Animated.timing(flash, { toValue: 0, duration: 520, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
      Animated.spring(p, { toValue: 1, speed: 10, bounciness: 12, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(380),
        ...[1, -1, 0.6, -0.4, 0].map((x) => Animated.timing(shake, { toValue: x, duration: 55, useNativeDriver: true })),
      ]),
    ]);
    a.start();
    return () => a.stop();
  }, [reduce, p, shake, flash]);

  const late = (from: number) => p.interpolate({ inputRange: [0, from, 1], outputRange: [0, 0, 1], extrapolate: 'clamp' });
  return (
    <View style={styles.hero} accessible accessibilityLabel={`新纪录，${label} ${value} ${unit}，${gain}`}>
      <Animated.View style={[styles.rays, { opacity: p, transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }]}>
        <Svg width={SIZE * 2} height={SIZE * 2} viewBox={`${-SIZE} ${-SIZE} ${SIZE * 2} ${SIZE * 2}`}>
          <Path d={RAY_PATH} fill={colors.surfaceRaised} />
        </Svg>
      </Animated.View>
      <Animated.Text style={[styles.stamp, { opacity: late(0.3), transform: [{ rotate: '-6deg' }, { scale: late(0.3).interpolate({ inputRange: [0, 1], outputRange: [2, 1] }) }] }]}>新纪录</Animated.Text>
      <Text style={styles.label}>{label}</Text>
      <Animated.View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-6, 6] }) }, { scale: p.interpolate({ inputRange: [0, 1], outputRange: [2.4, 1] }) }] }}>
        <Text style={styles.value}>{value}</Text>
        <Text style={styles.unit}>{unit}</Text>
      </Animated.View>
      <Animated.Text style={[styles.sticker, { opacity: late(0.5), transform: [{ rotate: late(0.5).interpolate({ inputRange: [0, 1], outputRange: ['50deg', '4deg'] }) }, { scale: late(0.5) }] }]}>{gain}</Animated.Text>
      <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flash }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { height: SIZE, alignItems: 'center', justifyContent: 'center', gap: 4, overflow: 'hidden', marginHorizontal: -20 },
  rays: { position: 'absolute', left: '50%', top: '50%', marginLeft: -SIZE, marginTop: -SIZE },
  stamp: { color: colors.onAccent, backgroundColor: colors.record, fontSize: 20, fontWeight: '900', paddingHorizontal: 14, paddingVertical: 3, overflow: 'hidden', marginBottom: 6 },
  label: { color: colors.textMuted, fontSize: 13 },
  value: { color: colors.accent, fontFamily: fonts.numericBold, fontSize: 112, lineHeight: 116 },
  unit: { color: colors.accent, fontFamily: fonts.numeric, fontSize: 26 },
  sticker: { color: colors.onAccent, backgroundColor: colors.rim, fontFamily: fonts.numericBold, fontSize: 24, paddingHorizontal: 12, paddingVertical: 2, overflow: 'hidden', marginTop: 4 },
  flash: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.surface },
});
