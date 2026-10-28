import { analyseJumps, FLAG_TEXT, flightCurve, frameError, SLOW_CONTACT_S, type JumpEvents } from '../jumpAnalysis';

const g = 9.81;

describe('analyseJumps: one jump', () => {
  // 240 fps, take-off frame 100, landing frame 232: FT = 132 / 240 = 0.55 s, JH = g·FT²/8 = 9.81 × 0.3025 / 8 = 0.3709 m
  // (Bosco, Luhtanen & Komi 1983, Eur J Appl Physiol 50:273).
  const r = analyseJumps([{ takeoff: 100, landing: 232 }], { kind: 'jump', captureFps: 240 });

  it('takes flight time and jump height from the frames', () => {
    expect(r.jumps[0].ftS).toBeCloseTo(0.55, 6);
    expect(r.jumps[0].jhCm).toBeCloseTo(37.09, 2);
  });

  it('has no contact time, so no RSI, RSR or DRI', () => {
    expect(r.jumps[0].gctS).toBeUndefined();
    expect(r.jumps[0].rsi).toBeUndefined();
    expect(r.jumps[0].dri).toBeUndefined();
    expect(r.summary.gctCv).toBeUndefined();
  });

  it('gives the error ±1 frame on each of the two marks makes, the marks independent: √2 · g·FT/4 · 1/fps', () => {
    // One frame on one mark: 9.81 × 0.55 / 4 / 240 = 0.00562 m. Two marks in quadrature: × √2 = 0.00795 m.
    expect(r.jumps[0].error.jhCm).toBeCloseTo(0.795, 3);
    expect(r.jumps[0].error.ftS).toBeCloseTo(Math.SQRT2 / 240, 9);
  });

  it('summarises the counted jumps', () => {
    expect(r.summary).toMatchObject({ counted: 1, total: 1 });
    expect(r.summary.jhCm?.best).toBeCloseTo(37.09, 2);
  });
});

describe('analyseJumps: a drop jump', () => {
  // Touch-down 100, take-off 150, landing 254 at 240 fps, from a 30 cm box:
  // GCT = 50/240 = 0.2083 s, FT = 104/240 = 0.4333 s, JH = 9.81 × 0.4333² / 8 = 0.2303 m,
  // RSI = JH / GCT = 1.105 (Flanagan & Comyns 2008, Strength Cond J 30:32), RSR = FT / GCT = 2.08,
  // DRI = (drop + JH) / (g · GCT²) = (0.30 + 0.2303) / (9.81 × 0.04340) = 1.245 (Brooks 2026, Eur J Sport Sci 5(1)).
  const r = analyseJumps([{ touchdown: 100, takeoff: 150, landing: 254 }], { kind: 'drop', captureFps: 240, boxCm: 30 });
  const j = r.jumps[0];

  it('takes contact, RSI, RSR and DRI from the three frames and the box', () => {
    expect(j.gctS).toBeCloseTo(0.20833, 5);
    expect(j.jhCm).toBeCloseTo(23.03, 2);
    expect(j.rsi).toBeCloseTo(1.105, 3);
    expect(j.rsr).toBeCloseTo(2.08, 3);
    expect(j.dri).toBeCloseTo(1.245, 3);
  });

  it('propagates ±1 frame on each of the three marks into RSI; take-off moves JH and GCT the same way', () => {
    // Per frame (1/240 s): dJH = g·FT/4 · dt = 0.004428 m, RSI/GCT · dt = 5.305 / 240 = 0.02211.
    // Landing: +dJH/GCT = 0.02125. Touch-down: +0.02211. Take-off: −0.02125 − 0.02211 = −0.04336 (both shrink RSI).
    // In quadrature: √(0.02125² + 0.02211² + 0.04336²) = 0.0531.
    expect(j.error.rsi).toBeCloseTo(0.0531, 3);
    expect(j.error.gctS).toBeCloseTo(Math.SQRT2 / 240, 9);
  });

  it('is what moving the marks one frame each actually does to RSI, to within its own size', () => {
    const at = (m: JumpEvents) => analyseJumps([m], { kind: 'drop', captureFps: 240, boxCm: 30 }).jumps[0].rsi!;
    const worst = at({ touchdown: 101, takeoff: 149, landing: 255 }) - j.rsi!;
    // All three marks off by one frame in the worst direction: about √3 × the stated error, never far beyond it.
    expect(worst).toBeGreaterThan(j.error.rsi!);
    expect(worst).toBeLessThan(2 * j.error.rsi!);
  });

  it('has no DRI without a box height', () => {
    expect(analyseJumps([{ touchdown: 100, takeoff: 150, landing: 254 }], { kind: 'drop', captureFps: 240 }).jumps[0].dri).toBeUndefined();
  });
});

