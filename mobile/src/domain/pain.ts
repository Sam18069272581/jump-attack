import { addDays, type ISODate } from './dates';
import { isJump, type Adjustment, type Prescription, type SessionTemplate } from './plan';

/**
 * Knee pain, scored 0 (none) to 10 (worst), read with the pain-monitoring model (Silbernagel 2007): pain up to 5
 * during training is acceptable as long as it settles by the next morning. Twice a day at most: the worst during
 * training, and the next morning.
 */

export type PainKind = 'session' | 'morning';
export type PainEntry = { date: ISODate; kind: PainKind; score: number };
export type KneeLight = 'green' | 'yellow' | 'red' | 'stop';

/** Up to this in training: carry on as planned. */
export const PAIN_OK = 2;
/** Above this in training: cut the jumps. */
export const PAIN_LIMIT = 5;
/** This much at any time: stop jumping and have it looked at. */
export const PAIN_STOP = 7;

const RED_ACTION = '这次跳跃减半，不做跳深';
const STOP_ACTION = '暂停跳跃训练，找康复师或医生看一下；App 不做医疗判断';

type Read = { light: Exclude<KneeLight, 'stop'>; reason: string | null };

/** One session: its own pain, and the next morning's against the last morning before it. */
function readSession(session: PainEntry, mornings: PainEntry[]): Read {
  if (session.score > PAIN_LIMIT) return { light: 'red', reason: `训练中膝盖 ${session.score} 分，超过 ${PAIN_LIMIT} 分：${RED_ACTION}` };
  const before = mornings.filter((m) => m.date <= session.date).at(-1);
  const after = mornings.find((m) => m.date === addDays(session.date, 1));
  if (before && after && after.score > before.score) return { light: 'red', reason: `今早膝盖 ${after.score} 分，比练前（${before.score} 分）高：${RED_ACTION}` };
  if (session.score > PAIN_OK) return { light: 'yellow', reason: `训练中膝盖 ${session.score} 分：照常练，跳跃量先别加` };
  return { light: 'green', reason: null };
}

/**
 * The knee's light for training on `date`: from sessions before that day and mornings up to it, so logging today's
 * session pain doesn't change today's plan. Null with nothing recorded.
 */
export function kneeStatus(entries: PainEntry[], date: ISODate): { light: KneeLight; reasons: string[] } | null {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const sessions = sorted.filter((e) => e.kind === 'session' && e.date < date);
  const mornings = sorted.filter((e) => e.kind === 'morning' && e.date <= date);
  if (!sessions.length && !mornings.length) return null;

  const lastSession = sessions.at(-1);
  const lastMorning = mornings.at(-1);
  if (lastSession && lastSession.score >= PAIN_STOP) return { light: 'stop', reasons: [`训练中膝盖 ${lastSession.score} 分`, STOP_ACTION] };
  if (lastMorning && lastMorning.score >= PAIN_STOP) return { light: 'stop', reasons: [`今早膝盖 ${lastMorning.score} 分`, STOP_ACTION] };
  if (!lastSession) return { light: 'green', reasons: [] };

  const last = readSession(lastSession, mornings);
  const prev = sessions.length > 1 ? readSession(sessions.at(-2)!, mornings) : null;
  if (last.light === 'red' && prev?.light === 'red') return { light: 'stop', reasons: ['连续两次红色', STOP_ACTION] };
  return { light: last.light, reasons: last.reason ? [last.reason] : [] };
}

const isDepthJump = (p: Prescription) => p.code === 'depth_jump';

/** Red: half the jumps and no depth jumps. Stop: no jumps at all. Green and yellow train as planned. */
export function adjustForKnee(session: SessionTemplate, light: KneeLight | null | undefined): { session: SessionTemplate; adjustments: Adjustment[] } {
  if (light !== 'red' && light !== 'stop') return { session, adjustments: [] };
  const adjustments: Adjustment[] = [];
  const items: Prescription[] = [];
  for (const p of session.items) {
    if (!isJump(p)) {
      items.push(p);
    } else if (light === 'stop' || isDepthJump(p)) {
      adjustments.push({ code: p.code, name: p.name, change: '今天取消', cause: 'knee' });
    } else {
      const sets = Math.max(1, Math.round(p.sets / 2));
      if (sets !== p.sets) adjustments.push({ code: p.code, name: p.name, change: `${p.sets} 组 → ${sets} 组`, cause: 'knee' });
      items.push({ ...p, sets });
    }
  }
  return { session: { ...session, items }, adjustments };
}

/** NSCA ground contacts per session: beginner 80–100, intermediate 100–120, advanced 120–140. */
export const JUMP_GUIDE = { beginner: [80, 100], intermediate: [100, 120], advanced: [120, 140] } as const;
/** Past the advanced range: warn, without changing the plan. */
export const JUMP_WARN = JUMP_GUIDE.advanced[1];

/** The day's ground contacts against the guide. */
export function jumpVolumeNote(jumps: number): { text: string; warn: boolean } {
  if (jumps > JUMP_WARN) return { text: `今天跳了 ${jumps} 次，超过 ${JUMP_WARN} 次：膝盖受不了的话下次少跳一些`, warn: true };
  const g = JUMP_GUIDE;
  return {
    text: `今天跳了 ${jumps} 次（NSCA 每节参考：初级 ${g.beginner.join('–')}，中级 ${g.intermediate.join('–')}，高级 ${g.advanced.join('–')}）`,
    warn: false,
  };
}

export function painProblem(score: number): string | null {
  return Number.isInteger(score) && score >= 0 && score <= 10 ? null : '疼痛按 0–10 分打，0 是不疼，10 是最疼';
}
