import type { IconName } from '@/components/Icon';

import { cooperVo2max, rsaSummary, yoyoVo2max } from './conditioning';
import { sprintLimits } from './interval';

export type Category = 'jump' | 'conditioning' | 'speed' | 'vbt' | 'mobility' | 'recovery';

/**
 * How a result can be recorded, first one is the default.
 * - `flight`: take-off and landing frames in a video (jump height).
 * - `contact`: touch-down, take-off and landing frames of a drop jump (reactive strength index).
 * - `interval`: start and finish frames in a video (sprint time, bar velocity).
 * - `manual`: typed in, from a stopwatch, timing gates, a VBT device or Apple Health.
 */
export type CaptureKind = 'flight' | 'contact' | 'interval' | 'manual';

export type MetricDef = {
  code: string;
  name: string;
  /** Short label for compact lists. */
  short?: string;
  category: Category;
  unit: string;
  decimals: number;
  /** True when a smaller value is better (sprint times, resting heart rate). */
  lowerIsBetter?: boolean;
  /** Neither direction is better (respiratory rate): changes are shown without good/bad colours. */
  neutral?: boolean;
  capture: CaptureKind[];
  /** The other side of a left/right test, for asymmetry checks. */
  pair?: string;
  /** What the result matters for, shown next to it. */
  use?: string;
  /** Plausible values; anything outside is almost certainly a typo or a mis-marked frame. */
  range?: [number, number];
  /** How a session's attempts become its result. Defaults to the best attempt. */
  aggregate?: 'best' | 'mean';
  /** A figure estimated from the measured value, shown alongside it (VO2max from a run distance). */
  estimate?: { name: string; unit: string; decimals: number; from: (value: number) => number };
  /** The value is a touch height: a jump measured from video is saved as standing reach + jump height. */
  plusReach?: boolean;
  /** What to type on the manual entry screen, when "this attempt's result" isn't clear enough. */
  entryHint?: string;
};

export type CategoryDef = {
  key: Category;
  name: string;
  color: string;
  tile: string;
  subtitle: string;
  icon: IconName;
  /** Where the home screen card leads; null while the module isn't built yet. */
  href: string | null;
};

export const CATEGORIES: CategoryDef[] = [
  { key: 'jump', name: '跳跃测试', color: '#2340C8', tile: '#E1E6FA', subtitle: 'CMJ · SJ · DJ · 助跑摸高', icon: 'jump', href: '/jumps' },
  { key: 'conditioning', name: '体能耐力', color: '#B92F1C', tile: '#F6E0DB', subtitle: 'VO2max · RSA 反复冲刺', icon: 'conditioning', href: '/conditioning' },
  { key: 'speed', name: '速度训练', color: '#0B6F6E', tile: '#DCEEEC', subtitle: '10 m · 30 m · 50 m · 100 m 冲刺', icon: 'speed', href: '/speed' },
  { key: 'vbt', name: 'VBT 训练', color: '#D9541E', tile: '#F8E3D8', subtitle: '深蹲 · 高翻 · 高拉 · 深蹲跳', icon: 'vbt', href: '/vbt' },
  { key: 'mobility', name: '灵活度', color: '#6A46BE', tile: '#ECE5F7', subtitle: '踝 · 髋 · 腘绳肌 · 胸椎 · 肩', icon: 'mobility', href: '/mobility' },
  { key: 'recovery', name: '恢复', color: '#1A6E3D', tile: '#DFEEE4', subtitle: 'HRV · 静息心率 · 睡眠 · 呼吸频率', icon: 'recovery', href: '/recovery' },
];

export function getCategory(key: Category): CategoryDef {
  return CATEGORIES.find((c) => c.key === key)!;
}

/** Modules that add little to the jump itself; home keeps them folded under 辅助 (their screens and data stay). */
export const SUPPORT_CATEGORIES: Category[] = ['conditioning', 'mobility'];

/**
 * How high the hand reaches in a run-up jump, the number the whole app works towards: the dunk line is the rim
 * plus clearance (domain/dunk.ts). Typed in from a mark on a wall or the backboard, or measured from video as
 * standing reach + flight-time jump height, which `trial.detail` keeps as `jump_cm` and `standing_reach_cm`.
 */
