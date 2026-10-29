#!/usr/bin/env node
/*
 * How far to trust the take-off technique figures (mobile/src/app/technique/analyse.tsx) before any real footage: each
 * figure's stated 95 % error must hold the truth in at least 95 % of clips, filmed nineteen ways. Everything runs the
 * app's own code: domain/testing/poseScene.ts builds a run-up jump with known take-off velocity, contacts, step and
 * knee angle and gives its landmarks the pose model's jitter, swaps and misses; domain/techniqueRead.ts reads it the way
 * the screen does (a coarse pass around a tap near the take-off, the jump's window, every frame in it), with the floor
 * lines tapped as a finger does (off by `TAP_PX` either way); and domain/technique.ts measures it.
 *
 *   node tools/pose-validation/validate.js [--seeds 40] [--ways guide,two] [--out <dir>]
 *
 * What this can't tell: how the real pose model's errors compare with the scene's (the plan's gate G2 checks that on
 * real clips against hand marks and a wall reading). Writes report.json and report.md to --out (default: a temp folder).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { compile } = require('../jump-analysis-validation/lib');

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const SEEDS = Number(opt('--seeds', 40));
const ONLY = opt('--ways', null)?.split(',');
const OUT = path.resolve(opt('--out', fs.mkdtempSync(path.join(os.tmpdir(), 'pose-validation-'))));

/** Ways of filming: the guide's, then each thing a real take gets wrong on its own. */
const ALL_WAYS = [
  { key: 'guide', name: '按指南拍（240 帧、侧面 7 米、起跳脚朝手机、贴两条线）', over: {} },
  { key: 'noise', name: '骨架抖动大一倍', over: { noisePx: 3 } },
  { key: 'far-foot', name: '起跳脚在远离手机那一侧', over: { foot: 'left' } },
  { key: 'fps120', name: '120 帧慢动作', over: { fps: 120 } },
  { key: 'fps60', name: '60 帧（App 里直接拍）', over: { fps: 60 } },
  { key: 'two', name: '双脚起跳', over: { style: 'two' } },
  { key: 'no-markers', name: '没贴线', over: { markers: null } },
  { key: 'rotate90', name: '手机竖着拿、画面横着', over: { rotate90: true } },
  { key: 'roll', name: '手机歪了 3°', over: { rollDeg: 3 } },
  { key: 'curve', name: '助跑斜着朝手机来（15°）', over: { curveDeg: 15 } },
  { key: 'hang', name: '手碰到篮筐、挂了一下', over: { hangAfterS: 0.34 } },
  { key: 'curve-bare', name: '助跑斜着来（15°），没贴线', over: { curveDeg: 15, markers: null } },
  { key: 'hang-bare', name: '挂了一下，没贴线', over: { hangAfterS: 0.34, markers: null } },
  { key: 'curve-roll-bare', name: '没贴线、斜跑 15° 且手机反向歪 1.5°', over: { curveDeg: 15, rollDeg: -1.5, markers: null } },
  { key: 'hang-roll-bare', name: '挂了一下，没贴线，手机反向歪 3°', over: { hangAfterS: 0.34, rollDeg: -3, markers: null } },
  { key: 'slight-bare', name: '没贴线、助跑偏了 4°（不到算斜跑的程度）', over: { curveDeg: 4, markers: null } },
  { key: 'bystander', name: '旁边站着一个人', over: { bystanderM: 2 } },
  { key: 'dropout', name: '5% 的帧没认出人，起跳前左右腿认反几帧', over: { dropout: 0.05, swaps: [[200, 208]] } },
  { key: 'far', name: '离得远（10 米）、助跑慢（4.5 m/s）', over: { distanceM: 10, approachSpeed: 4.5 } },
];
const WAYS = ONLY ? ALL_WAYS.filter((w) => ONLY.includes(w.key)) : ALL_WAYS;

const METRICS = [
  { key: 'vz', name: '起跳垂直速度', unit: 'm/s', d: 3, truth: (t) => t.vz },
  { key: 'vx', name: '起跳水平速度', unit: 'm/s', d: 3, truth: (t) => t.vx },
  { key: 'angle', name: '起跳角度', unit: '°', d: 1, truth: (t) => t.angleDeg },
  { key: 'approach', name: '助跑速度', unit: 'm/s', d: 3, truth: (t) => t.approachSpeed },
  { key: 'brake', name: '踏跳刹车', unit: 'm/s', d: 3, truth: (t) => t.brake },
  { key: 'plant', name: '最后一步触地', unit: 'ms', d: 1, truth: (t) => t.plantS * 1000 },
  { key: 'gap', name: '双脚落地间隔', unit: 'ms', d: 1, truth: (t) => (t.gapS == null ? null : t.gapS * 1000) },
  { key: 'step', name: '最后一步步长', unit: 'm', d: 3, truth: (t) => t.lastStepM },
  { key: 'knee', name: '起跳腿最小膝角', unit: '°', d: 1, truth: (t) => t.kneeMinDeg },
];

