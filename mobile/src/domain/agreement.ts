/**
 * How far to trust a measurement: agreement with a reference method, reliability, and whether a change is bigger than
 * the test's own noise. Used by the app (is today's jump a real change?) and by the validation tools (does the
 * automatic analysis agree with hand marks, My Jump, a contact mat or another app?).
 */
import { mean, sd, smallestWorthwhileChange } from './assess';

/** Bland–Altman agreement of `a` with `b`: differences are a − b. */
export function blandAltman(a: number[], b: number[]): { n: number; bias: number; sd: number; lower: number; upper: number } {
  if (a.length !== b.length || a.length < 2) throw new Error('blandAltman needs two lists of the same length, at least 2');
  const d = a.map((x, i) => x - b[i]);
  const bias = mean(d);
  const s = sd(d);
  return { n: d.length, bias, sd: s, lower: bias - 1.96 * s, upper: bias + 1.96 * s };
}

/**
 * Intraclass correlation from a two-way table, one row per subject and one column per method or trial (Shrout &
 * Fleiss 1979). `agreement` is ICC(2,1), which counts a fixed offset between methods against them; `consistency` is
 * ICC(3,1), which doesn't.
 */
export function icc(rows: number[][], type: 'agreement' | 'consistency'): number {
  const n = rows.length;
  const k = rows[0]?.length ?? 0;
  if (n < 2 || k < 2 || rows.some((r) => r.length !== k)) throw new Error('icc needs at least 2 subjects × 2 columns');
  const grand = mean(rows.flat());
  const rowMeans = rows.map(mean);
  const colMeans = Array.from({ length: k }, (_, j) => mean(rows.map((r) => r[j])));
  const ssRows = k * rowMeans.reduce((s, m) => s + (m - grand) ** 2, 0);
  const ssCols = n * colMeans.reduce((s, m) => s + (m - grand) ** 2, 0);
  const ssTotal = rows.flat().reduce((s, x) => s + (x - grand) ** 2, 0);
  const bms = ssRows / (n - 1);
  const jms = ssCols / (k - 1);
  const ems = (ssTotal - ssRows - ssCols) / ((n - 1) * (k - 1));
  if (type === 'consistency') return (bms - ems) / (bms + (k - 1) * ems);
  return (bms - ems) / (bms + (k - 1) * ems + (k * (jms - ems)) / n);
}

/** Typical error of a test from two trials of the same subjects: SD of the differences over √2 (Hopkins 2000). */
export function typicalError(first: number[], second: number[]): number {
  return blandAltman(first, second).sd / Math.SQRT2;
}

/** Smallest change one retest can show with 95 % confidence that it is not noise: 1.96 · √2 · TE (Weir 2005). */
export function mdc95(te: number): number {
  return 1.96 * Math.SQRT2 * te;
}

/**
 * The typical error from the athlete's own sessions: the SD of attempts within a session, pooled over sessions by
 * their degrees of freedom. Null until some session has two attempts.
 */
export function pooledWithinSd(sessions: number[][]): number | null {
  let ss = 0;
  let df = 0;
  for (const s of sessions) {
    if (s.length < 2) continue;
    ss += sd(s) ** 2 * (s.length - 1);
    df += s.length - 1;
  }
  return df ? Math.sqrt(ss / df) : null;
}

export type RealChange = {
  verdict: 'better' | 'worse' | 'noise' | 'unknown';
  delta: number;
  swc: number;
  mdc: number | null;
  /** The change it took: the larger of SWC and MDC. */
  bar: number;
};

/**
 * Whether `latest` really differs from the athlete's baseline (the mean of earlier sessions). A change has to be
 * worth something (over the smallest worthwhile change, 0.2 × the between-session SD) and has to be more than the test
 * can produce by itself (over MDC95, from the typical error `te`). Without a typical error yet, SWC alone decides.
 */
export function realChange(history: number[], latest: number, te: number | null, lowerIsBetter = false): RealChange {
  const delta = history.length ? latest - mean(history) : 0;
  if (history.length < 3) return { verdict: 'unknown', delta, swc: 0, mdc: te == null ? null : mdc95(te), bar: 0 };
  const swc = smallestWorthwhileChange(history);
  const mdc = te == null ? null : mdc95(te);
  const bar = Math.max(swc, mdc ?? 0);
  if (Math.abs(delta) <= bar) return { verdict: 'noise', delta, swc, mdc, bar };
  return { verdict: (lowerIsBetter ? delta < 0 : delta > 0) ? 'better' : 'worse', delta, swc, mdc, bar };
}
