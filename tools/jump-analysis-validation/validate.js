#!/usr/bin/env node
/*
 * How far to trust the automatic jump analysis (mobile/src/app/measure/analyse.tsx), measured the way a sports
 * scientist would: agreement with a reference per jump (Bland–Altman bias and 95 % limits of agreement, ICC(2,1)), and
 * repeatability (typical error, MDC95). Everything runs the app's own code: the frame-reading page in a real browser
 * engine (Playwright's Chromium), domain/autoMark for detection, domain/jumpAnalysis for the numbers,
 * domain/agreement for the statistics.
 *
 *   node tools/jump-analysis-validation/validate.js               # synthetic sets with known event times
 *   node tools/jump-analysis-validation/validate.js --real <dir>  # your clips against your references
 *
 * Synthetic: repeated-jump sets, drop jumps and CMJs with someone else moving in the picture (the athlete tapped),
 * rendered by domain/testing/jumpScene.ts and encoded to H.264. Each repeated-jump set is rendered twice with different
 * sensor noise, so the analysis's own repeatability can be read off the two runs.
 *
 * Real (`--real <dir>`), all CSV with a header row:
 *   clips.csv   file,fps,kind[,box_cm,from,to,target_x,target_y]
 *               kind: jump | drop | repeat; fps: capture rate (240 for slow motion); from/to: file frames to analyse;
 *               target: a point on the athlete in video pixels, as tapped on the phone.
 *   marks.csv   file,jump,takeoff,landing[,touchdown]   frames marked by hand, jump numbered from 1 (optional)
 *   arcus.csv   file,jump,JH,FT,GCT,RSI,RSR,DRI          another app's readings: cm, ms, ms, then ratios (optional;
 *               same columns work for My Jump or a contact mat; leave a cell empty when it has no reading)
 * Each reference is compared with the app jump by jump, and the references with each other. Clips are converted to
 * H.264 first with every frame kept (Chromium can't decode HEVC).
 *
 * Writes report.json and report.md to --out (default: a temp folder).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { compile, encodeAll, openReader, detectClip, serve } = require('./lib');

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const REAL = opt('--real', null);
const OUT = path.resolve(opt('--out', fs.mkdtempSync(path.join(os.tmpdir(), 'jump-analysis-'))));
const SEED = Number(opt('--seed', 1));
const SETS = Number(opt('--sets', 8));

const METRICS = [
  { key: 'jh', name: '跳高 JH', unit: 'cm', of: (j) => j.jhCm },
  { key: 'ft', name: '滞空 FT', unit: 'ms', of: (j) => j.ftS * 1000 },
  { key: 'gct', name: '触地 GCT', unit: 'ms', of: (j) => (j.gctS == null ? null : j.gctS * 1000) },
  { key: 'rsi', name: 'RSI', unit: '', of: (j) => j.rsi ?? null },
  { key: 'rsr', name: 'RSR', unit: '', of: (j) => j.rsr ?? null },
  { key: 'dri', name: 'DRI', unit: '', of: (j) => j.dri ?? null },
];
const SET_METRICS = [
  { key: 'rsi105', name: '10/5 RSI', unit: '', of: (s) => s.rsi105 ?? null },
  { key: 'gctCv', name: 'GCT-CV', unit: '%', of: (s) => s.gctCv ?? null },
  { key: 'driCv', name: 'DRI-CV', unit: '%', of: (s) => s.driCv ?? null },
];

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

function scenarios(S) {
  const r = rng(SEED);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const look = () => ({ shadow: pick([0, 0.3, 0.6]), reflection: pick([0, 0, 0.25]), flicker: pick([0, 0.03]), noise: 2 + 3 * r(), exposureS: pick([1 / 1000, 1 / 480]) });
  const out = [];
  for (let i = 0; i < SETS; i++) {
    const n = 5 + Math.floor(r() * 5);
    const hops = Array.from({ length: n - 1 }, () => ({ contactS: 0.15 + 0.15 * r(), flightS: 0.3 + 0.2 * r() }));
    const o = S.defaultScene('repeat', { ...look(), takeoffS: 1.2 + r() / 240, flightS: 0.4 + 0.15 * r(), hops, seed: i + 1 });
    const end = o.takeoffS + o.flightS + hops.reduce((s, h) => s + h.contactS + h.flightS, 0);
    o.durationS = end + 0.6;
    out.push({ name: `rj-${i + 1}`, kind: 'repeat', o, opts: { rebound: true }, twin: { ...o, seed: o.seed + 1000, noise: 2 + 3 * r() } });
  }
  for (let i = 0; i < Math.ceil(SETS / 2); i++) {
    const o = S.defaultScene('drop', { ...look(), contactS: 0.17 + 0.12 * r(), boxMm: pick([300, 400]), flightS: 0.38 + 0.15 * r(), takeoffS: 1.4 + r() / 240, seed: 100 + i });
    o.durationS += 0.2;
    out.push({ name: `dj-${i + 1}`, kind: 'drop', o, boxCm: o.boxMm / 10, opts: {} });
  }
  for (let i = 0; i < Math.ceil(SETS / 2); i++) {
    const o = S.defaultScene('cmj', { ...look(), width: 1080, bystander: { x: 1800, swayMm: 150 + 150 * r() }, flightS: 0.45 + 0.25 * r(), takeoffS: 1.2 + r() / 240, seed: 200 + i });
    // Tapped on the athlete's ankles, as on the phone.
    out.push({ name: `cmj-crowd-${i + 1}`, kind: 'jump', o, opts: { target: { x: (0 - o.originX) / o.mmPerPx - 40, y: o.floorRow - 20 } } });
  }
  return out;
}

/** App jumps paired with reference jumps: the app jump whose take-off is nearest, within 0.1 s. */
function pair(app, ref, fps) {
  const used = new Set();
  return ref.map((r) => {
    let best = -1;
    app.forEach((a, i) => {
      if (used.has(i) || Math.abs(a.events.takeoff - r.events.takeoff) > 0.1 * fps) return;
      if (best < 0 || Math.abs(a.events.takeoff - r.events.takeoff) < Math.abs(app[best].events.takeoff - r.events.takeoff)) best = i;
    });
    if (best >= 0) used.add(best);
    return best >= 0 ? app[best] : null;
  });
}

