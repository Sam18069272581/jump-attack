/**
 * How each training exercise is done: a few steps, the mistakes that cost the most, and a side-view stick figure of
 * its start and key position. Everything is drawn and written here, so a teammate sees the same demo offline and no
 * third-party video is involved. An athlete can swap in a clip they filmed themselves (media/demos.ts).
 */

type Point = [number, number];

/**
 * One position, seen from the side and facing right. Angles are in degrees, positive towards the front:
 * - `torso`: hip to neck, from straight up (90 lies face down, -90 on the back).
 * - legs: [thigh, shin, foot] — hip to knee and knee to ankle from straight down; the foot's tilt below level
 *   (0 flat, 50 up on the toes).
 * - arms: [upper arm, forearm] from straight down (180 reaches overhead).
 */
export type PoseSpec = {
  torso: number;
  legs: [[number, number, number?], [number, number, number?]];
  arms: [[number, number], [number, number]];
  /** Feet off the ground, in figure units (the thigh is 20). */
  air?: number;
  /** Standing on something this high. */
  on?: number;
  props?: Prop[];
};

export type Prop =
  | { kind: 'barOnBack' }
  | { kind: 'barInHands' }
  | { kind: 'box'; dx: number; w: number; h: number }
  | { kind: 'benchUnderRearFoot' }
  | { kind: 'hurdle'; dx: number; h: number }
  | { kind: 'rim' };

export type Figure = {
  /** Polylines: torso, two legs, two arms. The far leg and arm come first so they can be drawn lighter. */
  limbs: { points: Point[]; far: boolean }[];
  head: { c: Point; r: number };
  plates: { c: Point; r: number }[];
  rects: { x: number; y: number; w: number; h: number }[];
  lines: Point[][];
};

export const FIGURE_SIZE = 100;
const GROUND = 92;
/** Figure units to view units: a standing athlete with arms overhead fits the frame. */
const SCALE = 0.68;
const SEG = { torso: 28, neck: 7, head: 5.5, thigh: 20, shin: 20, foot: 6, upper: 14, fore: 13 };

const rad = (deg: number) => (deg * Math.PI) / 180;
const down = (from: Point, deg: number, len: number): Point => [from[0] + len * Math.sin(rad(deg)), from[1] + len * Math.cos(rad(deg))];
const up = (from: Point, deg: number, len: number): Point => [from[0] + len * Math.sin(rad(deg)), from[1] - len * Math.cos(rad(deg))];

/**
 * A pose in view coordinates ({@link FIGURE_SIZE} square): the lowest joint on the ground line (or on `on`, or `air`
 * above it), and the figure with its props centred across.
 */
