#!/usr/bin/env node
/*
 * End-to-end check of the automatic take-off / landing detection: real video files, the real frame-reading page in a
 * real browser engine (Playwright's Chromium), and the app's own detection code.
 *
 *   node tools/jump-detect-validation/validate.js                 # synthetic clips with known event times
 *   node tools/jump-detect-validation/validate.js --n 40          # more of them
 *   node tools/jump-detect-validation/validate.js --real <dir>    # your clips, against marks.csv in that folder
 *
 * Synthetic clips are rendered by mobile/src/domain/testing/jumpScene.ts (random flight times, take-off phase within
 * a frame, shadows, glossy floor, flicker, noise, blur), encoded to H.264 by ffmpeg, then read frame by frame by
 * mobile/src/media/frameGrabberHtml.ts exactly as the phone does.
 *
 * For --real, marks.csv has a header and one row per clip:  file,fps,takeoff,landing[,touchdown]
 * (frames as marked by hand or read off My Jump; fps is the capture rate, 240 for slow motion). Chromium can't decode
 * HEVC, so each clip is first converted to H.264 with every frame kept.
 *
 * Needs ffmpeg and Playwright (preinstalled in the cloud container). Writes report.json and report.md next to the
 * clips (default: a temp folder).
 */
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const MOBILE = path.resolve(__dirname, '../../mobile');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const N = Number(opt('--n', 24));
const REAL = opt('--real', null);
const OUT = path.resolve(opt('--out', fs.mkdtempSync(path.join(os.tmpdir(), 'jump-detect-'))));
const SEED = Number(opt('--seed', 1));
const SCALE = Number(opt('--scale', 1));

function compile() {
  const build = path.join(OUT, 'build');
  execFileSync(
    'npx',
    ['tsc', '--ignoreConfig', '--outDir', build, '--module', 'commonjs', '--target', 'es2022', '--skipLibCheck', '--rootDir', 'src', 'src/domain/autoMark.ts', 'src/domain/testing/jumpScene.ts', 'src/media/frameGrabberHtml.ts'],
    { cwd: MOBILE, stdio: 'inherit' },
  );
  return {
    A: require(path.join(build, 'domain/autoMark.js')),
    S: require(path.join(build, 'domain/testing/jumpScene.js')),
    H: require(path.join(build, 'media/frameGrabberHtml.js')),
  };
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function scenarios(S, n) {
  const r = rng(SEED);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const out = [];
  for (let i = 0; i < n; i++) {
    const kind = pick(['cmj', 'cmj', 'approach', 'drop', 'single']);
    const flightS = kind === 'single' ? 0.28 + 0.12 * r() : kind === 'drop' ? 0.38 + 0.15 * r() : 0.45 + 0.3 * r();
    const over = {
      takeoffS: (kind === 'approach' ? 1.1 : kind === 'drop' ? 1.4 : 1.2) + r() / 240,
      flightS,
      shadow: pick([0, 0.3, 0.6]),
      reflection: pick([0, 0, 0.25, 0.4]),
      flicker: pick([0, 0.03, 0.06]),
      noise: 2 + 3 * r(),
      exposureS: pick([1 / 1000, 1 / 480]),
      secondFootLagS: kind === 'approach' ? 0.03 * r() : 0.008 * r(),
      farFootPx: Math.round(4 * r()),
      seed: i + 1,
      ...(r() < 0.25 ? { courtLineMm: 20 + 40 * r() } : {}),
      ...(kind === 'drop' ? { contactS: 0.17 + 0.12 * r(), boxMm: pick([300, 400]) } : {}),
    };
    // At the default size the athlete is about 600 px tall, roughly what the detector's fine pass reads from a real
    // 1080 x 1920 slow-motion file; --scale renders bigger (and slower).
    const base = S.defaultScene(kind === 'single' ? 'cmj' : kind, over);
    const big = { width: Math.round(base.width * SCALE), height: Math.round(base.height * SCALE) };
    out.push({ name: `${String(i + 1).padStart(2, '0')}-${kind}`, kind, o: { ...base, ...big, mmPerPx: base.mmPerPx / SCALE, floorRow: Math.round(base.floorRow * SCALE), durationS: base.durationS + (kind === 'drop' ? 0.2 : 0) } });
  }
  return out;
}

/** Renders and encodes one clip in a worker thread, so all cores render. */
function encodeInWorker(scenePath, o, file) {
  const { Worker } = require('worker_threads');
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { scenePath, o, file } });
    w.on('message', resolve);
    w.on('error', reject);
  });
}

