#!/usr/bin/env node
/*
 * Accuracy regression check: runs a quick, seeded subset of each synthetic validation and fails when a figure is worse
 * than in baseline.json. CI runs it on every change to the measuring code (.github/workflows/accuracy.yml).
 *
 *   node tools/accuracy-regression/run.js detect            # one check: detect | analysis | pose | vbt
 *   node tools/accuracy-regression/run.js all               # all four (about 20 minutes on 4 cores)
 *   node tools/accuracy-regression/run.js pose --update     # write this run's figures into baseline.json
 *   node tools/accuracy-regression/run.js vbt --reuse --out <dir>   # score a run already in <dir> again
 *
 * A change that really makes a figure worse (a trade worth making) updates the baseline in the same PR with
 * --update, so the review shows the old and new figures side by side.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { compare, summaryMd } = require('./compare');

const REPO = path.resolve(__dirname, '../..');
const BASELINE = path.join(__dirname, 'baseline.json');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const OUT = path.resolve(opt('--out', fs.mkdtempSync(path.join(os.tmpdir(), 'accuracy-'))));

const abs = (x) => (x == null ? null : Math.abs(x));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** Figures of the jump analysis's agreement with the truth: |bias|, SD and max |difference| of one metric. */
function agreementFigures(report, metric, label, unit, tol) {
  const row = report.agreement.find((r) => r.metric === metric && r.against === '真值');
  return [
    { key: `${label}.bias`, name: `${label} bias, absolute${unit ? ` (${unit})` : ''}`, better: 'lower', tol, value: abs(row?.bias) },
    { key: `${label}.sd`, name: `${label} SD of differences${unit ? ` (${unit})` : ''}`, better: 'lower', tol, value: row?.sd ?? null },
    { key: `${label}.maxAbs`, name: `${label} largest difference${unit ? ` (${unit})` : ''}`, better: 'lower', tol: 2 * tol, value: row?.maxAbs ?? null },
  ];
}

const CHECKS = {
  // Automatic take-off / landing frames: 8 clips of every kind (CMJ, run-up, drop, single leg).
  detect: {
    command: (out) => ['node', [path.join(REPO, 'tools/jump-detect-validation/validate.js'), '--n', '8', '--seed', '1', '--out', out]],
    report: 'report.json',
    figures: ({ summary: s, results }) => [
      { key: 'found', name: 'clips detected', better: 'higher', tol: 0, value: s.found },
      { key: 'withinOneFrame', name: 'clips with every mark within ±1 frame', better: 'higher', tol: 0, value: s.withinOneFrame },
      { key: 'extraJumps', name: 'extra jumps found', better: 'lower', tol: 0, value: results.reduce((n, r) => n + r.extraJumps, 0) },
      { key: 'takeoff.maxAbs', name: 'take-off largest error (frames)', better: 'lower', tol: 0, value: s.takeoffFrames?.maxAbs ?? null },
      { key: 'landing.maxAbs', name: 'landing largest error (frames)', better: 'lower', tol: 0, value: s.landingFrames?.maxAbs ?? null },
      { key: 'takeoff.sd', name: 'take-off SD (frames)', better: 'lower', tol: 0.05, value: s.takeoffFrames?.sd ?? null },
      { key: 'landing.sd', name: 'landing SD (frames)', better: 'lower', tol: 0.05, value: s.landingFrames?.sd ?? null },
      { key: 'height.bias', name: 'jump height bias, absolute (cm)', better: 'lower', tol: 0.05, value: abs(s.heightCm?.mean) },
      { key: 'height.sd', name: 'jump height SD (cm)', better: 'lower', tol: 0.05, value: s.heightCm?.sd ?? null },
      { key: 'height.maxAbs', name: 'jump height largest error (cm)', better: 'lower', tol: 0.1, value: s.heightCm?.maxAbs ?? null },
    ],
  },
  // Jump analysis (JH, FT, GCT, RSI): 2 repeated-jump sets filmed twice, a drop jump, a CMJ with someone moving nearby.
  analysis: {
    command: (out) => ['node', [path.join(REPO, 'tools/jump-analysis-validation/validate.js'), '--sets', '2', '--seed', '1', '--out', out]],
    report: 'report.json',
    figures: (r) => [
      { key: 'found', name: `jumps found (of ${r.trueJumps})`, better: 'higher', tol: 0, value: r.found },
      { key: 'extra', name: 'extra jumps', better: 'lower', tol: 0, value: r.extra },
      { key: 'failedVideos', name: 'videos not analysed', better: 'lower', tol: 0, value: r.cases.flatMap((c) => c.videos).filter((v) => !v.ok).length },
      ...agreementFigures(r, '跳高 JH', 'JH', 'cm', 0.05),
      ...agreementFigures(r, '滞空 FT', 'FT', 'ms', 0.5),
      ...agreementFigures(r, '触地 GCT', 'GCT', 'ms', 0.5),
      ...agreementFigures(r, 'RSI', 'RSI', '', 0.005),
      { key: 'twinPairs', name: 'repeated jumps found again in the re-noised copy', better: 'higher', tol: 0, value: r.repeat.find((x) => x.metric === '跳高 JH')?.n ?? null },
      { key: 'JH.te', name: 'JH typical error, same set re-noised (cm)', better: 'lower', tol: 0.05, value: r.repeat.find((x) => x.metric === '跳高 JH')?.te ?? null },
    ],
  },
  // Take-off technique from the pose: 16 ways of filming × 40 clips (no video, so the full set is quick).
  pose: {
    command: (out) => ['node', [path.join(REPO, 'tools/pose-validation/validate.js'), '--seeds', '40', '--out', out]],
    report: 'report.json',
    figures: (r) => [
      { key: 'failed', name: 'clips not analysed', better: 'lower', tol: 0, value: r.ways.reduce((n, w) => n + w.failed, 0) },
      ...Object.entries({ vz: 0.002, vx: 0.002, angle: 0.05, approach: 0.002, brake: 0.002, plant: 0.2, gap: 0.2, step: 0.001, knee: 0.05 }).flatMap(([k, tol]) => [
        { key: `${k}.covered`, name: `${k}: stated error holds the truth (share)`, better: 'higher', tol: 0, value: r.overall[k]?.covered ?? null },
        { key: `${k}.rmse`, name: `${k}: RMSE`, better: 'lower', tol, value: r.overall[k]?.rmse ?? null },
      ]),
    ],
  },
  // Bar speed: the quick synthetic set (10 squat videos), the app's tracker and analyser as shipped.
  vbt: {
    command: (out) => ['python3', [path.join(REPO, 'tools/vbt-validation/evaluate.py'), '--quick', '--work', out]],
    report: 'results.json',
    figures: (r) => {
      const k = 'app+app';
      const o = r.summary.overall[k];
      const d = r.summary.detection[k];
      const mcv = o.mcv ?? {};
      return [
        { key: 'recall', name: 'reps found (recall)', better: 'higher', tol: 0, value: d.recall },
        { key: 'precision', name: 'reps found that are real (precision)', better: 'higher', tol: 0, value: d.precision },
        { key: 'failures', name: 'app tracker / pipeline failures', better: 'lower', tol: 0, value: r.failures.filter((f) => f.stage === 'app tracker' || f.stage === k).length },
        { key: 'mcv.bias', name: 'MCV bias, absolute (%)', better: 'lower', tol: 0.1, value: abs(mcv.bias_pct) },
        { key: 'mcv.loa', name: 'MCV 95 % LoA width (%)', better: 'lower', tol: 0.2, value: mcv.loa_pct_high == null ? null : mcv.loa_pct_high - mcv.loa_pct_low },
        { key: 'mcv.mae', name: 'MCV MAE (m/s)', better: 'lower', tol: 0.002, value: mcv.mae ?? null },
        { key: 'mpv.mae', name: 'MPV MAE (m/s)', better: 'lower', tol: 0.002, value: o.mpv?.mae ?? null },
        { key: 'pv.mae', name: 'peak velocity MAE (m/s)', better: 'lower', tol: 0.003, value: o.pv?.mae ?? null },
        { key: 'rom.mae', name: 'ROM MAE (m)', better: 'lower', tol: 0.002, value: o.rom?.mae ?? null },
        { key: 'retest.sem', name: 'MCV test–retest SEM (m/s)', better: 'lower', tol: 0.002, value: r.summary.retest[k]?.overall?.sem ?? null },
      ];
    },
  },
};

