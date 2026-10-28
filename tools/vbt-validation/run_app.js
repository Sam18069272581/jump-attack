#!/usr/bin/env node
/**
 * Runs the app's own VBT pipeline outside the app: the tracker page from mobile/src/media/barTrackerHtml.ts in
 * headless Chromium (the same seek-draw-read loop the WebView runs), and analyseBarPath from
 * mobile/src/domain/barPath.ts on what it reports. Both are transpiled from the current source on every run, so
 * this always measures the code as it stands.
 *
 * The page is driven as a test would drive it: the circle is put on the plate with window.setCircle (at the
 * position given, usually the ground-truth plate with a deliberately wrong radius), snapped to the rim, and
 * window.startTrack() runs to the 'done' message.
 *
 * Usage:
 *   node run_app.js track <video.mp4> --circle x,y,r [--fps 60] [--no-snap] [--out samples.json]
 *   node run_app.js track-batch <jobs.json> [--pages 3]     jobs: [{ video, circle: [x, y, r], fps, out }]
 *   node run_app.js analyse <samples.json> [--time-scale 1] [--out reps.json]
 *   node run_app.js analyse-batch <jobs.json>               jobs: [{ samples, timeScale, out }]
 * Every command takes --src <dir> to measure another copy of mobile/src (default: the working tree).
 *
 * Samples files (in and out) are the tracker's 'done' message: { samples: [t, x, y, c][], diameter, lost }, with t
 * in media seconds and x, y in video pixels; reference_tracker.py writes the same, so either analyser runs on either
 * tracker. Needs Playwright: NODE_PATH=$(npm root -g) if it is installed globally.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const REPO = path.resolve(__dirname, '../..');
// The app source to measure: the working tree, or another checkout (`--src`, or VBT_APP_SRC) such as a commit
// exported with `git archive` to compare versions.
let SRC = process.env.VBT_APP_SRC ? path.resolve(process.env.VBT_APP_SRC) : path.join(REPO, 'mobile/src');
const ts = require(path.join(REPO, 'mobile/node_modules/typescript'));

// ---- loading the app's TypeScript ----

const cache = new Map();

/** Transpiles and runs a module of the app (and whatever it imports from the app), CommonJS-style. */
function load(file) {
  const full = resolveSource(file);
  if (cache.has(full)) return cache.get(full).exports;
  const src = fs.readFileSync(full, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    fileName: full,
  }).outputText;
  const m = { exports: {} };
  cache.set(full, m);
  const req = (spec) => {
    if (spec.startsWith('@/')) return load(path.join(SRC, spec.slice(2)));
    if (spec.startsWith('.')) return load(path.resolve(path.dirname(full), spec));
    return require(spec);
  };
  new Function('module', 'exports', 'require', js)(m, m.exports, req);
  return m.exports;
}

function resolveSource(file) {
  for (const ext of ['', '.ts', '.tsx', '/index.ts']) if (fs.existsSync(file + ext) && fs.statSync(file + ext).isFile()) return file + ext;
  throw new Error(`no source for ${file}`);
}

function playwright() {
  try {
    return require('playwright');
  } catch {
    const root = execSync('npm root -g').toString().trim();
    return require(path.join(root, 'playwright'));
  }
}

// ---- arguments ----

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

// ---- tracking ----

