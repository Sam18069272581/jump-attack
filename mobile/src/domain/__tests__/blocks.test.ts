import { acceptSuggestion, advanceSuggestion, blockExtras, declineSuggestion, firstBlock, NO_DIAGNOSIS_REASON, retestCodes, switchSuggestion } from '../blocks';
import { diagnose, type DunkInput } from '../dunk';
import { blockOn, blockPosition, planDay, type PlanSettings } from '../plan';
import { BLOCK_PLAN_CODE, getTemplate } from '../templates';

const t = getTemplate(BLOCK_PLAN_CODE)!;
const input = (over: Partial<DunkInput> = {}): DunkInput => ({
  bodyMassKg: 80,
  standingReachCm: 240,
  cmj: [45],
  sj: [42],
  approachTouch: [],
  squat1rm: [140, 140],
  dropJumps: [
    { rsi: 1.6, contactMs: 220 },
    { rsi: 1.7, contactMs: 230 },
  ],
  fvPct: [],
  ...over,
});
// Squat 1.75× body mass and RSI under 2.0 in both tests: a confirmed reactive limiter.
const reactive = diagnose(input());
// Both lines passed, twice.
const transfer = diagnose(input({ dropJumps: [{ rsi: 2.1, contactMs: 200 }, { rsi: 2.2, contactMs: 190 }] }));

// Monday start, Monday / Wednesday / Friday.
const plan = (blocks: PlanSettings['blocks']): PlanSettings => ({ templateCode: BLOCK_PLAN_CODE, startDate: '2026-10-19', weekdays: [1, 3, 5], blocks });

describe('firstBlock', () => {
  it('follows the diagnosis and gives its reason', () => {
    expect(reactive.limiter).toBe('reactive');
    const b = firstBlock(reactive, '2026-10-19');
    expect(b).toMatchObject({ start: '2026-10-19', type: 'reactive', reason: reactive.reasons[0] });
    expect(b.reason).toContain('RSI');
  });

  it('starts with strength until the diagnosis can tell', () => {
    expect(firstBlock(null, '2026-10-19')).toEqual({ start: '2026-10-19', type: 'strength', reason: NO_DIAGNOSIS_REASON });
    expect(firstBlock(reactive, '2026-10-19', 'transfer').type).toBe('transfer');
  });

  it('switches on run-up technique and a second heavy squat day when called for', () => {
    const d = diagnose(input({ approachTouch: [286], dropJumps: [{ rsi: 2.1, contactMs: 200 }, { rsi: 2.2, contactMs: 190 }] }));
    expect(d.technique).toBe(true);
    expect(blockExtras(d, 'transfer')).toEqual(['technique', 'heavy_squat']);
    expect(blockExtras(d, 'reactive')).toEqual(['technique']);
  });
});

describe('switchSuggestion', () => {
  const p = plan([{ start: '2026-10-19', type: 'reactive' }]);

  it('waits for the retest week', () => {
    expect(switchSuggestion(t, p, '2026-11-04', transfer)).toBeNull(); // week 3 of 4
    expect(switchSuggestion(t, p, '2026-11-11', transfer)).toMatchObject({ kind: 'switch', from: 'reactive', type: 'transfer', start: '2026-11-16' });
  });

  it('needs two tests that agree on a different block', () => {
    expect(switchSuggestion(t, p, '2026-11-11', reactive)).toBeNull();
    const once = diagnose(input({ dropJumps: [{ rsi: 1.6, contactMs: 220 }, { rsi: 2.2, contactMs: 190 }] }));
    expect(once.limiter).toBe('transfer');
    expect(once.confirmed).toBe(false);
    expect(switchSuggestion(t, p, '2026-11-11', once)).toBeNull();
  });

  it('starts the new block after the retest week once accepted', () => {
    const s = switchSuggestion(t, p, '2026-11-11', transfer)!;
    const next = { ...p, blocks: acceptSuggestion(p, s, transfer, '2026-11-11') };
    expect(blockOn(next, '2026-11-13')).toBe('reactive');
    expect(blockOn(next, '2026-11-16')).toBe('transfer');
    expect(planDay(t, next, '2026-11-16')?.session.code).toBe('T1');
    expect(next.blocks[1].reason).toBe(transfer.reasons[0]);
    expect(switchSuggestion(t, next, '2026-11-13', transfer)).toBeNull();
  });

  it('is not offered again once turned down', () => {
    const s = switchSuggestion(t, p, '2026-11-11', transfer)!;
    const declined = { ...p, blocks: declineSuggestion(p, s, '2026-11-11') };
    expect(switchSuggestion(t, declined, '2026-11-13', transfer)).toBeNull();
    // The block runs again as the same type; its next retest week asks again.
    expect(switchSuggestion(t, declined, '2026-12-09', transfer)).toMatchObject({ type: 'transfer', start: '2026-12-14' });
  });
});