function agreementTable(G, rows, metrics, against) {
  const out = [];
  for (const m of metrics) {
    const pairs = rows.map((r) => [r.a?.[m.key], r.b?.[m.key]]).filter(([a, b]) => a != null && b != null);
    if (pairs.length < 3) continue;
    const ba = G.blandAltman(
      pairs.map((p) => p[0]),
      pairs.map((p) => p[1]),
    );
    let icc = null;
    try {
      icc = G.icc(pairs, 'agreement');
    } catch {
      icc = null;
    }
    out.push({ metric: m.name, unit: m.unit, against, n: ba.n, bias: ba.bias, sd: ba.sd, lower: ba.lower, upper: ba.upper, icc, maxAbs: Math.max(...pairs.map(([a, b]) => Math.abs(a - b))) });
  }
  return out;
}

const fmt = (x, d = 2) => (x == null || Number.isNaN(x) ? '—' : x.toFixed(d));
const tableMd = (rows) => [
  '| 指标 | 对照 | n | 平均偏差 | 标准差 | 95% 一致性界限 | ICC(2,1) | 最大绝对差 |',
  '|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.metric}${r.unit ? `（${r.unit}）` : ''} | ${r.against} | ${r.n} | ${fmt(r.bias)} | ${fmt(r.sd)} | ${fmt(r.lower)} … ${fmt(r.upper)} | ${fmt(r.icc, 3)} | ${fmt(r.maxAbs)} |`),
];

function metricsOf(jump) {
  const o = {};
  for (const m of METRICS) o[m.key] = m.of(jump);
  return o;
}