function encode(S, o, file) {
  return new Promise((resolve, reject) => {
    const frames = Math.floor(o.durationS * o.fps);
    const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${o.width}x${o.height}`, '-r', String(o.fps), '-i', '-', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-g', '60', file]);
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve(frames) : reject(new Error(`ffmpeg exited ${code}`))));
    let f = 0;
    const rect = { x: 0, y: 0, w: o.width, h: o.height };
    const pump = () => {
      while (f < frames) {
        const ok = ff.stdin.write(Buffer.from(S.renderScene(o, f++, rect, o.width, o.height).data));
        if (!ok) return ff.stdin.once('drain', pump);
      }
      ff.stdin.end();
    };
    pump();
  });
}

function serve(root, port) {
  const TYPES = { '.mp4': 'video/mp4', '.html': 'text/html' };
  return new Promise((resolve) => {
    const srv = http
      .createServer((q, s) => {
        const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
        if (!fs.existsSync(f)) return s.writeHead(404), s.end();
        const size = fs.statSync(f).size;
        const type = TYPES[path.extname(f)] || 'application/octet-stream';
        // Browsers only seek in media served with byte ranges.
        const m = /bytes=(\d*)-(\d*)/.exec(q.headers.range || '');
        if (m) {
          const a = m[1] ? +m[1] : 0;
          const b = m[2] ? +m[2] : size - 1;
          s.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1 });
          return fs.createReadStream(f, { start: a, end: b }).pipe(s);
        }
        s.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
        fs.createReadStream(f).pipe(s);
      })
      .listen(port, () => resolve(srv));
  });
}

/** Runs the app's two passes against the page, as AutoMarker does on the phone. */
async function detect(A, page, clip, frames, fileFps, captureFps, kind) {
  const inbox = [];
  let wake = null;
  await page.exposeFunction('__toNode', (m) => {
    inbox.push(m);
    if (wake) wake();
  });
  await page.addInitScript(() => (window.onGrabberMessage = (m) => window.__toNode(m)));
  // Messages are taken in the order the page sent them.
  const next = async (...types) => {
    for (;;) {
      const i = inbox.findIndex((m) => types.includes(m.type) || m.type === 'error');
      if (i >= 0) return inbox.splice(i, 1)[0];
      await new Promise((r) => (wake = r));
    }
  };
  await page.goto(clip);
  const ready = await next('ready');
  if (ready.type === 'error') return { ok: false, problem: 'error', message: ready.message };
  const grab = async (id, req) => {
    await page.evaluate((call) => window.grab(call), { id, frames: req.frames, fps: fileFps, rect: req.rect, w: req.w, h: req.h });
    const got = [];
    for (;;) {
      const m = await next('frames', 'done');
      if (m.type === 'error') throw new Error(m.message);
      if (m.type === 'done') return got;
      const bytes = Buffer.from(m.data, 'base64');
      const size = m.w * m.h;
      for (let k = 0; k * size < bytes.length; k++) got[m.from + k] = { w: m.w, h: m.h, data: new Uint8Array(bytes.subarray(k * size, (k + 1) * size)) };
    }
  };
  const info = { width: ready.width, height: ready.height, frames, captureFps };
  const t0 = Date.now();
  const req = coarseFor(A, info);
  const coarse = A.analyseCoarse(info, req, await grab(1, req), kind);
  if (!coarse.ok) return { ...coarse, ms: Date.now() - t0 };
  const fine = A.analyseFine(coarse.plan, await grab(2, coarse.plan.request));
  return { ...fine, ms: Date.now() - t0, seeks: req.frames.length + coarse.plan.request.frames.length };
}

const coarseFor = (A, info) => A.coarseRequest(info);

function stats(xs) {
  if (!xs.length) return null;
  const n = xs.length;
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  return { n, mean: +mean.toFixed(2), sd: +sd.toFixed(2), loa: [+(mean - 1.96 * sd).toFixed(2), +(mean + 1.96 * sd).toFixed(2)], maxAbs: +Math.max(...xs.map(Math.abs)).toFixed(2) };
}

const heightCm = (t) => (9.81 * t * t) / 8 * 100;

async function main() {
  const { chromium } = require('playwright');
  const { A, S, H } = compile();
  const cases = [];
  if (REAL) {
    const rows = fs.readFileSync(path.join(REAL, 'marks.csv'), 'utf8').trim().split(/\r?\n/).slice(1);
    for (const row of rows) {
      const [file, fps, takeoff, landing, touchdown] = row.split(',').map((x) => x.trim());
      const src = path.join(REAL, file);
      const mp4 = path.join(OUT, `${path.parse(file).name}.mp4`);
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', src, '-map', '0:v:0', '-fps_mode', 'passthrough', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', mp4]);
      const count = Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', mp4]).toString().trim());
      const fileFps = eval(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', mp4]).toString().trim());
      const truth = { takeoff: +takeoff, landing: +landing, ...(touchdown ? { touchdown: +touchdown } : {}) };
      cases.push({ name: path.parse(file).name, kind: touchdown ? 'drop' : 'jump', video: path.basename(mp4), frames: count, fileFps, captureFps: +fps, truth });
    }
  } else {
    const list = scenarios(S, N);
    let done = 0;
    // One render per core; each clip is a few hundred frames.
    const cores = os.cpus().length;
    await Promise.all(
      [...Array(cores).keys()].map(async (w) => {
        for (let i = w; i < list.length; i += cores) {
          const c = list[i];
          const video = `${c.name}.mp4`;
          const frames = await encodeInWorker(path.join(OUT, 'build/domain/testing/jumpScene.js'), c.o, path.join(OUT, video));
          cases[i] = { name: c.name, kind: c.kind === 'drop' ? 'drop' : 'jump', scene: c.kind, video, frames, fileFps: c.o.fps, captureFps: c.o.fps, truth: S.sceneTruth(c.o), o: c.o };
          process.stdout.write(`\rrendered ${++done}/${list.length}`);
        }
      }),
    );
    process.stdout.write('\n');
  }

  const srv = await serve(OUT, 8199);
  const browser = await chromium.launch();
  const results = [];
  for (const c of cases) {
    const html = `${c.name}.html`;
    fs.writeFileSync(path.join(OUT, html), H.frameGrabberHtml({ video: c.video, bg: '#14161B', accent: '#D4FF3F' }));
    const page = await browser.newPage();
    let r;
    try {
      r = await detect(A, page, `http://localhost:8199/${html}`, c.frames, c.fileFps, c.captureFps, c.kind);
    } catch (e) {
      r = { ok: false, problem: 'error', message: String(e) };
    }
    await page.close();
    const want = c.kind === 'drop' ? [c.truth.touchdown, c.truth.takeoff, c.truth.landing] : [c.truth.takeoff, c.truth.landing];
    const got = r.ok ? r.jumps.reduce((best, j) => (Math.abs(j.marks.at(-2) - c.truth.takeoff) < Math.abs(best.marks.at(-2) - c.truth.takeoff) ? j : best)).marks : null;
    const trueFlight = c.o ? c.o.flightS : (c.truth.landing - c.truth.takeoff) / c.captureFps;
    const row = {
      name: c.name,
      scene: c.scene ?? 'real',
      ok: r.ok,
      problem: r.ok ? undefined : r.problem,
      want,
      got,
      frameErr: got ? got.map((g, i) => g - want[i]) : null,
      flightErrMs: got ? +(((got.at(-1) - got.at(-2)) / c.captureFps - trueFlight) * 1000).toFixed(1) : null,
      heightErrCm: got ? +(heightCm((got.at(-1) - got.at(-2)) / c.captureFps) - heightCm(trueFlight)).toFixed(2) : null,
      ms: r.ms,
      seeks: r.seeks,
      extraJumps: r.ok ? r.jumps.length - 1 : 0,
    };
    results.push(row);
    console.log(row.name.padEnd(14), row.ok ? `frames ${JSON.stringify(row.frameErr)} flight ${row.flightErrMs} ms height ${row.heightErrCm} cm` : `FAILED ${row.problem}`);
  }
  await browser.close();
  srv.close();

  const okRows = results.filter((r) => r.ok);
  const summary = {
    clips: results.length,
    found: okRows.length,
    failed: results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.problem}`),
    takeoffFrames: stats(okRows.map((r) => r.frameErr.at(-2))),
    landingFrames: stats(okRows.map((r) => r.frameErr.at(-1))),
    touchdownFrames: stats(okRows.filter((r) => r.frameErr.length === 3).map((r) => r.frameErr[0])),
    flightMs: stats(okRows.map((r) => r.flightErrMs)),
    heightCm: stats(okRows.map((r) => r.heightErrCm)),
    withinOneFrame: okRows.filter((r) => r.frameErr.every((e) => Math.abs(e) <= 1)).length,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ summary, results }, null, 2));
  const md = [
    `# 自动识别起跳/落地：${REAL ? '真实视频' : '合成视频'}验证`,
    '',
    `${summary.clips} 段，认出 ${summary.found} 段，每个标记都在 ±1 帧内的 ${summary.withinOneFrame} 段。`,
    '',
    '| 指标 | 段数 | 平均偏差 | 标准差 | 95% 一致性界限 | 最大绝对误差 |',
    '|---|---|---|---|---|---|',
    ...[
      ['起跳帧（帧）', summary.takeoffFrames],
      ['落地帧（帧）', summary.landingFrames],
      ['触地帧（帧，跳深）', summary.touchdownFrames],
      ['滞空时间（ms）', summary.flightMs],
      ['跳高（cm）', summary.heightCm],
    ]
      .filter(([, s]) => s)
      .map(([k, s]) => `| ${k} | ${s.n} | ${s.mean} | ${s.sd} | ${s.loa[0]} … ${s.loa[1]} | ${s.maxAbs} |`),
    '',
    summary.failed.length ? `没认出：${summary.failed.join('；')}` : '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
  console.log(`\n${md}\n\n${OUT}`);
}

const { isMainThread, parentPort, workerData } = require('worker_threads');
if (isMainThread) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  encode(require(workerData.scenePath), workerData.o, workerData.file).then((frames) => parentPort.postMessage(frames));
}
