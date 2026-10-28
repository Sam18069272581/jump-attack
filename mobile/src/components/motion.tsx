import * as Haptics from 'expo-haptics';
import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, Text, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { motion } from '@/theme';

/** Whether the phone's "Reduce Motion" setting is on; null until known. */
export function useReduceMotion(): boolean | null {
  const [reduce, setReduce] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((r) => live && setReduce(r));
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (r) => live && setReduce(r));
    return () => {
      live = false;
      sub?.remove();
    };
  }, []);
  return reduce;
}

/** A light tap on the Taptic Engine. Never blocks the action it accompanies: test mocks and the web have no engine. */
export function tick() {
  try {
    Haptics.selectionAsync?.()?.catch(() => {});
  } catch {
    // no haptics here
  }
}

/** A success buzz for a moment worth celebrating (a new record). Same guarantees as {@link tick}. */
export function cheer() {
  try {
    Haptics.notificationAsync?.(Haptics.NotificationFeedbackType?.Success)?.catch(() => {});
  } catch {
    // no haptics here
  }
}

/** Fades and slides its children up into place; `index` staggers siblings so a list arrives top to bottom. */
export function Rise({ children, index = 0, style }: { children: ReactNode; index?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const [p] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce == null) return;
    if (reduce) {
      p.setValue(1);
      return;
    }
    const a = Animated.timing(p, { toValue: 1, duration: motion.enter, delay: index * motion.stagger, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [p, reduce, index]);
  const translateY = p.interpolate({ inputRange: [0, 1], outputRange: [motion.rise, 0] });
  return <Animated.View style={[style, { opacity: p, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

type PressScaleProps = Omit<PressableProps, 'style' | 'children'> & { children: ReactNode; style?: StyleProp<ViewStyle>; haptic?: boolean };

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A button that gives under the thumb (scales down a touch) and ticks, so every tap feels answered. */
export function PressScale({ children, style, haptic = true, onPress, onPressIn, onPressOut, ...rest }: PressScaleProps) {
  const [s] = useState(() => new Animated.Value(1));
  const to = (v: number) => Animated.spring(s, { toValue: v, useNativeDriver: true, ...motion.press }).start();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      onPressIn={(e) => {
        to(motion.pressScale);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) tick();
        onPress?.(e);
      }}
      style={[style, { transform: [{ scale: s }] }]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}

/**
 * A number that counts up to `value` from `from` (a scoreboard rolling over), then shows `value` exactly as `format`
 * writes it. Shows the final value at once when the phone asks for less motion.
 */
export function CountUp({ value, from, format, style }: { value: number; from: number; format: (v: number) => string; style?: StyleProp<TextStyle> }) {
  const reduce = useReduceMotion();
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (reduce !== false) return;
    const v = new Animated.Value(from);
    const id = v.addListener(({ value: x }) => setShown(Math.round(x)));
    const a = Animated.timing(v, { toValue: value, duration: motion.count, delay: motion.countDelay, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    a.start(({ finished }) => finished && setShown(null));
    return () => {
      a.stop();
      v.removeListener(id);
    };
  }, [reduce, value, from]);
  return <Text style={style}>{shown == null || reduce !== false ? format(value) : String(shown)}</Text>;
}
