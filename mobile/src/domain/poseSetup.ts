/**
 * Live checks before filming a run-up jump with the phone's own camera (the technique camera screen). The athlete
 * stands on the take-off spot, side-on to the phone and facing the way they run, and the screen says what to change
 * until the picture will do for the analysis (domain/technique.ts). Each check reads the last second of the pose
 * model's output and of the accelerometer, so one odd frame doesn't flip it, and each hint is a sentence short
 * enough to hear from the take-off spot.
 *
 * What the analysis needs, in statures (S, floor to the top of the head) of the athlete on the take-off spot, from
 * Drillis and Contini's proportions (Winter, "Biomechanics and Motor Control of Human Movement", fig. 4.1):
 * - 1.8 S of picture above the floor: arms up at the rim reach about 1.75 S (3.25 m for a 1.85 m athlete);
 * - 2.4 S behind them: the last two steps (about 1.1 S each) and the run-up marker 3 m back (1.6 S);
 * - 1.4 S ahead: the flight drifts 0.8–1.3 S forward before the landing;
 * - S at least a fifth of the picture's height, or the pose model's few pixels of jitter grow large against the body.
 * The remaining limits (level, steady, light, clear, side-on) are hints for setting up rather than measurements, so
 * they are set loose and named here to be tuned on the phone.
 */
import { LM, SIDE, type Pose } from './pose';

const { abs, acos, asin, atan2, hypot, max, min, PI, sqrt } = Math;
const DEG = 180 / PI;

/** An accelerometer reading at page time `t` (s), in the phone's axes: x across the screen, y along it, z out of it. */
export type GravitySample = { t: number; x: number; y: number; z: number };

/** What the camera page saw in one analysed frame. */
export type SetupFrame = {
  /** Page time, s. */
  t: number;
  /** The upright picture the pose model saw, px. */
  width: number;
  height: number;
  /** Everyone the pose model found, in picture px. */
  poses: Pose[];
  /** Mean brightness (0–255) inside each person's outline box, in the order of `poses`. */
  lumas: number[];
  /** Mean brightness of the whole picture. */
  luma: number;
  /**
   * How many people the latest search of the whole picture found, when `poses` holds only the people read around the
   * athlete (the camera page searches the whole picture now and then, and follows the athlete in between).
   */
  crowd?: number;
};

export type SetupCheckKey = 'phone' | 'steady' | 'person' | 'whole' | 'size' | 'room' | 'light' | 'clear' | 'side';

/** `fix` and `wait` hold the recording back; `warn` says something worth knowing but doesn't. */
export type SetupCheck = { key: SetupCheckKey; state: 'ok' | 'warn' | 'fix' | 'wait'; hint: string };

/** Every check, in the order to fix them, with its name on the screen's list. */
export const SETUP_CHECKS: [SetupCheckKey, string][] = [
  ['phone', '手机横放、放平'],
  ['steady', '放稳'],
  ['person', '看到人'],
  ['whole', '全身入镜'],
  ['size', '大小合适、上方留够'],
  ['room', '助跑和落地都拍得到'],
  ['light', '光线'],
  ['clear', '关节看得清'],
  ['side', '侧对手机'],
];

export type SetupState = {
  /** In the order to fix them: the phone first, then where the athlete is in the picture, then how well they show. */
  checks: SetupCheck[];
  /** Nothing holds the recording back. */
  ready: boolean;
  /** The first check to fix (or the first warning when nothing needs fixing): the one hint to say aloud. */
  main: SetupCheck | null;
  /** The phone's tilt across the picture and up or down, degrees, for a level on screen (null without a sensor). */
  level: { roll: number; pitch: number } | null;
  /** Which of the latest frame's poses is the athlete, and their stature in picture px. */
  athlete: { index: number; stature: number } | null;
};

/** Picture above the floor at the take-off spot, in statures. */
export const HEADROOM_S = 1.8;
/** Picture behind the athlete (the run-up side), in statures. */
export const BEHIND_S = 2.4;
/** Picture ahead of the athlete (the landing side), in statures. */
export const AHEAD_S = 1.4;
/** Smallest stature, as a share of the picture's height. */
export const MIN_SIZE = 0.2;
/** Feet at least this share of the picture's height above its bottom edge. */
const FOOT_MARGIN = 0.03;
/** Ear level as a share of stature (Drillis and Contini, as in Winter fig. 4.1). */
const EAR_SHARE = 0.93;

