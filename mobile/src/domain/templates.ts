import type { PlanTemplate, Prescription, SessionTemplate } from './plan';

// Exercises shared by the templates. Sets and RPE are week-1 values; the week specs scale them.
const EX = {
  squatJump: { code: 'squat_jump', name: '深蹲跳', kind: 'plyo', sets: 3, reps: 5, cue: '每次落地站稳再跳，追求高度' },
  backSquat: { code: 'back_squat', name: '杠铃后蹲', kind: 'strength', sets: 4, reps: 5, rpe: 7.5 },
  rdl: { code: 'rdl', name: '罗马尼亚硬拉', kind: 'strength', sets: 3, reps: 8, rpe: 7 },
  calfRaise: { code: 'calf_raise', name: '单腿提踵', kind: 'accessory', sets: 3, reps: 12, perSide: true },
  pogo: { code: 'pogo', name: 'Pogo 跳', kind: 'plyo', sets: 3, reps: 15, cue: '膝盖微屈，靠脚踝弹，触地越短越好' },
  boxJump: { code: 'box_jump', name: '跳箱', kind: 'plyo', sets: 4, reps: 4, cue: '落在箱上要轻，走下来不跳下来' },
  depthJump: { code: 'depth_jump', name: '跌落跳', kind: 'plyo', sets: 3, reps: 5, intense: true, cue: '从 30–45 cm 台阶落下，一触地就起跳' },
  singleLegHop: { code: 'single_leg_hop', name: '单腿连续跳', kind: 'plyo', sets: 3, reps: 5, perSide: true },
  deadBug: { code: 'dead_bug', name: '死虫', kind: 'accessory', sets: 3, reps: 10, perSide: true },
  trapBarJump: { code: 'trap_bar_jump', name: '六角杠铃跳', kind: 'plyo', sets: 4, reps: 4, loaded: true, cue: '用后蹲 1RM 的 20–30%，每次都全力跳' },
  splitSquat: { code: 'split_squat', name: '保加利亚分腿蹲', kind: 'strength', sets: 3, reps: 6, perSide: true, rpe: 7.5 },
  approachJump: { code: 'approach_jump', name: '助跑摸高', kind: 'plyo', sets: 5, reps: 3, intense: true, cue: '3–5 步助跑，全力起跳摸高，每次休息 1 分钟' },
  nordic: { code: 'nordic', name: '北欧腿弯举', kind: 'accessory', sets: 3, reps: 5 },
} satisfies Record<string, Prescription>;

const STRENGTH: SessionTemplate = {
  code: 'A',
  name: '力量 + 跳跃',
  focus: '下肢最大力量，配合深蹲跳',
  items: [EX.squatJump, EX.backSquat, EX.rdl, EX.calfRaise],
};

const REACTIVE: SessionTemplate = {
  code: 'B',
  name: '反应力量',
  focus: '触地短、弹得快',
  items: [EX.pogo, EX.boxJump, EX.depthJump, EX.singleLegHop, EX.deadBug],
};

const POWER: SessionTemplate = {
  code: 'C',
  name: '力量-速度',
  focus: '中等重量下快速发力',
  items: [EX.trapBarJump, EX.splitSquat, EX.approachJump, EX.nordic],
};

export const TEMPLATES: PlanTemplate[] = [
  {
    code: 'jump-4-1',
    name: '垂直弹跳 · 4+1 周期',
    summary: '每周 3 练，前 4 周逐步加量加强度，第 5 周减量恢复，最后测一次 CMJ 看提升。',
    sessions: [STRENGTH, REACTIVE, POWER],
    weeks: [
      { phase: 'accumulate' },
      { phase: 'accumulate', rpeDelta: 0.5 },
      { phase: 'intensify', setDelta: 1, rpeDelta: 0.5 },
      { phase: 'intensify', setDelta: 1, rpeDelta: 1 },
      { phase: 'deload', setFactor: 0.6, rpeDelta: -1.5, dropIntense: true },
    ],
    repeat: false,
  },
  {
    code: 'jump-maintain-2',
    name: '保持 · 每周 2 练',
    summary: '赛季中或时间少的时候用：每周 2 练保住力量和弹性，两周正常一周轻松，循环进行。',
    sessions: [STRENGTH, REACTIVE],
    weeks: [{ phase: 'accumulate' }, { phase: 'accumulate', rpeDelta: 0.5 }, { phase: 'deload', setFactor: 0.6, rpeDelta: -1, dropIntense: true }],
    repeat: true,
  },
];

export function getTemplate(code: string): PlanTemplate | undefined {
  return TEMPLATES.find((t) => t.code === code);
}

/** Training days to suggest when the athlete hasn't picked any: spread out, with rest between. */
export function defaultWeekdays(sessionsPerWeek: number): number[] {
  return sessionsPerWeek >= 3 ? [1, 3, 5] : sessionsPerWeek === 2 ? [2, 5] : [3];
}
