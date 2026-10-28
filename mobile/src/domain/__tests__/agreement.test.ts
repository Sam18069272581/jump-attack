import { blandAltman, icc, mdc95, pooledWithinSd, realChange, typicalError } from '../agreement';

describe('blandAltman', () => {
  it('gives the mean difference and the 95 % limits of agreement, bias ± 1.96 SD (Bland & Altman 1986, Lancet i:307)', () => {
    // Differences 1, 0, −1: bias 0, SD 1.
    const r = blandAltman([10, 12, 14], [9, 12, 15]);
    expect(r).toMatchObject({ n: 3, bias: 0, sd: 1 });
    expect(r.lower).toBeCloseTo(-1.96, 9);
    expect(r.upper).toBeCloseTo(1.96, 9);
  });

  it('needs pairs', () => {
    expect(() => blandAltman([1], [1, 2])).toThrow();
  });
});

describe('icc', () => {
  // Shrout & Fleiss 1979 (Psychol Bull 86:420), Table 2: six targets rated by four judges. Their Table 4 gives
  // ICC(2,1) = 0.29 (absolute agreement) and ICC(3,1) = 0.71 (consistency).
  const table = [
    [9, 2, 5, 8],
    [6, 1, 3, 2],
    [8, 4, 6, 8],
    [7, 1, 2, 6],
    [10, 5, 6, 9],
    [6, 2, 4, 7],
  ];

  it('reproduces Shrout & Fleiss ICC(2,1) = 0.29', () => {
    expect(icc(table, 'agreement')).toBeCloseTo(0.29, 2);
  });

  it('reproduces Shrout & Fleiss ICC(3,1) = 0.71', () => {
    expect(icc(table, 'consistency')).toBeCloseTo(0.71, 2);
  });
});

describe('typicalError and mdc95', () => {
  it('takes the typical error as the SD of the trial-to-trial differences over √2 (Hopkins 2000, Sports Med 30:1)', () => {
    // Differences 2, 0, −2: SD 2, TE = 2 / √2 = 1.414.
    expect(typicalError([40, 41, 42], [38, 41, 44])).toBeCloseTo(Math.SQRT2, 9);
  });

  it('takes the smallest change a retest can show beyond noise as 1.96 · √2 · TE (Weir 2005, JSCR 19:231)', () => {
    expect(mdc95(1)).toBeCloseTo(2.772, 3);
  });

  it('pools the within-session SD over sessions by their degrees of freedom', () => {
    // Sessions [40, 42] (SD² 2, 1 df) and [50, 51, 52] (SD² 1, 2 df): (2 + 2) / 3 = 1.333, √ = 1.155.
    expect(pooledWithinSd([[40, 42], [50, 51, 52], [45]])).toBeCloseTo(Math.sqrt(4 / 3), 9);
    expect(pooledWithinSd([[45], [46]])).toBeNull();
  });
});

describe('realChange', () => {
  // Earlier sessions 40, 41, 39, 40 cm: mean 40, SD 0.816, SWC = 0.2 × 0.816 = 0.16 cm. With a typical error of
  // 1 cm the noise of one retest is 2.77 cm (MDC95), which is the bar a change has to clear.
  const history = [40, 41, 39, 40];

  it('calls a change real only when it clears both the smallest worthwhile change and the noise of the test', () => {
    expect(realChange(history, 43, 1)).toMatchObject({ verdict: 'better', delta: 3 });
    expect(realChange(history, 42, 1)).toMatchObject({ verdict: 'noise', delta: 2 });
    expect(realChange(history, 37, 1).verdict).toBe('worse');
  });

  it('reports the bar it used', () => {
    const r = realChange(history, 43, 1);
    expect(r.swc).toBeCloseTo(0.163, 3);
    expect(r.mdc).toBeCloseTo(2.772, 3);
    expect(r.bar).toBeCloseTo(2.772, 3);
  });

  it('reads lower as better when asked', () => {
    expect(realChange([0.25, 0.24, 0.26], 0.2, 0.005, true).verdict).toBe('better');
  });

  it('needs three earlier sessions', () => {
    expect(realChange([40, 41], 45, 1).verdict).toBe('unknown');
  });

  it('falls back to the smallest worthwhile change while the test noise is not known yet', () => {
    expect(realChange(history, 41, null)).toMatchObject({ verdict: 'better', mdc: null });
  });
});
