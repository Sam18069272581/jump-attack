import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { openDunkTest } from '@/components/dunkTests';
import { Icon } from '@/components/Icon';
import { CountUp, useReduceMotion } from '@/components/motion';
import { RIM_CM, reachRuler, type DunkDiagnosis } from '@/domain/dunk';
import { gapHeading, touchSpread } from '@/domain/dunkSummary';
import { reachVanes, type Vane } from '@/domain/vanes';
import { tr } from '@/i18n';
import { colors, fonts, text } from '@/theme';

/** Height of the hero; with the status bar above it, it stays within the top half of the screen. */
const HEIGHT = 330;
const V_TOP = 8;
const V_SPAN = 312;
/** Distance from the right edge to the pole. */
const POLE = 26;
const VANE_LONG = 168;
const VANE_SHORT = 140;
const IDLE_OPACITY = 0.12;
const SWEPT_OPACITY = 0.06;

const cm = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/**
 * The top of the home screen: a jump-and-reach tester (Vertec) drawn faintly behind the numbers. On opening, the vanes
 * under the athlete's best touch swing aside bottom to top, the marker springs up the pole to the touch, the net
 * swishes, and the vanes still between the touch and the dunk line pulse.
 */
export function ReachHero({ diagnosis: d, standingReach, name, onSwitchAthlete }: { diagnosis: DunkDiagnosis; standingReach: number | null; name: string; onSwitchAthlete: () => void }) {
  const touch = d.touch.value;
  const layout = reachVanes(touch, d.line, RIM_CM);
  const ruler = reachRuler(touch, standingReach, d.line);
  const y = (f: number) => V_TOP + f * V_SPAN;
  const markerY = layout.touchY == null ? null : y(layout.touchY);
  const lineY = y(layout.lineY);
  const rimY = layout.rimY >= 0 && layout.rimY <= 1 ? y(layout.rimY) : null;

  const reduce = useReduceMotion();
  const [sweep] = useState(() => new Animated.Value(0));
  const [rise] = useState(() => new Animated.Value(0));
  const [swish] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduce == null) return;
    if (reduce) {
      sweep.setValue(1);
      rise.setValue(1);
      return;
    }
    const intro = Animated.parallel([
      Animated.timing(sweep, { toValue: 1, duration: 900, delay: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.sequence([Animated.delay(250), Animated.spring(rise, { toValue: 1, speed: 6, bounciness: 9, useNativeDriver: true })]),
      Animated.sequence([
        Animated.delay(1000),
        Animated.timing(swish, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.spring(swish, { toValue: 0, speed: 14, bounciness: 14, useNativeDriver: true }),
      ]),
    ]);
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    intro.start(({ finished }) => finished && breathe.start());
    return () => {
      intro.stop();
      breathe.stop();
    };
  }, [reduce, sweep, rise, swish, pulse]);

  const swept = layout.vanes.filter((v) => v.state === 'swept').length;
  const travel = markerY == null ? 0 : HEIGHT - markerY;
  const known = d.gapCm != null;
  const touchLabel = d.touch.source === 'approach' ? tr('助跑摸高') : tr('原地估算');

  return (
    <View style={styles.hero}>
      <View
        style={StyleSheet.absoluteFill}
        accessible
        accessibilityRole="image"
        accessibilityLabel={known ? tr('摸高器：{touchLabel} {touch} cm，扣篮线 {line} cm，{p}', { touchLabel, touch: cm(touch!), line: d.line, p: d.gapCm! > 0 ? tr('还差 {gapCm} cm', { gapCm: d.gapCm!.toFixed(1) }) : tr('已过 {gapCm} cm', { gapCm: (-d.gapCm!).toFixed(1) }) }) : tr('摸高器：扣篮线 {line} cm，还没有摸高', { line: d.line })}
      >
        {layout.vanes.map((v, i) => (
          <VaneBar key={v.cm} v={v} top={y(v.y) - 2} sweep={sweep} pulse={pulse} order={layout.vanes.length - 1 - i} swept={swept} />
        ))}
        {/* Fade the vanes out to the left so the numbers sit on clean paper. */}
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <LinearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0.3" stopColor={colors.bg} stopOpacity={1} />
              <Stop offset="0.78" stopColor={colors.bg} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#fade)" />
        </Svg>
        <View style={styles.pole} />

        <View style={[styles.lineBox, { top: lineY - 1 }]}>
          <Svg width={VANE_LONG} height={2}>
            <Line x1={0} x2={VANE_LONG} y1={1} y2={1} stroke={colors.accent} strokeWidth={2} strokeDasharray="5 4" />
          </Svg>
        </View>
        <Text style={[styles.mark, { top: lineY - 19, color: colors.accent }]}>{tr('扣篮线 {line}', { line: d.line })}</Text>

        {rimY != null && (
          <>
            <View style={[styles.rim, { top: rimY - 2 }]} />
            <Animated.View style={[styles.net, { top: rimY + 3, transform: [{ scaleY: swish.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] }) }, { skewX: swish.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-6deg'] }) }] }]}>
              <Svg width={68} height={40} viewBox="0 0 70 46" preserveAspectRatio="none">
                <Path d="M2 0 12 44M24 0 26 44M46 0 40 44M68 0 56 44M6 14h58M10 30h50" stroke={colors.textMuted} strokeWidth={1.4} fill="none" />
              </Svg>
            </Animated.View>
            <Text style={[styles.mark, { top: rimY - 20, color: colors.rim }]}>{tr('篮筐 {RIM_CM}', { RIM_CM })}</Text>
          </>
        )}

        {markerY != null && (
          <>
            <Animated.View style={[styles.trail, { top: markerY, height: travel, transform: [{ scaleY: rise }] }]} />
            <Animated.View style={[styles.marker, { top: markerY - 7, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [travel, 0] }) }] }]} />
          </>
        )}
      </View>

      <View style={styles.column}>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('切换测试对象')} hitSlop={8} onPress={onSwitchAthlete} style={styles.greeting}>
          <Text style={text.muted} numberOfLines={1}>{tr('你好，{name}', { name })}</Text>
          <Icon name="chevronDown" size={12} color={colors.textMuted} />
        </Pressable>
        <Text style={text.title}>{tr('今天练什么？')}</Text>

        {known ? (
          <>
            <Text style={[text.muted, styles.gapLabel]}>{gapHeading(d).label}</Text>
            <View style={styles.gapRow}>
              <Text style={styles.gap}>{d.gapCm! > 0 ? d.gapCm!.toFixed(1) : `+${(-d.gapCm!).toFixed(1)}`}</Text>
              <Text style={styles.gapUnit}>cm</Text>
            </View>
            <View
              style={styles.touchRow}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={tr('离扣篮线的进度')}
              accessibilityValue={ruler ? { min: 0, max: 100, now: Math.round(ruler.progress * 100) } : undefined}
            >
              <Text style={text.muted}>{touchLabel}</Text>
              <CountUp value={touch!} from={standingReach ?? Math.round(touch! - 60)} format={cm} style={styles.touch} />
              <Text style={text.muted}>cm</Text>
            </View>
            {touchSpread(d) && <Text style={text.caption}>{touchSpread(d)}</Text>}
            {gapHeading(d).hint && <Text style={styles.hint}>{gapHeading(d).hint}</Text>}
          </>
        ) : (
          <>
            <Text style={[text.muted, styles.gapLabel]}>{tr('扣篮线 {line} cm', { line: d.line })}</Text>
            <Text style={styles.unknown}>{tr('还不知道离扣篮多远')}</Text>
            <Text style={styles.hint}>{tr('测一次助跑摸高，或者在「我的」填站立摸高、再测一次 CMJ。')}</Text>
          </>
        )}
        {!d.missing.includes('approach') && (
          <Pressable accessibilityRole="button" accessibilityLabel={tr('测助跑摸高')} hitSlop={8} onPress={() => openDunkTest('approach')} style={styles.retest}>
            <Text style={styles.retestText}>{tr('再测助跑摸高')}</Text>
            <Icon name="chevronRight" size={14} color={colors.accent} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function VaneBar({ v, top, sweep, pulse, order, swept }: { v: Vane; top: number; sweep: Animated.Value; pulse: Animated.Value; order: number; swept: number }) {
  const width = v.major ? VANE_LONG : VANE_SHORT;
  if (v.state !== 'swept') {
    return <Animated.View style={[styles.vane, { top, width, backgroundColor: v.state === 'gap' ? colors.accent : colors.vane, opacity: v.state === 'gap' ? pulse : IDLE_OPACITY }]} />;
  }
  // Bottom vanes swing first, as a hand sweeping up the pole would push them.
  const start = swept > 1 ? (order / (swept - 1)) * 0.6 : 0;
  const t = sweep.interpolate({ inputRange: [0, start, start + 0.4, 1], outputRange: [0, 0, 1, 1], extrapolate: 'clamp' });
  return (
    <Animated.View
      style={[
        styles.vane,
        {
          top,
          width,
          backgroundColor: colors.vane,
          opacity: t.interpolate({ inputRange: [0, 1], outputRange: [IDLE_OPACITY, SWEPT_OPACITY] }),
          transform: [{ perspective: 300 }, { rotateY: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-72deg'] }) }],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  hero: { height: HEIGHT, marginHorizontal: -20 },
  vane: { position: 'absolute', right: POLE + 6, height: 3.5, borderTopLeftRadius: 2, borderBottomLeftRadius: 2, transformOrigin: 'right' },
  pole: { position: 'absolute', right: POLE, top: 0, bottom: 4, width: 6, borderRadius: 3, backgroundColor: colors.pole },
  lineBox: { position: 'absolute', right: POLE + 6, width: VANE_LONG, height: 2 },
  mark: { position: 'absolute', right: POLE + 12, fontFamily: fonts.numeric, fontSize: 14 },
  rim: { position: 'absolute', right: POLE + 6, width: 122, height: 5, borderTopLeftRadius: 3, borderBottomLeftRadius: 3, backgroundColor: colors.rim },
  net: { position: 'absolute', right: POLE + 36, transformOrigin: 'top' },
  trail: { position: 'absolute', right: POLE + 1, width: 4, borderRadius: 2, backgroundColor: colors.accent, opacity: 0.3, transformOrigin: 'bottom' },
  marker: { position: 'absolute', right: POLE - 4, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.accent, borderWidth: 3, borderColor: colors.bg },
  column: { position: 'absolute', left: 20, top: 0, width: 210 },
  greeting: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 24 },
  gapLabel: { marginTop: 18 },
  gapRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  gap: { color: colors.accent, fontFamily: fonts.numericBold, fontSize: 104, lineHeight: 108 },
  gapUnit: { color: colors.accent, fontFamily: fonts.numeric, fontSize: 24 },
  touchRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  touch: { color: colors.text, fontFamily: fonts.numericBold, fontSize: 32 },
  unknown: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 6 },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  retest: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', minHeight: 44 },
  retestText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
});