export const APPROACH_TOUCH: MetricDef & { short: string; color: string } = {
  code: 'approach_touch',
  short: '摸高',
  name: '助跑摸高',
  category: 'jump',
  unit: 'cm',
  decimals: 1,
  color: '#D9541E',
  use: '离扣篮还差多少就看它',
  capture: ['flight', 'manual'],
  plusReach: true,
  entryHint: '输入摸到的高度：从地面量到手指摸到的刻度',
  range: [150, 420],
};

/** Typed-in jumps come from another flight-time app; a jump-and-reach mark measures something else. */
const JUMP_ENTRY_HINT = '输入跳高：用 My Jump 等按腾空时间计算的 App 测的读数';

/** Jump tests measured by flight time from video, or typed in from another app (CMJ and SJ, for the daily readiness test). */
export const JUMP_TESTS: (MetricDef & { short: string; color: string })[] = [
  { code: 'cmj', short: 'CMJ', name: 'CMJ 反向跳', category: 'jump', unit: 'cm', decimals: 1, color: '#2340C8', capture: ['flight', 'manual'], range: [5, 120], entryHint: JUMP_ENTRY_HINT },
  { code: 'sj', short: 'SJ', name: 'SJ 蹲跳', category: 'jump', unit: 'cm', decimals: 1, color: '#0B6F6E', capture: ['flight', 'manual'], range: [5, 120], entryHint: JUMP_ENTRY_HINT },
  { code: 'sl_cmj_l', short: 'SL-L', name: '单腿 CMJ · 左', category: 'jump', unit: 'cm', decimals: 1, color: '#1A6E3D', capture: ['flight'], range: [3, 80] },
  { code: 'sl_cmj_r', short: 'SL-R', name: '单腿 CMJ · 右', category: 'jump', unit: 'cm', decimals: 1, color: '#1A6E3D', capture: ['flight'], range: [3, 80] },
];

/**
 * Drop jump from a ladder of box heights, each trial's box in `trial.detail.box_cm`. Logged on its own screen
 * (jumps/dj), not straight from the jump list, because every jump needs its box height.
 */
export const DROP_JUMP: MetricDef & { short: string; color: string } = {
  code: 'dj_rsi',
  short: 'DJ',
  name: 'DJ 跳深 RSI',
  category: 'jump',
  unit: '',
  decimals: 2,
  color: '#6A46BE',
  use: '跳高 ÷ 触地时间，反应力量',
  capture: ['contact', 'manual'],
  range: [0.1, 5],
};

/**
 * Squat jumps at several loads for the force-velocity profile (jumps/fvp), the load in `trial.load_kg`. Kept apart
 * from `sj` so loaded jumps never pull down the squat-jump history; a session's result is its highest jump,
 * normally the unloaded one.
 */
export const LOADED_SJ: MetricDef & { short: string; color: string } = {
  code: 'fvp_sj',
  short: 'F-V',
  name: '负重蹲跳 · 力-速度曲线',
  category: 'jump',
  unit: 'cm',
  decimals: 1,
  color: '#0B6F6E',
  use: '每次测试最高的一跳，通常是徒手那级',
  capture: ['flight', 'manual'],
  range: [1, 120],
};

const VO2MAX = { name: 'VO2max', unit: 'ml/kg/min', decimals: 1 };

