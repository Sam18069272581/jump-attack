import { mean } from './assess';
import { daysBetween, toISODate, type ISODate } from './dates';
import type { DayReadiness } from './readiness';

/** Regulation rim height, cm. */
export const RIM_CM = 305;

/**
 * How far above the rim the hand has to reach for a one-hand dunk holding the ball: the 6 in (15 cm) that dunk
 * calculators default to. Smaller hands or two-hand dunks need more; it can be changed in 我的.
 */
export const CLEARANCE_CM = 15;

/**
 * Where each result changes the advice: below `low` it holds the athlete back, from `good` on it no longer does.
 * Sources are listed in the 扣篮导向方案 doc; every line is a starting point, not a law.
 */
export const THRESHOLDS = {
  /** Back-squat 1RM ÷ body mass: strength deficit, association and reserve phases (Suchomel 2016). */
  squatRatio: { low: 1.5, good: 2.0 },
  /** Drop-jump RSI at the best box: 2.0 and above is a good benchmark for most athletes (Flanagan 2021). */
  rsi: { low: 1.5, good: 2.0 },
  /** Drop-jump contact past 250 ms is a slow stretch-shortening cycle. */
  contactMs: 250,
  /** CMJ ÷ SJ, the eccentric utilisation ratio: above 1.0 in stretch-shortening sports, NCAA median 1.13. */
  eur: { low: 1.0, good: 1.1 },
  /** Force-velocity profile as % of the optimal slope; outside this band one side lags (Jiménez-Reyes 2017). */
  fvPct: { low: 90, high: 110 },
  /** Approach touch over standing touch, cm: elite basketball players gain 5.7 ± 3.1 cm from a run-up (Hank 2012). */
  approachGainCm: { low: 2.6, good: 5.7 },
};

/** The kind of 4-week training block the diagnosis calls for. */
export type BlockType = 'strength' | 'reactive' | 'transfer';

export const BLOCKS: Record<BlockType, { name: string; focus: string }> = {
  strength: { name: '力量块', focus: '后蹲或史密斯深蹲每周 2–3 次，每组 3–5 次大重量；跳跃少量保持' },
  reactive: { name: '反应块', focus: '最佳箱高跳深、短触地连续跳每周 2–3 次；深蹲 1–2 次维持' },
  transfer: { name: '转化块', focus: '助跑摸高跳、轻负重跳、冲刺；深蹲和跳深各 1 次维持' },
};

/** Results oldest first, one per test session; only the last two of each are read. */
export type DunkInput = {
  bodyMassKg: number | null;
  standingReachCm: number | null;
  /** Null for a regulation rim. */
  rimCm?: number | null;
  /** Null for the default clearance. */
  clearanceCm?: number | null;
  cmj: number[];
  sj: number[];
  /** Touch heights, cm. */
  approachTouch: number[];
  /** Estimated back-squat 1RM, kg. */
  squat1rm: number[];
  /** Body mass weighed near each 1RM's day (domain/bodyMass.ts), null where none: then `bodyMassKg`. */
  squatMassKg?: (number | null)[];
  /** The best jump of each drop-jump box ladder. */
  dropJumps: { rsi: number; contactMs: number }[];
  /** FV% of each force-velocity profile. */
  fvPct: number[];
  /** Wall reading minus video estimate for this athlete (domain/touch.ts); null before any calibration. */
  touchOffsetCm?: number | null;
  /** How the latest approach touch was measured: read off a wall, or estimated from video. */
  approachMethod?: 'wall' | 'video' | null;
  /** The day the diagnosis is for, and when each result was last tested (ISO date or timestamp), for the stale check. */
  asOf?: ISODate;
  latestAt?: Partial<Record<Testable, string>>;
};

export type DunkMetricKey = 'squat_ratio' | 'rsi' | 'contact' | 'eur' | 'fv' | 'approach_gain';