/** Normal draws (mean 0, SD 1) from a seed: mulberry32, then Box–Muller. */
function normals(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(Math.max(1e-12, next()))) * Math.cos(2 * Math.PI * next());
}

/** The floor lines as a finger taps them on the zoomed picture: each off by `TAP_PX` (1 SD) either way. */
function tapped(T, scene) {
  const m = scene.markers;
  if (!m) return null;
  const normal = normals(scene.options.seed * 7919);
  const tap = (p) => ({ x: p.x + T.TAP_PX * normal(), y: p.y + T.TAP_PX * normal() });
  return { a: tap(m.a), b: tap(m.b), distanceM: m.distanceM };
}

/** Reads a scene the way the technique screen does, from a tap a quarter second before the take-off, and measures it. */
function measure(S, R, T, LM, scene) {
  const fps = scene.options.fps;
  const total = scene.frames.length;
  const wire = S.asWire(scene);
  const read = (frames) => frames.map((f) => [f, f / fps, ...wire[f].values]);
  // The athlete is the scene's first person; a frame the model missed can't be tapped, so the next one is.
  let tapAt = Math.max(0, scene.truth.takeoffFrame - Math.round(0.25 * fps));
  while (tapAt < total - 1 && !scene.frames[tapAt].poses.length) tapAt++;
  const p = scene.frames[tapAt].poses[0];
  const target = { x: (p[LM.leftHip].x + p[LM.rightHip].x) / 2, y: (p[LM.leftHip].y + p[LM.rightHip].y) / 2 };
  const { forward, backward } = R.coarseFrames(tapAt, total, R.coarseStep(fps), Math.round(R.TAP_REACH_S * fps));
  const coarseWire = [...read(forward), ...read(backward)];
  const coarse = R.framesFromWire(coarseWire, scene.width, scene.height, fps);
  const plan = R.planWindow(coarse, fps, target);
  if (!plan.ok) return { ok: false, problem: plan.problem };
  const dense = R.denseFrames(plan.win, total, coarse.map((f) => f.frame));
  const frames = R.windowOf(R.framesFromWire([...coarseWire, ...read(dense)], scene.width, scene.height, fps), plan.win);
  return T.analyseTechnique({ frames, captureFps: fps, markers: tapped(T, scene), target: plan.win.target });
}

function stats(rows) {
  const n = rows.length;
  if (!n) return null;
  const diffs = rows.map((r) => r.value - r.truth);
  const errs = rows.map((r) => r.error).sort((a, b) => a - b);
  return {
    n,
    covered: rows.filter((r) => Math.abs(r.value - r.truth) <= r.error).length / n,
    bias: diffs.reduce((s, d) => s + d, 0) / n,
    rmse: Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / n),
    medianError: errs[errs.length >> 1],
    imprecise: rows.filter((r) => r.status !== 'ok').length / n,
  };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

/**
 * The chance of `k` or fewer of `n` covered if the errors really held the truth 95 % of the time (binomial). With 40
 * clips, 37 covered comes up a third of the time even then; a shortfall is only flagged when it is unlikely by chance.
 */
