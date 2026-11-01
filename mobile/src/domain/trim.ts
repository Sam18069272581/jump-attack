// The trim bar under a clip, the way the Photos app trims a video: a filmstrip with a handle at each end of the part
// kept. Frames are the clip file's frames, 0 … total − 1.

export type Span = { from: number; to: number };
export type Handle = 'from' | 'to';

/** Where frame `f` sits on a bar `width` px wide: the first frame at the left edge, the last at the right edge. */
export function xOf(f: number, width: number, total: number): number {
  return total > 1 ? (f / (total - 1)) * width : 0;
}

/** The frame nearest `x` px along a bar `width` px wide, inside the clip. */
export function frameAt(x: number, width: number, total: number): number {
  if (width <= 0 || total <= 1) return 0;
  return Math.min(total - 1, Math.max(0, Math.round((x / width) * (total - 1))));
}

/** The span with one handle moved to frame `f`: inside the clip, the start at least a frame before the end. */
export function moveHandle(span: Span, handle: Handle, f: number, total: number): Span {
  const last = Math.max(1, total - 1);
  return handle === 'from'
    ? { from: Math.max(0, Math.min(Math.round(f), span.to - 1)), to: span.to }
    : { from: span.from, to: Math.min(last, Math.max(Math.round(f), span.from + 1)) };
}

/** One VoiceOver step of a handle (`by` = ±1): a twentieth of the clip, at least a frame. */
export function nudgeHandle(span: Span, handle: Handle, by: 1 | -1, total: number): Span {
  const step = Math.max(1, Math.floor((total - 1) / 20));
  return moveHandle(span, handle, span[handle] + by * step, total);
}

/** The times (s, in the file) of a filmstrip of `cells` pictures: the middle of each equal cell along the clip. */
export function stripTimes(durationS: number, cells: number): number[] {
  if (durationS <= 0 || cells <= 0) return [];
  return Array.from({ length: cells }, (_, i) => ((i + 0.5) * durationS) / cells);
}
