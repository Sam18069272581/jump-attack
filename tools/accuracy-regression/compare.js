/*
 * Compares one validation run with its baseline. Every figure says which way is better and how far it may move the
 * wrong way before it counts: the runs are seeded, so on the same machine the figures repeat exactly, and the
 * tolerance only absorbs a different ffmpeg or Chromium build.
 */

/** @typedef {{ key: string, name: string, better: 'higher' | 'lower', tol: number }} Spec */

const EPS = 1e-9;

/**
 * @param {Spec[]} specs
 * @param {Record<string, number | null>} baseline
 * @param {Record<string, number | null>} current
 */
function compare(specs, baseline, current) {
  const rows = specs.map((s) => {
    const base = baseline[s.key] ?? null;
    const now = current[s.key] ?? null;
    if (base == null) return { ...s, base, now, status: now == null ? 'same' : 'new' };
    if (now == null) return { ...s, base, now, status: 'missing' };
    // Positive when the run is better than the baseline.
    const gain = s.better === 'higher' ? now - base : base - now;
    const status = gain < -s.tol - EPS ? 'worse' : gain > EPS ? 'better' : 'same';
    return { ...s, base, now, status };
  });
  return { ok: rows.every((r) => r.status !== 'worse' && r.status !== 'missing'), rows };
}

const ICON = { same: '✅', better: '⬆️', new: '🆕', worse: '❌', missing: '❌' };
const num = (x) => (x == null ? '—' : String(+x.toFixed(4)));

/** A Markdown table of the comparison, for the log and the GitHub job summary. */
function summaryMd(tool, result) {
  return [
    `### ${tool} ${result.ok ? '✅' : '❌ worse than the baseline'}`,
    '',
    '| figure | better | baseline | this run | tolerance | |',
    '|---|---|---|---|---|---|',
    ...result.rows.map((r) => `| ${r.name} | ${r.better} | ${num(r.base)} | ${num(r.now)} | ${num(r.tol)} | ${ICON[r.status]} |`),
    '',
  ].join('\n');
}

module.exports = { compare, summaryMd };