/** Field tests for aerobic capacity and repeated sprints; protocols in ./conditioning. */
export const CONDITIONING_TESTS: (MetricDef & { short: string; color: string; summary: string; kit: string })[] = [
  {
    code: 'yoyo_ir1',
    short: 'YO-YO',
    name: 'Yo-Yo 间歇恢复测试 1 级',
    category: 'conditioning',
    unit: 'm',
    decimals: 0,
    color: '#B92F1C',
    summary: '20 m 往返跑，每趟后 10 秒恢复，越来越快，跑不动为止',
    kit: '20 m 场地 · 3 个标志桶 · 约 6–20 分钟',
    estimate: { ...VO2MAX, from: yoyoVo2max },
    capture: ['manual'],
  },
  {
    code: 'cooper',
    short: '12MIN',
    name: 'Cooper 12 分钟跑',
    category: 'conditioning',
    unit: 'm',
    decimals: 0,
    color: '#985100',
    summary: '12 分钟内跑尽量远，按距离估算 VO2max',
    kit: '田径场或已知距离的环线 · 12 分钟',
    estimate: { ...VO2MAX, from: cooperVo2max },
    capture: ['manual'],
  },
  {
    code: 'rsa',
    short: 'RSA',
    name: 'RSA 反复冲刺 6×(20+20 m)',
    category: 'conditioning',
    unit: 's',
    decimals: 2,
    lowerIsBetter: true,
    aggregate: 'mean',
    color: '#0B6F6E',
    summary: '6 趟 20 m 折返冲刺，每趟间休 20 秒，看平均时间和掉速',
    kit: '20 m 场地 · 2 个标志桶 · 最好有同伴按表 · 约 3 分钟',
    capture: ['manual'],
  },
];

export const SPRINT_DISTANCES = [10, 30, 50, 100];

const sprints = new Map<number, MetricDef>();

/**
 * Sprint over `m` metres. Any distance works, so custom distances need no registry entry. The same object is
 * returned for a distance every time, so screens can depend on it without re-running their effects.
 */
export function sprintMetric(m: number): MetricDef {
  let def = sprints.get(m);
  if (!def) {
    const { minS, maxS } = sprintLimits(m);
    def = { code: `sprint_${m}`, short: `${m} m`, name: `${m} m 冲刺`, category: 'speed', unit: 's', decimals: 2, lowerIsBetter: true, capture: ['interval', 'manual'], range: [minS, maxS] };
    sprints.set(m, def);
  }
  return def;
}

export const SPEED_TESTS: MetricDef[] = SPRINT_DISTANCES.map(sprintMetric);

/** One logged set per trial: mean concentric velocity, with the load in `trial.load_kg`. */
export const VBT_LIFTS: MetricDef[] = [
  { code: 'vbt_squat', name: '深蹲', category: 'vbt', unit: 'm/s', decimals: 2, capture: ['manual', 'interval'], range: [0.05, 4] },
  { code: 'vbt_clean_floor', name: '高翻 · 地面', category: 'vbt', unit: 'm/s', decimals: 2, capture: ['manual', 'interval'], range: [0.05, 4] },
  { code: 'vbt_clean_hang', name: '高翻 · 悬垂', category: 'vbt', unit: 'm/s', decimals: 2, capture: ['manual', 'interval'], range: [0.05, 4] },
  { code: 'vbt_clean_power', name: '高翻 · 发力位', category: 'vbt', unit: 'm/s', decimals: 2, capture: ['manual', 'interval'], range: [0.05, 4] },
  { code: 'vbt_pull_floor', name: '高拉 · 地面', category: 'vbt', unit: 'm/s', decimals: 2, capture: ['manual', 'interval'], range: [0.05, 4] },
  { code: 'vbt_pull_hang', name: '高拉 · 悬垂', category: 'vbt', unit: 'm/s', decimals: 2, capture: ['manual', 'interval'], range: [0.05, 4] },
  { code: 'vbt_pull_power', name: '高拉 · 发力位', category: 'vbt', unit: 'm/s', decimals: 2, capture: ['manual', 'interval'], range: [0.05, 4] },
  { code: 'vbt_squat_jump', name: '深蹲跳', category: 'vbt', unit: 'm/s', decimals: 2, capture: ['manual', 'interval'], range: [0.05, 4] },
];

function sides(code: string, name: string, unit: string, decimals: number, use: string, range: [number, number], lowerIsBetter?: boolean): MetricDef[] {
  const base = { category: 'mobility' as const, unit, decimals, use, range, capture: ['manual' as const], ...(lowerIsBetter ? { lowerIsBetter } : {}) };
  return [
    { ...base, code: `${code}_l`, name: `${name} · 左`, short: name, pair: `${code}_r` },
    { ...base, code: `${code}_r`, name: `${name} · 右`, short: name, pair: `${code}_l` },
  ];
}

