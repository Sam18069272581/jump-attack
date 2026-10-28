import { DEFAULT_TEST_BOX_CM, testDayBox, testDaySteps, nextStep } from '../testDay';

describe('testDaySteps', () => {
  it('runs CMJ ×3, then drop jumps, then run-up touches ×6, the order the shortlist settled on', () => {
    expect(testDaySteps(40).map((s) => [s.metric, s.jumps, s.box ?? null])).toEqual([
      ['cmj', 3, null],
      ['dj_rsi', 3, 40],
      ['approach_touch', 6, null],
    ]);
  });
});

describe('testDayBox', () => {
  const j = (session_id: string, boxCm: number, rsi: number) => ({ session_id, boxCm, rsi, contactMs: 200, heightCm: 30 });

  it('drops from the box the latest ladder peaked at', () => {
    // The first ladder peaked at 40, the latest one at 50.
    expect(testDayBox([j('a', 30, 1.8), j('a', 40, 2.0), j('b', 40, 2.1), j('b', 50, 2.3), j('b', 60, 2.2)])).toBe(50);
  });

  it('uses 30 cm before there is a ladder', () => {
    expect(DEFAULT_TEST_BOX_CM).toBe(30);
    expect(testDayBox([])).toBe(30);
  });
});

describe('nextStep', () => {
  const steps = testDaySteps(30);

  it('is the first test with nothing recorded today, or null when every test has a result', () => {
    expect(nextStep(steps, {})).toBe(0);
    expect(nextStep(steps, { cmj: { trials: 2 } })).toBe(1);
    expect(nextStep(steps, { cmj: { trials: 3 }, approach_touch: { trials: 6 } })).toBe(1);
    expect(nextStep(steps, { cmj: { trials: 3 }, dj_rsi: { trials: 3 }, approach_touch: { trials: 6 } })).toBeNull();
  });
});
