import { flightTimeFromFrames, frameCount, frameToSeconds, heightFromFlightTime, measureFromMarks, rsi } from '../jump';

describe('heightFromFlightTime', () => {
  it('uses h = g·t²/8', () => {
    // 0.55 s of flight ≈ 37.1 cm, the CMJ example in the design.
    expect(heightFromFlightTime(0.55) * 100).toBeCloseTo(37.09, 1);
  });

  it('is zero for no flight', () => {
    expect(heightFromFlightTime(0)).toBe(0);
  });
});

describe('flightTimeFromFrames', () => {
  it('divides frame span by fps', () => {
    expect(flightTimeFromFrames(120, 252, 240)).toBeCloseTo(0.55);
  });

  it('rejects non-positive fps', () => {
    expect(() => flightTimeFromFrames(0, 10, 0)).toThrow();
  });
});

describe('measureFromMarks', () => {
  it('measures a valid jump', () => {
    const r = measureFromMarks({ takeoffFrame: 120, landingFrame: 252, fps: 240 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.flightS).toBeCloseTo(0.55);
      expect(r.value.heightCm).toBeCloseTo(37.09, 1);
    }
  });

  it.each([
    [{ takeoffFrame: null, landingFrame: 252, fps: 240 }, 'missing'],
    [{ takeoffFrame: 252, landingFrame: 120, fps: 240 }, 'order'],
    [{ takeoffFrame: 100, landingFrame: 110, fps: 240 }, 'too-short'],
    [{ takeoffFrame: 0, landingFrame: 400, fps: 240 }, 'too-long'],
  ] as const)('flags %o as %s', (marks, problem) => {
    expect(measureFromMarks(marks)).toEqual({ ok: false, problem });
  });
});

describe('rsi', () => {
  it('height method: jump height (m) / contact (s)', () => {
    // 168 ms contact, 405 ms flight → h ≈ 0.201 m → RSI ≈ 1.20
    expect(rsi(0.168, 0.405)).toBeCloseTo(1.2, 2);
  });

  it('flight method: flight / contact', () => {
    expect(rsi(0.2, 0.4, 'flight')).toBeCloseTo(2);
  });
});

describe('frame helpers', () => {
  it('seeks to the middle of a frame', () => {
    expect(frameToSeconds(0, 240)).toBeCloseTo(1 / 480);
    expect(frameToSeconds(239, 240)).toBeCloseTo(0.99792, 4);
  });

  it('counts whole frames', () => {
    expect(frameCount(1.5, 240)).toBe(360);
    expect(frameCount(-1, 240)).toBe(0);
  });
});
