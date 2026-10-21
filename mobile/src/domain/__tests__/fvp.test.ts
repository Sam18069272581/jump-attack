import {
  bandOf,
  fvProfile,
  heightPerLoad,
  jumpForceVelocity,
  maxJumpHeight,
  optimalSlope,
  profileFromPower,
  pushOff,
  suggestedLoads,
  suggestion,
} from '../fvp';
import { G } from '../jump';

/** Height (cm) a jumper with this profile reaches with `loadKg` on the bar: the inverse of Samozino's equations. */
function jumpHeight(massKg: number, loadKg: number, f0: number, v0: number, hpo: number): number {
  const gap = (h: number) => ((massKg + loadKg) * G * (h / hpo + 1)) / massKg - f0 * (1 - Math.sqrt((G * h) / 2) / v0);
  let lo = 0;
  let hi = 1.5;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (gap(lo) * gap(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return ((lo + hi) / 2) * 100;
}

// 75 kg, 40 cm push-off, F0 32 N/kg, v0 3.2 m/s: a typical strength-deficit profile.
const MASS = 75;
const HPO = 0.4;
const jumps = [0, 20, 40, 60].map((loadKg) => ({ loadKg, heightCm: jumpHeight(MASS, loadKg, 32, 3.2, HPO) }));

describe('push-off distance', () => {
  it('is leg length minus the start height, in metres', () => {
    expect(pushOff(100, 60)).toBeCloseTo(0.4);
  });

  it('rejects measurements that cannot be a leg', () => {
    expect(pushOff(60, 100)).toBeNull();
    expect(pushOff(100, 95)).toBeNull();
  });
});

describe('jump force and velocity', () => {
  it('follows the simple method', () => {
    // 75 kg + 20 kg, 30 cm jump, 40 cm push-off.
    const { f, v } = jumpForceVelocity(75, 20, 0.3, 0.4);
    expect(f).toBeCloseTo(((95 * G) / 75) * 1.75);
    expect(v).toBeCloseTo(Math.sqrt((G * 0.3) / 2));
  });
});

describe('force-velocity profile', () => {
  it('recovers the profile the jumps came from', () => {
    expect(jumps.map((j) => Math.round(j.heightCm * 10) / 10)).toEqual([36.2, 26.4, 19.3, 13.8]);
    const p = fvProfile(MASS, HPO, jumps)!;
    expect(p.f0).toBeCloseTo(32, 1);
    expect(p.v0).toBeCloseTo(3.2, 2);
    expect(p.pmax).toBeCloseTo(25.6, 1);
    expect(p.sfv).toBeCloseTo(-10, 1);
    expect(p.r2).toBeCloseTo(1, 4);
  });

  it('compares the slope with the one that jumps highest for the same power', () => {
    const p = fvProfile(MASS, HPO, jumps)!;
    expect(p.sfvOpt).toBeCloseTo(-14.0, 1);
    expect(p.fvPct).toBeCloseTo(71, 0);
    // Balancing the profile at the same power gains under a centimetre here.
    expect(p.optimalHeightCm).toBeCloseTo(37.2, 1);
    expect(bandOf(p.fvPct).key).toBe('force-low');
  });

  it('finds the slope at the top of the height curve', () => {
    const s = optimalSlope(25.6, HPO);
    const h = (slope: number) => {
      const { f0, v0 } = profileFromPower(25.6, slope);
      return maxJumpHeight(f0, v0, HPO);
    };
    expect(h(s)).toBeGreaterThan(h(s * 0.9));
    expect(h(s)).toBeGreaterThan(h(s * 1.1));
  });

  it('predicts the measured unloaded jump from the fitted line', () => {
    expect(maxJumpHeight(32, 3.2, HPO) * 100).toBeCloseTo(jumps[0].heightCm, 1);
  });

  it('uses the mean of the best two jumps at each load', () => {
    expect(heightPerLoad([
      { loadKg: 20, heightCm: 25 },
      { loadKg: 0, heightCm: 34 },
      { loadKg: 0, heightCm: 36 },
      { loadKg: 0, heightCm: 30 },
    ])).toEqual([
      { loadKg: 0, heightCm: 35 },
      { loadKg: 20, heightCm: 25 },
    ]);
  });

  it('needs two loads and force falling as velocity rises', () => {
    expect(fvProfile(MASS, HPO, [jumps[0], { ...jumps[0], heightCm: 30 }])).toBeNull();
    expect(fvProfile(MASS, HPO, [{ loadKg: 0, heightCm: 20 }, { loadKg: 40, heightCm: 30 }])).toBeNull();
  });
});

describe('training emphasis', () => {
  it('splits FV% into five bands', () => {
    expect([50, 60, 89.9, 90, 109.9, 110, 140, 200].map((x) => bandOf(x).key)).toEqual([
      'force-high',
      'force-low',
      'force-low',
      'balanced',
      'balanced',
      'velocity-low',
      'velocity-high',
      'velocity-high',
    ]);
    for (const b of ['force-high', 'force-low', 'balanced', 'velocity-low', 'velocity-high'])
      expect(bandOf({ 'force-high': 50, 'force-low': 70, balanced: 100, 'velocity-low': 120, 'velocity-high': 150 }[b]!).mix.reduce((s, m) => s + m.n, 0)).toBe(6);
  });

  it('trusts one test only when it is clearly off balance', () => {
    expect(suggestion([])).toBeNull();
    expect(suggestion([85])).toMatchObject({ band: { key: 'force-low' }, confirmed: false });
    expect(suggestion([75])).toMatchObject({ band: { key: 'force-low' }, confirmed: true });
    expect(suggestion([125])).toMatchObject({ band: { key: 'velocity-low' }, confirmed: true });
  });

  it('confirms a side when the last two tests agree', () => {
    expect(suggestion([70, 85])).toMatchObject({ band: { key: 'force-low' }, confirmed: true });
    expect(suggestion([115, 85])).toMatchObject({ band: { key: 'force-low' }, confirmed: false });
    expect(suggestion([95, 105])).toMatchObject({ band: { key: 'balanced' }, confirmed: true });
  });

  it('suggests test loads of about 0, 25, 50 and 75 % of body mass', () => {
    expect(suggestedLoads(75)).toEqual([0, 20, 37.5, 57.5]);
  });
});
