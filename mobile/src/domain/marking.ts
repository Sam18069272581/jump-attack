import { dropJumpFromMarks, type DropJumpProblem } from './dropJump';
import { intervalFromMarks, roundTo, sprintDistance, sprintLimits, type IntervalProblem } from './interval';
import { measureFromMarks, type MarkProblem } from './jump';
import type { MetricDef } from './metrics';

import { localized, tr } from '@/i18n';

type Mark = { title: string; hint: string };

export type MarkOutcome =
  | {
      ok: true;
      value: number;
      elapsedS: number;
      cells: { label: string; value: string; unit: string; main?: boolean }[];
      /** Extras stored with the trial, e.g. a drop jump's contact time. */
      detail?: Record<string, unknown>;
    }
  | { ok: false; message: string };

/**
 * What the marks on a video mean for a metric, and how they become a result. Most tests take two marks; a drop
 * jump takes three. The last two are stored as the trial's take-off and landing (start and finish) frames.
 */
export type MarkProfile = {
  marks: Mark[];
  /** Shown over the video: before the first mark, between each pair of marks, after the last. One more than `marks`. */
  phases: string[];
  measure: (marks: (number | null)[], fps: number) => MarkOutcome;
};

const JUMP_PROBLEMS: Record<MarkProblem, string> = {
  missing: '标记起跳帧和落地帧后显示结果',
  order: '落地帧要在起跳帧之后',
  'too-short': '滞空不到 150 ms，检查是否标错帧',
  'too-long': '滞空超过 1.2 s：检查是否标错帧；慢动作视频要把拍摄帧率选成 240',
};

const jumpProfile: MarkProfile = {
  marks: [
    { title: '起跳帧', hint: '脚尖刚离地' },
    { title: '落地帧', hint: '脚尖刚触地' },
  ],
  phases: ['准备 / 下蹲', '腾空', '落地'],
  measure([first, second], fps) {
    const r = measureFromMarks({ takeoffFrame: first, landingFrame: second, fps });
    if (!r.ok) return { ok: false, message: JUMP_PROBLEMS[r.problem] };
    const { flightS, heightCm } = r.value;
    return {
      ok: true,
      value: roundTo(heightCm, 1),
      elapsedS: flightS,
      cells: [
        { label: tr('滞空'), value: String(Math.round(flightS * 1000)), unit: 'ms' },
        { label: tr('跳高'), value: heightCm.toFixed(1), unit: 'cm', main: true },
      ],
    };
  },
};

/**
 * A run-up jump measured for touch height: flight time gives the jump, standing reach is added on top. Without a
 * standing reach there is nothing to add it to.
 */
function touchProfile(reachCm: number | undefined): MarkProfile {
  return {
    ...jumpProfile,
    marks: [
      { title: tr('起跳帧'), hint: tr('起跳脚刚离地') },
      { title: tr('落地帧'), hint: tr('第一只脚刚触地') },
    ],
    phases: [tr('助跑'), tr('腾空'), tr('落地')],
    measure(marks, fps) {
      const jump = jumpProfile.measure(marks, fps);
      if (!jump.ok) return jump;
      if (reachCm == null) return { ok: false, message: tr('先在「我的」填站立摸高，才能用录像算摸高；也可以直接手填摸到的高度') };
      return {
        ...jump,
        value: roundTo(reachCm + jump.value, 1),
        cells: [
          { label: tr('跳高'), value: jump.value.toFixed(1), unit: 'cm' },
          { label: tr('摸高'), value: (reachCm + jump.value).toFixed(1), unit: 'cm', main: true },
        ],
        detail: { jump_cm: jump.value, standing_reach_cm: reachCm },
      };
    },
  };
}

function sprintProfile(metres: number): MarkProfile {
  const limits = sprintLimits(metres);
  const problems: Record<IntervalProblem, string> = {
    missing: tr('标记起跑帧和冲线帧后显示成绩'),
    order: tr('冲线帧要在起跑帧之后'),
    'too-short': tr('{metres} m 不可能少于 {minS} s，检查是否标错帧', { metres, minS: limits.minS.toFixed(2) }),
    'too-long': tr('超过 {maxS} s：检查是否标错帧；慢动作视频要把拍摄帧率选成 240', { maxS: limits.maxS.toFixed(0) }),
  };
  return {
    marks: [
      { title: tr('起跑帧'), hint: tr('身体第一次动') },
      { title: tr('冲线帧'), hint: tr('躯干越过终点线') },
    ],
    phases: [tr('准备'), tr('跑'), tr('冲线后')],
    measure([first, second], fps) {
      const r = intervalFromMarks(first, second, fps, limits);
      if (!r.ok) return { ok: false, message: problems[r.problem] };
      return {
        ok: true,
        value: roundTo(r.seconds, 2),
        elapsedS: r.seconds,
        cells: [
          { label: tr('距离'), value: String(metres), unit: 'm' },
          { label: tr('用时'), value: r.seconds.toFixed(2), unit: 's', main: true },
          { label: tr('平均速度'), value: (metres / r.seconds).toFixed(2), unit: 'm/s' },
        ],
      };
    },
  };
}

