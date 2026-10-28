import { readinessOn } from '../assess';
import {
  adjustForReadiness,
  blockOn,
  blockPosition,
  calendarDate,
  formatPrescription,
  isJump,
  missedThisWeek,
  nextSession,
  personalNote,
  planDay,
  planFinished,
  planPosition,
  planWeekOf,
  summarizeWorkout,
  type PlanSettings,
  type SessionTemplate,
} from '../plan';
import { BLOCK_PLAN_CODE, defaultWeekdays, getTemplate, TEMPLATES } from '../templates';

const fourPlusOne = getTemplate('jump-4-1')!;
const maintain = getTemplate('jump-maintain-2')!;
// Starts on a Wednesday, trains Monday / Wednesday / Friday.
const settings: PlanSettings = { templateCode: 'jump-4-1', startDate: '2026-10-21', weekdays: [5, 1, 3] };

const item = (session: SessionTemplate, code: string) => session.items.find((p) => p.code === code);

describe('templates', () => {
  it('have one session per training day and unique exercise codes per session', () => {
    for (const t of TEMPLATES) {
      expect(t.sessions.length).toBe(defaultWeekdays(t.sessions.length).length);
      for (const s of t.sessions) expect(new Set(s.items.map((p) => p.code)).size).toBe(s.items.length);
    }
  });
});

describe('planDay', () => {
  it('maps training weekdays to sessions in order and skips rest days', () => {
    expect(planDay(fourPlusOne, settings, '2026-10-21')?.session.code).toBe('B'); // Wednesday
    expect(planDay(fourPlusOne, settings, '2026-10-23')?.session.code).toBe('C'); // Friday
    expect(planDay(fourPlusOne, settings, '2026-10-26')?.session.code).toBe('A'); // next Monday
    expect(planDay(fourPlusOne, settings, '2026-10-22')).toBeNull(); // Thursday
  });

  it('starts on the start date and counts weeks from its Monday', () => {
    expect(planDay(fourPlusOne, settings, '2026-10-19')).toBeNull(); // Monday before the start
    expect(planDay(fourPlusOne, settings, '2026-10-21')?.week).toBe(0);
    expect(planDay(fourPlusOne, settings, '2026-10-26')?.week).toBe(1);
  });

  it('progresses through the weeks and deloads in the last one', () => {
    const w1 = planDay(fourPlusOne, settings, '2026-10-26')!; // week 2 (index 1), Monday A
    expect(item(w1.session, 'back_squat')).toMatchObject({ sets: 4, rpe: 8 });
    const w3 = planDay(fourPlusOne, settings, '2026-11-09')!; // week index 3
    expect(w3.phase).toBe('intensify');
    expect(item(w3.session, 'back_squat')).toMatchObject({ sets: 5, rpe: 8.5 });

    const deload = planDay(fourPlusOne, settings, '2026-11-18')!; // week index 4, Wednesday B
    expect(deload.phase).toBe('deload');
    expect(item(deload.session, 'depth_jump')).toBeUndefined();
    expect(item(deload.session, 'pogo')?.sets).toBe(2);
  });

  it('ends a fixed plan after its last week and loops a repeating one', () => {
    expect(planDay(fourPlusOne, settings, '2026-11-23')).toBeNull();
    expect(planFinished(fourPlusOne, settings, '2026-11-22')).toBe(false);
    expect(planFinished(fourPlusOne, settings, '2026-11-23')).toBe(true);

    const loop: PlanSettings = { templateCode: 'jump-maintain-2', startDate: '2026-10-19', weekdays: [2, 5] };
    const week4 = planDay(maintain, loop, '2026-11-10')!; // week index 3 → first week again
    expect(week4.phase).toBe('accumulate');
    expect(planFinished(maintain, loop, '2027-06-01')).toBe(false);
  });

  it('finds the next session from a rest day', () => {
    expect(nextSession(fourPlusOne, settings, '2026-10-24')?.date).toBe('2026-10-26');
  });
});