/** `low` holds the athlete back, `mid` is between the lines, `good` is past the line that matters. */
export type MetricStatus = 'low' | 'mid' | 'good' | 'missing';

export type DunkMetric = {
  key: DunkMetricKey;
  name: string;
  value: number | null;
  unit: string;
  decimals: number;
  /** Below this (above, for `lowerIsBetter`) the result is a limiter. For FV% it is the bottom of the balanced band. */
  low: number;
  /** The line to get past. For FV% it is the top of the balanced band. */
  threshold: number;
  lowerIsBetter?: boolean;
  status: MetricStatus;
};

/** Something to measure or fill in before the diagnosis is complete, in the order to do it. */
export type Missing = 'body_mass' | 'standing_reach' | 'squat' | 'drop_jump' | 'approach' | 'cmj';

/** Results that come from a test, as opposed to the profile in 我的. */
export type Testable = Extract<Missing, 'squat' | 'drop_jump' | 'approach' | 'cmj'>;

/**
 * A block is 4 weeks with a retest at the end, so a result older than this has missed a retest and may no longer
 * describe the athlete.
 */
export const STALE_DAYS = 42;

const TESTABLE_NAME: Record<Testable, string> = { squat: '深蹲 1RM', drop_jump: '跳深 RSI', approach: '助跑摸高', cmj: 'CMJ' };

export const MISSING_TEXT: Record<Missing, string> = {
  body_mass: '在「我的」填体重',
  standing_reach: '在「我的」填站立摸高',
  squat: '在 VBT 页测一次后蹲（两个以上重量），估出 1RM',
  drop_jump: '做一次 DJ 跳深，找最佳箱高',
  approach: '测一次助跑摸高',
  cmj: '测一次 CMJ',
};

export type DunkDiagnosis = {
  /** Rim + clearance, cm. */
  line: number;
  touch: {
    /** Standing reach + the latest CMJ. */
    standing: number | null;
    /** The latest approach touch. */
    approach: number | null;
    /** What the gap is measured from: the approach touch when there is one, else the standing estimate. */
    value: number | null;
    source: 'approach' | 'standing' | null;
  };
  /** Dunk line − touch, cm; zero or less means the reach is there. */
  gapCm: number | null;
  limiter: BlockType | null;
  /**
   * Every result that decides the limiter was on the same side of its line in the test before too, or the drop jump
   * is clearly under the RSI floor.
   */
  confirmed: boolean;
  /** The run-up adds too little over a standing jump: the last two steps and the arm swing need work. */
  technique: boolean;
  metrics: DunkMetric[];
  reasons: string[];
  missing: Missing[];
  /** Results the diagnosis leans on that are older than {@link STALE_DAYS}. */
  stale: Testable[];
};

export function dunkLine(rimCm?: number | null, clearanceCm?: number | null): number {
  return (rimCm ?? RIM_CM) + (clearanceCm ?? CLEARANCE_CM);
}

/** Where `x` sits between `from` and `to`, pinned to 0–1. */
function along(x: number, from: number, to: number): number {
  return Math.max(0, Math.min(1, (x - from) / (to - from)));
}

/**
 * The reach ruler on the home screen runs from the standing reach (0) to the dunk line (1): how far along it the touch
 * is, and where the regulation rim falls when it is between the two. Null without a standing reach or a touch, or when
 * the standing reach is already at the line.
 */
export function reachRuler(touch: number | null, standingReach: number | null, line: number): { progress: number; rim: number | null } | null {
  if (touch == null || standingReach == null || line <= standingReach) return null;
  return {
    progress: along(touch, standingReach, line),
    rim: RIM_CM > standingReach && RIM_CM < line ? along(RIM_CM, standingReach, line) : null,
  };
}

type Snapshot = { squatRatio: number | null; rsi: number | null; contactMs: number | null };

