import { localized } from '@/i18n';

import type { BlockType } from './dunk';
import type { BlockTemplate, PlanTemplate, Prescription, SessionTemplate, WeekSpec } from './plan';

// The block plan's exercises, each tagged strength / reactive / transfer / technique. A new exercise only needs a
// tag and a place in a session; the plan logic doesn't change.
const SMITH = '没有深蹲架就用史密斯机';
const BX = {
  heavySquat: { code: 'back_squat', name: '杠铃后蹲', kind: 'strength', sets: 4, reps: 4, rpe: 8, cue: '大重量，每次下到大腿平行。没有深蹲架就用史密斯机' },
  squat: { code: 'back_squat', name: '杠铃后蹲', kind: 'strength', sets: 3, reps: 5, rpe: 7.5, cue: SMITH },
  maintainSquat: { code: 'back_squat', name: '杠铃后蹲', kind: 'strength', sets: 3, reps: 3, rpe: 8, cue: '维持力量，组数少但不轻。没有深蹲架就用史密斯机' },
  rdl: { code: 'rdl', name: '罗马尼亚硬拉', kind: 'strength', sets: 3, reps: 6, rpe: 7.5 },
  splitSquat: { code: 'split_squat', name: '保加利亚分腿蹲', kind: 'strength', sets: 3, reps: 6, perSide: true, rpe: 7.5 },
  depthJump: { code: 'depth_jump', name: '跳深', kind: 'reactive', sets: 4, reps: 5, intense: true, cue: '用跳深测试找到的最佳箱高，一触地就起跳，每次休息 1 分钟' },
  maintainDepthJump: { code: 'depth_jump', name: '跳深', kind: 'reactive', sets: 3, reps: 4, intense: true, cue: '用最佳箱高，维持反应力量' },
  pogo: { code: 'pogo', name: 'Pogo 跳', kind: 'reactive', sets: 3, reps: 15, cue: '膝盖微屈，靠脚踝弹，触地越短越好' },
  maintainPogo: { code: 'pogo', name: 'Pogo 跳', kind: 'reactive', sets: 2, reps: 10, cue: '热身后做，保持弹性' },
  hurdleHop: { code: 'hurdle_hop', name: '连续跨栏跳', kind: 'reactive', sets: 4, reps: 5, cue: '栏高到膝盖下方，落地即起，不要停顿' },
  singleLegHop: { code: 'single_leg_hop', name: '单腿连续跳', kind: 'reactive', sets: 3, reps: 5, perSide: true, cue: '触地短，膝盖对准脚尖' },
  approachJump: { code: 'approach_jump', name: '助跑摸高', kind: 'transfer', sets: 5, reps: 3, intense: true, jump: true, cue: '3–5 步助跑，全力起跳摸高，每次休息 1 分钟' },
  trapBarJump: { code: 'trap_bar_jump', name: '六角杠铃跳', kind: 'transfer', sets: 4, reps: 4, loaded: true, jump: true, cue: '用后蹲 1RM 的 20–30%，每次都全力跳' },
  squatJump: { code: 'squat_jump', name: '深蹲跳', kind: 'transfer', sets: 3, reps: 3, jump: true, cue: '每次落地站稳再跳，追求高度' },
  sprint: { code: 'sprint_20', name: '20 m 冲刺', kind: 'transfer', sets: 4, reps: 1, intense: true, cue: '站立起跑全力冲，每趟走回来休息 2 分钟' },
  penultimate: { code: 'penultimate_step', name: '助跑最后两步', kind: 'technique', sets: 4, reps: 3, jump: true, cue: '最后两步一长一短，降重心、摆臂向上；先求节奏不求高度' },
  calfRaise: { code: 'calf_raise', name: '单腿提踵', kind: 'accessory', sets: 3, reps: 12, perSide: true },
  nordic: { code: 'nordic', name: '北欧腿弯举', kind: 'accessory', sets: 3, reps: 5 },
  deadBug: { code: 'dead_bug', name: '死虫', kind: 'accessory', sets: 3, reps: 10, perSide: true },
} satisfies Record<string, Prescription>;

// The older fixed templates' exercises. Sets and RPE are week-1 values; the week specs scale them. Where an exercise
// is the same as in the block plan it is taken from BX, so the two can't drift apart.
const EX = {
  squatJump: { code: 'squat_jump', name: '深蹲跳', kind: 'plyo', sets: 3, reps: 5, cue: '每次落地站稳再跳，追求高度' },
  backSquat: { code: 'back_squat', name: '杠铃后蹲', kind: 'strength', sets: 4, reps: 5, rpe: 7.5 },
  rdl: { code: 'rdl', name: '罗马尼亚硬拉', kind: 'strength', sets: 3, reps: 8, rpe: 7 },
  calfRaise: BX.calfRaise,
  pogo: { ...BX.pogo, kind: 'plyo' },
  boxJump: { code: 'box_jump', name: '跳箱', kind: 'plyo', sets: 4, reps: 4, cue: '落在箱上要轻，走下来不跳下来' },
  depthJump: { code: 'depth_jump', name: '跌落跳', kind: 'plyo', sets: 3, reps: 5, intense: true, cue: '从 30–45 cm 台阶落下，一触地就起跳' },
  singleLegHop: { code: 'single_leg_hop', name: '单腿连续跳', kind: 'plyo', sets: 3, reps: 5, perSide: true },
  deadBug: BX.deadBug,
  trapBarJump: { code: 'trap_bar_jump', name: '六角杠铃跳', kind: 'plyo', sets: 4, reps: 4, loaded: true, cue: BX.trapBarJump.cue },
  splitSquat: BX.splitSquat,
  approachJump: { code: 'approach_jump', name: '助跑摸高', kind: 'plyo', sets: 5, reps: 3, intense: true, cue: BX.approachJump.cue },
  nordic: BX.nordic,
} satisfies Record<string, Prescription>;