describe('analyseJumps: repeated jumps', () => {
  // Three rebounds at 240 fps. Contacts: 248 − 200 = 48 frames (0.200 s) and 410 − 350 = 60 frames (0.250 s).
  const events: JumpEvents[] = [
    { takeoff: 100, landing: 200 },
    { takeoff: 248, landing: 350 },
    { takeoff: 410, landing: 510 },
  ];
  const r = analyseJumps(events, { kind: 'repeat', captureFps: 240 });

  it('takes each contact from the landing before it; the first jump has none', () => {
    expect(r.jumps.map((j) => j.gctS)).toEqual([undefined, 0.2, 0.25]);
  });

  it('drops into each rebound from the height of the jump before it', () => {
    const jh1 = (g * (100 / 240) ** 2) / 8;
    const jh2 = (g * (102 / 240) ** 2) / 8;
    expect(r.jumps[1].dri).toBeCloseTo((jh1 + jh2) / (g * 0.2 ** 2), 9);
  });

  it('gives GCT-CV as sample SD over mean: contacts 0.200 and 0.250 s → 0.0354 / 0.225 = 15.7 %', () => {
    expect(r.summary.gctCv).toBeCloseTo(15.71, 2);
  });

  it('gives DRI-CV the same way', () => {
    const d = [r.jumps[1].dri!, r.jumps[2].dri!];
    const m = (d[0] + d[1]) / 2;
    expect(r.summary.driCv).toBeCloseTo((Math.abs(d[0] - d[1]) / Math.SQRT2 / m) * 100, 9);
  });

  it('scores a 10/5 test as the mean RSI of the best five rebounds (Harper, Hobbs & Moore 2011)', () => {
    const ten: JumpEvents[] = [];
    let t = 100;
    for (let k = 0; k < 10; k++) {
      ten.push({ takeoff: t, landing: t + 100 });
      t += 100 + 40 + k; // contacts 40, 41, …, 49 frames: the earlier the rebound, the shorter its contact
    }
    const s = analyseJumps(ten, { kind: 'repeat', captureFps: 240 });
    const rsis = s.jumps.slice(1).map((j) => j.rsi!);
    const best5 = [...rsis].sort((a, b) => b - a).slice(0, 5);
    expect(s.summary.rsi105).toBeCloseTo(best5.reduce((a, b) => a + b) / 5, 9);
    expect(s.jumps[1].rsi).toBeCloseTo(Math.max(...rsis), 9);
  });

  it('scores no 10/5 from fewer than five counted rebounds: the best of fewer is not the same test', () => {
    expect(r.summary.rsi).toBeDefined();
    expect(r.summary.rsi105).toBeUndefined();
  });

  it('flags a rebound slower than 250 ms as not a fast stretch-shortening cycle, but still counts it', () => {
    expect(SLOW_CONTACT_S).toBe(0.25);
    const slow = analyseJumps(
      [
        { takeoff: 100, landing: 200 },
        { takeoff: 261, landing: 361 },
      ],
      { kind: 'repeat', captureFps: 240 },
    );
    expect(slow.jumps[1].flags).toContain('slow-contact');
    expect(slow.jumps[1].counted).toBe(true);
  });

  it('treats a pause longer than 1 s between jumps as separate jumps, not a rebound', () => {
    const apart = analyseJumps(
      [
        { takeoff: 100, landing: 200 },
        { takeoff: 500, landing: 600 },
      ],
      { kind: 'jump', captureFps: 240 },
    );
    expect(apart.jumps[1].gctS).toBeUndefined();
  });

  it('gives a CMJ clip no contact, even when the next jump follows within a second: only rebounds have one', () => {
    const twoCmj = analyseJumps(
      [
        { takeoff: 100, landing: 200 },
        { takeoff: 400, landing: 500 },
      ],
      { kind: 'jump', captureFps: 240 },
    );
    expect(twoCmj.jumps[1].gctS).toBeUndefined();
    expect(twoCmj.jumps[1].flags).not.toContain('slow-contact');
  });
});

