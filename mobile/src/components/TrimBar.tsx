import { Image } from 'expo-image';
import type { VideoThumbnail } from 'expo-video';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View, type AccessibilityActionEvent, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import { tick } from '@/components/motion';
import { frameAt, moveHandle, nudgeHandle, xOf, type Handle, type Span } from '@/domain/trim';
import { decimal, tr } from '@/i18n';
import { colors, fonts } from '@/theme';

/** The yellow of the Photos app's trim frame, so the bar reads as one at a glance. */
const FRAME = '#F5C518';
const HANDLE = 16;
const STRIP = 52;

type Props = {
  /** Frames in the clip file, 0 … total − 1. */
  total: number;
  span: Span;
  /** The frame on screen: the playhead. */
  frame: number;
  /** The capture frame rate, for the times shown. */
  fps: number;
  /** The filmstrip, left to right. */
  thumbnails: VideoThumbnail[];
  /** A handle moved: the new span, and which end to show. */
  onChange: (span: Span, moved: Handle) => void;
  /** The playhead dragged to a frame inside the span. */
  onScrub: (frame: number) => void;
  /** A handle let go (or stepped by VoiceOver): the trim is done for now. */
  onRelease: () => void;
};

/**
 * Trims a clip the way the Photos app does: a filmstrip with a yellow frame round the part kept, a handle at each end to
 * drag, and the playhead to scrub inside it.
 */
export function TrimBar({ total, span, frame, fps, thumbnails, onChange, onScrub, onRelease }: Props) {
  const [width, setWidth] = useState(0);
  /** Where the finger started a drag: on the bar (px) and on the screen. */
  const drag = useRef({ x0: 0, page0: 0 });

  const begin = (e: GestureResponderEvent, x0: number) => {
    drag.current = { x0, page0: e.nativeEvent.pageX };
  };
  const along = (e: GestureResponderEvent) => drag.current.x0 + e.nativeEvent.pageX - drag.current.page0;

  /** Touch handling for one handle: it follows the finger, and letting go ends the trim for now. */
  const dragHandle = (h: Handle) => ({
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    // The screen scrolls up and down; a handle dragged a little off the horizontal stays a handle.
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      begin(e, xOf(span[h], width, total));
      tick();
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const next = moveHandle(span, h, frameAt(along(e), width, total), total);
      if (next.from !== span.from || next.to !== span.to) onChange(next, h);
    },
    onResponderRelease: onRelease,
    onResponderTerminate: onRelease,
  });

  const scrubTo = (x: number) => onScrub(Math.min(span.to, Math.max(span.from, frameAt(x, width, total))));
  const scrub = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      begin(e, e.nativeEvent.locationX);
      scrubTo(e.nativeEvent.locationX);
    },
    onResponderMove: (e: GestureResponderEvent) => scrubTo(along(e)),
  };

  const x = (f: number) => xOf(f, width, total);
  const left = x(span.from);
  const right = x(span.to);
  const seconds = (f: number) => decimal(f / fps, 2);

  function step(h: Handle, e: AccessibilityActionEvent) {
    const by = e.nativeEvent.actionName === 'increment' ? 1 : e.nativeEvent.actionName === 'decrement' ? -1 : 0;
    if (!by) return;
    onChange(nudgeHandle(span, h, by, total), h);
    onRelease();
  }

  const handle = (h: Handle) => (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={tr('片段{label}', { label: h === 'from' ? tr('开始') : tr('结束') })}
      accessibilityValue={{ text: `${seconds(span[h])} s` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => step(h, e)}
      hitSlop={{ top: 12, bottom: 12, left: 14, right: 14 }}
      style={[styles.handle, h === 'from' ? { left, borderTopLeftRadius: 8, borderBottomLeftRadius: 8 } : { left: HANDLE + right, borderTopRightRadius: 8, borderBottomRightRadius: 8 }]}
      {...dragHandle(h)}
    >
      <View style={styles.grip} />
    </View>
  );

  return (
    <View style={{ gap: 6 }}>
      <View style={styles.bar}>
        <View style={styles.strip} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} {...scrub}>
          {thumbnails.map((t, i) => (
            <Image key={i} source={t} contentFit="cover" style={styles.cell} />
          ))}
          <View pointerEvents="none" style={[styles.shade, { left: 0, width: left }]} />
          <View pointerEvents="none" style={[styles.shade, { left: right, right: 0 }]} />
        </View>
        <View pointerEvents="none" style={[styles.frame, { left: HANDLE + left, width: Math.max(0, right - left) }]} />
        <View pointerEvents="none" style={[styles.playhead, { left: HANDLE + x(Math.min(span.to, Math.max(span.from, frame))) - 1.5 }]} />
        {handle('from')}
        {handle('to')}
      </View>
      <View style={styles.times}>
        <Text style={styles.time}>{seconds(span.from)} s</Text>
        <Text style={styles.chosen}>{tr('已选 {s} s', { s: seconds(span.to - span.from) })}</Text>
        <Text style={styles.time}>{seconds(span.to)} s</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Everything on the bar is placed from its left edge; the strip leaves a handle's width free at either end.
  bar: { height: STRIP + 8 },
  strip: { position: 'absolute', top: 4, left: HANDLE, right: HANDLE, height: STRIP, flexDirection: 'row', borderRadius: 6, overflow: 'hidden', backgroundColor: colors.surfaceRaised },
  cell: { flex: 1, height: STRIP },
  shade: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(241,236,226,0.72)' },
  frame: { position: 'absolute', top: 2, height: STRIP + 4, borderTopWidth: 3, borderBottomWidth: 3, borderColor: FRAME },
  playhead: { position: 'absolute', top: 0, width: 3, height: STRIP + 8, borderRadius: 2, backgroundColor: colors.text },
  handle: { position: 'absolute', top: 2, width: HANDLE, height: STRIP + 4, backgroundColor: FRAME, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 3, height: 16, borderRadius: 2, backgroundColor: 'rgba(23,19,14,0.55)' },
  times: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 },
  time: { color: colors.textMuted, fontFamily: fonts.numeric, fontSize: 14 },
  chosen: { color: colors.text, fontSize: 13, fontWeight: '700' },
});