/** The deciding results as of the latest test (`back` 0) or the one before (`back` 1), each metric on its own. */
function snapshot(input: DunkInput, back: number): Snapshot {
  const oneRm = input.squat1rm.at(-1 - back);
  const mass = input.squatMassKg?.at(-1 - back) ?? input.bodyMassKg;
  const dj = input.dropJumps.at(-1 - back);
  return {
    squatRatio: oneRm != null && mass ? oneRm / mass : null,
    rsi: dj?.rsi ?? null,
    contactMs: dj?.contactMs ?? null,
  };
}

/**
 * Strength first, then reactive strength: under 1.5× body mass the squat decides whatever the RSI, since weaker
 * athletes should build strength before power work (Suchomel 2018). Null when the deciding result is missing.
 */
export function limiterOf(s: Snapshot): BlockType | null {
  if (s.squatRatio == null) return null;
  if (s.squatRatio < THRESHOLDS.squatRatio.low) return 'strength';
  if (s.rsi == null || s.contactMs == null) return null;
  return s.rsi < THRESHOLDS.rsi.good || s.contactMs > THRESHOLDS.contactMs ? 'reactive' : 'transfer';
}

function rate(value: number | null, low: number, good: number, lowerIsBetter = false): MetricStatus {
  if (value == null) return 'missing';
  if (lowerIsBetter ? value > low : value < low) return 'low';
  if (lowerIsBetter ? value > good : value < good) return 'mid';
  return 'good';
}

const fixed = (x: number, d: number) => x.toFixed(d);

