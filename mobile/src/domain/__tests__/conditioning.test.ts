import {
  COOPER_SECONDS,
  YOYO_IR1,
  clock,
  cooperVo2max,
  rsaRating,
  rsaSummary,
  yoyoCompletedAt,
  yoyoDistance,
  yoyoLabel,
  yoyoStateAt,
  yoyoVo2max,
} from '../conditioning';

describe('Yo-Yo IR1 schedule', () => {
  it('has 91 shuttles ending at level 23.8, 3640 m in all', () => {
    expect(YOYO_IR1).toHaveLength(91);
    expect(yoyoLabel(91)).toBe('23.8');
    expect(yoyoDistance(91)).toBe(3640);
    expect(yoyoDistance(200)).toBe(3640);
  });

  it('starts at 10 km/h with 14.4 s per 40 m and 10 s recovery', () => {
    const [first, second] = YOYO_IR1;
    expect(first).toMatchObject({ level: 5, inLevel: 1, speedKmh: 10, start: 0 });
    expect(first.end).toBeCloseTo(14.4);
    expect(first.turn).toBeCloseTo(7.2);
    expect(second.start).toBeCloseTo(24.4);
    expect(second).toMatchObject({ level: 9, speedKmh: 12 });
  });

  it('labels shuttles by level and position in level', () => {
    expect(yoyoLabel(0)).toBe('—');
    expect(yoyoLabel(1)).toBe('5.1');
    expect(yoyoLabel(4)).toBe('11.2');
    expect(yoyoLabel(11)).toBe('13.4');
    expect(yoyoLabel(14)).toBe('14.3');
    const level15 = YOYO_IR1.find((s) => s.level === 15)!;
    expect(level15.speedKmh).toBe(15);
  });

  it('tracks the phase over time', () => {
    expect(yoyoStateAt(1)).toMatchObject({ phase: 'run', leg: 'out' });
    expect(yoyoStateAt(8)).toMatchObject({ phase: 'run', leg: 'back' });
    const rest = yoyoStateAt(20);
    expect(rest.phase).toBe('rest');
    if (rest.phase === 'rest') {
      expect(rest.next.n).toBe(2);
      expect(rest.toBeep).toBeCloseTo(4.4);
    }
    expect(yoyoStateAt(YOYO_IR1[90].end + 1)).toEqual({ phase: 'done' });
  });

  it('credits only shuttles whose finish beep has sounded', () => {
    expect(yoyoCompletedAt(10)).toBe(0);
    expect(yoyoCompletedAt(14.4)).toBe(1);
    expect(yoyoCompletedAt(20)).toBe(1);
    expect(yoyoCompletedAt(30)).toBe(1);
  });

  it('estimates VO2max with the Bangsbo equation', () => {
    expect(yoyoVo2max(2000)).toBeCloseTo(53.2);
    expect(yoyoVo2max(0)).toBeCloseTo(36.4);
  });
});

describe('Cooper 12-minute run', () => {
  it('lasts 12 minutes and uses the Cooper equation', () => {
    expect(COOPER_SECONDS).toBe(720);
    expect(cooperVo2max(3000)).toBeCloseTo(55.8, 1);
  });
});

describe('repeated sprints', () => {
  it('summarises best, mean and percentage decrement', () => {
    const s = rsaSummary([7.0, 7.1, 7.2, 7.3, 7.4, 7.5]);
    expect(s.best).toBe(7.0);
    expect(s.mean).toBeCloseTo(7.25);
    expect(s.total).toBeCloseTo(43.5);
    expect(s.sdec).toBeCloseTo((43.5 / 42 - 1) * 100);
  });

  it('is zero when every sprint matches the best', () => {
    expect(rsaSummary([7, 7, 7]).sdec).toBeCloseTo(0);
  });

  it('rates the decrement', () => {
    expect(rsaRating(2.5).rating).toBe('good');
    expect(rsaRating(4).rating).toBe('typical');
    expect(rsaRating(7).rating).toBe('poor');
  });
});

describe('clock', () => {
  it('formats seconds as m:ss, rounding up', () => {
    expect(clock(720)).toBe('12:00');
    expect(clock(59.2)).toBe('1:00');
    expect(clock(5)).toBe('0:05');
    expect(clock(-1)).toBe('0:00');
  });
});
