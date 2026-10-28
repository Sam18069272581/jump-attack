import { fileFpsFromFrameTimes, flightTimeFromFrames, frameCount, frameToSeconds, heightFromFlightTime, markingRates, measureFromMarks, rsi } from '../jump';

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

describe('markingRates', () => {
  it('uses the file rate for both when nothing is chosen', () => {
    expect(markingRates({ detected: 240, chosen: null, reported: 0 })).toEqual({ file: 240, capture: 240 });
  });

  it('measures a slowed-down slow-motion clip at its capture rate', () => {
    const { file, capture } = markingRates({ detected: 30, chosen: 240, reported: 0 });
    expect(file).toBe(30);
    // 132 frames of a 240 fps capture played back at 30 fps is still 0.55 s of real flight.
    const r = measureFromMarks({ takeoffFrame: 100, landingFrame: 232, fps: capture });
    expect(r.ok && r.value.flightS).toBeCloseTo(0.55);
  });

  it('never measures slower than the file', () => {
    expect(markingRates({ detected: 240, chosen: 60, reported: 0 }).capture).toBe(240);
  });

  it('falls back to the chosen, then the camera, then the default rate', () => {
    expect(markingRates({ detected: null, chosen: 120, reported: 240 })).toEqual({ file: 120, capture: 120 });
    expect(markingRates({ detected: null, chosen: null, reported: 120 })).toEqual({ file: 120, capture: 120 });
    expect(markingRates({ detected: null, chosen: null, reported: 0 })).toEqual({ file: 240, capture: 240 });
  });
});

describe('fileFpsFromFrameTimes', () => {
  // Presentation times of consecutive decoded frames, as a browser reports them while the clip plays.
  const times = (fps: number, n: number, skip: number[] = []) => Array.from({ length: n }, (_, i) => i / fps).filter((_, i) => !skip.includes(i));

  it('reads the frame rate from the gap between frames', () => {
    expect(fileFpsFromFrameTimes(times(30, 12))).toBe(30);
    expect(fileFpsFromFrameTimes(times(240, 12))).toBe(240);
  });

  it('ignores frames the browser skipped', () => {
    // Frames 3, 4 and 8 never reached the screen; the remaining gaps are still 1/240 s.
    expect(fileFpsFromFrameTimes(times(240, 14, [3, 4, 8]))).toBe(240);
  });

  it('snaps NTSC rates to the nominal one', () => {
    expect(fileFpsFromFrameTimes(times(29.97, 12))).toBe(30);
    expect(fileFpsFromFrameTimes(times(59.94, 12))).toBe(60);
  });

  it('needs a handful of frames', () => {
    expect(fileFpsFromFrameTimes([0, 1 / 30, 2 / 30])).toBeNull();
    expect(fileFpsFromFrameTimes([0, 0, 0, 0, 0, 0])).toBeNull();
  });
});
