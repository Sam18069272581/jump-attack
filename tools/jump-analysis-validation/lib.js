/* Shared by the jump-analysis checks: compile the app's own TypeScript, render and encode synthetic clips, serve files. */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const Module = require('module');
const path = require('path');

const MOBILE = path.resolve(__dirname, '../../mobile');

/** Compiles the given files under mobile/src (and what they import) and returns a loader for the compiled modules. */
function compile(out, files) {
  const build = path.join(out, 'build');
  // Type errors are the app's typecheck's business (`npm run typecheck`). The app's own tsconfig pulls in Expo's, so a
  // small one here maps `@/x` to `src/x` (the app's alias), which lets tsc follow those imports and compile them too.
  const config = path.join(out, 'tsconfig.validate.json');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: { outDir: build, rootDir: path.join(MOBILE, 'src'), module: 'commonjs', target: 'es2022', skipLibCheck: true, types: [], paths: { '@/*': [path.join(MOBILE, 'src/*')] } },
      files: files.map((f) => path.join(MOBILE, 'src', f)),
    }),
  );
  const r = spawnSync('npx', ['tsc', '-p', config], { cwd: MOBILE, encoding: 'utf8' });
  const missing = files.filter((f) => !fs.existsSync(path.join(build, f.replace(/\.ts$/, '.js'))));
  if (missing.length) throw new Error(`tsc wrote nothing for ${missing.join(', ')}:\n${r.stdout}${r.stderr}`);
  // The app imports `@/x` for `src/x`.
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) {
    return resolve.call(this, req.startsWith('@/') ? path.join(build, req.slice(2)) : req, ...rest);
  };
  return (name) => require(path.join(build, name));
}

/**
 * ffmpeg arguments that encode raw grey frames from stdin to H.264. ffmpeg and x264 pick their SIMD code and x264 its
 * thread count from the machine, and each choice changes the decoded picture a little; with plain C in ffmpeg, SSE2
 * (every x86-64 CPU has it) in x264 and two threads, a clip comes out the same on every machine, so the accuracy check
 * (tools/accuracy-regression) can compare its runs in CI with the baseline exactly.
 */
function encodeArgs(o, file) {
  return ['-loglevel', 'error', '-y', '-cpuflags', '0', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${o.width}x${o.height}`, '-r', String(o.fps), '-i', '-', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-g', '60', '-threads', '2', '-x264-params', 'asm=SSE2', file];
}

/** Renders a synthetic clip frame by frame and encodes it to H.264 at its real-time frame rate. */
function encode(S, o, file) {
  return new Promise((resolve, reject) => {
    const frames = Math.floor(o.durationS * o.fps);
    const ff = spawn('ffmpeg', encodeArgs(o, file));
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

/** A static file server with byte ranges (browsers only seek in media served with them). */
function serve(root, port) {
  const TYPES = { '.mp4': 'video/mp4', '.html': 'text/html' };
  return new Promise((resolve) => {
    const srv = http
      .createServer((q, s) => {
        const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
        if (!fs.existsSync(f)) return s.writeHead(404), s.end();
        const size = fs.statSync(f).size;
        const type = TYPES[path.extname(f)] || 'application/octet-stream';
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
      .listen(port, '127.0.0.1', () => resolve(srv));
  });
}

/** Renders and encodes clips on every core: `jobs` are { o, file }; resolves to each clip's frame count. */
async function encodeAll(scenePath, jobs, onDone = () => {}) {
  const { Worker } = require('worker_threads');
  const out = [];
  let next = 0;
  const cores = require('os').cpus().length;
  await Promise.all(
    [...Array(Math.min(cores, jobs.length)).keys()].map(async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await new Promise((resolve, reject) => {
          const w = new Worker(path.join(__dirname, 'encodeWorker.js'), { workerData: { scenePath, o: jobs[i].o, file: jobs[i].file } });
          w.on('message', resolve);
          w.on('error', reject);
        });
        onDone(i);
      }
    }),
  );
  return out;
}

/**
 * Opens the app's frame-reading page for a clip in a browser page and returns a function that runs the app's two
 * passes against it (coarse, then fine), as the analysis screen does on the phone.
 */
async function openReader(page, url) {
  const inbox = [];
  let wake = null;
  await page.exposeFunction('__toNode', (m) => {
    inbox.push(m);
    if (wake) wake();
  });
  await page.addInitScript(() => (window.onGrabberMessage = (m) => window.__toNode(m)));
  const next = async (...types) => {
    for (;;) {
      const i = inbox.findIndex((m) => types.includes(m.type) || m.type === 'error');
      if (i >= 0) return inbox.splice(i, 1)[0];
      await new Promise((r) => (wake = r));
    }
  };
  await page.goto(url);
  const ready = await next('ready');
  if (ready.type === 'error') throw new Error(ready.message);
  let id = 0;
  const grab = async (req, fileFps) => {
    await page.evaluate((call) => window.grab(call), { id: ++id, frames: req.frames, fps: fileFps, rect: req.rect, w: req.w, h: req.h });
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
  return { width: ready.width, height: ready.height, grab };
}

/** The app's detection on one clip: both passes, with what the athlete chose (range, target, rebound). */
async function detectClip(A, reader, { frames, fileFps, captureFps, kind, opts }) {
  const info = { width: reader.width, height: reader.height, frames, captureFps };
  const req = A.coarseRequest(info, opts);
  const coarse = A.analyseCoarse(info, req, await reader.grab(req, fileFps), kind === 'drop' ? 'drop' : 'jump', opts);
  if (!coarse.ok) return coarse;
  const fine = A.analyseFine(coarse.plan, await reader.grab(coarse.plan.request, fileFps));
  if (!fine.ok) return fine;
  return {
    ok: true,
    events: fine.jumps.map((j) => (j.marks.length === 3 ? { touchdown: j.marks[0], takeoff: j.marks[1], landing: j.marks[2], flags: j.flags } : { takeoff: j.marks[0], landing: j.marks[1], flags: j.flags })),
  };
}

module.exports = { compile, encode, encodeArgs, encodeAll, serve, openReader, detectClip, MOBILE };