const DROP_PROBLEMS: Record<DropJumpProblem, string> = {
  missing: '标记触地、起跳和落地三帧后显示结果',
  order: '三帧要按触地 → 起跳 → 落地的顺序',
  'contact-short': '触地不到 80 ms，检查是否标错帧',
  'contact-long': '触地超过 1 秒，这是一次下蹲而不是反弹，重跳一次',
  'flight-short': '滞空不到 150 ms，检查是否标错帧',
  'flight-long': '滞空超过 1.2 s：检查是否标错帧；慢动作视频要把拍摄帧率选成 240',
};

const dropJumpProfile: MarkProfile = {
  marks: [
    { title: '触地帧', hint: '跳下后脚刚着地' },
    { title: '起跳帧', hint: '反弹脚尖刚离地' },
    { title: '落地帧', hint: '脚尖再次触地' },
  ],
  phases: ['跳下', '触地', '腾空', '落地'],
  measure([contact, takeoff, landing], fps) {
    const r = dropJumpFromMarks(contact, takeoff, landing, fps);
    if (!r.ok) return { ok: false, message: DROP_PROBLEMS[r.problem] };
    const { contactS, flightS, heightCm, rsi } = r.value;
    return {
      ok: true,
      value: roundTo(rsi, 2),
      elapsedS: flightS,
      cells: [
        { label: tr('触地'), value: String(Math.round(contactS * 1000)), unit: 'ms' },
        { label: tr('跳高'), value: heightCm.toFixed(1), unit: 'cm' },
        { label: 'RSI', value: rsi.toFixed(2), unit: '', main: true },
      ],
      detail: { contact_frame: contact, contact_ms: Math.round(contactS * 1000), height_cm: roundTo(heightCm, 1) },
    };
  },
};

/**
 * The marking profile for a metric recorded from video, or null when it can't be marked. Lifts aren't marked by
 * hand: their videos are tracked automatically (app/vbt/track).
 */
// Shown in the current language (i18n).
localized(JUMP_PROBLEMS);
localized(DROP_PROBLEMS);
localized([jumpProfile, dropJumpProfile], 'title', 'hint', 'phases');

export function markProfile(def: MetricDef, opts: { reachCm?: number } = {}): MarkProfile | null {
  if (def.capture.includes('contact')) return dropJumpProfile;
  if (def.capture.includes('flight')) return def.plusReach ? touchProfile(opts.reachCm) : jumpProfile;
  const metres = sprintDistance(def.code);
  if (metres != null) return sprintProfile(metres);
  return null;
}

/** Screens that log several measured trials in a row and take a marked video straight back to themselves. */
const LOGGERS = ['fvp', 'dj'];

export function returnsToLogger(from: string | undefined): boolean {
  return from != null && LOGGERS.includes(from);
}

/**
 * What the screens above the marking screen pass along: the load, reps and bar travel of a VBT set, a drop jump's box,
 * and the photo-library id of the clip, so the video can be found again without the app keeping a copy.
 */
export type MarkContext = { from?: string; load?: string; reps?: string; rom?: string; box?: string; asset?: string };

/** For a filmed touch: what the hand was read to touch on the wall, or the athlete's calibration to add. */
export type TouchCalibration = { touchedCm?: number | null; offsetCm?: number | null };

export type MarkedTrial = {
  value: number;
  flight_ms: number;
  fps: number;
  takeoff_frame: number | null;
  landing_frame: number | null;
  load_kg?: number;
  detail?: Record<string, unknown>;
};

/**
 * The trial a marked video saves. Only the last two marks fit the trial's take-off and landing columns, so a drop
 * jump's touch-down frame goes in the detail along with whatever else the profile measured.
 */
export function markedTrial(
  outcome: Extract<MarkOutcome, { ok: true }>,
  marks: (number | null)[],
  fps: number,
  ctx: MarkContext,
  touch: TouchCalibration = {},
): MarkedTrial {
  const vbt = ctx.from === 'vbt';
  // A filmed touch (domain/touch.ts): the wall reading when there is one, else the estimate plus the athlete's offset.
  const filmedTouch = outcome.detail?.jump_cm != null;
  const touched = filmedTouch ? touch.touchedCm : null;
  const offset = filmedTouch && touched == null ? touch.offsetCm : null;
  const detail = {
    ...(vbt ? { rom_cm: Number(ctx.rom), ...(Number(ctx.reps) ? { reps: Number(ctx.reps) } : {}) } : {}),
    ...outcome.detail,
    ...(ctx.box ? { box_cm: Number(ctx.box) } : {}),
    ...(ctx.asset ? { asset_id: ctx.asset } : {}),
    ...(touched != null ? { touched_cm: touched } : {}),
    ...(offset != null ? { offset_cm: offset } : {}),
  };
  return {
    value: touched ?? (offset != null ? roundTo(outcome.value + offset, 1) : outcome.value),
    flight_ms: outcome.elapsedS * 1000,
    fps,
    takeoff_frame: marks.at(-2) ?? null,
    landing_frame: marks.at(-1) ?? null,
    ...(vbt || ctx.load != null ? { load_kg: Number(ctx.load) || 0 } : {}),
    ...(Object.keys(detail).length ? { detail: { source: 'video', ...detail } } : {}),
  };
}