/** Three weeks building up, then a deload week to retest in. */
export const BLOCK_WEEK_SPECS: WeekSpec[] = [
  { phase: 'accumulate' },
  { phase: 'accumulate', rpeDelta: 0.5 },
  { phase: 'intensify', setDelta: 1, rpeDelta: 1 },
  { phase: 'deload', setFactor: 0.6, rpeDelta: -1.5, dropIntense: true, retest: true },
];

/** Optional additions any block can switch on. */
const BLOCK_EXTRAS: BlockTemplate['extras'] = {
  /** Run-up technique: the approach jump barely beats the standing one. */
  technique: { slot: 0, item: BX.penultimate },
  /** A second heavy squat day while squat is still under 2× body mass. */
  heavy_squat: { slot: 2, item: BX.maintainSquat },
};

export const BLOCK_TEMPLATES: Record<BlockType, BlockTemplate> = {
  strength: {
    type: 'strength',
    sessions: [
      { code: 'S1', name: '大重量深蹲', focus: '下肢最大力量', items: [BX.heavySquat, BX.rdl, BX.squatJump, BX.calfRaise] },
      { code: 'S2', name: '单腿力量', focus: '单腿力量和后链', items: [BX.squat, BX.splitSquat, BX.maintainPogo, BX.nordic] },
      { code: 'S3', name: '深蹲 + 跳', focus: '重量和跳跃配着练', items: [BX.maintainSquat, BX.rdl, BX.maintainDepthJump, BX.deadBug] },
    ],
    weeks: BLOCK_WEEK_SPECS,
    retest: ['vbt_squat', 'sj', 'cmj'],
    extras: BLOCK_EXTRAS,
  },
  reactive: {
    type: 'reactive',
    sessions: [
      { code: 'R1', name: '跳深', focus: '最佳箱高跳深，触地短', items: [BX.depthJump, BX.pogo, BX.maintainSquat, BX.calfRaise] },
      { code: 'R2', name: '连续跳', focus: '短触地连续跳', items: [BX.hurdleHop, BX.singleLegHop, BX.splitSquat, BX.deadBug] },
      { code: 'R3', name: '跳深 + 力量', focus: '跳深配维持力量', items: [BX.maintainDepthJump, BX.pogo, BX.maintainSquat, BX.nordic] },
    ],
    weeks: BLOCK_WEEK_SPECS,
    retest: ['dj_rsi', 'cmj'],
    extras: BLOCK_EXTRAS,
  },
  transfer: {
    type: 'transfer',
    sessions: [
      { code: 'T1', name: '助跑摸高', focus: '把力量和弹性用到助跑起跳上', items: [BX.approachJump, BX.trapBarJump, BX.sprint, BX.nordic] },
      { code: 'T2', name: '维持', focus: '深蹲和跳深各维持一次', items: [BX.maintainDepthJump, BX.maintainSquat, BX.squatJump, BX.calfRaise] },
      { code: 'T3', name: '速度', focus: '冲刺和助跑跳', items: [BX.sprint, BX.approachJump, BX.hurdleHop, BX.deadBug] },
    ],
    weeks: BLOCK_WEEK_SPECS,
    retest: ['approach_touch', 'cmj'],
    extras: BLOCK_EXTRAS,
  },
};

export const BLOCK_PLAN_CODE = 'dunk-blocks';

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
    code: BLOCK_PLAN_CODE,
    name: '扣篮 · 4 周训练块',
    summary: '按诊断出的短板练 4 周：缺力量练力量块，缺反应练反应块，都过线练转化块。第 4 周减量并复测，再看下一块练什么。',
    sessions: BLOCK_TEMPLATES.strength.sessions,
    weeks: BLOCK_WEEK_SPECS,
    repeat: true,
    blocks: BLOCK_TEMPLATES,
  },
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

// Names, cues and summaries are shown in the current language (i18n).
localized([BX, EX, BLOCK_TEMPLATES, TEMPLATES], 'name', 'focus', 'summary', 'cue');

export function getTemplate(code: string): PlanTemplate | undefined {
  return TEMPLATES.find((t) => t.code === code);
}

/** An exercise of a template by its code, from any of its sessions, blocks or block extras. */
export function exerciseIn(templateCode: string, code: string): Prescription | undefined {
  const t = getTemplate(templateCode);
  if (!t) return undefined;
  const blocks = Object.values(t.blocks ?? {});
  const items = [...t.sessions, ...blocks.flatMap((b) => b.sessions)].flatMap((s) => s.items);
  const extras = blocks.flatMap((b) => Object.values(b.extras ?? {}).map((e) => e.item));
  return [...items, ...extras].find((p) => p.code === code);
}

/** Training days to suggest when the athlete hasn't picked any: spread out, with rest between. */
export function defaultWeekdays(sessionsPerWeek: number): number[] {
  return sessionsPerWeek >= 3 ? [1, 3, 5] : sessionsPerWeek === 2 ? [2, 5] : [3];
}
