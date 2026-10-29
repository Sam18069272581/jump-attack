import { ladder, type LadderJump } from './dropJump';
import { APPROACH_TOUCH, DROP_JUMP } from './metrics';

import { tr } from '@/i18n';

/**
 * A test day in one pass, the way Output and Hawkin run theirs: pick the test, jump, see the number, next. The order
 * goes from the least to the most tiring, so the run-up touches aren't measured on legs the drop jumps already took.
 */

export type TestDayStep = { metric: string; jumps: number; hint: string; box?: number };

/** Drop height before the athlete has a box ladder to pick one from. */
export const DEFAULT_TEST_BOX_CM = 30;

export function testDaySteps(boxCm: number): TestDayStep[] {
  return [
    { metric: 'cmj', jumps: 3, hint: tr('原地 CMJ，跳 3 次，每次间隔 30 秒') },
    { metric: DROP_JUMP.code, jumps: 3, hint: tr('从 {boxCm} cm 的箱子跳下，落地马上弹起，跳 3 次', { boxCm }), box: boxCm },
    { metric: APPROACH_TOUCH.code, jumps: 6, hint: tr('助跑摸高 6 次，每次间隔 1–2 分钟') },
  ];
}

/** The box the latest drop-jump ladder peaked at: the height the athlete's RSI is tracked on. */
export function testDayBox(drops: (LadderJump & { session_id: string })[]): number {
  const latest = drops.at(-1)?.session_id;
  return ladder(drops.filter((j) => j.session_id === latest)).best?.boxCm ?? DEFAULT_TEST_BOX_CM;
}

/** Index of the first test with nothing recorded today, or null once every test has a result. */
export function nextStep(steps: TestDayStep[], today: Record<string, { trials: number } | undefined>): number | null {
  const i = steps.findIndex((s) => !today[s.metric]?.trials);
  return i === -1 ? null : i;
}