describe('inserted deload weeks', () => {
  // Fatigue on Wednesday 2026-10-28 (week index 1): a deload runs to Tuesday 11-03 and the plan resumes a week later.
  const withDeload: PlanSettings = { ...settings, deloads: ['2026-10-28'] };

  it('keeps the days before it as planned', () => {
    expect(planDay(fourPlusOne, withDeload, '2026-10-26')).toEqual(planDay(fourPlusOne, settings, '2026-10-26'));
  });

  it('turns the next 7 days into a deload of the sessions due then', () => {
    const wed = planDay(fourPlusOne, withDeload, '2026-10-28')!;
    expect(wed).toMatchObject({ phase: 'deload', inserted: true, week: 1 });
    expect(wed.session.code).toBe('B');
    expect(wed.session.items.some((p) => p.intense)).toBe(false);
    expect(item(wed.session, 'pogo')!.sets).toBeLessThan(item(planDay(fourPlusOne, settings, '2026-10-28')!.session, 'pogo')!.sets);
    expect(planDay(fourPlusOne, withDeload, '2026-11-02')).toMatchObject({ inserted: true, session: { code: 'A' } });
  });

  it('pushes the rest of the plan back a week', () => {
    expect(planDay(fourPlusOne, withDeload, '2026-11-04')).toEqual({ ...planDay(fourPlusOne, settings, '2026-10-28')!, date: '2026-11-04' });
    expect(planWeekOf(withDeload, '2026-11-09')).toBe(2);
    expect(planFinished(fourPlusOne, withDeload, '2026-11-23')).toBe(false);
    expect(planFinished(fourPlusOne, withDeload, '2026-11-30')).toBe(true);
  });
});

describe('adjustForReadiness', () => {
  const b = planDay(fourPlusOne, settings, '2026-10-21')!.session;
  const a = planDay(fourPlusOne, settings, '2026-10-26')!.session;

  it('leaves the session alone unless fatigued', () => {
    expect(adjustForReadiness(b, 'ready')).toEqual({ session: b, adjustments: [] });
    expect(adjustForReadiness(b, 'unknown').adjustments).toEqual([]);
  });

  it('drops maximal work and cuts about 30% of sets and one RPE point when fatigued', () => {
    const { session, adjustments } = adjustForReadiness(a, 'fatigued');
    expect(item(session, 'back_squat')).toMatchObject({ sets: 3, rpe: 7 });
    expect(adjustments).toContainEqual({ code: 'back_squat', name: '杠铃后蹲', change: '4 组 → 3 组，RPE 8 → 7' });

    const reactive = adjustForReadiness(b, 'fatigued');
    expect(item(reactive.session, 'depth_jump')).toBeUndefined();
    expect(reactive.adjustments[2]).toEqual({ code: 'depth_jump', name: '跌落跳', change: '今天取消（最大强度）' });
  });
});

describe('formatPrescription', () => {
  it('shows sets, reps, sides and RPE', () => {
    expect(formatPrescription({ code: 'x', name: 'x', kind: 'strength', sets: 4, reps: 5, rpe: 7.5 })).toBe('4 × 5 · RPE 7.5');
    expect(formatPrescription({ code: 'x', name: 'x', kind: 'plyo', sets: 3, reps: 5, perSide: true })).toBe('3 × 5/侧');
  });
});

describe('summarizeWorkout', () => {
  it('counts planned sets done, jumps and lifted volume', () => {
    const a = planDay(fourPlusOne, settings, '2026-10-26')!.session;
    const s = summarizeWorkout(a, [
      { exercise_code: 'squat_jump', set_no: 1, reps: 5, load_kg: null, rpe: null },
      { exercise_code: 'back_squat', set_no: 1, reps: 5, load_kg: 100, rpe: 8 },
      { exercise_code: 'back_squat', set_no: 2, reps: 5, load_kg: 100, rpe: 8 },
      { exercise_code: 'calf_raise', set_no: 1, reps: 12, load_kg: null, rpe: null },
    ]);
    expect(s).toEqual({ setsDone: 4, setsPlanned: 13, jumps: 5, volumeKg: 1000 });
  });
});

