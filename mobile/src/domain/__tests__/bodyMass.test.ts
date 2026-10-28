import { massGainCm, massGainText, massNear, MASS_NEAR_DAYS } from '../bodyMass';
import { maxJumpHeight } from '../fvp';

describe('massGainCm', () => {
  // F0 30 N/kg and v0 3 m/s at 80 kg over a 40 cm push-off: a 31.6 cm squat jump.
  const profile = { f0: 30, v0: 3, massKg: 80, hpoM: 0.4 };

  it('re-runs the athlete’s own force-velocity line at the lighter mass, with the same absolute force and v0', () => {
    expect(maxJumpHeight(30, 3, 0.4) * 100).toBeCloseTo(31.578, 3);
    // 2400 N over 79 kg is 30.38 N/kg: 32.08 cm, half a centimetre higher.
    expect(massGainCm(profile, 1)).toBeCloseTo(32.078 - 31.578, 3);
    expect(massGainCm(profile, 3)).toBeCloseTo(33.106 - 31.578, 3);
  });

  it('only estimates losing 1–3 kg', () => {
    expect(massGainCm(profile, 0.5)).toBeNull();
    expect(massGainCm(profile, 5)).toBeNull();
  });
});

describe('massGainText', () => {
  it('says it is an estimate and what it assumes', () => {
    expect(massGainText(0.5, 1.53)).toBe('体重 −1 kg ≈ 摸高 +0.5 cm，−3 kg ≈ +1.5 cm（按你的力-速度曲线估算，假设减的是脂肪、力量和速度不变）');
  });
});

describe('massNear', () => {
  const history = [
    { date: '2026-10-01', kg: 82 },
    { date: '2026-10-20', kg: 80 },
    { date: '2026-10-26', kg: 79.5 },
  ];

  it('takes the weigh-in closest to the day, within a week either side', () => {
    expect(MASS_NEAR_DAYS).toBe(7);
    expect(massNear(history, '2026-10-24')).toBe(79.5);
    expect(massNear(history, '2026-10-22')).toBe(80);
    expect(massNear(history, '2026-10-05')).toBe(82);
    expect(massNear(history, '2026-10-12')).toBeNull();
    expect(massNear([], '2026-10-12')).toBeNull();
  });
});