/** The horizon may lean this much in the picture, degrees: the analysis fits the floor line anyway. */
export const LEVEL_DEG = 3;
/**
 * The lens may point this far up or down, degrees. A tipped phone sees the run-up's plane at a slant, so the scale
 * changes with height in the picture: about 0.5 % across a flight's rise at 5°, a fifth of the take-off velocity's
 * pass line.
 */
export const PITCH_DEG = 5;
/** Wobble of gravity's direction over a second (RMS, degrees) above which the phone is being held, not set down. */
export const STEADY_DEG = 0.5;
/**
 * Mean brightness in the athlete's box (0–255). The camera's automatic exposure keeps most scenes near the middle by
 * lengthening the exposure, which blurs fast feet, so a box that still comes out dim means it has run out of room.
 * Starting points, not published limits: no app or paper gives numbers for these.
 */
export const DARK_LUMA = 40;
export const DIM_LUMA = 60;
export const BRIGHT_LUMA = 220;
/** The athlete less than this share of the picture's brightness: lit from behind, which the pose model handles badly. */
export const BACKLIT_SHARE = 0.5;
/** The pose model's visibility (0–1) each part needs on at least one side. */
export const CLEAR_VISIBILITY = 0.6;
/** Shoulder spread over torso length: side-on is near 0, facing the phone about 0.7. */
export const SIDE_ON = 0.25;
export const SIDE_OFF = 0.45;

/** How much of the recent past a check reads, s. */
const WINDOW_S = 1;

type Measure = {
  stature: number;
  floor: number;
  top: number;
  left: number;
  right: number;
  hipX: number;
  facing: number;
  spread: number;
  luma: number;
  /** The least visible part (best side), and how visible it is. */
  faint: { part: string; v: number };
};

const PARTS: [string, (keyof typeof SIDE.left)[]][] = [
  ['脚', ['ankle', 'heel', 'toe']],
  ['膝盖', ['knee']],
  ['髋部', ['hip']],
  ['肩膀', ['shoulder']],
];

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function statureOf(p: Pose): { stature: number; floor: number } {
  const floor = max(...(['left', 'right'] as const).flatMap((s) => [p[SIDE[s].heel].y, p[SIDE[s].toe].y]));
  const ear = (p[LM.leftEar].y + p[LM.rightEar].y) / 2;
  return { stature: (floor - ear) / EAR_SHARE, floor };
}

function measure(p: Pose, luma: number): Measure {
  const { stature, floor } = statureOf(p);
  const xs = p.map((q) => q.x);
  const ys = p.map((q) => q.y);
  const sh = { x: (p[LM.leftShoulder].x + p[LM.rightShoulder].x) / 2, y: (p[LM.leftShoulder].y + p[LM.rightShoulder].y) / 2 };
  const hip = { x: (p[LM.leftHip].x + p[LM.rightHip].x) / 2, y: (p[LM.leftHip].y + p[LM.rightHip].y) / 2 };
  const torso = hypot(sh.x - hip.x, sh.y - hip.y);
  const facing = (['left', 'right'] as const).reduce((s, side) => s + p[SIDE[side].toe].x - p[SIDE[side].heel].x, 0);
  let faint = { part: '', v: Infinity };
  for (const [part, keys] of PARTS) {
    const v = min(...keys.map((k) => max(p[SIDE.left[k]].v, p[SIDE.right[k]].v)));
    if (v < faint.v) faint = { part, v };
  }
  return {
    stature,
    floor,
    top: min(...ys),
    left: min(...xs),
    right: max(...xs),
    hipX: hip.x,
    facing,
    spread: torso > 0 ? abs(p[LM.leftShoulder].x - p[LM.rightShoulder].x) / torso : Infinity,
    luma,
    faint,
  };
}

/** The athlete: whoever stands tallest in the picture (the nearest person, on the take-off spot). */
function athleteIn(f: SetupFrame): { index: number; stature: number } | null {
  let best: { index: number; stature: number } | null = null;
  f.poses.forEach((p, index) => {
    const { stature } = statureOf(p);
    if (stature > 0 && (!best || stature > best.stature)) best = { index, stature };
  });
  return best;
}