describe('readinessOn', () => {
  const at = (day: number, hour = 10) => new Date(2026, 9, day, hour).toISOString();

  it('compares the day’s best CMJ with earlier days', () => {
    const results = [
      { started_at: at(14), best: 40 },
      { started_at: at(15), best: 41 },
      { started_at: at(16), best: 40.5 },
      { started_at: at(19, 8), best: 37 },
      { started_at: at(19, 9), best: 38 },
    ];
    const r = readinessOn(results, '2026-10-19');
    expect(r.today).toBe(38);
    expect(r.readiness).toBe('fatigued');
    expect(r.dropPct).toBeCloseTo(0.0617, 3);
  });

  it('is unknown until CMJ is tested that day', () => {
    expect(readinessOn([{ started_at: at(14), best: 40 }], '2026-10-19')).toEqual({ today: null, readiness: 'unknown', dropPct: 0 });
  });
});

describe('block plans', () => {
  const blocks = getTemplate(BLOCK_PLAN_CODE)!;
  // Monday start, Monday / Wednesday / Friday, one reactive block.
  const s: PlanSettings = { templateCode: BLOCK_PLAN_CODE, startDate: '2026-10-19', weekdays: [1, 3, 5], blocks: [{ start: '2026-10-19', type: 'reactive' }] };

  it('takes sessions and weeks from the block the day falls in', () => {
    expect(planDay(blocks, s, '2026-10-19')).toMatchObject({ phase: 'accumulate', session: { code: 'R1' }, block: { index: 0, type: 'reactive', week: 0, start: '2026-10-19', end: '2026-11-16' } });
    expect(planDay(blocks, s, '2026-10-23')?.session.code).toBe('R3');
    expect(planDay(blocks, s, '2026-11-02')).toMatchObject({ phase: 'intensify', block: { week: 2 } });
  });

  it('deloads and retests in week 4, then runs the block again until another is picked', () => {
    const retest = planDay(blocks, s, '2026-11-09')!;
    expect(retest).toMatchObject({ phase: 'deload', block: { week: 3 } });
    expect(item(retest.session, 'depth_jump')).toBeUndefined();
    expect(planDay(blocks, s, '2026-11-16')).toMatchObject({ phase: 'accumulate', session: { code: 'R1' }, block: { week: 0, start: '2026-11-16' } });
    expect(planFinished(blocks, s, '2027-06-01')).toBe(false);
  });

  it('tells which block a day is in', () => {
    const switched: PlanSettings = { ...s, blocks: [...s.blocks!, { start: '2026-11-16', type: 'transfer' }] };
    expect(blockOn(switched, '2026-10-18')).toBeNull();
    expect(blockOn(switched, '2026-11-15')).toBe('reactive');
    expect(blockOn(switched, '2026-11-16')).toBe('transfer');
    expect(planDay(blocks, switched, '2026-11-16')?.session.code).toBe('T1');
    expect(blockOn(settings, '2026-10-26')).toBeNull();
  });

  it('pushes blocks back with an inserted deload', () => {
    const withDeload: PlanSettings = { ...s, deloads: ['2026-10-28'] };
    expect(planDay(blocks, withDeload, '2026-10-28')).toMatchObject({ inserted: true, phase: 'deload', block: { week: 1 } });
    expect(planDay(blocks, withDeload, '2026-11-16')).toMatchObject({ phase: 'deload', block: { week: 3 } });
    expect(blockPosition(withDeload, '2026-11-23')).toMatchObject({ week: 0 });
    expect(calendarDate(withDeload, '2026-10-27')).toBe('2026-10-27');
    expect(calendarDate(withDeload, planPosition(withDeload, '2026-11-04').planDate)).toBe('2026-11-04');
    expect(calendarDate(withDeload, '2026-11-16')).toBe('2026-11-23');
  });

  it('adds the extras a block switched on to their session', () => {
    const extras: PlanSettings = { ...s, blocks: [{ start: '2026-10-19', type: 'transfer', extras: ['technique', 'heavy_squat'] }] };
    expect(item(planDay(blocks, extras, '2026-10-19')!.session, 'penultimate_step')?.kind).toBe('technique');
    expect(item(planDay(blocks, extras, '2026-10-23')!.session, 'back_squat')).toBeDefined();
    expect(item(planDay(blocks, s, '2026-10-19')!.session, 'penultimate_step')).toBeUndefined();
  });

  it('tags every block exercise and counts reactive and transfer jumps', () => {
    for (const b of Object.values(blocks.blocks!)) {
      expect(b.weeks.filter((w) => w.retest)).toHaveLength(1);
      for (const session of b.sessions) {
        expect(new Set(session.items.map((p) => p.code)).size).toBe(session.items.length);
        for (const p of session.items) expect(['strength', 'reactive', 'transfer', 'technique', 'accessory']).toContain(p.kind);
      }
    }
    const r1 = planDay(blocks, s, '2026-10-19')!.session;
    expect(summarizeWorkout(r1, [{ exercise_code: 'pogo', set_no: 1, reps: 15, load_kg: null, rpe: null }]).jumps).toBe(15);
    expect(isJump({ code: 'sprint_20', name: '20 m 冲刺', kind: 'transfer', sets: 1, reps: 1 })).toBe(false);
  });
});

