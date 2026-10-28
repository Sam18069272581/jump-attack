import type { SessionTemplate } from '../plan';
import { adjustForKnee, jumpVolumeNote, kneeStatus, painProblem, PAIN_LIMIT, PAIN_OK, PAIN_STOP, JUMP_WARN, type PainEntry } from '../pain';

const s = (date: string, score: number): PainEntry => ({ date, kind: 'session', score });
const m = (date: string, score: number): PainEntry => ({ date, kind: 'morning', score });

describe('kneeStatus (pain-monitoring model, Silbernagel 2007)', () => {
  it('uses the model’s lines: up to 2 is fine, up to 5 acceptable, 7 or more stops jumping', () => {
    expect([PAIN_OK, PAIN_LIMIT, PAIN_STOP]).toEqual([2, 5, 7]);
  });

  it('is green with little pain in training and the next morning no worse than before', () => {
    expect(kneeStatus([m('2026-11-02', 1), s('2026-11-02', 2), m('2026-11-03', 1)], '2026-11-03')).toEqual({ light: 'green', reasons: [] });
  });

  it('is yellow at 3–5 in training when the next morning is back where it was', () => {
    expect(kneeStatus([m('2026-11-02', 1), s('2026-11-02', 4), m('2026-11-03', 1)], '2026-11-03')).toEqual({ light: 'yellow', reasons: ['训练中膝盖 4 分：照常练，跳跃量先别加'] });
  });

  it('is red above 5 in training, or when the next morning is worse than the one before', () => {
    expect(kneeStatus([s('2026-11-02', 6)], '2026-11-03')).toEqual({ light: 'red', reasons: ['训练中膝盖 6 分，超过 5 分：这次跳跃减半，不做跳深'] });
    expect(kneeStatus([m('2026-11-02', 1), s('2026-11-02', 3), m('2026-11-03', 3)], '2026-11-03')).toEqual({
      light: 'red',
      reasons: ['今早膝盖 3 分，比练前（1 分）高：这次跳跃减半，不做跳深'],
    });
  });

  it('only reads training before the day, so today’s own session does not change today’s plan', () => {
    expect(kneeStatus([s('2026-11-03', 6)], '2026-11-03')).toBeNull();
  });

  it('stops jumping after two reds in a row or any 7', () => {
    const stop = '暂停跳跃训练，找康复师或医生看一下；App 不做医疗判断';
    expect(kneeStatus([s('2026-10-30', 6), s('2026-11-02', 6)], '2026-11-03')).toEqual({ light: 'stop', reasons: ['连续两次红色', stop] });
    expect(kneeStatus([s('2026-11-02', 7)], '2026-11-03')).toEqual({ light: 'stop', reasons: ['训练中膝盖 7 分', stop] });
    expect(kneeStatus([s('2026-11-02', 1), m('2026-11-03', 8)], '2026-11-03')).toEqual({ light: 'stop', reasons: ['今早膝盖 8 分', stop] });
    // One red, then a green session: carry on.
    expect(kneeStatus([s('2026-10-30', 6), s('2026-11-02', 1)], '2026-11-03')?.light).toBe('green');
  });

  it('is null with nothing recorded', () => {
    expect(kneeStatus([], '2026-11-03')).toBeNull();
  });
});

describe('adjustForKnee', () => {
  const session: SessionTemplate = {
    code: 'R1',
    name: '跳深',
    focus: '',
    items: [
      { code: 'depth_jump', name: '跳深', kind: 'reactive', sets: 4, reps: 5, intense: true },
      { code: 'pogo', name: '踝跳', kind: 'reactive', sets: 3, reps: 15 },
      { code: 'approach_jump', name: '助跑摸高', kind: 'transfer', sets: 5, reps: 3, jump: true },
      { code: 'back_squat', name: '深蹲', kind: 'strength', sets: 3, reps: 5 },
    ],
  };

  it('halves the jumps and drops depth jumps on red', () => {
    const r = adjustForKnee(session, 'red');
    expect(r.session.items.map((p) => [p.code, p.sets])).toEqual([
      ['pogo', 2],
      ['approach_jump', 3],
      ['back_squat', 3],
    ]);
    expect(r.adjustments).toEqual([
      { code: 'depth_jump', name: '跳深', change: '今天取消', cause: 'knee' },
      { code: 'pogo', name: '踝跳', change: '3 组 → 2 组', cause: 'knee' },
      { code: 'approach_jump', name: '助跑摸高', change: '5 组 → 3 组', cause: 'knee' },
    ]);
  });

  it('takes every jump out on stop, and changes nothing on green or yellow', () => {
    expect(adjustForKnee(session, 'stop').session.items.map((p) => p.code)).toEqual(['back_squat']);
    expect(adjustForKnee(session, 'yellow')).toEqual({ session, adjustments: [] });
    expect(adjustForKnee(session, null)).toEqual({ session, adjustments: [] });
  });
});

describe('jumpVolumeNote', () => {
  it('shows the NSCA ground-contact guide and warns past 140', () => {
    expect(JUMP_WARN).toBe(140);
    expect(jumpVolumeNote(96)).toEqual({ text: '今天跳了 96 次（NSCA 每节参考：初级 80–100，中级 100–120，高级 120–140）', warn: false });
    expect(jumpVolumeNote(150)).toEqual({ text: '今天跳了 150 次，超过 140 次：膝盖受不了的话下次少跳一些', warn: true });
  });
});

describe('painProblem', () => {
  it('takes whole numbers 0–10', () => {
    expect(painProblem(0)).toBeNull();
    expect(painProblem(10)).toBeNull();
    expect(painProblem(11)).not.toBeNull();
    expect(painProblem(2.5)).not.toBeNull();
  });
});
