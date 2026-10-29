import { MOBILITY_TESTS, type MetricDef } from './metrics';

import { localized } from '@/i18n';

/** Left/right difference that earns an orange flag, as a share of the better side. */
export const ASYMMETRY_FLAG = 0.1;

/**
 * Tests whose values sit near zero (the Thomas test is ~0° for a supple hip flexor), where a percentage
 * difference means nothing: flag on an absolute gap instead.
 */
const ABSOLUTE_FLAG: Record<string, number> = { mob_thomas: 5 };

export type MobilityTest = { key: string; name: string; unit: string; use: string; how: string; left: MetricDef; right: MetricDef };

/** How to measure each test; angles with the phone strapped or held flat on the moving limb. */
const HOW: Record<string, string> = localized({
  mob_ankle: '弓步面对墙，脚跟不离地、膝盖碰到墙的前提下，脚尖尽量远离墙，量脚尖到墙的距离。',
  mob_hip_ir: '坐在床边，小腿自然下垂。手机贴在小腿上，小腿垂直时归零，再把小脚向外摆到最大（髋内旋）。',
  mob_hip_er: '坐在床边，小腿自然下垂。手机贴在小腿上，小腿垂直时归零，再把小脚向内摆到最大（髋外旋）。',
  mob_slr: '仰卧，手机贴在小腿前侧，腿平放时归零，膝盖伸直把腿抬到最高。',
  mob_thomas: '先把手机平放在床面归零。坐在床尾仰躺、抱住对侧膝，再把手机贴在被测大腿上读角度：大腿高于水平为正，低于水平请输入负数。',
  mob_tspine: '侧卧屈髋屈膝，双臂前伸叠放。手机贴在上侧上臂，起始位归零，上臂向后打开到最大（开书式）。',
  mob_shoulder: '仰卧屈膝，手机贴在上臂，手臂贴体侧时归零，伸直手臂举过头顶到最大。',
});

/** The tests as left/right pairs, in table order. */
export const MOBILITY_PAIRS: MobilityTest[] = MOBILITY_TESTS.filter((m) => m.code.endsWith('_l')).map((left) => {
  const right = MOBILITY_TESTS.find((m) => m.code === left.pair)!;
  const key = left.code.slice(0, -2);
  return { key, name: left.short ?? left.name, unit: left.unit, use: left.use ?? '', how: HOW[key] ?? '', left, right };
});

export function getMobilityTest(key: string): MobilityTest | undefined {
  return MOBILITY_PAIRS.find((t) => t.key === key);
}

export type Asymmetry = { diff: number; pct: number | null; flagged: boolean };

/** How far apart the two sides are, and whether that is worth flagging. */
export function asymmetry(test: MobilityTest, left: number, right: number): Asymmetry {
  const diff = Math.abs(left - right);
  const abs = ABSOLUTE_FLAG[test.key];
  if (abs != null) return { diff, pct: null, flagged: diff >= abs };
  const ref = Math.max(Math.abs(left), Math.abs(right));
  const pct = ref > 0 ? diff / ref : 0;
  return { diff, pct, flagged: pct >= ASYMMETRY_FLAG };
}

type Vec = { x: number; y: number; z: number };

/**
 * Angle in degrees between two phone orientations, from the gravity vector the accelerometer reads
 * while the phone is still. Strapped to a limb, it is how far the limb moved, in any plane that isn't horizontal.
 */
export function angleBetween(a: Vec, b: Vec): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const na = Math.hypot(a.x, a.y, a.z);
  const nb = Math.hypot(b.x, b.y, b.z);
  if (na === 0 || nb === 0) return 0;
  const cos = Math.min(1, Math.max(-1, dot / (na * nb)));
  return (Math.acos(cos) * 180) / Math.PI;
}