function phoneChecks(gravity: GravitySample[], now: number): { checks: SetupCheck[]; level: SetupState['level'] } {
  const recent = gravity.filter((g) => g.t >= now - WINDOW_S);
  if (recent.length < 3) {
    const hint = '读不到手机的水平仪：自己确认手机横放、放平、放稳';
    return { checks: [{ key: 'phone', state: 'warn', hint }, { key: 'steady', state: 'warn', hint }], level: null };
  }
  const units = recent.map((g) => {
    const n = hypot(g.x, g.y, g.z) || 1;
    return { x: g.x / n, y: g.y / n, z: g.z / n };
  });
  const m = units.reduce((s, u) => ({ x: s.x + u.x, y: s.y + u.y, z: s.z + u.z }), { x: 0, y: 0, z: 0 });
  const n = hypot(m.x, m.y, m.z) || 1;
  const mean = { x: m.x / n, y: m.y / n, z: m.z / n };
  // On its side, gravity runs along the screen's short axis (x); any share along y leans the horizon.
  const roll = atan2(mean.y, abs(mean.x)) * DEG;
  const pitch = asin(max(-1, min(1, mean.z))) * DEG;
  const wobble = sqrt(units.reduce((s, u) => s + acos(max(-1, min(1, u.x * mean.x + u.y * mean.y + u.z * mean.z))) ** 2, 0) / units.length) * DEG;

  let phone: SetupCheck;
  if (abs(mean.z) > 0.8) phone = { key: 'phone', state: 'fix', hint: '把手机立起来，背面的镜头对着起跳点' };
  else if (abs(mean.y) > abs(mean.x)) phone = { key: 'phone', state: 'fix', hint: '把手机横过来放' };
  else if (abs(pitch) > PITCH_DEG) phone = { key: 'phone', state: 'fix', hint: `手机前后没立直，差 ${Math.round(abs(pitch))} 度` };
  else if (abs(roll) > LEVEL_DEG) phone = { key: 'phone', state: 'fix', hint: `手机歪了 ${Math.round(abs(roll))} 度，转平` };
  else phone = { key: 'phone', state: 'ok', hint: '手机横放、放平了' };
  const steady: SetupCheck =
    wobble > STEADY_DEG ? { key: 'steady', state: 'fix', hint: '手机在晃：放到三脚架上，或者靠在稳的东西上' } : { key: 'steady', state: 'ok', hint: '手机放稳了' };
  return { checks: [phone, steady], level: { roll, pitch } };
}

