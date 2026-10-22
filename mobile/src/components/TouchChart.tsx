import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import type { TouchPoint } from '@/domain/dunkSummary';
import { APPROACH_TOUCH } from '@/domain/metrics';
import { colors, fonts } from '@/theme';

const PAD_X = 20;
const PAD_Y = 22;

/**
 * Touch height over time against the dunk line: approach touches as filled dots, standing estimates (standing
 * reach + CMJ) as hollow ones, the line dashed. Dates set the x position so both series line up.
 */
export function TouchChart({ approach, standing, line, height = 170 }: { approach: TouchPoint[]; standing: TouchPoint[]; line: number; height?: number }) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const all = [...approach, ...standing];
  const times = all.map((p) => new Date(p.at).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const values = [...all.map((p) => p.value), line];
  const lo = Math.min(...values) - 4;
  const hi = Math.max(...values) + 4;
  const x = (at: string) => (t1 === t0 ? width / 2 : PAD_X + ((new Date(at).getTime() - t0) / (t1 - t0)) * (width - 2 * PAD_X));
  const y = (v: number) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (height - 2 * PAD_Y);
  const color = APPROACH_TOUCH.color;
  const path = (ps: TouchPoint[]) => ps.map((p) => `${x(p.at)},${y(p.value)}`).join(' ');

  return (
    <View style={[styles.box, { height }]} onLayout={onLayout} accessibilityRole="image" accessibilityLabel={`摸高趋势，助跑实测 ${approach.length} 次，原地估算 ${standing.length} 次，扣篮线 ${line} cm`}>
      {width > 0 && all.length > 0 && (
        <>
          <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
            <Line x1={0} x2={width} y1={y(line)} y2={y(line)} stroke={colors.textSoft} strokeDasharray="6 5" strokeWidth={1.5} />
            {standing.length > 1 && <Polyline points={path(standing)} fill="none" stroke={colors.textFaint} strokeWidth={1.5} />}
            {approach.length > 1 && <Polyline points={path(approach)} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />}
            {standing.map((p, i) => (
              <Circle key={`s${i}`} cx={x(p.at)} cy={y(p.value)} r={4} fill={colors.surface} stroke={colors.textMuted} strokeWidth={1.5} />
            ))}
            {approach.map((p, i) => (
              <Circle key={`a${i}`} cx={x(p.at)} cy={y(p.value)} r={4.5} fill={color} />
            ))}
          </Svg>
          <Text style={[styles.lineLabel, { top: y(line) - 18 }]}>扣篮线 {line}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.bg, borderRadius: 14, overflow: 'hidden' },
  lineLabel: { position: 'absolute', right: 8, color: colors.textSoft, fontFamily: fonts.numeric, fontSize: 12 },
});
