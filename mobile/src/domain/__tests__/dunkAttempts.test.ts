import { attemptSummary, firstDunk, RECENT_ATTEMPTS, rimProblem, type DunkAttempt } from '../dunkAttempts';

let nextId = 1;
function attempt(outcome: DunkAttempt['outcome'], rimCm = 305, ball: DunkAttempt['ball'] = 'basketball', at = '2026-10-28T18:00:00Z'): DunkAttempt {
  return { id: nextId++, at, rimCm, ball, outcome };
}

describe('attemptSummary', () => {
  it('counts the latest setup by outcome', () => {
    const s = attemptSummary([attempt('short'), attempt('rim'), attempt('made'), attempt('rim')]);
    expect(s).toEqual({ rimCm: 305, ball: 'basketball', total: 4, made: 1, rim: 2, short: 1 });
  });

  it('reads only the most recent attempts, so old misses fade out', () => {
    const old = Array.from({ length: 5 }, () => attempt('short'));
    const recent = Array.from({ length: RECENT_ATTEMPTS }, (_, i) => attempt(i < 4 ? 'made' : 'rim'));
    expect(attemptSummary([...old, ...recent])).toMatchObject({ total: 10, made: 4, rim: 6, short: 0 });
  });

  it('defaults to the setup of the latest attempt and leaves other rims and balls out', () => {
    const list = [attempt('made', 295, 'volleyball'), attempt('made', 305), attempt('short', 305), attempt('rim', 300, 'volleyball')];
    expect(attemptSummary(list)).toEqual({ rimCm: 300, ball: 'volleyball', total: 1, made: 0, rim: 1, short: 0 });
    expect(attemptSummary(list, { rimCm: 305, ball: 'basketball' })).toMatchObject({ total: 2, made: 1, short: 1 });
  });

  it('is null without attempts at that setup', () => {
    expect(attemptSummary([])).toBeNull();
    expect(attemptSummary([attempt('made', 295)], { rimCm: 305, ball: 'basketball' })).toBeNull();
  });
});

describe('firstDunk', () => {
  it('is the first basketball dunk at or above the regulation rim', () => {
    const first = attempt('made', 305, 'basketball', '2026-11-20T18:00:00Z');
    const list = [
      attempt('made', 300, 'basketball', '2026-11-10T18:00:00Z'), // lower rim: practice, not the goal
      attempt('made', 305, 'volleyball', '2026-11-15T18:00:00Z'), // smaller ball: practice too
      attempt('rim', 305, 'basketball', '2026-11-18T18:00:00Z'),
      first,
      attempt('made', 305, 'basketball', '2026-11-25T18:00:00Z'),
    ];
    expect(firstDunk(list, 305)).toBe(first);
  });

  it('is null until it happens', () => {
    expect(firstDunk([attempt('rim'), attempt('short')], 305)).toBeNull();
  });
});

describe('rimProblem', () => {
  it('accepts adjustable hoops down to 200 cm and the regulation 305', () => {
    expect(rimProblem(305)).toBeNull();
    expect(rimProblem(260)).toBeNull();
    expect(rimProblem(200)).toBeNull();
  });

  it('rejects heights no hoop is set to', () => {
    expect(rimProblem(30.5)).not.toBeNull(); // metres typed as centimetres
    expect(rimProblem(350)).not.toBeNull();
    expect(rimProblem(Number.NaN)).not.toBeNull();
  });
});
