import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { useReduceMotion } from '@/components/motion';
import { tr } from '@/i18n';
import { colors, fonts } from '@/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const HEIGHT = 64;
/** One heartbeat of the trace, in px. */
const BEAT = 72;

/** A heartbeat trace across `width`: flat, a small bump, a sharp spike up and down, a slow wave, flat again. */
function trace(width: number): { d: string; length: number; at: (len: number) => [number, number] } {
  const mid = HEIGHT / 2;
  // [x share of a beat, height share of half the panel], up is negative.
  const beat: [number, number][] = [
    [0, 0],
    [0.18, 0],
    [0.24, -0.12],
    [0.3, 0],
    [0.38, 0],
    [0.42, 0.18],
    [0.47, -0.9],
    [0.52, 0.45],
    [0.56, 0],
    [0.68, -0.22],
    [0.8, 0],
  ];
  const pts: [number, number][] = [];
  for (let x0 = 0; x0 < width; x0 += BEAT) for (const [x, y] of beat) if (x0 + x * BEAT <= width) pts.push([x0 + x * BEAT, mid + y * (mid - 6)]);
  pts.push([width, mid]);
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  // The point `len` along the trace, for the head of the lit part.
  const at = (len: number): [number, number] => {
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (len <= seg) return [pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * len) / (seg || 1), pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * len) / (seg || 1)];
      len -= seg;
    }
    return pts[pts.length - 1];
  };
  return { d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' '), length, at };
}

/**
 * Analysis progress as an electronic pulse: a heartbeat trace that lights up from the left as frames are read, with a
 * spark running along the lit part. `progress` is 0–1; `label` says what is happening now.
 */
export function PulseProgress({ progress, label }: { progress: number; label: string }) {
  const [width, setWidth] = useState(0);
  const reduce = useReduceMotion();
  const [run] = useState(() => new Animated.Value(0));
  const { d, length, at } = useMemo(() => trace(width), [width]);
  const p = Math.max(0, Math.min(1, progress));
  const lit = length * p;
  const [hx, hy] = at(lit);

  useEffect(() => {
    if (reduce !== false) return;
    const loop = Animated.loop(Animated.timing(run, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [run, reduce]);

  // The spark: a short bright dash moving from the start of the trace to the head.
  const spark = 26;
  const offset = run.interpolate({ inputRange: [0, 1], outputRange: [spark, spark - Math.max(spark, lit)] });

  return (
    <View style={styles.panel} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width - 32)}>
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.pct} accessibilityLabel={tr('进度 {p}%', { p: Math.round(p * 100) })}>
          {Math.round(p * 100)}
          <Text style={styles.pctUnit}>%</Text>
        </Text>
      </View>
      {width > 0 && (
        <Svg width={width} height={HEIGHT}>
          {[0.25, 0.5, 0.75].map((k) => (
            <Line key={k} x1={0} x2={width} y1={HEIGHT * k} y2={HEIGHT * k} stroke={GRID} strokeWidth={1} />
          ))}
          <Path d={d} stroke={DIM} strokeWidth={2} fill="none" strokeLinejoin="round" />
          <Path d={d} stroke={colors.rim} strokeOpacity={0.35} strokeWidth={7} fill="none" strokeLinejoin="round" strokeDasharray={[lit, length]} />
          <Path d={d} stroke={colors.rim} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeDasharray={[lit, length]} />
          {reduce === false && lit > spark && (
            <AnimatedPath d={d} stroke="#FFFFFF" strokeWidth={3} fill="none" strokeLinecap="round" strokeDasharray={[spark, length + spark]} strokeDashoffset={offset} />
          )}
          <Circle cx={hx} cy={hy} r={4} fill="#FFFFFF" />
        </Svg>
      )}
    </View>
  );
}

const GRID = 'rgba(255,255,255,0.08)';
const DIM = 'rgba(255,255,255,0.18)';

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.text, borderRadius: 16, padding: 16, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  label: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  pct: { color: colors.rim, fontFamily: fonts.numericBold, fontSize: 32 },
  pctUnit: { fontSize: 16 },
});