function chanceOfSoFew(k, n, p = 0.95) {
  const lg = (x) => {
    let s = 0;
    for (let i = 2; i <= x; i++) s += Math.log(i);
    return s;
  };
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += Math.exp(lg(n) - lg(i) - lg(n - i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, sum);
}
const short = (s) => s.covered < 0.95 && chanceOfSoFew(Math.round(s.covered * s.n), s.n) < 0.05;

function table(byMetric, passLine) {
  const lines = ['| 指标 | 及格线 | 视频数 | 误差罩住真值 | 偏差 | RMSE | 中位误差 ± | 标「不够准」 |', '|---|---|---|---|---|---|---|---|'];
  for (const m of METRICS) {
    const s = byMetric[m.key];
    if (!s) continue;
    const f = (x) => `${x.toFixed(m.d)} ${m.unit}`;
    const flag = short(s) ? ' ⚠️' : '';
    lines.push(`| ${m.name} | ${passLine[m.key]} ${m.unit} | ${s.n} | ${Math.round(s.covered * s.n)}/${s.n}（${pct(s.covered)}）${flag} | ${f(s.bias)} | ${f(s.rmse)} | ${f(s.medianError)} | ${pct(s.imprecise)} |`);
  }
  return lines.join('\n');
}

function main() {
  const M = compile(OUT, ['domain/technique.ts', 'domain/techniqueRead.ts', 'domain/testing/poseScene.ts']);
  const T = M('domain/technique');
  const R = M('domain/techniqueRead');
  const S = M('domain/testing/poseScene');
  const { LM } = M('domain/pose');

  const clips = [];
  for (const way of WAYS) {
    for (let i = 0; i < SEEDS; i++) {
      const seed = 1000 + i;
      const scene = S.poseScene({ ...way.over, seed });
      const r = measure(S, R, T, LM, scene);
      const clip = { way: way.key, seed, ok: r.ok, problem: r.ok ? null : r.problem, metrics: {} };
      if (r.ok) {
        for (const m of METRICS) {
          const got = r.result.metrics[m.key];
          const truth = m.truth(scene.truth);
          if (got && truth != null) clip.metrics[m.key] = { value: got.value, error: got.error, status: got.status, truth };
        }
        clip.flags = r.result.flags;
      }
      clips.push(clip);
    }
    process.stdout.write(`${way.key} `);
  }
  process.stdout.write('\n');

  const rowsOf = (pick, key) => clips.filter(pick).flatMap((c) => (c.metrics[key] ? [c.metrics[key]] : []));
  const overall = Object.fromEntries(METRICS.map((m) => [m.key, stats(rowsOf(() => true, m.key))]));
  const ways = WAYS.map((w) => {
    const mine = clips.filter((c) => c.way === w.key);
    const failed = mine.filter((c) => !c.ok);
    return {
      ...w,
      clips: mine.length,
      failed: failed.length,
      problems: failed.reduce((acc, c) => ({ ...acc, [c.problem]: (acc[c.problem] ?? 0) + 1 }), {}),
      metrics: Object.fromEntries(METRICS.map((m) => [m.key, stats(rowsOf((c) => c.way === w.key, m.key))])),
    };
  });
  // A figure falls short when it does overall or under some way of filming, beyond what chance explains.
  const shortfalls = [
    ...METRICS.filter((m) => overall[m.key] && short(overall[m.key])).map((m) => m.name),
    ...ways.flatMap((w) => METRICS.filter((m) => w.metrics[m.key] && short(w.metrics[m.key])).map((m) => `${m.name}（${w.name}）`)),
  ];

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ seeds: SEEDS, overall, ways, clips }, null, 1));
  const md = [
    '# 起跳技术分析 · 误差模拟',
    '',
    `${WAYS.length} 种拍法，每种 ${SEEDS} 段合成视频，按 App 的读法读（点起跳前 0.25 秒的运动员 → 粗扫前后 3 秒 → 找起跳 → 逐帧细读）。`,
    '每个数说的误差（±，95%）要在至少 95% 的视频里罩住真值；比 95% 少、又少到不像是碰巧（二项检验 p < 0.05）的标 ⚠️。偏差 = 测量 − 真值的平均；「不够准」= 误差比及格线宽，App 里会这样标出来。',
    '',
    shortfalls.length ? `**明显没达到 95% 的：${shortfalls.join('、')}**` : '**没有明显低于 95% 的：每个指标说的误差都罩得住真值。**',
    '',
    '## 全部拍法合在一起',
    '',
    table(overall, T.PASS_LINE),
    '',
    ...ways.flatMap((w) => [
      `## ${w.name}`,
      '',
      w.failed ? `${w.clips} 段里 ${w.failed} 段没分析出来：${Object.entries(w.problems).map(([k, n]) => `${k} ${n}`).join('，')}` : `${w.clips} 段全部分析出来了。`,
      '',
      table(w.metrics, T.PASS_LINE),
      '',
    ]),
    '这只说明计算本身：骨架点的误差是按 MediaPipe 的公开表现模拟的。真实骨架模型的误差要拿真视频、手标帧和摸高读数对（方案里的 G2）。',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
  console.log(md.split('\n').slice(0, 24).join('\n'));
  console.log(`\nreport: ${path.join(OUT, 'report.md')}`);
}

main();
