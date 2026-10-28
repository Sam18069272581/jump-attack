import { getMetric, sessionValue } from '../metrics';
import { calibrationProblem, lineVerdict, MAX_CALIBRATIONS, touchError, touchOffset, videoReadError, WALL_READ_ERROR_CM } from '../touch';

describe('touchOffset', () => {
  it('is the median gap between the reading on the wall and standing reach + flight-time jump', () => {
    // On the toes and with the arm stretched at take-off, the hand starts higher than the standing reach:
    // 296 − (240 + 50) = 6, 297 − (240 + 52) = 5, 300 − (240 + 51.5) = 8.5 → median 6.
    expect(
      touchOffset([
        { touchedCm: 296, reachCm: 240, jumpCm: 50 },
        { touchedCm: 297, reachCm: 240, jumpCm: 52 },
        { touchedCm: 300, reachCm: 240, jumpCm: 51.5 },
      ]),
    ).toBe(6);
  });

  it('uses only the latest calibrations, oldest first', () => {
    const old = { touchedCm: 320, reachCm: 240, jumpCm: 50 }; // 30 cm off: a misread mark long ago
    const recent = Array.from({ length: MAX_CALIBRATIONS }, () => ({ touchedCm: 294, reachCm: 240, jumpCm: 50 }));
    expect(touchOffset([old, ...recent])).toBe(4);
  });

  it('is null without a calibration', () => {
    expect(touchOffset([])).toBeNull();
  });
});

describe('calibrationProblem', () => {
  it('accepts a reading within 25 cm of the video and rejects one that can’t be the same jump', () => {
    expect(calibrationProblem(296, 290)).toBeNull();
    expect(calibrationProblem(270, 290)).toBeNull();
    expect(calibrationProblem(320, 290)).toContain('差了 30 cm');
    expect(calibrationProblem(100, 290)).not.toBeNull();
  });
});

describe('touchError', () => {
  it('is the 95 % range of the mean of the best three: reading error and jump-to-jump spread together', () => {
    // Best three of six: 318, 317, 316 → SD 1. ±1.96 × √(1² + 1² ÷ 3) = ±2.26 → 2.3.
    expect(touchError([318, 316, 317, 312, 310, 315], WALL_READ_ERROR_CM)).toEqual({ n: 3, errorCm: 2.3 });
  });

  it('uses every jump when there are fewer than three, and only the reading error for one', () => {
    // 316 and 318: SD 1.41. ±1.96 × √(1 + 2 ÷ 2) = ±2.77 → 2.8.
    expect(touchError([316, 318], WALL_READ_ERROR_CM)).toEqual({ n: 2, errorCm: 2.8 });
    expect(touchError([318], WALL_READ_ERROR_CM)).toEqual({ n: 1, errorCm: 2 });
  });

  it('is unknown when the reading error is', () => {
    expect(touchError([318, 317, 316], null)).toEqual({ n: 3, errorCm: null });
  });
});

describe('videoReadError', () => {
  it('is the spread of the wall-minus-video gaps once there are two calibrations', () => {
    // Gaps 6, 5, 8.5: SD √((0.25 + 2.25 + 4) ÷ 2) = 1.80.
    const c = [
      { touchedCm: 296, reachCm: 240, jumpCm: 50 },
      { touchedCm: 297, reachCm: 240, jumpCm: 52 },
      { touchedCm: 300, reachCm: 240, jumpCm: 51.5 },
    ];
    expect(videoReadError(c)).toBe(1.8);
    expect(videoReadError(c.slice(0, 1))).toBeNull();
  });
});

describe('lineVerdict', () => {
  it('says over only when the whole range clears the line, and close while the line is inside it', () => {
    expect(lineVerdict(322.5, 2.3, 320)).toBe('over');
    expect(lineVerdict(321, 2.3, 320)).toBe('close');
    expect(lineVerdict(318.5, 2.3, 320)).toBe('close');
    expect(lineVerdict(317, 2.3, 320)).toBe('short');
  });

  it('reads the touch as it is when the error is unknown', () => {
    expect(lineVerdict(320, null, 320)).toBe('over');
    expect(lineVerdict(319.9, null, 320)).toBe('short');
  });
});

describe('sessionValue', () => {
  it('is the mean of the best three for the approach touch and the best attempt for the rest', () => {
    expect(sessionValue(getMetric('approach_touch')!, [312, 318, 310, 316, 317, 315])).toBe(317);
    expect(sessionValue(getMetric('approach_touch')!, [316, 318])).toBe(317);
    expect(sessionValue(getMetric('cmj')!, [44, 45])).toBe(45);
    expect(sessionValue(getMetric('cmj')!, [])).toBeNull();
  });
});