export function diagnose(input: DunkInput): DunkDiagnosis {
  const line = dunkLine(input.rimCm, input.clearanceCm);
  const cmj = input.cmj.at(-1) ?? null;
  const sj = input.sj.at(-1) ?? null;
  const offset = input.touchOffsetCm ?? null;
  const standing = input.standingReachCm != null && cmj != null ? input.standingReachCm + cmj + (offset ?? 0) : null;
  const approach = input.approachTouch.at(-1) ?? null;
  const value = approach ?? standing;
  const source = approach != null ? 'approach' : standing != null ? 'standing' : null;

  const now = snapshot(input, 0);
  const before = snapshot(input, 1);
  const limiter = limiterOf(now);
  // A drop jump under the RSI floor is reactive whatever the noise, the way FV% trusts a test far outside its band
  // (fvp.ts): one ladder is enough once the squat was past its line in the test before too.
  const clearlyReactive =
    limiter === 'reactive' && now.rsi != null && now.rsi < THRESHOLDS.rsi.low && before.squatRatio != null && before.squatRatio >= THRESHOLDS.squatRatio.low;
  const confirmed = limiter != null && (limiterOf(before) === limiter || clearlyReactive);
  const eur = cmj != null && sj ? cmj / sj : null;
  const fv = input.fvPct.at(-1) ?? null;
  // A wall reading and a video estimate are a few cm apart, so they only compare once the athlete is calibrated; two
  // video estimates share the same error.
  const comparable = input.approachMethod !== 'wall' || offset != null;
  const gain = approach != null && standing != null && comparable ? Math.round((approach - standing) * 10) / 10 : null;
  const technique = gain != null && gain < THRESHOLDS.approachGainCm.low;
  const T = THRESHOLDS;

  const metrics: DunkMetric[] = [
    { key: 'squat_ratio', name: '深蹲 ÷ 体重', value: now.squatRatio, unit: '×', decimals: 2, low: T.squatRatio.low, threshold: T.squatRatio.good, status: rate(now.squatRatio, T.squatRatio.low, T.squatRatio.good) },
    { key: 'rsi', name: '跳深 RSI', value: now.rsi, unit: '', decimals: 2, low: T.rsi.low, threshold: T.rsi.good, status: rate(now.rsi, T.rsi.low, T.rsi.good) },
    { key: 'contact', name: '跳深触地', value: now.contactMs, unit: 'ms', decimals: 0, low: T.contactMs, threshold: T.contactMs, lowerIsBetter: true, status: rate(now.contactMs, T.contactMs, T.contactMs, true) },
    { key: 'eur', name: 'CMJ ÷ SJ', value: eur, unit: '', decimals: 2, low: T.eur.low, threshold: T.eur.good, status: rate(eur, T.eur.low, T.eur.good) },
    {
      key: 'fv',
      name: '力-速度 FV%',
      value: fv,
      unit: '%',
      decimals: 0,
      low: T.fvPct.low,
      threshold: T.fvPct.high,
      status: fv == null ? 'missing' : fv < T.fvPct.low || fv > T.fvPct.high ? 'mid' : 'good',
    },
    { key: 'approach_gain', name: '助跑比原地高', value: gain, unit: 'cm', decimals: 1, low: T.approachGainCm.low, threshold: T.approachGainCm.good, status: rate(gain, T.approachGainCm.low, T.approachGainCm.good) },
  ];

  const reasons: string[] = [];
  const r = now.squatRatio;
  if (limiter === 'strength' && r != null) {
    reasons.push(`深蹲 1RM 约 ${Math.round(input.squat1rm.at(-1)!)} kg，是体重的 ${fixed(r, 2)} 倍，不到 ${T.squatRatio.low} 倍：先练力量。`);
  } else if (limiter === 'reactive' && r != null && now.rsi != null && now.contactMs != null) {
    const why = [
      ...(now.rsi < T.rsi.good ? [`跳深 RSI ${fixed(now.rsi, 2)}，不到 ${fixed(T.rsi.good, 1)}`] : []),
      ...(now.contactMs > T.contactMs ? [`触地 ${Math.round(now.contactMs)} ms，超过 ${T.contactMs} ms，反弹偏慢`] : []),
    ];
    reasons.push(`深蹲是体重的 ${fixed(r, 2)} 倍，力量够了；${why.join('，')}：练反应。`);
  } else if (limiter === 'transfer' && r != null && now.rsi != null) {
    reasons.push(`深蹲是体重的 ${fixed(r, 2)} 倍，跳深 RSI ${fixed(now.rsi, 2)}，两项都过线：把能力转成摸高，多练助跑摸高跳和冲刺。`);
    if (r < T.squatRatio.good) reasons.push(`深蹲还没到 ${fixed(T.squatRatio.good, 1)} 倍体重，块里每周保留 2 次大重量。`);
  }
  if (limiter != null && limiter !== 'strength' && fv != null) {
    if (fv < T.fvPct.low) reasons.push(`力-速度曲线偏力量不足（FV% ${Math.round(fv)}），块里多放一个力量练习。`);
    else if (fv > T.fvPct.high) reasons.push(`力-速度曲线偏速度不足（FV% ${Math.round(fv)}），块里多放一个速度练习。`);
  }
  if (eur != null && eur < T.eur.low) reasons.push(`CMJ ÷ SJ 只有 ${fixed(eur, 2)}，不到 ${fixed(T.eur.low, 1)}：下蹲反弹的弹性没用上，加反向跳和连续跳。`);
  if (approach != null && standing != null && !comparable) {
    reasons.push('助跑摸高是在墙上读的，原地摸高是用录像算的，两种口径差几厘米。录一次助跑摸高视频并填上墙上摸到的刻度，校准后才能比较助跑比原地高多少。');
  }
  if (technique && gain != null) reasons.push(`助跑摸高只比原地高 ${fixed(gain, 1)} cm（精英篮球运动员平均高约 ${T.approachGainCm.good} cm）：练最后两步和摆臂。`);
  if (limiter != null && !confirmed) reasons.push('这个结论只有一次测试支持，再测一次结论一致才建议换训练块。');

  // Only results that decide something now: the drop jump doesn't while strength is the limiter, the CMJ doesn't once
  // there is an approach touch.
  const leanedOn: Testable[] = ['squat', ...(limiter !== 'strength' ? (['drop_jump'] as const) : []), source === 'standing' ? 'cmj' : 'approach'];
  const ageOf = (k: Testable) => {
    const at = input.latestAt?.[k];
    if (!at || !input.asOf) return null;
    return daysBetween(at.length === 10 ? at : toISODate(new Date(at)), input.asOf);
  };
  const stale = leanedOn.filter((k) => (ageOf(k) ?? 0) > STALE_DAYS);
  for (const k of stale) {
    // A space only between Latin and Chinese: 「跳深 RSI 是」, 「助跑摸高是」.
    const name = TESTABLE_NAME[k] + (/[A-Za-z0-9]$/.test(TESTABLE_NAME[k]) ? ' ' : '');
    reasons.push(`${name}是 ${Math.floor(ageOf(k)! / 7)} 周前测的，建议复测，结论才跟得上现在的你。`);
  }

  const missing: Missing[] = [];
  if (input.bodyMassKg == null) missing.push('body_mass');
  if (input.standingReachCm == null) missing.push('standing_reach');
  if (input.squat1rm.length === 0) missing.push('squat');
  if (input.dropJumps.length === 0 && limiter !== 'strength') missing.push('drop_jump');
  if (input.approachTouch.length === 0) missing.push('approach');
  if (input.cmj.length === 0) missing.push('cmj');

  return {
    line,
    touch: { standing, approach, value, source },
    gapCm: value != null ? Math.round((line - value) * 10) / 10 : null,
    limiter,
    confirmed,
    technique,
    metrics,
    reasons,
    missing,
    stale,
  };
}