describe('analyseJumps: what is left out', () => {
  it('leaves a jump far from the others out of the summary (over 25 % from the median of three or more)', () => {
    // Flights 130, 132, 128 and 190 frames. Jump height goes with the square of flight time, so the last jump is
    // (190 / 131)² = 2.1 times the median height: a wrong landing frame or a tucked landing, either way not a fair one.
    const r = analyseJumps(
      [130, 132, 128, 190].map((ft, i) => ({ takeoff: 1000 * i, landing: 1000 * i + ft })),
      { kind: 'jump', captureFps: 240 },
    );
    expect(r.jumps[3].flags).toContain('outlier');
    expect(r.jumps[3].counted).toBe(false);
    expect(r.summary).toMatchObject({ counted: 3, total: 4 });
    expect(r.summary.jhCm!.best).toBeCloseTo(r.jumps[1].jhCm, 9);
  });

  it('leaves out a jump the detector saw near the edge of the picture', () => {
    const r = analyseJumps([{ takeoff: 100, landing: 232, flags: ['edge'] }], { kind: 'jump', captureFps: 240 });
    expect(r.jumps[0].counted).toBe(false);
    expect(r.summary.jhCm).toBeUndefined();
  });

  it('counts a jump the athlete chose to keep, whatever its flags', () => {
    const r = analyseJumps([{ takeoff: 100, landing: 232, flags: ['edge'] }], { kind: 'jump', captureFps: 240, keep: [0] });
    expect(r.jumps[0].counted).toBe(true);
  });

  it('flags every jump when one frame moves the jump height more than 1 cm (below about 120 fps)', () => {
    // At 60 fps a 0.55 s flight: 9.81 × 0.55 / 4 / 60 = 2.2 cm a frame.
    const r = analyseJumps([{ takeoff: 25, landing: 58 }], { kind: 'jump', captureFps: 60 });
    expect(r.jumps[0].flags).toContain('low-fps');
    expect(r.jumps[0].counted).toBe(true);
  });

  it('says what each flag means and what to do next time', () => {
    for (const t of Object.values(FLAG_TEXT)) {
      expect(t.what.length).toBeGreaterThan(0);
      expect(t.advice.length).toBeGreaterThan(0);
    }
  });
});

describe('frameError', () => {
  it('is the jump height one frame of flight is worth', () => {
    expect(frameError(0.55, 240)).toBeCloseTo(0.562, 3);
    expect(frameError(0.55, 60)).toBeCloseTo(2.248, 3);
  });
});

describe('flightCurve', () => {
  // A 0.55 s flight at 240 fps from frame 100 to 232: the centre of mass rises and falls on g·τ·(FT − τ)/2, which
  // peaks at the jump height, 37.09 cm, half-way (frame 166).
  const curve = flightCurve([{ takeoff: 100, landing: 232 }], 240, 90, 240);

  it('has one height for every frame of the part asked for', () => {
    expect(curve).toHaveLength(151);
  });

  it('is zero on the ground and peaks at the jump height half-way through the flight', () => {
    expect(curve[0]).toBe(0);
    expect(curve[100 - 90]).toBe(0);
    expect(curve[166 - 90]).toBeCloseTo(37.09, 2);
    expect(curve[232 - 90]).toBe(0);
    expect(Math.max(...curve)).toBeCloseTo(37.09, 2);
  });
});
