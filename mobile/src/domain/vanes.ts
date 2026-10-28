export type Vane = {
  cm: number;
  /** 0 at the top vane, 1 at the bottom one. */
  y: number;
  /** Every fifth vane is drawn longer, like the marked vanes on a real tester. */
  major: boolean;
  /** swept: at or under the touch; gap: between the touch and the dunk line; idle: the rest. */
  state: 'swept' | 'gap' | 'idle';
  line: boolean;
  rim: boolean;
};

const HEADROOM_CM = 8;
const FOOTROOM_CM = 6;
const STEPS = [1, 2, 5, 10];

/**
 * The home screen's jump-and-reach tester (Vertec): `count` vanes up a pole, one per cm when the touch and the dunk
 * line fit within the window with some room either side, else 2, 5 or 10 cm apart. Pure layout; the screen draws it.
 */
export function reachVanes(touch: number | null, line: number, rim: number, count = 35) {
  const high = Math.max(line, touch ?? line) + HEADROOM_CM;
  const low = Math.min(touch ?? line, line) - FOOTROOM_CM;
  const step = STEPS.find((s) => Math.ceil(high / s) * s - (count - 1) * s <= low) ?? STEPS.at(-1)!;
  const top = Math.ceil(high / step) * step;
  const span = (count - 1) * step;
  const yOf = (cm: number) => (top - cm) / span;

  const vanes: Vane[] = Array.from({ length: count }, (_, i) => {
    const cm = top - i * step;
    const state = touch != null && cm <= touch ? 'swept' : touch != null && cm <= line ? 'gap' : 'idle';
    return { cm, y: i / (count - 1), major: cm % (5 * step) === 0, state, line: cm === line, rim: cm === rim };
  });
  return { step, vanes, touchY: touch == null ? null : yOf(touch), lineY: yOf(line), rimY: yOf(rim) };
}
