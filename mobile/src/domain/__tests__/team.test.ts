import { diagnose, type DunkInput } from '../dunk';
import { nextTurn, teamBoard, type TeamEntry } from '../team';

// 75 kg, 240 cm standing reach: no squat or drop jump yet, so no limiter.
const base: DunkInput = { bodyMassKg: 75, standingReachCm: 240, cmj: [45], sj: [], approachTouch: [], squat1rm: [], dropJumps: [], fvPct: [] };

function entry(id: number, name: string, input: Partial<DunkInput>, touches: { at: string; value: number }[] = []): TeamEntry {
  return { id, name, diagnosis: diagnose({ ...base, ...input }), touches };
}

describe('teamBoard', () => {
  it('ranks by how far each athlete is from their own dunk line, closest first', () => {
    const rows = teamBoard([
      // 305 + 15 = 320: 8 cm short.
      entry(1, '阿杰', { approachTouch: [312] }),
      // A 300 cm practice rim: line 315, 3 cm over.
      entry(2, '小明', { approachTouch: [318], rimCm: 300 }),
      // 2 cm short.
      entry(3, '大伟', { approachTouch: [318] }),
    ]);
    expect(rows.map((r) => [r.rank, r.name, r.gap])).toEqual([
      [1, '小明', '过线 3.0 cm'],
      [2, '大伟', '差 2.0 cm'],
      [3, '阿杰', '差 8.0 cm'],
    ]);
  });

  it('shares a rank on a tie and puts athletes without a touch last, unranked', () => {
    const rows = teamBoard([
      entry(1, '甲', { standingReachCm: null }),
      entry(2, '乙', { approachTouch: [316] }),
      entry(3, '丙', { approachTouch: [316] }),
      entry(4, '丁', { approachTouch: [310] }),
    ]);
    expect(rows.map((r) => [r.rank, r.name])).toEqual([
      [1, '乙'],
      [1, '丙'],
      [3, '丁'],
      [null, '甲'],
    ]);
    expect(rows[3].gap).toBe('还没测摸高');
  });

  it('marks a gap estimated from a standing jump, which is less sure than a run-up touch', () => {
    // 240 + 45 = 285: 35 cm short of 320.
    expect(teamBoard([entry(1, '甲', {})])[0].gap).toBe('差 35.0 cm · 原地估算');
  });

  it('only claims the line when the dunk page does, counting the touch’s error (domain/touch.ts lineVerdict)', () => {
    const gap = (approachTouch: number, errorCm: number | null) => teamBoard([entry(1, '甲', { approachTouch: [approachTouch], approachSpread: { jumps: 3, errorCm } })])[0].gap;
    // 319.96 rounds to a 0.0 cm gap but is still under 320.
    expect(gap(319.96, null)).toBe('差不到 0.1 cm');
    expect(gap(320, null)).toBe('正好摸到线');
    // 321 ± 2.1: the line is inside the error, so not yet for sure.
    expect(gap(321, 2.1)).toBe('摸到线 · 在误差内');
    expect(gap(318.5, 2.3)).toBe('差 1.5 cm · 在误差内');
    expect(gap(323, 2.1)).toBe('过线 3.0 cm');
  });

  it('names the weak link the diagnosis found, and says when one test is all it rests on', () => {
    // 1RM 100 kg at 75 kg is 1.33× body mass, under 1.5×: strength (Suchomel 2018, see domain/dunk.ts).
    const weak = teamBoard([entry(1, '甲', { squat1rm: [100] })])[0];
    expect(weak.weakness).toBe('力量（待复测确认）');
    const confirmed = teamBoard([entry(1, '甲', { squat1rm: [100, 101] })])[0];
    expect(confirmed.weakness).toBe('力量');
    // 1.6× and an RSI of 1.6, under 2.0: reactive strength.
    expect(teamBoard([entry(1, '甲', { squat1rm: [120, 120], dropJumps: [{ rsi: 1.6, contactMs: 200 }, { rsi: 1.6, contactMs: 200 }] })])[0].weakness).toBe('反应力量');
  });

  it('adds the run-up technique when the run-up gains too little over a standing jump', () => {
    // Standing 240 + 45 = 285, run-up 287: a 2 cm gain, under the 2.6 cm floor (Hank 2012, see domain/dunk.ts).
    const row = teamBoard([entry(1, '甲', { squat1rm: [120, 120], dropJumps: [{ rsi: 2.2, contactMs: 190 }, { rsi: 2.2, contactMs: 190 }], approachTouch: [287] })])[0];
    expect(row.weakness).toBe('转化、助跑技术');
  });

  it('says which tests are missing before a weak link can be named', () => {
    expect(teamBoard([entry(1, '甲', { bodyMassKg: null })])[0].weakness).toBe('先测：体重、深蹲 1RM、跳深、助跑摸高');
  });

  it('lists the latest three touches newest first, with the change since the one before', () => {
    const touches = [
      { at: '2026-10-01T10:00:00Z', value: 310 },
      { at: '2026-10-08T10:00:00Z', value: 311.5 },
      { at: '2026-10-15T10:00:00Z', value: 312 },
      { at: '2026-10-22T10:00:00Z', value: 314.2 },
    ];
    const row = teamBoard([entry(1, '甲', { approachTouch: touches.map((t) => t.value) }, touches)])[0];
    expect(row.recent.map((t) => t.value)).toEqual([314.2, 312, 311.5]);
    expect(row.change).toBe(2.2);
    expect(row.lastAt).toBe('2026-10-22T10:00:00Z');
    expect(teamBoard([entry(1, '甲', {}, touches.slice(0, 1))])[0].change).toBeNull();
  });
});

describe('nextTurn', () => {
  const lane = (...trials: number[]) => trials.map((n) => ({ trials: n }));

  it('has everyone do a test before anyone moves on, so each rests while the others jump', () => {
    expect(nextTurn([lane(0, 0, 0), lane(0, 0, 0)])).toEqual({ athlete: 0, step: 0 });
    expect(nextTurn([lane(3, 0, 0), lane(0, 0, 0)])).toEqual({ athlete: 1, step: 0 });
    expect(nextTurn([lane(3, 0, 0), lane(3, 0, 0)])).toEqual({ athlete: 0, step: 1 });
    expect(nextTurn([lane(3, 3, 0), lane(3, 0, 0)])).toEqual({ athlete: 1, step: 1 });
  });

  it('goes back for anyone who skipped a test, before the next test starts', () => {
    expect(nextTurn([lane(0, 0, 0), lane(3, 3, 0)])).toEqual({ athlete: 0, step: 0 });
  });

  it('is done once everyone has a result for every test', () => {
    expect(nextTurn([lane(3, 1, 6), lane(3, 3, 6)])).toBeNull();
    expect(nextTurn([])).toBeNull();
  });
});
