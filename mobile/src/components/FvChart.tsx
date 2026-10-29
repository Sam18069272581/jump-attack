import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';

import { profileFromPower, type FvProfile } from '@/domain/fvp';
import { tr } from '@/i18n';
import { colors, fonts } from '@/theme';

const PAD_LEFT = 36;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 32;

/** Force (N/kg) against velocity (m/s): the measured jumps, the fitted line and the optimal line for the same power. */
export function FvChart({ profile, color = colors.accent, height = 220 }: { profile: FvProfile; color?: string; height?: number }) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const opt = profileFromPower(profile.pmax, profile.sfvOpt);
  const maxV = Math.ceil(Math.max(profile.v0, opt.v0));
  const maxF = Math.ceil(Math.max(profile.f0, opt.f0) / 10) * 10;
  const innerW = width - PAD_LEFT - PAD_RIGHT;
  const innerH = height - PAD_TOP - PAD_BOTTOM;
  const x = (v: number) => PAD_LEFT + (v / maxV) * innerW;
  const y = (f: number) => PAD_TOP + (1 - f / maxF) * innerH;
  const vTicks = Array.from({ length: maxV + 1 }, (_, i) => i);
  const fTicks = [0, maxF / 2, maxF];

  return (
    <View style={[styles.box, { height }]} onLayout={onLayout} accessibilityRole="image" accessibilityLabel={tr('力-速度曲线：F0 {f0} N/kg，v0 {v0} m/s', { f0: profile.f0.toFixed(1), v0: profile.v0.toFixed(2) })}>
      {width > 0 && (
        <Svg width={width} height={height}>
          {fTicks.map((f) => (
            <Line key={`f${f}`} x1={PAD_LEFT} x2={width - PAD_RIGHT} y1={y(f)} y2={y(f)} stroke={colors.divider} />
          ))}
          {fTicks.map((f) => (
            <SvgText key={`fl${f}`} x={PAD_LEFT - 6} y={y(f) + 4} fill={colors.textMuted} fontSize={11} fontFamily={fonts.numeric} textAnchor="end">
              {String(f)}
            </SvgText>
          ))}
          {vTicks.map((v) => (
            <SvgText key={`vl${v}`} x={x(v)} y={height - PAD_BOTTOM + 16} fill={colors.textMuted} fontSize={11} fontFamily={fonts.numeric} textAnchor="middle">
              {String(v)}
            </SvgText>
          ))}
          <SvgText x={width - PAD_RIGHT} y={height - 4} fill={colors.textMuted} fontSize={10} textAnchor="end">{tr('速度 m/s')}</SvgText>
          <SvgText x={PAD_LEFT + 4} y={PAD_TOP + 10} fill={colors.textMuted} fontSize={10}>{tr('力 N/kg')}</SvgText>
          <Line x1={x(0)} y1={y(opt.f0)} x2={x(opt.v0)} y2={y(0)} stroke={colors.textSoft} strokeWidth={1.5} strokeDasharray="5 5" />
          <Line x1={x(0)} y1={y(profile.f0)} x2={x(profile.v0)} y2={y(0)} stroke={color} strokeWidth={2.5} />
          {profile.points.map((p) => (
            <Circle key={p.loadKg} cx={x(p.v)} cy={y(p.f)} r={5} fill={colors.bg} stroke={color} strokeWidth={2} />
          ))}
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.bg, borderRadius: 14, overflow: 'hidden' },
});