describe('advanceSuggestion', () => {
  const p = plan([{ start: '2026-10-19', type: 'strength' }]);
  const earlier = [
    { date: '2026-10-01', value: 290 },
    { date: '2026-10-08', value: 291 },
    { date: '2026-10-15', value: 290.5 },
  ];

  it('suggests the next phase after two clearly better touches in a row', () => {
    const touches = [...earlier, { date: '2026-10-20', value: 294 }, { date: '2026-10-22', value: 295 }];
    const s = advanceSuggestion(t, p, '2026-10-22', touches);
    expect(s).toMatchObject({ kind: 'advance', type: 'strength', week: 2, phase: '强化期' });
    expect(s?.kind === 'advance' && s.reason).toContain('294.0、295.0 cm');

    const next = { ...p, blocks: acceptSuggestion(p, s!, null, '2026-10-23') };
    expect(planDay(t, next, '2026-10-21')?.phase).toBe('accumulate');
    expect(planDay(t, next, '2026-10-23')).toMatchObject({ phase: 'intensify', block: { week: 2, end: '2026-11-02' } });
    expect(planDay(t, next, '2026-10-26')).toMatchObject({ phase: 'deload', block: { week: 3 } });
    expect(blockPosition(next, '2026-11-02')).toMatchObject({ week: 0, start: '2026-11-02' });
    // The skip-ahead needs two new results before it is offered again.
    expect(advanceSuggestion(t, next, '2026-10-23', touches)).toBeNull();
  });

  it('does nothing on one result, small changes or too little history', () => {
    expect(advanceSuggestion(t, p, '2026-10-22', [...earlier, { date: '2026-10-20', value: 295 }])).toBeNull();
    expect(advanceSuggestion(t, p, '2026-10-22', [...earlier, { date: '2026-10-20', value: 295 }, { date: '2026-10-22', value: 290.6 }])).toBeNull();
    expect(advanceSuggestion(t, p, '2026-10-22', [earlier[0], { date: '2026-10-20', value: 295 }, { date: '2026-10-22', value: 296 }])).toBeNull();
  });

  it('has nothing to skip to in the retest week', () => {
    const touches = [...earlier, { date: '2026-11-09', value: 294 }, { date: '2026-11-11', value: 295 }];
    expect(advanceSuggestion(t, p, '2026-11-11', touches)).toBeNull();
  });
});

describe('retestCodes', () => {
  it('always retests the run-up touch, the number the plan works towards', () => {
    const strong = diagnose(input({ squat1rm: [100, 100], approachTouch: [290] }));
    expect(strong.limiter).toBe('strength');
    expect(retestCodes(t, 'strength', strong)).toEqual(['approach_touch', 'vbt_squat', 'sj', 'cmj']);
    expect(retestCodes(t, 'reactive', reactive)).toEqual(['approach_touch', 'dj_rsi', 'cmj']);
    expect(retestCodes(t, 'transfer', transfer)).toEqual(['approach_touch', 'cmj']);
  });

  it('adds the drop jump to a strength block once the squat is past 1.5× and the next block hinges on it', () => {
    // No drop jump yet: the diagnosis can't tell reactive from transfer.
    const noJump = diagnose(input({ squat1rm: [125, 130], dropJumps: [], approachTouch: [290] }));
    expect(retestCodes(t, 'strength', noJump)).toEqual(['approach_touch', 'vbt_squat', 'sj', 'cmj', 'dj_rsi']);
    // One drop jump says reactive but needs a second to confirm.
    const once = diagnose(input({ squat1rm: [125, 130], dropJumps: [{ rsi: 1.8, contactMs: 200 }], approachTouch: [290] }));
    expect(once.confirmed).toBe(false);
    expect(retestCodes(t, 'strength', once)).toEqual(['approach_touch', 'vbt_squat', 'sj', 'cmj', 'dj_rsi']);
  });

  it('keeps to the block’s own tests without a diagnosis', () => {
    expect(retestCodes(t, 'reactive', null)).toEqual(['approach_touch', 'dj_rsi', 'cmj']);
  });
});