describe('personalNote', () => {
  it('names the best box from the drop-jump test for depth jumps', () => {
    expect(personalNote('depth_jump', { bestBoxCm: 40, squat1rmKg: null })).toBe('你的最佳箱高 40 cm');
    expect(personalNote('depth_jump', { bestBoxCm: null, squat1rmKg: 130 })).toBeNull();
  });

  it('turns the 20–30% of the squat 1RM for trap-bar jumps into kilos', () => {
    // 130 × 0.2 = 26 → 25 kg, 130 × 0.3 = 39 → 40 kg, to the nearest 2.5 kg plate step.
    expect(personalNote('trap_bar_jump', { bestBoxCm: null, squat1rmKg: 130 })).toBe('建议 25–40 kg（后蹲 1RM 130 kg 的 20–30%）');
    expect(personalNote('trap_bar_jump', { bestBoxCm: 40, squat1rmKg: null })).toBeNull();
  });

  it('has nothing for other exercises', () => {
    expect(personalNote('pogo', { bestBoxCm: 40, squat1rmKg: 130 })).toBeNull();
  });
});

describe('missedThisWeek', () => {
  const t = getTemplate('jump-4-1')!;
  // Starts Monday 2026-10-19, training Monday, Wednesday and Friday.
  const s: PlanSettings = { templateCode: 'jump-4-1', startDate: '2026-10-19', weekdays: [1, 3, 5] };

  it('lists this week’s training days before today that were never started, oldest first', () => {
    // Thursday: Monday's A and Wednesday's B are open.
    expect(missedThisWeek(t, s, [], '2026-10-22').map((p) => [p.date, p.session.code])).toEqual([
      ['2026-10-19', 'A'],
      ['2026-10-21', 'B'],
    ]);
    expect(missedThisWeek(t, s, ['2026-10-19'], '2026-10-22').map((p) => p.date)).toEqual(['2026-10-21']);
  });

  it('does not reach into last week or before the plan started', () => {
    // Next Tuesday: only that week's Monday counts, not last Friday.
    expect(missedThisWeek(t, s, [], '2026-10-27').map((p) => p.date)).toEqual(['2026-10-26']);
    expect(missedThisWeek(t, { ...s, startDate: '2026-10-21' }, [], '2026-10-22').map((p) => p.date)).toEqual(['2026-10-21']);
    expect(missedThisWeek(t, s, [], '2026-10-19')).toEqual([]);
  });
});
