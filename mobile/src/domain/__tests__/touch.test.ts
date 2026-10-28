import { calibrationProblem, MAX_CALIBRATIONS, touchOffset } from '../touch';

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
