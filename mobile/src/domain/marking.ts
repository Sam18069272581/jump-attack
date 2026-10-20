import { intervalFromMarks, LIFT_LIMITS, meanVelocity, roundTo, sprintDistance, sprintLimits, type IntervalProblem } from './interval';
import { measureFromMarks, type MarkProblem } from './jump';
import type { MetricDef } from './metrics';

type Mark = { title: string; hint: string };

export type MarkOutcome =
  | { ok: true; value: number; elapsedS: number; cells: { label: string; value: string; unit: string; main?: boolean }[] }
  | { ok: false; message: string };

/** What the two marks on a video mean for a metric, and how they become a result. */
export type MarkProfile = {
  first: Mark;
  second: Mark;
  /** Shown over the video: before the first mark, between the marks, after the second. */
  phases: [string, string, string];
  measure: (first: number | null, second: number | null, fps: number) => MarkOutcome;
};

const JUMP_PROBLEMS: Record<MarkProblem, string> = {
  missing: '标记起跳帧和落地帧后显示结果',
  order: '落地帧要在起跳帧之后',
  'too-short': '滞空不到 150 ms，检查是否标错帧',
  'too-long': '滞空超过 1.2 s：检查是否标错帧；慢动作视频要把拍摄帧率选成 240',
};

const jumpProfile: MarkProfile = {
  first: { title: '起跳帧', hint: '脚尖刚离地' },
  second: { title: '落地帧', hint: '脚尖刚触地' },
  phases: ['准备 / 下蹲', '腾空', '落地'],
  measure(first, second, fps) {
    const r = measureFromMarks({ takeoffFrame: first, landingFrame: second, fps });
    if (!r.ok) return { ok: false, message: JUMP_PROBLEMS[r.problem] };
    const { flightS, heightCm } = r.value;
    return {
      ok: true,
      value: roundTo(heightCm, 1),
      elapsedS: flightS,
      cells: [
        { label: '滞空', value: String(Math.round(flightS * 1000)), unit: 'ms' },
        { label: '跳高', value: heightCm.toFixed(1), unit: 'cm', main: true },
      ],
    };
  },
};

function sprintProfile(metres: number): MarkProfile {
  const limits = sprintLimits(metres);
  const problems: Record<IntervalProblem, string> = {
    missing: '标记起跑帧和冲线帧后显示成绩',
    order: '冲线帧要在起跑帧之后',
    'too-short': `${metres} m 不可能少于 ${limits.minS.toFixed(2)} s，检查是否标错帧`,
    'too-long': `超过 ${limits.maxS.toFixed(0)} s：检查是否标错帧；慢动作视频要把拍摄帧率选成 240`,
  };
  return {
    first: { title: '起跑帧', hint: '身体第一次动' },
    second: { title: '冲线帧', hint: '躯干越过终点线' },
    phases: ['准备', '跑', '冲线后'],
    measure(first, second, fps) {
      const r = intervalFromMarks(first, second, fps, limits);
      if (!r.ok) return { ok: false, message: problems[r.problem] };
      return {
        ok: true,
        value: roundTo(r.seconds, 2),
        elapsedS: r.seconds,
        cells: [
          { label: '距离', value: String(metres), unit: 'm' },
          { label: '用时', value: r.seconds.toFixed(2), unit: 's', main: true },
          { label: '平均速度', value: (metres / r.seconds).toFixed(2), unit: 'm/s' },
        ],
      };
    },
  };
}

const LIFT_PROBLEMS: Record<IntervalProblem, string> = {
  missing: '标记向心开始和结束后显示速度',
  order: '结束帧要在开始帧之后',
  'too-short': '向心不到 0.1 秒，检查是否标错帧',
  'too-long': '向心超过 4 秒：检查是否标错帧；慢动作视频要把拍摄帧率选成 240',
};

function liftProfile(romCm: number): MarkProfile {
  return {
    first: { title: '向心开始', hint: '杠铃在最低点开始上升' },
    second: { title: '向心结束', hint: '杠铃到最高点' },
    phases: ['准备 / 下放', '向心', '结束'],
    measure(first, second, fps) {
      const r = intervalFromMarks(first, second, fps, LIFT_LIMITS);
      if (!r.ok) return { ok: false, message: LIFT_PROBLEMS[r.problem] };
      const v = meanVelocity(romCm, r.seconds);
      return {
        ok: true,
        value: roundTo(v, 2),
        elapsedS: r.seconds,
        cells: [
          { label: '行程', value: String(romCm), unit: 'cm' },
          { label: '用时', value: String(Math.round(r.seconds * 1000)), unit: 'ms' },
          { label: '平均速度', value: v.toFixed(2), unit: 'm/s', main: true },
        ],
      };
    },
  };
}

/** The marking profile for a metric recorded from video, or null when it can't be marked. A lift needs its bar travel. */
export function markProfile(def: MetricDef, opts: { romCm?: number } = {}): MarkProfile | null {
  if (def.capture.includes('flight')) return jumpProfile;
  const metres = sprintDistance(def.code);
  if (metres != null) return sprintProfile(metres);
  if (def.category === 'vbt' && opts.romCm != null && opts.romCm > 0) return liftProfile(opts.romCm);
  return null;
}
