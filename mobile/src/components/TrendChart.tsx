import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { tr } from '@/i18n';
import { colors, fonts } from '@/theme';

type Point = { label: string; value: number; display: string };

const PAD_X = 24;
const PAD_TOP = 34;
const PAD_BOTTOM = 36;

/** Line chart of a metric across sessions, styled after the history detail screen in the design. `target` adds a dashed goal line. */
export function TrendChart({
  points,
  color = colors.accent,
  height = 200,
  showLabels = true,
  target,
}: {
  points: Point[];
  color?: string;
  height?: number;
  showLabels?: boolean;
  target?: { value: number; label: string };
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const values = [...points.map((p) => p.value), ...(target ? [target.value] : [])];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const top = showLabels ? PAD_TOP : 8;
  const bottom = showLabels ? PAD_BOTTOM : 8;
  const innerH = height - top - bottom;
  const coords = points.map((p, i) => ({
    x: points.length === 1 ? width / 2 : PAD_X + (i * (width - 2 * PAD_X)) / (points.length - 1),
    y: top + (1 - (p.value - min) / span) * innerH,
  }));
  const targetY = target ? top + (1 - (target.value - min) / span) * innerH : 0;
  // Too many labels collide; show at most ~8 evenly spaced.
  const every = Math.max(1, Math.ceil(points.length / 8));

  return (
    <View style={[styles.box, { height }]} onLayout={onLayout} accessibilityRole="image" accessibilityLabel={tr('趋势图，共 {length} 次', { length: points.length })}>
      {width > 0 && points.length > 0 && (
        <>
          <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
            {showLabels && (
              <>
                <Line x1={0} x2={width} y1={top} y2={top} stroke={colors.border} strokeDasharray="4 4" />
                <Line x1={0} x2={width} y1={top + innerH} y2={top + innerH} stroke={colors.border} strokeDasharray="4 4" />
              </>
            )}
            {target && <Line x1={0} x2={width} y1={targetY} y2={targetY} stroke={colors.textSoft} strokeDasharray="6 5" strokeWidth={1.5} />}
            {coords.length > 1 && (
              <Polyline points={coords.map((c) => `${c.x},${c.y}`).join(' ')} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            )}
            {coords.map((c, i) => (
              <Circle key={i} cx={c.x} cy={c.y} r={showLabels ? 4 : i === coords.length - 1 ? 4.5 : 0} fill={showLabels ? colors.bg : color} stroke={color} strokeWidth={2} />
            ))}
          </Svg>
          {showLabels &&
            coords.map((c, i) =>
              i % every === 0 || i === coords.length - 1 ? (
                <View key={i} pointerEvents="none">
                  <Text style={[styles.value, { left: c.x - 24, top: c.y - 24 }]}>{points[i].display}</Text>
                  <Text style={[styles.date, { left: c.x - 24, top: height - 26 }]}>{points[i].label}</Text>
                </View>
              ) : null,
            )}
          {target && <Text style={[styles.target, { top: targetY - 18 }]}>{target.label}</Text>}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surface, borderRadius: 18, overflow: 'hidden' },
  value: { position: 'absolute', width: 48, textAlign: 'center', fontFamily: fonts.numeric, fontSize: 13, color: colors.textSoft },
  target: { position: 'absolute', right: 8, fontFamily: fonts.numeric, fontSize: 12, color: colors.textSoft },
  date: { position: 'absolute', width: 48, textAlign: 'center', fontFamily: fonts.numeric, fontSize: 12, color: colors.textMuted },
});