/** Left/right range-of-motion tests, in the order of the design's mobility table. */
export const MOBILITY_TESTS: MetricDef[] = [
  ...sides('mob_ankle', '踝背屈 · 膝触墙', 'cm', 1, '影响落地缓冲与深蹲', [0, 25]),
  ...sides('mob_hip_ir', '髋内旋', '°', 0, '变向与急停', [0, 90]),
  ...sides('mob_hip_er', '髋外旋', '°', 0, '侧向移动', [0, 90]),
  ...sides('mob_slr', '直腿抬高 · 腘绳肌', '°', 0, '冲刺后程', [0, 150]),
  // Angle of the thigh above horizontal; below horizontal is negative.
  ...sides('mob_thomas', '托马斯测试 · 髋屈肌', '°', 0, '伸髋受限（越小越好）', [-30, 60], true),
  ...sides('mob_tspine', '胸椎旋转', '°', 0, '投篮与对抗', [0, 90]),
  ...sides('mob_shoulder', '肩屈曲', '°', 0, '过顶动作', [90, 200]),
];

/** Daily values, typed in or read from Apple Health. */
export const RECOVERY_METRICS: MetricDef[] = [
  { code: 'rec_hrv', name: 'HRV (SDNN)', short: 'HRV', category: 'recovery', unit: 'ms', decimals: 0, capture: ['manual'], range: [5, 300] },
  { code: 'rec_rhr', name: '静息心率', category: 'recovery', unit: 'bpm', decimals: 0, lowerIsBetter: true, capture: ['manual'], range: [25, 150] },
  { code: 'rec_sleep', name: '睡眠', category: 'recovery', unit: 'h', decimals: 1, capture: ['manual'], range: [0, 16] },
  { code: 'rec_resp', name: '呼吸频率', category: 'recovery', unit: '次/分', decimals: 1, neutral: true, capture: ['manual'], range: [5, 40] },
];

export const METRICS: MetricDef[] = [APPROACH_TOUCH, ...JUMP_TESTS, LOADED_SJ, DROP_JUMP, ...CONDITIONING_TESTS, ...SPEED_TESTS, ...VBT_LIFTS, ...MOBILITY_TESTS, ...RECOVERY_METRICS];

export function getMetric(code: string): MetricDef | undefined {
  const known = METRICS.find((m) => m.code === code);
  if (known) return known;
  const sprint = /^sprint_(\d+)$/.exec(code);
  return sprint ? sprintMetric(Number(sprint[1])) : undefined;
}

export function formatValue(metric: MetricDef, value: number): string {
  return value.toFixed(metric.decimals);
}

/** The secondary figure for a session: the VO2max a run distance implies, or how much a sprint set slowed down. */
export function resultNote(metric: MetricDef, result: number, attempts: number[] = []): string | null {
  if (metric.estimate) return `${metric.estimate.name} ≈ ${metric.estimate.from(result).toFixed(metric.estimate.decimals)}`;
  if (metric.aggregate === 'mean' && attempts.length > 1) {
    const s = rsaSummary(attempts);
    return `最快 ${s.best.toFixed(metric.decimals)} ${metric.unit} · 递减 ${s.sdec.toFixed(1)}%`;
  }
  return null;
}

/** A metric's own colour, or its category's. */
export function metricColor(metric: MetricDef): string {
  return (metric as { color?: string }).color ?? getCategory(metric.category).color;
}

/** The better of two results for this metric. */
export function better(metric: MetricDef, a: number, b: number): number {
  return metric.lowerIsBetter ? Math.min(a, b) : Math.max(a, b);
}

/** Best of a list of results for this metric. */
export function best(metric: MetricDef, values: number[]): number | null {
  return values.length ? values.reduce((x, y) => better(metric, x, y)) : null;
}

/** Colour of a change: good, bad, or muted when it's zero or the metric has no better direction. */
export function changeTone(metric: MetricDef, delta: number): 'good' | 'bad' | 'flat' {
  if (Math.abs(delta) < 1e-9 || metric.neutral) return 'flat';
  return (metric.lowerIsBetter ? delta < 0 : delta > 0) ? 'good' : 'bad';
}
