import { mean } from './assess';

// Field tests for aerobic capacity (VO2max) and repeated-sprint ability that need only cones, a tape and the phone.

/** One running bout of the Yo-Yo Intermittent Recovery Test level 1: 20 m out and 20 m back. */
export type YoyoShuttle = {
  /** 1-based shuttle number over the whole test. */
  n: number;
  /** Speed level as printed on Yo-Yo score sheets (5, 9, 11 … 23). */
  level: number;
  /** 1-based shuttle number within its level. */
  inLevel: number;
  speedKmh: number;
  /** Seconds from the first start signal. */
  start: number;
  turn: number;
  end: number;
};

export const YOYO_SHUTTLE_M = 40;
export const YOYO_RECOVERY_S = 10;

// Bangsbo et al. 2008 (Sports Med 38:37). 91 shuttles in all, 3640 m.
const YOYO_IR1_LEVELS: { level: number; speedKmh: number; shuttles: number }[] = [
  { level: 5, speedKmh: 10, shuttles: 1 },
  { level: 9, speedKmh: 12, shuttles: 1 },
  { level: 11, speedKmh: 13, shuttles: 2 },
  { level: 12, speedKmh: 13.5, shuttles: 3 },
  { level: 13, speedKmh: 14, shuttles: 4 },
  ...[14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map((level) => ({ level, speedKmh: 14.5 + (level - 14) * 0.5, shuttles: 8 })),
];

function buildYoyoSchedule(): YoyoShuttle[] {
  const out: YoyoShuttle[] = [];
  let t = 0;
  for (const l of YOYO_IR1_LEVELS) {
    for (let i = 1; i <= l.shuttles; i++) {
      const duration = YOYO_SHUTTLE_M / (l.speedKmh / 3.6);
      out.push({ n: out.length + 1, level: l.level, inLevel: i, speedKmh: l.speedKmh, start: t, turn: t + duration / 2, end: t + duration });
      t += duration + YOYO_RECOVERY_S;
    }
  }
  return out;
}

export const YOYO_IR1: readonly YoyoShuttle[] = buildYoyoSchedule();

export type YoyoState =
  | { phase: 'run'; shuttle: YoyoShuttle; /** Seconds until the next beep (turn or finish line). */ toBeep: number; leg: 'out' | 'back' }
  | { phase: 'rest'; shuttle: YoyoShuttle; /** The shuttle about to start. */ next: YoyoShuttle; toBeep: number }
  | { phase: 'done' };

/** Where the test is `t` seconds after the first start signal. */
export function yoyoStateAt(t: number): YoyoState {
  for (let i = 0; i < YOYO_IR1.length; i++) {
    const s = YOYO_IR1[i];
    if (t < s.end) {
      return t < s.turn ? { phase: 'run', shuttle: s, toBeep: s.turn - t, leg: 'out' } : { phase: 'run', shuttle: s, toBeep: s.end - t, leg: 'back' };
    }
    const next = YOYO_IR1[i + 1];
    if (next && t < next.start) return { phase: 'rest', shuttle: s, next, toBeep: next.start - t };
  }
  return { phase: 'done' };
}

/**
 * Shuttles completed when the tester stops the test at `t`.
 * A shuttle only counts once its finish beep has sounded, so stopping mid-run credits the shuttles before it.
 */
export function yoyoCompletedAt(t: number): number {
  return YOYO_IR1.filter((s) => s.end <= t).length;
}

/** Score-sheet label of the last completed shuttle, e.g. "14.3". */
export function yoyoLabel(completed: number): string {
  if (completed <= 0) return '—';
  const s = YOYO_IR1[Math.min(completed, YOYO_IR1.length) - 1];
  return `${s.level}.${s.inLevel}`;
}

export function yoyoDistance(completed: number): number {
  return Math.max(0, Math.min(completed, YOYO_IR1.length)) * YOYO_SHUTTLE_M;
}

/** VO2max (ml/kg/min) from Yo-Yo IR1 distance; Bangsbo et al. 2008. */
export function yoyoVo2max(distanceM: number): number {
  return distanceM * 0.0084 + 36.4;
}

export const COOPER_SECONDS = 12 * 60;

/** VO2max (ml/kg/min) from the 12-minute run distance; Cooper 1968. */
export function cooperVo2max(distanceM: number): number {
  return (distanceM - 504.9) / 44.73;
}

/** Repeated-sprint protocol: 6 × (20 + 20 m) shuttle sprints, 20 s passive recovery (Rampinini et al. 2007). */
export const RSA_PROTOCOL = { sprints: 6, distanceM: 40, recoveryS: 20 } as const;

export type RsaSummary = {
  best: number;
  mean: number;
  total: number;
  /** Percentage decrement score: how much slower the set was than if every sprint matched the best. */
  sdec: number;
};

/** Sprint times in seconds; sdec is a percentage. */
export function rsaSummary(times: number[]): RsaSummary {
  const best = Math.min(...times);
  const total = times.reduce((s, x) => s + x, 0);
  return { best, mean: mean(times), total, sdec: (total / (best * times.length) - 1) * 100 };
}

export type RsaRating = 'good' | 'typical' | 'poor';

/** Rough bands from team-sport studies, where most players fall between 3 % and 6 %. */
export function rsaRating(sdec: number): { rating: RsaRating; text: string } {
  if (sdec <= 3) return { rating: 'good', text: '后程掉速小，反复冲刺能力好' };
  if (sdec <= 6) return { rating: 'typical', text: '掉速在团队项目运动员的常见范围' };
  return { rating: 'poor', text: '后程掉速明显，建议加强反复冲刺和有氧基础' };
}

/** Rough VO2max bands for trained young men (ml/kg/min), only to give the number some context. */
export function vo2maxBand(vo2: number): string {
  if (vo2 >= 60) return '很高，接近耐力型运动员';
  if (vo2 >= 52) return '良好，球类项目运动员的常见水平';
  if (vo2 >= 45) return '一般，有提升空间';
  return '偏低，建议补有氧基础';
}

/** Formats seconds as m:ss. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
