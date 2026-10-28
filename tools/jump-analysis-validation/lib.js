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
  // Type errors are the app's typecheck's business (`npm run typecheck`); here tsc runs without the app's config, so
  // `@/` imports of types don't resolve, which changes nothing in the JavaScript it writes.
  const r = spawnSync('npx', ['tsc', '--ignoreConfig', '--outDir', build, '--module', 'commonjs', '--target', 'es2022', '--skipLibCheck', '--rootDir', 'src', ...files.map((f) => `src/${f}`)], {
    cwd: MOBILE,
    encoding: 'utf8',
  });
  const missing = files.filter((f) => !fs.existsSync(path.join(build, f.replace(/\.ts$/, '.js'))));
  if (missing.length) throw new Error(`tsc wrote nothing for ${missing.join(', ')}:\n${r.stdout}${r.stderr}`);
  // The app imports `@/x` for `src/x`.
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) {
    return resolve.call(this, req.startsWith('@/') ? path.join(build, req.slice(2)) : req, ...rest);
  };
  return (name) => require(path.join(build, name));
}

/** Renders a synthetic clip frame by frame and encodes it to H.264 at its real-time frame rate. */
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

module.exports = { compile, encode, serve, MOBILE };