async function runAll(cases, A, H) {
  const srv = await serve(OUT, 0);
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  for (const c of cases) {
    for (const v of c.videos) {
      const html = `${v.name}.html`;
      fs.writeFileSync(path.join(OUT, html), H.frameGrabberHtml({ video: v.file, bg: '#17130E', accent: '#D9541E' }));
      const page = await browser.newPage();
      const t0 = Date.now();
      try {
        const reader = await openReader(page, `http://127.0.0.1:${srv.address().port}/${html}`);
        v.result = await detectClip(A, reader, { frames: v.frames, fileFps: c.fileFps, captureFps: c.captureFps, kind: c.kind, opts: c.opts });
      } catch (e) {
        v.result = { ok: false, problem: 'error', message: String(e) };
      }
      v.ms = Date.now() - t0;
      await page.close();
      console.log(v.name.padEnd(16), v.result.ok ? `${v.result.events.length} jumps, ${(v.ms / 1000).toFixed(1)} s` : `FAILED ${v.result.problem} ${v.result.message ?? ''}`);
    }
  }
  await browser.close();
  srv.close();
}

async function synthetic(M) {
  const A = M('domain/autoMark');
  const S = M('domain/testing/jumpScene');
  const J = M('domain/jumpAnalysis');
  const G = M('domain/agreement');
  const H = M('media/frameGrabberHtml');
  const list = scenarios(S);
  const jobs = [];
  const cases = list.map((c) => {
    const videos = [{ name: c.name, o: c.o }, ...(c.twin ? [{ name: `${c.name}-twin`, o: c.twin }] : [])].map((v) => ({ ...v, file: `${v.name}.mp4` }));
    for (const v of videos) jobs.push({ o: v.o, file: path.join(OUT, v.file), v });
    return { ...c, videos, fileFps: c.o.fps, captureFps: c.o.fps };
  });
  let done = 0;
  const frames = await encodeAll(path.join(OUT, 'build/domain/testing/jumpScene.js'), jobs, () => process.stdout.write(`\rrendered ${++done}/${jobs.length}`));
  jobs.forEach((j, i) => (j.v.frames = frames[i]));
  process.stdout.write('\n');
  await runAll(cases, A, H);

  const perJump = [];
  const perSet = [];
  const twins = [];
  let trueJumps = 0;
  let found = 0;
  let extra = 0;
  for (const c of cases) {
    const truthEvents = S.sceneEvents(c.o).map((e, i) => (c.kind === 'drop' ? { ...e, touchdown: S.sceneTruth(c.o).touchdown } : e)).slice(0, c.kind === 'repeat' ? undefined : 1);
    const opts = { kind: c.kind, captureFps: c.captureFps, ...(c.boxCm ? { boxCm: c.boxCm } : {}) };
    const truth = J.analyseJumps(truthEvents, opts);
    trueJumps += truth.jumps.length;
    const analysed = c.videos.map((v) => (v.result.ok ? J.analyseJumps(v.result.events, opts) : null));
    const app = analysed[0];
    if (!app) continue;
    const paired = pair(app.jumps, truth.jumps, c.captureFps);
    found += paired.filter(Boolean).length;
    extra += app.jumps.length - paired.filter(Boolean).length;
    paired.forEach((a, i) => a && perJump.push({ set: c.name, a: metricsOf(a), b: metricsOf(truth.jumps[i]) }));
    if (c.kind === 'repeat') {
      const s = {};
      const t = {};
      for (const m of SET_METRICS) {
        s[m.key] = m.of(app.summary);
        t[m.key] = m.of(truth.summary);
      }
      perSet.push({ set: c.name, a: s, b: t });
      if (analysed[1]) {
        const p2 = pair(analysed[1].jumps, app.jumps, c.captureFps);
        p2.forEach((b, i) => b && twins.push({ a: metricsOf(app.jumps[i]), b: metricsOf(b) }));
      }
    }
  }
  const agreement = [...agreementTable(G, perJump, METRICS, '真值'), ...agreementTable(G, perSet, SET_METRICS, '真值（每组）')];
  const repeat = METRICS.map((m) => {
    const pairs = twins.map((t) => [t.a[m.key], t.b[m.key]]).filter(([a, b]) => a != null && b != null);
    if (pairs.length < 3) return null;
    const te = G.typicalError(
      pairs.map((p) => p[0]),
      pairs.map((p) => p[1]),
    );
    const mean = pairs.flat().reduce((s, x) => s + x, 0) / (2 * pairs.length);
    return { metric: m.name, unit: m.unit, n: pairs.length, te, cv: (te / mean) * 100, mdc: G.mdc95(te), icc: G.icc(pairs, 'agreement') };
  }).filter(Boolean);
  const failed = cases.flatMap((c) => c.videos.filter((v) => !v.result.ok).map((v) => `${v.name}: ${v.result.problem}`));
  const md = [
    '# 自动分析：合成视频验证',
    '',
    `${cases.length} 段视频（${cases.filter((c) => c.kind === 'repeat').length} 组连跳、${cases.filter((c) => c.kind === 'drop').length} 段跳深、${cases.filter((c) => c.kind === 'jump').length} 段旁边有人晃动的 CMJ，点选运动员），共 ${trueJumps} 跳；认出 ${found} 跳，多认 ${extra} 跳。`,
    failed.length ? `没认出：${failed.join('；')}` : '',
    '',
    '## 和真值比（每跳、每组）',
    '',
    ...tableMd(agreement),
    '',
    '## 分析本身的重复性（同一组连跳换一遍传感器噪声再分析）',
    '',
    '| 指标 | n | 典型误差 TE | CV% | MDC95 | ICC(2,1) |',
    '|---|---|---|---|---|---|',
    ...repeat.map((r) => `| ${r.metric}${r.unit ? `（${r.unit}）` : ''} | ${r.n} | ${fmt(r.te)} | ${fmt(r.cv, 1)} | ${fmt(r.mdc)} | ${fmt(r.icc, 3)} |`),
    '',
    '这里的重复性只是分析流程对画面噪声的稳定性，不是运动员两次测试之间的信度；后者要用真实的同日多跳或隔天重测来算。',
  ].join('\n');
  return { md, json: { trueJumps, found, extra, cases: cases.map((c) => ({ name: c.name, kind: c.kind, videos: c.videos.map((v) => ({ name: v.name, ok: v.result.ok, problem: v.result.problem, jumps: v.result.events, ms: v.ms })) })), agreement, repeat, perJump, perSet } };
}

