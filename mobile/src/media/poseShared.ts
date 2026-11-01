/**
 * The part of the pose pages (media/poseReaderHtml.ts reads a clip, media/poseCameraHtml.ts watches the camera) that
 * runs MediaPipe's pose model, as page script. It defines `POSE` with:
 * - `start(cfg)`: loads the library and the model from the phone's copy (media/poseLib.ts), or from the CDN when that
 *   can't be read, and starts the pose landmarker on the GPU, or the CPU when the GPU won't start;
 * - `detect(src, w, h, crop)`: the people in a square `{ x, y, s }` of a picture (video px), each as 33 × 4 numbers
 *   (x and y as shares of the whole picture, MediaPipe's depth, visibility: what domain/pose.ts `decodePose` reads);
 * - `search(src, w, h)`: everyone in the picture, read in overlapping squares and in the whole picture at once;
 * - `Tracker`: follows one person from frame to frame, cropping each frame around where they should be by then. It
 *   starts from a tap, which can be anywhere on the body: the person picked is the one whose skeleton is nearest it.
 *
 * Why crops: the model's person detector looks at the picture shrunk to 224 px. An athlete filmed from 7 m is about
 * a third of the picture's height, 40-odd px at that size, too small to be found reliably; in a square of about two
 * statures around them they are half of it. The model then reads the joints from its own close-up of the person. One
 * filmed close, taller than the squares, is found in the whole picture.
 *
 * The pages run it in IMAGE mode, each frame on its own: VIDEO mode smooths the points over time, which delays fast
 * events like toe-off by a few frames.
 */