/** A local server for the pages and videos of the jobs: Chromium only seeks in a video served with byte ranges. */
function serve(jobs) {
  const { barTrackerHtml } = load(path.join(SRC, 'media/barTrackerHtml'));
  const pages = jobs.map((j, i) =>
    barTrackerHtml({ video: `/video/${i}.mp4`, fps: j.fps ?? 0, accent: '#D4FF3F', bg: '#0F1115', text: '#ffffff', muted: '#999999' }),
  );
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let m = url.match(/^\/page\/(\d+)\.html$/);
    if (m && pages[+m[1]] != null) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(pages[+m[1]]);
    }
    m = url.match(/^\/video\/(\d+)\.mp4$/);
    if (!m || !jobs[+m[1]]) {
      res.writeHead(404);
      return res.end();
    }
    const file = jobs[+m[1]].video;
    const size = fs.statSync(file).size;
    const range = req.headers.range;
    if (range) {
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = Number(s);
      const end = e ? Number(e) : size - 1;
      res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function trackOne(browser, port, job, i) {
  const began = Date.now();
  const page = await browser.newPage({ viewport: { width: 390, height: 560 } });
  try {
    await page.addInitScript(() => {
      window.__msgs = [];
      window.onTrackerMessage = (m) => window.__msgs.push(m);
    });
    await page.goto(`http://127.0.0.1:${port}/page/${i}.html`);
    await page.waitForFunction(() => window.__msgs.some((m) => m.type === 'ready' || m.type === 'error'), null, { timeout: 60000 });
    const ready = await page.evaluate(() => window.__msgs.find((m) => m.type === 'ready' || m.type === 'error'));
    if (ready.type === 'error') return { error: ready.message };
    const [x, y, r] = job.circle;
    const snapped = await page.evaluate(([x, y, r, s]) => window.setCircle(x, y, r, s), [x, y, r, job.snap !== false]);
    if (job.snapOnly) return { circleSet: job.circle, circle: snapped, ready };
    // As the app does: tell the page the frame rate the player reported (0 when it didn't).
    await page.evaluate((fps) => window.startTrack(fps), job.fps ?? 0);
    // Generous: a second of video takes the page a few seconds at 60 fps.
    const timeout = Math.max(120000, ready.duration * 150 * 1000);
    await page.waitForFunction(() => window.__msgs.some((m) => m.type === 'done' || m.type === 'error'), null, { timeout, polling: 250 });
    const done = await page.evaluate(() => window.__msgs.find((m) => m.type === 'done' || m.type === 'error'));
    if (done.type === 'error') return { error: done.message, circle: snapped };
    const { type: _type, ...rest } = done;
    return { ...rest, circleSet: job.circle, circle: snapped, ready, wallMs: Date.now() - began };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  } finally {
    await page.close();
  }
}

async function trackBatch(jobs, pages, log = console.error) {
  const server = await serve(jobs);
  const port = server.address().port;
  const browser = await playwright().chromium.launch();
  let next = 0;
  const results = new Array(jobs.length);
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      const job = jobs[i];
      const res = { tracker: 'app', video: path.basename(job.video), fps: job.fps ?? 0, ...(await trackOne(browser, port, job, i)) };
      if (job.out) fs.writeFileSync(job.out, JSON.stringify(res));
      results[i] = res;
      log(
        res.error
          ? `  app tracker ${res.video}: ERROR ${res.error}`
          : job.snapOnly
            ? `  app tracker ${res.video}: snapped to ${JSON.stringify(res.circle)}`
            : `  app tracker ${res.video}: ${res.samples.length} frames in ${(res.wallMs / 1000).toFixed(0)} s, lost=${res.lost}, diameter ${res.diameter.toFixed(1)} px`,
      );
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.max(1, pages) }, worker));
  } finally {
    await browser.close();
    server.close();
  }
  return results;
}

// ---- analysis ----

/** Runs analyseBarPath on a samples file; reps come back in metres and m/s, under the same names as the reference. */
function analyse(samplesFile, timeScale) {
  const { analyseBarPath, trackWarnings } = load(path.join(SRC, 'domain/barPath'));
  const data = JSON.parse(fs.readFileSync(samplesFile, 'utf8'));
  if (data.error || !data.samples) return { error: data.error || 'no samples' };
  const samples = data.samples.map(([t, x, y, c]) => ({ t, x, y, c }));
  const scale = timeScale ?? data.time_scale ?? 1;
  const a = analyseBarPath(samples, data.diameter, scale);
  return {
    analyser: 'app',
    rate: a.rate,
    unsure: a.unsure,
    warnings: trackWarnings ? trackWarnings(a) : [],
    reps: a.reps.map((r) => ({
      start: r.start,
      end: r.end,
      mcv: r.mcv ?? r.mv,
      mpv: r.mpv ?? null,
      pv: r.pv,
      rom: r.rom ?? r.romCm / 100,
      // Reps the analyser itself distrusts (barPath's `flags`) are kept but marked, so rejection can be scored.
      valid: r.flags ? r.flags.length === 0 : (r.valid ?? true),
      reason: r.flags && r.flags.length ? r.flags.join(',') : (r.reason ?? null),
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, target] = args._;
  if (args.src) SRC = path.resolve(args.src);
  if (cmd === 'track') {
    if (!args.circle) throw new Error('--circle x,y,r is required');
    const job = { video: path.resolve(target), circle: args.circle.split(',').map(Number), fps: Number(args.fps || 0), snap: !args['no-snap'], out: args.out };
    const [res] = await trackBatch([job], 1);
    if (!args.out) process.stdout.write(JSON.stringify(res) + '\n');
  } else if (cmd === 'track-batch') {
    const jobs = JSON.parse(fs.readFileSync(target, 'utf8'));
    await trackBatch(jobs, Number(args.pages || 3));
  } else if (cmd === 'analyse') {
    const res = analyse(target, args['time-scale'] != null ? Number(args['time-scale']) : undefined);
    if (args.out) fs.writeFileSync(args.out, JSON.stringify(res, null, 1));
    else process.stdout.write(JSON.stringify(res, null, 1) + '\n');
  } else if (cmd === 'analyse-batch') {
    const jobs = JSON.parse(fs.readFileSync(target, 'utf8'));
    for (const j of jobs) {
      let res;
      try {
        res = analyse(j.samples, j.timeScale);
      } catch (e) {
        res = { error: String((e && e.stack) || e) };
      }
      fs.writeFileSync(j.out, JSON.stringify(res));
    }
  } else {
    process.stderr.write('usage: node run_app.js track|track-batch|analyse|analyse-batch …\n');
    process.exit(2);
  }
}

main().catch((e) => {
  process.stderr.write(String((e && e.stack) || e) + '\n');
  process.exit(1);
});