export function figure(spec: PoseSpec): Figure {
  // Built around the hip at the origin, y down.
  const hip: Point = [0, 0];
  const neck = up(hip, spec.torso, SEG.torso);
  const head = up(neck, spec.torso, SEG.neck);
  const legs = spec.legs.map(([thigh, shin, foot = 0]) => {
    const knee = down(hip, thigh, SEG.thigh);
    const ankle = down(knee, shin, SEG.shin);
    return [hip, knee, ankle, down(ankle, 90 - foot, SEG.foot)];
  });
  const arms = spec.arms.map(([upper, fore]) => {
    const elbow = down(neck, upper, SEG.upper);
    return [neck, elbow, down(elbow, fore, SEG.fore)];
  });
  const body = [...legs.flat(), ...arms.flat(), neck, [head[0], head[1] + SEG.head] as Point];
  const ground = Math.max(...body.map((p) => p[1])) + (spec.on ?? 0) + (spec.air ?? 0);

  const plates: { c: Point; r: number }[] = [];
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const lines: Point[][] = [];
  for (const p of spec.props ?? []) {
    if (p.kind === 'barOnBack') plates.push({ c: [neck[0] - 2, neck[1] + 2], r: 8 });
    if (p.kind === 'barInHands') plates.push({ c: arms[0][2], r: 8 });
    if (p.kind === 'box') rects.push({ x: p.dx, y: ground - p.h, w: p.w, h: p.h });
    if (p.kind === 'benchUnderRearFoot') {
      const [ax, ay] = legs[1][2];
      rects.push({ x: ax - 10, y: ay + 3, w: 20, h: ground - ay - 3 });
    }
    if (p.kind === 'hurdle') {
      const top = ground - p.h;
      lines.push(
        [
          [p.dx, ground],
          [p.dx, top],
          [p.dx + 8, top],
          [p.dx + 8, ground],
        ],
      );
    }
    if (p.kind === 'rim') {
      const [hx, hy] = arms[0][2];
      lines.push([
        [hx - 3, hy - 4],
        [hx + 22, hy - 4],
      ]);
    }
  }

  const xs = [...body, ...plates.map((p) => p.c), ...rects.flatMap((r): Point[] => [[r.x, r.y], [r.x + r.w, r.y]]), ...lines.flat()].map((p) => p[0]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const view = ([px, py]: Point): Point => [FIGURE_SIZE / 2 + (px - cx) * SCALE, GROUND + (py - ground) * SCALE];

  return {
    limbs: [
      { points: legs[1].map(view), far: true },
      { points: arms[1].map(view), far: true },
      { points: [hip, neck].map(view), far: false },
      { points: legs[0].map(view), far: false },
      { points: arms[0].map(view), far: false },
    ],
    head: { c: view(head), r: SEG.head * SCALE },
    plates: plates.map((p) => ({ c: view(p.c), r: p.r * SCALE })),
    rects: rects.map((r) => {
      const [x, y] = view([r.x, r.y]);
      return { x, y, w: r.w * SCALE, h: r.h * SCALE };
    }),
    lines: [
      [
        [0, GROUND],
        [FIGURE_SIZE, GROUND],
      ],
      ...lines.map((l) => l.map(view)),
    ],
  };
}

export type Demo = {
  /** What to do, in order. */
  steps: string[];
  /** The mistakes that matter most. */
  mistakes: string[];
  /** Start and key position. */
  poses: [PoseSpec, PoseSpec];
};

const STAND: PoseSpec = {
  torso: 0,
  legs: [
    [0, 0],
    [0, 0],
  ],
  arms: [
    [5, 5],
    [-5, -5],
  ],
};

export const DEMOS: Record<string, Demo> = {
  back_squat: {
    steps: ['杠铃放在斜方肌上，双脚与肩同宽，脚尖稍外展。', '吸气收紧核心，屈髋屈膝下蹲，蹲到大腿与地面平行。', '全脚掌踩稳，发力站起，站直后呼气。'],
    mistakes: ['膝盖向内扣，要对准脚尖。', '脚跟离地，或下蹲时弯腰。'],
    poses: [
      { ...STAND, arms: [[-45, 170], [-45, 170]], props: [{ kind: 'barOnBack' }] },
      { torso: 40, legs: [[85, -35], [85, -35]], arms: [[-10, 200], [-10, 200]], props: [{ kind: 'barOnBack' }] },
    ],
  },
  rdl: {
    steps: ['握杠站直，膝盖微屈后保持不动。', '臀部向后推，杠铃贴着大腿滑到膝盖下面，背保持平直。', '大腿后侧拉紧后伸髋站起。'],
    mistakes: ['弓背。', '膝盖越蹲越深，变成了深蹲。'],
    poses: [
      { ...STAND, arms: [[0, 0], [0, 0]], props: [{ kind: 'barInHands' }] },
      { torso: 75, legs: [[-5, -15], [-5, -15]], arms: [[0, 0], [0, 0]], props: [{ kind: 'barInHands' }] },
    ],
  },
  split_squat: {
    steps: ['后脚脚背放在约膝高的凳子上，前脚向前迈一大步。', '向下蹲，前腿大腿蹲到接近水平，后膝接近地面。', '用前脚全脚掌发力站起；做完一侧再换另一侧。'],
    mistakes: ['前膝向内扣。', '上身前倾太多，重心压在后腿上。'],
    poses: [
      { torso: 5, legs: [[20, -5], [-25, -100, -70]], arms: [[5, 5], [-5, -5]], props: [{ kind: 'benchUnderRearFoot' }] },
      { torso: 15, legs: [[80, -5], [0, -115, -70]], arms: [[10, 10], [-10, -10]], props: [{ kind: 'benchUnderRearFoot' }] },
    ],
  },
  depth_jump: {
    steps: ['站在箱子边缘，一只脚迈出去，自然落下，不要先往上跳。', '双脚前脚掌着地，一碰地就全力向上跳。', '落地屈膝缓冲，走回箱上休息够再做下一次。'],
    mistakes: ['落地后蹲很深、停顿，再起跳。', '从箱子上往上跳，变相加高了箱子。'],
    poses: [
      { ...STAND, on: 22, props: [{ kind: 'box', dx: -14, w: 28, h: 22 }] },
      { torso: 0, legs: [[0, 0, 40], [0, 0, 40]], arms: [[170, 175], [165, 170]], air: 18, props: [{ kind: 'box', dx: -50, w: 28, h: 22 }] },
    ],
  },
  pogo: {
    steps: ['站直，膝盖微屈后不再弯。', '只用脚踝发力，原地连续小跳，前脚掌着地。', '手臂小幅摆动，跟着节奏。'],
    mistakes: ['屈膝屈髋太多，变成了蹲跳。', '脚跟着地，触地变长。'],
    poses: [
      { ...STAND, legs: [[5, -5, 20], [5, -5, 20]] },
      { ...STAND, legs: [[0, 0, 50], [0, 0, 50]], arms: [[20, 30], [-10, 0]], air: 8 },
    ],
  },
  hurdle_hop: {
    steps: ['栏架放在膝盖以下的高度，间隔约一步。', '双脚起跳，收腿越过栏架。', '落地马上起跳过下一个，全程不停，手臂配合摆动。'],
    mistakes: ['两个栏之间多跳了一下。', '脚跟着地，触地时间太长。'],
    poses: [
      { torso: 15, legs: [[30, -20], [30, -20]], arms: [[-40, -30], [-40, -30]], props: [{ kind: 'hurdle', dx: 16, h: 18 }] },
      { torso: 5, legs: [[80, -20, 20], [75, -25, 20]], arms: [[60, 80], [50, 70]], air: 20, props: [{ kind: 'hurdle', dx: -4, h: 18 }] },
    ],
  },
  single_leg_hop: {
    steps: ['单腿站立，膝盖对准脚尖。', '向前连续单腿跳，前脚掌着地后马上起跳。', '做完一侧再换另一条腿。'],
    mistakes: ['落地时膝盖内扣。', '没站稳就接着跳。'],
    poses: [
      { torso: 15, legs: [[25, -15], [60, -40]], arms: [[-40, -20], [30, 60]] },
      { torso: 10, legs: [[-15, -10, 40], [70, -30]], arms: [[60, 90], [-40, -20]], air: 14 },
    ],
  },
  approach_jump: {
    steps: ['3–5 步助跑，一步比一步快。', '最后两步一长一短，重心降下来。', '双臂先往后再猛地往上摆，全力起跳摸最高点。'],
    mistakes: ['最后一步减速。', '起跳前停顿一下。'],
    poses: [
      { torso: 20, legs: [[40, -10], [-30, -60]], arms: [[-50, -40], [-50, -40]] },
      { torso: 0, legs: [[0, 0, 40], [60, -40]], arms: [[180, 180], [160, 170]], air: 20, props: [{ kind: 'rim' }] },
    ],
  },
  trap_bar_jump: {
    steps: ['站在六角杠中间，握住两侧把手，重量用后蹲 1RM 的 20–30%。', '屈髋屈膝到四分之一蹲，全力向上跳。', '落地屈膝缓冲，站稳再做下一次。'],
    mistakes: ['蹲得太深，起跳变慢。', '落地腿是直的，没有缓冲。'],
    poses: [
      { torso: 35, legs: [[55, -25], [55, -25]], arms: [[0, 0], [0, 0]], props: [{ kind: 'barInHands' }] },
      { torso: 0, legs: [[0, 0, 40], [0, 0, 40]], arms: [[0, 0], [0, 0]], air: 16, props: [{ kind: 'barInHands' }] },
    ],
  },
  squat_jump: {
    steps: ['蹲到半蹲，双臂向后。', '全力向上跳，髋、膝、踝都伸直，双臂向上摆。', '落地屈膝缓冲，站稳再做下一次。'],
    mistakes: ['落地时膝盖内扣。', '不站稳就连着跳。'],
    poses: [
      { torso: 40, legs: [[70, -30], [70, -30]], arms: [[-50, -40], [-50, -40]] },
      { torso: 0, legs: [[0, 0, 40], [0, 0, 40]], arms: [[170, 175], [165, 170]], air: 18 },
    ],
  },
  sprint_20: {
    steps: ['站立起跑，前脚在线后，身体前倾。', '前几步保持前倾，蹬地有力，身体逐步抬起。', '全力冲过 20 m，减速后走回起点。'],
    mistakes: ['第一步就站直了。', '没热身就全力跑。'],
    poses: [
      { torso: 35, legs: [[40, -20], [-25, -10]], arms: [[-40, -10], [40, 80]] },
      { torso: 20, legs: [[70, 0], [-30, -70]], arms: [[60, 100], [-50, -20]], air: 4 },
    ],
  },
  penultimate_step: {
    steps: ['慢速助跑 3 步。', '倒数第二步又长又低，重心降下来。', '最后一步短而快，双臂向上摆起跳；先求节奏，不求高度。'],
    mistakes: ['最后两步一样长。', '降重心时弯腰，而不是屈膝。'],
    poses: [
      { torso: 10, legs: [[50, -20], [-30, -40]], arms: [[-30, -20], [30, 60]] },
      { torso: 5, legs: [[30, -20], [55, -15]], arms: [[-60, -50], [-60, -50]] },
    ],
  },
  calf_raise: {
    steps: ['前脚掌站在台阶边缘，一只手扶墙保持平衡。', '脚跟慢慢放到最低，再用力提到最高。', '顶端停 1 秒；做完一侧换另一侧。'],
    mistakes: ['弹震借力，节奏太快。', '膝盖弯曲。'],
    poses: [
      { ...STAND, legs: [[0, 0, -20], [20, -60]], on: 10, props: [{ kind: 'box', dx: -4, w: 16, h: 10 }] },
      { ...STAND, legs: [[0, 0, 60], [20, -60]], on: 10, props: [{ kind: 'box', dx: -4, w: 16, h: 10 }] },
    ],
  },
  nordic: {
    steps: ['跪在软垫上，请同伴压住脚踝，或用器械固定。', '膝盖到头保持一条直线，慢慢向前倒，用大腿后侧控制速度。', '控制不住时用手撑地，推回起始位置。'],
    mistakes: ['屈髋、撅臀。', '倒得太快，没有控制。'],
    poses: [
      { torso: 0, legs: [[0, -90], [0, -90]], arms: [[0, 0], [0, 0]] },
      { torso: 55, legs: [[-55, -90], [-55, -90]], arms: [[80, 80], [80, 80]] },
    ],
  },
  dead_bug: {
    steps: ['仰卧，双臂向上伸直，髋和膝都屈 90 度。', '下背压紧地面，同时伸直一侧手臂和对侧腿。', '慢慢收回，再换另一侧。'],
    mistakes: ['下背离地拱起。', '憋气。'],
    poses: [
      { torso: -90, legs: [[180, 90], [180, 90]], arms: [[180, 180], [180, 180]] },
      { torso: -90, legs: [[180, 90], [95, 95]], arms: [[180, 180], [-95, -95]] },
    ],
  },
  box_jump: {
    steps: ['站在箱前约一脚远的地方。', '摆臂下蹲，全力跳上箱子，屈膝轻轻落下。', '在箱上站直，再走下来，不要跳下来。'],
    mistakes: ['箱子太高，落在箱上是深蹲。', '跳下箱子，徒增膝盖负担。'],
    poses: [
      { torso: 35, legs: [[60, -25], [60, -25]], arms: [[-50, -40], [-50, -40]], props: [{ kind: 'box', dx: 24, w: 30, h: 26 }] },
      { torso: 20, legs: [[60, -20], [60, -20]], arms: [[60, 70], [60, 70]], on: 26, props: [{ kind: 'box', dx: -6, w: 30, h: 26 }] },
    ],
  },
};

export function demoFor(code: string): Demo | null {
  return DEMOS[code] ?? null;
}

/** A demo is a few reps, not a training session: longer clips are trimmed in Photos first. */
export const DEMO_MAX_S = 30;

/** Why a picked clip can't be the demo, or null. The picker reports milliseconds, or nothing. */
export function demoClipProblem(durationMs: number | null | undefined): string | null {
  if (durationMs == null) return null;
  const s = Math.round(durationMs / 1000);
  return s > DEMO_MAX_S ? `这段有 ${s} 秒，示范剪到 ${DEMO_MAX_S} 秒以内再选` : null;
}