/** The page script, ES2017. Expects `post(message)` in scope; adds `POSE`. */
export const POSE_SHARED_JS = String.raw`
var POSE = (function () {
  var lib = null;
  var landmarker = null;
  var lost = false;
  var work = document.createElement('canvas');
  var wctx = work.getContext('2d', { willReadFrequently: true });

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('读不到 ' + src)); };
      document.body.appendChild(s);
    });
  }

  // XHR, not fetch: WebKit's fetch refuses file: URLs.
  function readBytes(url) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('GET', url, true);
      x.responseType = 'arraybuffer';
      x.onload = function () {
        if ((x.status === 0 || x.status === 200) && x.response && x.response.byteLength) resolve(new Uint8Array(x.response));
        else reject(new Error('读不到 ' + url));
      };
      x.onerror = function () { reject(new Error('读不到 ' + url)); };
      x.send();
    });
  }

  async function local(cfg) {
    if (!self.MPVision) await loadScript(cfg.lib + '/vision.js');
    var model = await readBytes(cfg.lib + '/pose_landmarker_full.task');
    // The wasm loader reads file: URLs with XHR only when given the full URL.
    return { source: 'local', loader: cfg.lib + '/vision_wasm_internal.js', wasm: new URL(cfg.lib + '/vision_wasm_internal.wasm', location.href).href, model: model };
  }

  async function cdn(cfg) {
    if (!self.MPVision) self.MPVision = await import(cfg.cdn.bundle);
    var res = await fetch(cfg.cdn.model);
    if (!res.ok) throw new Error('模型下载失败（' + res.status + '）');
    return { source: 'cdn', loader: cfg.cdn.loader, wasm: cfg.cdn.wasm, model: new Uint8Array(await res.arrayBuffer()) };
  }

  async function start(cfg) {
    if (!lib) lib = await local(cfg).catch(function () { return cdn(cfg); });
    var last = null;
    var order = cfg.cpuOnly ? ['CPU'] : ['GPU', 'CPU'];
    for (var i = 0; i < order.length; i++) {
      try {
        // The library takes the loader's ModuleFactory and clears it, so a second try loads it again.
        if (!self.ModuleFactory) await loadScript(lib.loader);
        // Its own canvas: left to itself, the library picks an OffscreenCanvas that WebKit before 17 can't draw with.
        var gl = document.createElement('canvas');
        gl.addEventListener('webglcontextlost', function (e) { e.preventDefault(); lost = true; });
        landmarker = await self.MPVision.PoseLandmarker.createFromOptions(
          { wasmLoaderPath: '', wasmBinaryPath: lib.wasm },
          {
            baseOptions: { modelAssetBuffer: new Uint8Array(lib.model), delegate: order[i] },
            runningMode: 'IMAGE',
            numPoses: cfg.numPoses || 2,
            canvas: gl,
          },
        );
        lost = false;
        return { delegate: order[i], source: lib.source };
      } catch (e) {
        last = e;
      }
    }
    throw last || new Error('骨架识别启动失败');
  }

  /** The GPU went away (iOS takes it back from pages in the background): start again on the CPU. */
  async function recover(cfg) {
    if (!lost) return null;
    try { landmarker.close(); } catch (e) {}
    return start(Object.assign({}, cfg, { cpuOnly: true }));
  }

  var R5 = 1e5, R3 = 1e3;
  function detect(src, w, h, crop) {
    var d = Math.max(160, Math.min(640, Math.round(crop.s)));
    if (work.width !== d || work.height !== d) { work.width = d; work.height = d; }
    wctx.fillStyle = '#000';
    wctx.fillRect(0, 0, d, d);
    // Only the part inside the picture: Safari draws nothing for a source rectangle that runs off the edge.
    var x0 = Math.max(0, crop.x), y0 = Math.max(0, crop.y), x1 = Math.min(w, crop.x + crop.s), y1 = Math.min(h, crop.y + crop.s);
    if (x1 - x0 < 8 || y1 - y0 < 8) return [];
    var k = d / crop.s;
    wctx.drawImage(src, x0, y0, x1 - x0, y1 - y0, (x0 - crop.x) * k, (y0 - crop.y) * k, (x1 - x0) * k, (y1 - y0) * k);
    var r = landmarker.detect(work);
    var out = [];
    ((r && r.landmarks) || []).forEach(function (lms) {
      if (!lms || lms.length !== 33) return;
      var v = new Array(132);
      for (var i = 0; i < 33; i++) {
        var p = lms[i];
        v[4 * i] = Math.round(((crop.x + p.x * crop.s) / w) * R5) / R5;
        v[4 * i + 1] = Math.round(((crop.y + p.y * crop.s) / h) * R5) / R5;
        v[4 * i + 2] = Math.round(p.z * R3) / R3;
        v[4 * i + 3] = p.visibility == null ? 0 : Math.round(p.visibility * R3) / R3;
      }
      out.push(v);
    });
    return out;
  }

  function pt(v, i, w, h) { return { x: v[4 * i] * w, y: v[4 * i + 1] * h }; }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function hip(v, w, h) { return mid(pt(v, 23, w, h), pt(v, 24, w, h)); }
  // Thigh + shank + trunk, px: about 0.78 of standing height in any posture (Winter's proportions).
  function length(v, w, h) {
    function p(i) { return pt(v, i, w, h); }
    var thigh = (dist(p(23), p(25)) + dist(p(24), p(26))) / 2;
    var shank = (dist(p(25), p(27)) + dist(p(26), p(28))) / 2;
    return thigh + shank + dist(mid(p(11), p(12)), hip(v, w, h));
  }
  function segment(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    var u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return dist(p, { x: a.x + u * dx, y: a.y + u * dy });
  }
  // How far p (px) is from the skeleton, the neck up to the nose included: domain/pose.ts distanceToBody.
  function reach(v, p, w, h) {
    var d = segment(p, mid(pt(v, 11, w, h), pt(v, 12, w, h)), pt(v, 0, w, h));
    BONES.forEach(function (b) { if (b[0] !== 7) d = Math.min(d, segment(p, pt(v, b[0], w, h), pt(v, b[1], w, h))); });
    return d;
  }
  function seen(v) { var s = 0; for (var i = 0; i < 33; i++) s += v[4 * i + 3]; return s / 33; }
  // About 2.1 statures, centred a little above the hips: room for arms raised at the rim.
  function around(at, len) { var s = 2.7 * len; return { x: at.x - s / 2, y: at.y - 0.4 * len - s / 2, s: s }; }

  /** Overlapping squares of three quarters of the picture's short side, half a square apart. */
  function tiles(w, h) {
    var T = Math.round(0.75 * Math.min(w, h)), step = Math.round(T / 2), out = [];
    for (var y = 0; ; y += step) {
      var yy = Math.min(y, h - T);
      for (var x = 0; ; x += step) {
        var xx = Math.min(x, w - T);
        out.push({ x: xx, y: yy, s: T });
        if (xx >= w - T) break;
      }
      if (yy >= h - T) break;
    }
    return out;
  }

  /** One person found in two places (overlapping squares): keep the reading the model was surer of. */
  function merge(poses, w, h) {
    var kept = [];
    poses.forEach(function (v) {
      var at = hip(v, w, h), len = length(v, w, h), s = seen(v);
      var same = -1;
      kept.forEach(function (k, i) { if (same < 0 && dist(k.at, at) < 0.5 * Math.max(k.len, len)) same = i; });
      if (same < 0) kept.push({ v: v, at: at, len: len, s: s });
      else if (s > kept[same].s) kept[same] = { v: v, at: at, len: len, s: s };
    });
    return kept.map(function (k) { return k.v; });
  }

  /** The whole picture as one square (the model pads it): finds someone too tall for the tiles. */
  function whole(w, h) { var s = Math.max(w, h); return { x: (w - s) / 2, y: (h - s) / 2, s: s }; }

  function search(src, w, h) {
    var all = detect(src, w, h, whole(w, h));
    tiles(w, h).forEach(function (t) { all = all.concat(detect(src, w, h, t)); });
    return merge(all, w, h);
  }

  /** Follows one person; frame numbers may run forwards or backwards. len is unknown (0) until first found. */
  function Tracker(at, len) { this.at = at; this.len = len || 0; this.vel = { x: 0, y: 0 }; this.last = null; this.misses = 0; }
  Tracker.prototype.expect = function (f) {
    var dt = this.last == null ? 0 : f - this.last;
    return { x: this.at.x + this.vel.x * dt, y: this.at.y + this.vel.y * dt };
  };
  Tracker.prototype.crop = function (f, w, h) {
    if (!this.len) { var s0 = 0.7 * Math.min(w, h); return { x: this.at.x - s0 / 2, y: this.at.y - s0 / 2, s: s0 }; }
    var c = around(this.expect(f), this.len);
    var g = Math.pow(1.5, Math.min(this.misses, 3));
    return { x: c.x - ((g - 1) * c.s) / 2, y: c.y - ((g - 1) * c.s) / 2, s: c.s * g };
  };
  /**
   * Picks the tracked person among poses (the nearest to where they should be), or null when none is near; after a
   * miss, only someone between 2/3 and 1.5 times their size. Before the first find, where they should be is the tap: the person picked is the one whose skeleton is nearest it, taken when
   * the tap is within half a length (about 0.4 stature) of it, or their hips within 0.35 of the picture's short side.
   */
  Tracker.prototype.update = function (f, poses, w, h) {
    var want = this.expect(f), best = null, bestD = Infinity, ok;
    if (this.len) {
      var len = this.len, misses = this.misses;
      // Once missed, the square grows or the whole picture is searched: someone else of another size (walking past
      // close to the phone, or a misreading of a close-up) can then be nearest. The athlete's own size changes little.
      poses.forEach(function (v) {
        var d = dist(hip(v, w, h), want), r = length(v, w, h) / len;
        if (misses && (r < 2 / 3 || r > 1.5)) return;
        if (d < bestD) { bestD = d; best = v; }
      });
      ok = best && bestD <= 1.2 * this.len * (1 + this.misses);
    } else {
      poses.forEach(function (v) { var d = reach(v, want, w, h); if (d < bestD) { bestD = d; best = v; } });
      ok = best && (bestD <= 0.5 * length(best, w, h) || dist(hip(best, w, h), want) <= 0.35 * Math.min(w, h));
    }
    if (!ok) { this.misses++; return null; }
    var at = hip(best, w, h), len = length(best, w, h);
    if (this.last != null && f !== this.last) {
      var dt = f - this.last, v = { x: (at.x - this.at.x) / dt, y: (at.y - this.at.y) / dt };
      this.vel = this.misses ? v : { x: 0.5 * this.vel.x + 0.5 * v.x, y: 0.5 * this.vel.y + 0.5 * v.y };
    }
    this.at = at;
    this.len = this.len ? 0.7 * this.len + 0.3 * len : len;
    this.last = f;
    this.misses = 0;
    return best;
  };

  var BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32], [7, 8]];
  /** Draws a pose; map() takes picture px to the canvas. */
  function draw(ctx, v, w, h, map, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    BONES.forEach(function (b) {
      var a = map(pt(v, b[0], w, h)), c = map(pt(v, b[1], w, h));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
    });
  }

  return { start: start, recover: recover, detect: detect, search: search, tiles: tiles, whole: whole, merge: merge, reach: reach, Tracker: Tracker, around: around, hip: hip, length: length, draw: draw };
})();
`;
