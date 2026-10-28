import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import type { PathPoint, Rep } from '@/domain/barPath';
import { colors, fonts } from '@/theme';

const PAD = 8;

/** Bar height over time, with each detected concentric phase shaded and numbered; left-out reps are dimmed. */
export function BarPathChart({ path, reps, included, color, height = 150 }: { path: PathPoint[]; reps: Rep[]; included: boolean[]; color: string; height?: number }) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  if (path.length < 2) return null;
  const t0 = path[0].t;
  const t1 = path[path.length - 1].t;
  const hs = path.map((p) => p.h);
  const lo = Math.min(...hs);
  const hi = Math.max(...hs);
  const x = (t: number) => PAD + ((t - t0) / (t1 - t0 || 1)) * (width - 2 * PAD);
  const y = (h: number) => PAD + (1 - (h - lo) / (hi - lo || 1)) * (height - 2 * PAD);
  // Thin the line to about one point per pixel.
  const every = Math.max(1, Math.floor(path.length / Math.max(1, width)));
  const line = path.filter((_, i) => i % every === 0).map((p) => `${x(p.t).toFixed(1)},${y(p.h).toFixed(1)}`).join(' ');

  return (
    <View style={{ height }} onLayout={onLayout} accessibilityRole="image" accessibilityLabel={`杠铃高度曲线，找到 ${reps.length} 次`}>
      {width > 0 && (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          {reps.map((r, i) => (
            <Rect key={i} x={x(r.start)} y={PAD} width={Math.max(2, x(r.end) - x(r.start))} height={height - 2 * PAD} rx={4} fill={color} opacity={included[i] ? 0.18 : 0.06} />
          ))}
          <Line x1={PAD} x2={width - PAD} y1={y(lo)} y2={y(lo)} stroke={colors.border} strokeDasharray="4 4" />
          <Polyline points={line} fill="none" stroke={colors.textSoft} strokeWidth={2} strokeLinejoin="round" />
          {reps.map((r, i) => (
            <SvgText key={i} x={(x(r.start) + x(r.end)) / 2} y={PAD + 14} fill={included[i] ? color : colors.textFaint} fontSize={13} fontFamily={fonts.numericBold} textAnchor="middle">
              {i + 1}
            </SvgText>
          ))}
        </Svg>
      )}
    </View>
  );
}