function readCsv(file) {
  if (!fs.existsSync(file)) return null;
  const [head, ...rows] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const keys = head.split(',').map((k) => k.trim());
  return rows.filter((r) => r.trim()).map((r) => Object.fromEntries(r.split(',').map((v, i) => [keys[i], v.trim()])));
}

async function real(M) {
  const A = M('domain/autoMark');
  const J = M('domain/jumpAnalysis');
  const G = M('domain/agreement');
  const H = M('media/frameGrabberHtml');
  const clips = readCsv(path.join(REAL, 'clips.csv'));
  if (!clips) throw new Error(`${REAL}/clips.csv not found`);
  const marks = readCsv(path.join(REAL, 'marks.csv')) ?? [];
  const arcus = readCsv(path.join(REAL, 'arcus.csv')) ?? [];
  const num = (x) => (x === '' || x == null ? null : Number(x));
  const cases = clips.map((c) => {
    const mp4 = `${path.parse(c.file).name}.mp4`;
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(REAL, c.file), '-map', '0:v:0', '-fps_mode', 'passthrough', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', path.join(OUT, mp4)]);
    const frames = Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', path.join(OUT, mp4)]).toString().trim());
    const [n, d] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', path.join(OUT, mp4)]).toString().trim().split('/').map(Number);
    const opts = {
      ...(c.kind === 'repeat' ? { rebound: true } : {}),
      ...(c.from && c.to ? { range: { from: Number(c.from), to: Number(c.to) } } : {}),
      ...(c.target_x && c.target_y ? { target: { x: Number(c.target_x), y: Number(c.target_y) } } : {}),
    };
    return { name: path.parse(c.file).name, file: c.file, kind: c.kind || 'jump', boxCm: num(c.box_cm), fileFps: n / (d || 1), captureFps: Number(c.fps), opts, videos: [{ name: path.parse(c.file).name, file: mp4, frames }] };
  });
  await runAll(cases, A, H);

  const byRef = { hand: [], arcus: [], handVsArcus: [] };
  const within = [];
  for (const c of cases) {
    const opts = { kind: c.kind, captureFps: c.captureFps, ...(c.boxCm ? { boxCm: c.boxCm } : {}) };
    const v = c.videos[0];
    const app = v.result.ok ? J.analyseJumps(v.result.events, opts) : null;
    if (app && c.kind !== 'repeat') within.push(app.jumps.filter((j) => j.counted).map((j) => j.jhCm));
    const hm = marks.filter((m) => m.file === c.file).sort((a, b) => num(a.jump) - num(b.jump));
    const hand = hm.length ? J.analyseJumps(hm.map((m) => ({ takeoff: num(m.takeoff), landing: num(m.landing), ...(m.touchdown ? { touchdown: num(m.touchdown) } : {}) })), opts) : null;
    const ar = arcus.filter((x) => x.file === c.file).sort((a, b) => num(a.jump) - num(b.jump));
    const arcusRow = (x) => ({ jh: num(x.JH), ft: num(x.FT), gct: num(x.GCT), rsi: num(x.RSI), rsr: num(x.RSR), dri: num(x.DRI) });
    if (app && hand) pair(app.jumps, hand.jumps, c.captureFps).forEach((a, i) => a && byRef.hand.push({ a: metricsOf(a), b: metricsOf(hand.jumps[i]) }));
    // Another app's jumps carry no frames: they pair by order, against the hand marks' order when there are marks.
    if (app && ar.length) {
      const order = hand ? pair(app.jumps, hand.jumps, c.captureFps) : app.jumps;
      ar.forEach((x, i) => order[i] && byRef.arcus.push({ a: metricsOf(order[i]), b: arcusRow(x) }));
    }
    if (hand && ar.length) ar.forEach((x, i) => hand.jumps[i] && byRef.handVsArcus.push({ a: metricsOf(hand.jumps[i]), b: arcusRow(x) }));
  }
  const agreement = [...agreementTable(G, byRef.hand, METRICS, 'App vs 手标'), ...agreementTable(G, byRef.arcus, METRICS, 'App vs Arcus'), ...agreementTable(G, byRef.handVsArcus, METRICS, '手标 vs Arcus')];
  const te = G.pooledWithinSd(within);
  const failed = cases.filter((c) => !c.videos[0].result.ok).map((c) => `${c.name}: ${c.videos[0].result.problem}`);
  const md = [
    '# 自动分析：真实视频验证',
    '',
    `${cases.length} 段视频，认出 ${cases.length - failed.length} 段。`,
    failed.length ? `没认出：${failed.join('；')}` : '',
    '',
    '## 一致性（每跳）',
    '',
    ...tableMd(agreement),
    '',
    '## 同一段视频里多跳的重测信度（App 跳高）',
    '',
    te == null ? '没有一段视频里有两跳以上，算不了。' : `典型误差 ${fmt(te)} cm，MDC95 ${fmt(G.mdc95(te))} cm：两次测试的跳高差要超过它才不是噪声。`,
  ].join('\n');
  return { md, json: { cases: cases.map((c) => ({ name: c.name, ok: c.videos[0].result.ok, problem: c.videos[0].result.problem, jumps: c.videos[0].result.events })), agreement, te } };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const M = compile(OUT, ['domain/autoMark.ts', 'domain/jumpAnalysis.ts', 'domain/agreement.ts', 'domain/testing/jumpScene.ts', 'media/frameGrabberHtml.ts']);
  const r = REAL ? await real(M) : await synthetic(M);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(r.json, null, 2));
  fs.writeFileSync(path.join(OUT, 'report.md'), r.md);
  console.log(`\n${r.md}\n\n${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