function pictureChecks(frames: SetupFrame[]): { checks: SetupCheck[]; athlete: SetupState['athlete'] } {
  const latest = frames[frames.length - 1];
  const recent = frames.filter((f) => f.t >= latest.t - WINDOW_S);
  const seen = recent.flatMap((f) => {
    const a = athleteIn(f);
    return a ? [{ f, a, m: measure(f.poses[a.index], f.lumas[a.index] ?? f.luma) }] : [];
  });
  const now = athleteIn(latest);
  if (frames.slice(-2).every((f) => !athleteIn(f))) {
    const dark = latest.luma < DARK_LUMA;
    const hint = dark ? '太暗了，看不到人：开灯，或者换亮一点的地方' : '没看到人：站到起跳点，侧身对着手机，全身都要在画面里';
    return { checks: [{ key: 'person', state: 'fix', hint }], athlete: null };
  }
  if (seen.length < 2) return { checks: [{ key: 'person', state: 'wait', hint: '正在找人，站着别动' }], athlete: now };

  const W = latest.width;
  const H = latest.height;
  const med = (pick: (m: Measure) => number) => median(seen.map((s) => pick(s.m)));
  const stature = med((m) => m.stature);
  const floor = med((m) => m.floor);
  const checks: SetupCheck[] = [];

  const crowd = latest.crowd ?? max(...recent.map((f) => f.poses.length));
  checks.push(
    crowd > 1
      ? { key: 'person', state: 'warn', hint: `画面里有 ${crowd} 个人：最好只留运动员，分析时也可以点一下运动员` }
      : { key: 'person', state: 'ok', hint: '找到人了' },
  );

  // Whole body in the picture, feet clear of the bottom edge.
  if (floor > H * (1 - FOOT_MARGIN)) checks.push({ key: 'whole', state: 'fix', hint: '脚出画了：镜头往下一点，或者手机往后挪' });
  else if (med((m) => m.top) < 0) checks.push({ key: 'whole', state: 'fix', hint: '头出画了：手机往后挪，或者架高一点' });
  else if (med((m) => m.left) < 0 || med((m) => m.right) > W) checks.push({ key: 'whole', state: 'fix', hint: '身体出画了：手机往后挪，让人在画面中间附近' });
  else checks.push({ key: 'whole', state: 'ok', hint: '全身都在画面里' });

  if (stature < MIN_SIZE * H) checks.push({ key: 'size', state: 'fix', hint: '人太小了：手机往前挪近一点' });
  else if (floor < HEADROOM_S * stature) checks.push({ key: 'size', state: 'fix', hint: '上面不够高，跳起来手会出画：手机往后挪远一点，或者架高一点' });
  else checks.push({ key: 'size', state: 'ok', hint: '大小合适，上面留够了' });

  // Room either side along the run-up: the toes point the way they run, the run-up comes from behind.
  const facing = med((m) => m.facing);
  if (abs(facing) < 0.03 * stature) checks.push({ key: 'room', state: 'wait', hint: '面朝跑的方向站好' });
  else {
    const hipX = med((m) => m.hipX);
    const behind = facing > 0 ? hipX : W - hipX;
    const ahead = facing > 0 ? W - hipX : hipX;
    const shortBehind = behind < BEHIND_S * stature;
    const shortAhead = ahead < AHEAD_S * stature;
    if (shortBehind && shortAhead) checks.push({ key: 'room', state: 'fix', hint: '两边都拍不全：手机往后挪远一点' });
    else if (shortBehind) checks.push({ key: 'room', state: 'fix', hint: '助跑那边拍不全：把手机往助跑的方向平移一点' });
    else if (shortAhead) checks.push({ key: 'room', state: 'fix', hint: '落地那边拍不全：把手机往篮筐那边平移一点' });
    else checks.push({ key: 'room', state: 'ok', hint: '最后两步和落地都拍得到' });
  }

  const luma = med((m) => m.luma);
  const scene = median(recent.map((f) => f.luma));
  // A dark figure in a bright picture: the exposure is set by a window or the sun behind them.
  if (luma < BACKLIT_SHARE * scene) checks.push({ key: 'light', state: 'fix', hint: '逆光了：别对着窗户或太阳拍，换个方向' });
  else if (luma < DARK_LUMA) checks.push({ key: 'light', state: 'fix', hint: '太暗了：开灯，或者换亮一点的地方' });
  else if (luma > BRIGHT_LUMA) checks.push({ key: 'light', state: 'fix', hint: '太亮了：别对着窗户、太阳或灯拍' });
  else if (luma < DIM_LUMA) checks.push({ key: 'light', state: 'warn', hint: '光线偏暗，脚快的时候可能会糊' });
  else checks.push({ key: 'light', state: 'ok', hint: '光线够' });

  const faint = seen[seen.length - 1].m.faint;
  const faintV = median(seen.map((s) => s.m.faint.v));
  checks.push(
    faintV < CLEAR_VISIBILITY
      ? { key: 'clear', state: 'fix', hint: `看不清${faint.part}：别让东西挡住，衣服和背景颜色别太像，光线亮一点` }
      : { key: 'clear', state: 'ok', hint: '关节都看得清' },
  );

  const spread = med((m) => m.spread);
  if (spread > SIDE_OFF) checks.push({ key: 'side', state: 'fix', hint: '要侧对手机：侧身站好；已经侧着站了，就是手机不在跑道正侧面' });
  else if (spread > SIDE_ON) checks.push({ key: 'side', state: 'warn', hint: '还没完全侧对：手机再往跑道正侧面挪一点' });
  else checks.push({ key: 'side', state: 'ok', hint: '侧对手机了' });

  return { checks, athlete: now };
}

/**
 * Everything the camera screen shows and says before recording, from the analysed frames and accelerometer readings
 * so far (oldest first). With no frame yet, only the phone is checked.
 */
export function checkSetup(frames: SetupFrame[], gravity: GravitySample[]): SetupState {
  const now = frames.length ? frames[frames.length - 1].t : gravity.length ? gravity[gravity.length - 1].t : 0;
  const phone = phoneChecks(gravity, now);
  const picture = frames.length ? pictureChecks(frames) : { checks: [{ key: 'person', state: 'wait', hint: '正在打开相机' } as SetupCheck], athlete: null };
  const found = [...phone.checks, ...picture.checks];
  const checks = SETUP_CHECKS.map(([key]) => found.find((c) => c.key === key) ?? { key, state: 'wait' as const, hint: '' });
  const blocking = checks.find((c) => c.state === 'fix' || c.state === 'wait') ?? null;
  return {
    checks,
    ready: !blocking,
    // Something to fix comes before a wait: a wait isn't spoken, and facing the phone also leaves the run-up side unknown.
    main: checks.find((c) => c.state === 'fix') ?? blocking ?? checks.find((c) => c.state === 'warn') ?? null,
    level: phone.level,
    athlete: picture.athlete,
  };
}