/** How a training day is going, from recovery, today's CMJ or warm-up bar speed. */
export type DayState = 'good' | 'fair' | 'poor' | 'unknown';

/** How far below plan a day may fall and still count as done. */
export const ALLOWANCE: Record<DayState, number> = { good: 0, unknown: 0, fair: 0.05, poor: 0.1 };

/**
 * How a day's state relaxes the targets: multiply the planned load by `loadFactor`; a set at that load still counts
 * as done when its mean velocity is at least target × (1 − `velocityTolerance`). Load is a strength block's
 * stimulus, so with bar speed tracked it keeps the load and accepts a slower bar; reactive and transfer blocks,
 * and days without a block, take weight off to keep the speed. Without bar speed the load is the only lever.
 */
export function tolerance(state: DayState, block: BlockType | null, tracksVelocity = false): { loadFactor: number; velocityTolerance: number } {
  const allowance = ALLOWANCE[state];
  if (tracksVelocity && block === 'strength') return { loadFactor: 1, velocityTolerance: allowance };
  return { loadFactor: 1 - allowance, velocityTolerance: 0 };
}

/** The day's state from recovery readings and today's CMJ (domain/readiness.ts). */
export function dayState(r: DayReadiness): DayState {
  if (r.readiness === 'fatigued' || r.recovery.status === 'poor') return 'poor';
  if (r.recovery.status === 'fair') return 'fair';
  if (r.recovery.status === 'good' || r.readiness === 'ready') return 'good';
  return 'unknown';
}

/** Warm-up readings needed before the warm-up signal means anything. */
export const WARMUP_MIN_SAMPLES = 3;

/**
 * Today's warm-up bar speed at a fixed load against its recent mean: from 95 % on train as planned, 90–95 % ease
 * off, under 90 % cut load and volume (GymAware's readiness traffic light, over a 30-day window).
 */
export function warmupState(todayV: number, recentVs: number[]): DayState {
  if (recentVs.length < WARMUP_MIN_SAMPLES) return 'unknown';
  const ratio = todayV / mean(recentVs);
  return ratio >= 0.95 ? 'good' : ratio >= 0.9 ? 'fair' : 'poor';
}

const SEVERITY: DayState[] = ['unknown', 'good', 'fair', 'poor'];

/** The worst of several signals; unknown only when none is known. */
export function worstState(...states: DayState[]): DayState {
  return states.reduce((a, b) => (SEVERITY.indexOf(b) > SEVERITY.indexOf(a) ? b : a), 'unknown');
}