function runCheck(name) {
  const check = CHECKS[name];
  const out = path.join(OUT, name);
  if (!flag('--reuse')) {
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    const [cmd, argv] = check.command(out);
    console.log(`\n▶ ${name}: ${cmd} ${argv.map((a) => path.relative(REPO, a) || a).join(' ')}`);
    const r = spawnSync(cmd, argv, { cwd: REPO, stdio: 'inherit' });
    if (r.status !== 0) return { name, crashed: true };
  }
  const figures = check.figures(readJson(path.join(out, check.report)));
  return { name, figures, current: Object.fromEntries(figures.map((f) => [f.key, f.value == null ? null : +f.value.toFixed(6)])) };
}

function main() {
  const which = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--out'));
  const names = which.includes('all') ? Object.keys(CHECKS) : which;
  const unknown = names.filter((n) => !CHECKS[n]);
  if (!names.length || unknown.length) {
    console.error(`usage: run.js <${Object.keys(CHECKS).join(' | ')} | all> [--update] [--reuse] [--out dir]`);
    process.exit(2);
  }
  const baseline = fs.existsSync(BASELINE) ? readJson(BASELINE) : {};
  let ok = true;
  const md = [];
  for (const name of names) {
    const run = runCheck(name);
    if (run.crashed) {
      md.push(`### ${name} ❌ the validation itself failed (see the log)`, '');
      ok = false;
      continue;
    }
    if (flag('--update')) {
      baseline[name] = run.current;
      md.push(`### ${name}: baseline updated`, '');
      continue;
    }
    const result = compare(run.figures, baseline[name] ?? {}, run.current);
    md.push(summaryMd(name, result));
    ok &&= result.ok;
  }
  if (flag('--update')) fs.writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
  const text = md.join('\n');
  console.log(`\n${text}\nreports: ${OUT}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  if (!ok) {
    console.error('\nAccuracy is worse than the baseline. If the trade is intended, run with --update and commit baseline.json.');
    process.exit(1);
  }
}

main();
