/**
 * The page that tracks a barbell plate through a video, run in a WebView: Expo Go has no native module that hands
 * JavaScript the pixels of a video frame, but a web page can draw the frame into a canvas and read it back.
 *
 * The athlete drags a circle over the plate on the first frame and it snaps to the plate's rim as an ellipse: a
 * plate filmed a little off square-on looks narrower than it is tall, and one off to the side of the picture leans.
 * Its height in the picture (the ellipse's chord straight down through its centre) is the 45 cm of up-and-down bar
 * travel, so that is the scale. The ellipse is also the template: every later frame is searched near the predicted position
 * for the patch that best matches it (normalised cross-correlation inside the ellipse, so the background behind the
 * plate doesn't count), refined to a fraction of a pixel. The template stays the first frame's plate, turned as far as
 * the plate has turned on the sleeve, so the tracked point can't wander over the set. Each frame is stamped with its
 * own media time where the browser reports it (requestVideoFrameCallback), so a variable frame rate video keeps its
 * real timing. The page posts the plate centre for every frame; the app does the rest.
 *
 * Messages to the app (`ReactNativeWebView.postMessage`, JSON):
 * - `{ type: 'ready', duration, width, height }` once the first frame is on screen;
 * - `{ type: 'progress', done }` while tracking, 0–1;
 * - `{ type: 'done', samples: [t, x, y, c][], diameter, axes: { rx, ry, tilt }, lost }` with video-pixel positions and
 *   match quality (below 0.5 for a frame the tracker didn't trust, including one whose best match was at the edge of
 *   the search window), and the plate's height in the picture as `diameter` (the ellipse's vertical chord), fixed when tracking starts;
 * - `{ type: 'error', message }`.
 * The app starts tracking with `window.startTrack(fps)`, fps being the file's frame rate if it is known by then.
 */
export type TrackerOptions = {
  /** Video URL relative to the page, or absolute. */
  video: string;
  /** Frame rate of the file, from the player; 0 when unknown. */
  fps: number;
  accent: string;
  bg: string;
  text: string;
  muted: string;
};

export function barTrackerHtml(o: TrackerOptions): string {
  const config = JSON.stringify(o);
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html, body { margin: 0; height: 100%; background: ${o.bg}; color: ${o.text}; font: 13px -apple-system, system-ui, sans-serif; overflow: hidden; -webkit-user-select: none; user-select: none; }
  #wrap { display: flex; flex-direction: column; height: 100%; }
  #stage { position: relative; flex: 1; min-height: 0; touch-action: none; }
  #view { position: absolute; inset: 0; width: 100%; height: 100%; }
  video { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .row { display: flex; align-items: center; gap: 10px; padding: 8px 4px 0; }
  .row label { color: ${o.muted}; width: 64px; flex: none; }
  input[type=range] { flex: 1; accent-color: ${o.accent}; height: 28px; }
  #busy { position: absolute; left: 12px; right: 12px; bottom: 12px; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.15); display: none; }
  #bar { height: 100%; width: 0; border-radius: 3px; background: ${o.accent}; }
  #msg { position: absolute; left: 0; right: 0; top: 10px; text-align: center; color: ${o.muted}; pointer-events: none; }
</style></head>
<body><div id="wrap">
  <div id="stage"><canvas id="view"></canvas><div id="msg">正在载入视频…</div><div id="busy"><div id="bar"></div></div></div>
  <div class="row" id="seekRow"><label>起始画面</label><input id="seek" type="range" min="0" max="1" step="0.001" value="0"></div>
  <div class="row" id="sizeRow"><label>圈的大小</label><input id="size" type="range" min="0.03" max="0.5" step="0.001" value="0.15"></div>
</div>
<video id="video" playsinline muted preload="auto"></video>
<script>
(function () {
  var CFG = ${config};
  var RP = 28;            // plate radius in processing pixels
  var SEARCH = 13;        // search ± this many processing pixels around the prediction
  var MASK = 0.92;        // share of the radius used for matching: leave out the background around the rim
  var HUB = 0.3;          // share of the radius that doesn't turn with the plate: the hub and the sleeve
  var TURN = Math.PI / 90; // a plate turning on the sleeve is looked for in steps of 2°
  var LOST_FRAMES = 8;    // this many unsure frames in a row and the plate is lost
  var SURE = 0.5;
  var FRAME_WAIT = 250;   // ms to wait for the browser to say which frame a seek showed

  var video = document.getElementById('video');
  var view = document.getElementById('view');
  var vctx = view.getContext('2d');
  var stage = document.getElementById('stage');
  var seek = document.getElementById('seek');
  var size = document.getElementById('size');
  var msg = document.getElementById('msg');
  var work = document.createElement('canvas');
  var wctx = work.getContext('2d', { willReadFrequently: true });

  var W = 0, H = 0, duration = 0, startTime = 0, busy = false;
  var circle = { x: 0, y: 0, rx: 0, ry: 0, tilt: 0 };   // ellipse in video pixels: centre, semi-axes, and the turn (rad) of the ry axis from vertical
  var fit = { s: 1, ox: 0, oy: 0 };   // video → view canvas

  function post(m) {
    var s = JSON.stringify(m);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
    else if (window.onTrackerMessage) window.onTrackerMessage(m);
  }

  // Resolves with the media time of the frame now showing as the browser reports it; null where it can't say, and
  // 'same' where it does report frames but no new one came, i.e. the seek showed the frame that was already up.
  var hasFrameTimes = typeof video.requestVideoFrameCallback === 'function', frameTimesSeen = 0, frameTimesMissed = 0;
  function seekTo(t) {
    return new Promise(function (resolve) {
      var seeked = false, frameAt = null, done = false;
      function finish() {
        if (done) return; done = true;
        video.removeEventListener('seeked', onSeeked);
        if (frameAt != null) frameTimesSeen++; else frameTimesMissed++;
        // A browser that never reports frames for seeks: stop waiting for it.
        if (frameTimesSeen === 0 && frameTimesMissed >= 3) hasFrameTimes = false;
        resolve(frameAt != null ? frameAt : hasFrameTimes && frameTimesSeen > 0 ? 'same' : null);
      }
      function onSeeked() { seeked = true; if (!hasFrameTimes || frameAt != null) finish(); else setTimeout(finish, FRAME_WAIT); }
      video.addEventListener('seeked', onSeeked);
      if (hasFrameTimes) video.requestVideoFrameCallback(function (now, meta) { frameAt = meta.mediaTime; if (seeked) finish(); });
      setTimeout(finish, 4000);
      video.currentTime = Math.max(0, Math.min(duration, t));
    });
  }

  // ---- set-up view: the frame, the circle, dragging and pinching ----
  function layout() {
    var dpr = window.devicePixelRatio || 1;
    var cw = stage.clientWidth, ch = stage.clientHeight;
    view.width = Math.round(cw * dpr); view.height = Math.round(ch * dpr);
    if (!W) return;
    var s = Math.min(cw / W, ch / H);
    fit = { s: s * dpr, ox: (cw - W * s) / 2 * dpr, oy: (ch - H * s) / 2 * dpr };
    draw();
  }

  function draw() {
    if (!W) return;
    vctx.fillStyle = '#000'; vctx.fillRect(0, 0, view.width, view.height);
    vctx.drawImage(video, 0, 0, W, H, fit.ox, fit.oy, W * fit.s, H * fit.s);
    if (busy) return;
    var cx = fit.ox + circle.x * fit.s, cy = fit.oy + circle.y * fit.s, crx = circle.rx * fit.s, cr = verticalDiameter(circle) / 2 * fit.s;
    var dpr = window.devicePixelRatio || 1;
    vctx.lineWidth = 3 * dpr; vctx.strokeStyle = CFG.accent;
    vctx.beginPath(); vctx.ellipse(cx, cy, crx, circle.ry * fit.s, circle.tilt || 0, 0, Math.PI * 2); vctx.stroke();
    vctx.lineWidth = 1.5 * dpr;
    vctx.beginPath(); vctx.moveTo(cx - 10 * dpr, cy); vctx.lineTo(cx + 10 * dpr, cy); vctx.moveTo(cx, cy - 10 * dpr); vctx.lineTo(cx, cy + 10 * dpr); vctx.stroke();
    // The top and bottom of the plate set the scale: mark them.
    vctx.beginPath(); vctx.moveTo(cx - 18 * dpr, cy - cr); vctx.lineTo(cx + 18 * dpr, cy - cr); vctx.moveTo(cx - 18 * dpr, cy + cr); vctx.lineTo(cx + 18 * dpr, cy + cr); vctx.stroke();
  }

  var pointers = {}, gesture = null;
  function toVideo(e) {
    var dpr = window.devicePixelRatio || 1, rect = view.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) * dpr - fit.ox) / fit.s, y: ((e.clientY - rect.top) * dpr - fit.oy) / fit.s };
  }
  function startGesture() {
    var ids = Object.keys(pointers);
    if (ids.length === 1) {
      var p = pointers[ids[0]];
      gesture = { kind: 'move', from: p, cx: circle.x, cy: circle.y };
    } else if (ids.length >= 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]];
      gesture = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y) || 1, r: circle.ry };
    }
  }
  stage.addEventListener('pointerdown', function (e) {
    if (busy || !W) return;
    stage.setPointerCapture(e.pointerId);
    pointers[e.pointerId] = toVideo(e); startGesture();
  });
  stage.addEventListener('pointermove', function (e) {
    if (!(e.pointerId in pointers) || !gesture) return;
    pointers[e.pointerId] = toVideo(e);
    var ids = Object.keys(pointers);
    if (gesture.kind === 'move' && ids.length === 1) {
      var p = pointers[ids[0]];
      circle.x = gesture.cx + p.x - gesture.from.x; circle.y = gesture.cy + p.y - gesture.from.y;
    } else if (gesture.kind === 'pinch' && ids.length >= 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]];
      setRadius(gesture.r * Math.hypot(a.x - b.x, a.y - b.y) / gesture.d);
    }
    draw();
  });
  function lift(e) {
    // Only a drag or pinch that started on the set-up view snaps: a tap while tracking must not move the scale.
    if (busy || !(e.pointerId in pointers)) { pointers = {}; gesture = null; return; }
    delete pointers[e.pointerId];
    startGesture();
    if (Object.keys(pointers).length === 0 && W) snap();
  }
  stage.addEventListener('pointerup', lift);
  stage.addEventListener('pointercancel', lift);

  function setRadius(r) {
    var m = Math.min(W, H);
    circle.rx = circle.ry = Math.max(m * 0.03, Math.min(m * 0.5, r));
    circle.tilt = 0;
    size.value = String(circle.ry / m);
  }
  size.addEventListener('input', function () { circle.rx = circle.ry = Number(size.value) * Math.min(W, H); circle.tilt = 0; draw(); });
  size.addEventListener('change', function () { snap(); });
  seek.addEventListener('input', function () {
    startTime = Number(seek.value) * duration;
    seekTo(startTime).then(draw);
  });

  // ---- snapping the circle to the plate's rim ----
  // The scale is the plate's diameter, so a circle 3 % too big reads every speed 3 % too slow. The patch round the
  // athlete's circle is read in colour, 100 processing pixels to its radius, and the rim found by rimFit (below).
  // When no ring stands out clearly the circle stays where the athlete put it, to be moved or resized by hand.
  function snap() {
    var R0 = 100, k = R0 / Math.max(circle.rx, circle.ry), half = Math.ceil(R0 * 1.6);
    var e = rimFit(grabColour(circle.x, circle.y, half, k), 2 * half + 1, half, R0 * circle.ry / Math.max(circle.rx, circle.ry));
    if (e) {
      circle = { x: circle.x + e.x / k, y: circle.y + e.y / k, rx: e.rx / k, ry: e.ry / k, tilt: e.tilt };
      size.value = String(circle.ry / Math.min(W, H));
    }
    draw();
  }

  // The plate's rim in a colour patch (ch: red, green, blue planes, side x side, centre at (half, half)) round a circle
  // of radius rU: { x, y, rx, ry, tilt } relative to the patch centre, or null.
  // A plate has several rings that step clearly in colour all the way round: the edge, the lighter lip many plates
  // have just inside it, a groove, sometimes a printed band further in. The rim is the outermost of them. Colour, not
  // brightness alone: a grey plate in front of a wall just as bright but of another colour still has an edge.
  // 1. Rays out from the centre of the athlete's circle, from 0.6 to 1.45 times its radius; on each, how sharply the
  //    colour steps (the mean over 2 px out against the 2 px in) every 1/4 px. The strongest closed line through
  //    those steps that moves at most 1 px from one ray to the next (dynamic programming, twice round so it
  //    closes) follows one of the rings, or partly one and partly another: fit an ellipse to it for a first outline.
  //    Done twice, the second time only from 0.72 to 1.3 times the radius, so that a printed band further in can't
  //    take the line.
  // 2. Line the rays up by that outline (1 where it crosses each ray): every ring of the plate is then at the same
  //    place on all rays, and how clearly it steps is the step 60 % of the rays reach there. The rim is the
  //    outermost ring that steps at least 15 % as clearly as the clearest and 3 times as clearly as the picture's
  //    noise (the median step). On each ray take the step nearest that ring, to a fraction of a sample, and fit an
  //    ellipse to those points, giving less weight to the ones off it (a hand, a rack upright behind the edge).
  //    Twice, then twice more only within 8 % of the ellipse, to settle it.
  // 3. Of the two results, the rim is the clear ring that encloses the other; when neither does, the clearer one.
  //    (An ellipse half on the edge and half on the lip lines up well with itself; the true edge encloses it.)
  function rimFit(ch, side, half, rU) {
    var cr = ch[0], cg = ch[1], cb = ch[2], col = [0, 0, 0];
    var RAYS = 120, DS = 0.25, BAND = 2, LO = 0.6, HI = 1.45, COARSE = 0.25;   // samples DS px apart (COARSE while choosing); BAND px each side of a step
    var cosA = new Float64Array(RAYS), sinA = new Float64Array(RAYS);
    for (var a = 0; a < RAYS; a++) { cosA[a] = Math.cos(2 * Math.PI * a / RAYS); sinA[a] = Math.sin(2 * Math.PI * a / RAYS); }
    // The colour at (x, y) relative to the patch centre, into col; false off the patch.
    function px(x, y) {
      x += half; y += half;
      var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      if (xi < 0 || yi < 0 || xi + 1 >= side || yi + 1 >= side) return false;
      var i = yi * side + xi, w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      col[0] = cr[i] * w00 + cr[i + 1] * w10 + cr[i + side] * w01 + cr[i + side + 1] * w11;
      col[1] = cg[i] * w00 + cg[i + 1] * w10 + cg[i + side] * w01 + cg[i + side + 1] * w11;
      col[2] = cb[i] * w00 + cb[i + 1] * w10 + cb[i + side] * w01 + cb[i + side + 1] * w11;
      return true;
    }
    // Step strength along the ray from (x, y) in direction (dx, dy) at radii r(j) = rho * (u0 + j * du), j < n, with
    // band w samples each side; 0 where the bands run off the patch.
    function steps(x, y, dx, dy, rho, u0, du, n, w) {
      var sr = new Float32Array(n + 1), sg = new Float32Array(n + 1), sb = new Float32Array(n + 1), len = n;
      for (var j = 0; j < n; j++) {
        var r = rho * (u0 + j * du);
        if (!px(x + r * dx, y + r * dy)) { len = j; break; }
        sr[j + 1] = sr[j] + col[0]; sg[j + 1] = sg[j] + col[1]; sb[j + 1] = sb[j] + col[2];
      }
      var s = new Float32Array(n);
      for (j = w; j < len - w; j++) {
        var er = (sr[j + w + 1] - sr[j + 1]) - (sr[j] - sr[j - w]);
        var eg = (sg[j + w + 1] - sg[j + 1]) - (sg[j] - sg[j - w]);
        var eb = (sb[j + w + 1] - sb[j + 1]) - (sb[j] - sb[j - w]);
        s[j] = Math.sqrt(er * er + eg * eg + eb * eb) / w;
      }
      return s;
    }
    function subSample(s, j) {
      if (j < 1 || j >= s.length - 1) return j;
      var l = s[j - 1], m = s[j], r = s[j + 1], den = l - 2 * m + r;
      return j + (den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (l - r) / den)) : 0);
    }
    // The q-quantile of typed array v (reordered in place): Hoare's selection, quicker than sorting it all.
    function quantile(v, q) {
      var k = Math.min(v.length - 1, Math.floor(v.length * q)), lo = 0, hi = v.length - 1;
      while (lo < hi) {
        var pivot = v[(lo + hi) >> 1], i = lo, j = hi;
        while (i <= j) {
          while (v[i] < pivot) i++;
          while (v[j] > pivot) j--;
          if (i <= j) { var t = v[i]; v[i] = v[j]; v[j] = t; i++; j--; }
        }
        if (k <= j) hi = j; else if (k >= i) lo = i; else break;
      }
      return v[k];
    }

    // 1. Where the plate is: the circle whose edge steps most clearly nearly all the way round (the step 60 % of 60
    //    rays reach, across 4 px), centre within 16 % of rU of the athlete's, radius 0.72 to 1.33 rU. A printed band
    //    or a hand only covers part of the way round.
    var NA = 60, plate = { s: -1, x: 0, y: 0 }, v60 = new Float32Array(NA), RLO = 0.72 * rU, NR = Math.round(0.61 * rU / 2) + 1, prof = [];
    var line = new Float32Array(3 * (NR + 5));
    for (var cx = -0.16 * rU; cx <= 0.16 * rU + 1e-9; cx += 0.04 * rU) {
      for (var cy = -0.16 * rU; cy <= 0.16 * rU + 1e-9; cy += 0.04 * rU) {
        for (a = 0; a < NA; a++) {
          // The colour every 2 px from RLO - 2 out; the step at RLO + 2 j is between samples j and j + 2 (4 px apart).
          var dx = cosA[2 * a], dy = sinA[2 * a], row = new Float32Array(NR), len = 0;
          for (var j = 0; j < NR + 2; j++, len++) {
            if (!px(cx + (RLO - 2 + 2 * j) * dx, cy + (RLO - 2 + 2 * j) * dy)) break;
            line[3 * j] = col[0]; line[3 * j + 1] = col[1]; line[3 * j + 2] = col[2];
          }
          for (j = 0; j + 2 < len; j++) {
            var R = line[3 * j + 6] - line[3 * j], G = line[3 * j + 7] - line[3 * j + 1], B = line[3 * j + 8] - line[3 * j + 2];
            row[j] = Math.sqrt(R * R + G * G + B * B);
          }
          prof[a] = row;
        }
        for (j = 1; j < NR - 1; j++) {
          for (a = 0; a < NA; a++) v60[a] = prof[a][j];
          var sc = quantile(v60, 0.4);
          if (sc > plate.s) plate = { s: sc, x: cx, y: cy };
        }
      }
    }
    if (!(plate.s > 0)) return null;
    // A first outline: from the centre of that circle, rays from 0.6 to 1.45 rU, and on each how sharply the colour
    // steps. The strongest closed line through those steps that moves at most 1 px from one ray to the next follows
    // one of the plate's rings (dynamic programming, twice round so that it closes): fit an ellipse to it. Done again
    // between 0.72 and 1.3 rU, in case a ring further in or out took the first.
    var NP = Math.round((HI - LO) * rU / COARSE) + 1, polar = [];
    for (a = 0; a < RAYS; a++) polar.push(steps(plate.x, plate.y, cosA[a], sinA[a], 1, LO * rU, COARSE, NP, BAND / COARSE));
    function firstOutline(lo, hi) {
      var j0 = Math.round((lo - LO) * rU / COARSE), NJ = Math.round((hi - lo) * rU / COARSE) + 1, D = Math.round(1 / COARSE), w = [], all = new Float32Array(RAYS * Math.ceil(NJ / 4)), na = 0;
      // Each ray's steps as shares of its strongest, so that a printed band on part of the plate can't outweigh the
      // rest of the circle.
      for (var a = 0; a < RAYS; a++) {
        var mx = 0, row = new Float32Array(NJ);
        for (var j = 0; j < NJ; j++) if (polar[a][j0 + j] > mx) mx = polar[a][j0 + j];
        for (j = 0; j < NJ; j++) { row[j] = mx > 0 ? polar[a][j0 + j] / mx : 0; if (!(j & 3)) all[na++] = row[j]; }
        w.push(row);
      }
      // Moving the line 1/4 px out or in costs 5 % of a typical clear step.
      var LAMBDA = 0.05 * COARSE / 0.25 * quantile(all.subarray(0, na), 0.9);
      var prev = new Float32Array(NJ), from = [];
      for (var t = 0; t < 2 * RAYS; t++) {
        var m = w[t % RAYS], cur = new Float32Array(NJ), back = new Int16Array(NJ);
        for (j = 0; j < NJ; j++) {
          var best = -1e9, bj = j;
          for (var d = -D; d <= D; d++) {
            var jj = j + d;
            if (jj < 0 || jj >= NJ) continue;
            var v = prev[jj] - LAMBDA * (d < 0 ? -d : d);
            if (v > best) { best = v; bj = jj; }
          }
          cur[j] = (t ? best : 0) + m[j]; back[j] = bj;
        }
        from.push(back); prev = cur;
      }
      var end = 0;
      for (j = 1; j < NJ; j++) if (prev[j] > prev[end]) end = j;
      var path = new Int16Array(2 * RAYS);
      for (t = 2 * RAYS - 1; t >= 0; t--) { path[t] = end; end = from[t][end]; }
      // The middle time round, where the line has had half a turn to settle either side.
      var pts = [];
      for (t = RAYS >> 1; t < RAYS + (RAYS >> 1); t++) {
        a = t % RAYS;
        var r = LO * rU + subSample(polar[a], j0 + path[t]) * COARSE;
        pts.push([plate.x + r * cosA[a], plate.y + r * sinA[a]]);
      }
      var q = fitConic(pts, true);
      return q && conicEllipse(q);
    }

    // 2. Rays lined up by ellipse e from u0 to u1 (shares of the way out to e): sample j is the same ring on every ray.
    function rays(e, u0, u1, ds) {
      var ct = Math.cos(e.tilt), st = Math.sin(e.tilt), out = [], mean = Math.sqrt(e.rx * e.ry);
      var n = Math.round((u1 - u0) * mean / ds) + 1, du = ds / mean;
      for (var a = 0; a < RAYS; a++) {
        var u = cosA[a] * ct + sinA[a] * st, v = -cosA[a] * st + sinA[a] * ct, rho = 1 / Math.sqrt((u * u) / (e.rx * e.rx) + (v * v) / (e.ry * e.ry));
        // Samples a fixed share of the ellipse apart, so 2 px is a few samples more or less where it is wide or narrow.
        out.push({ rho: rho, u0: u0, du: du, s: steps(e.x, e.y, cosA[a], sinA[a], rho, u0, du, n, Math.max(2, Math.round(BAND / ds * mean / rho))) });
      }
      out.ds = ds;
      return out;
    }
    // The noise: the median step anywhere on the rays.
    function noise(rs) {
      var n = rs[0].s.length, v = new Float32Array(RAYS * Math.ceil(n / 6)), m = 0;
      for (var a = 0; a < RAYS; a += 2) for (var j = 0; j < n; j += 3) v[m++] = rs[a].s[j];
      return quantile(v.subarray(0, m), 0.5);
    }
    // How clearly each ring steps (the step 60 % of the rays reach), as rs.ring; returns the index of the outermost
    // clear ring, or of the clearest when none is clear yet (the rays are lined up by an outline still far off).
    function outerRing(rs) {
      var n = rs[0].s.length, ring = new Float32Array(n), v = new Float32Array(RAYS), top = 0, topJ = -1, fl = noise(rs), K = Math.round(1 / rs.ds);
      for (var j = 0; j < n; j++) {
        for (var a = 0; a < RAYS; a++) v[a] = rs[a].s[j];
        ring[j] = quantile(v, 0.4);
        if (ring[j] > top && j >= K && j < n - K) { top = ring[j]; topJ = j; }
      }
      rs.ring = ring; rs.noise = fl;
      // Outermost first; a ring is a peak over 1 px either side.
      for (j = n - K - 1; j >= K; j--) {
        if (ring[j] < 0.15 * top || ring[j] < 3 * fl) continue;
        var peak = true;
        for (var m = 1; m <= K && peak; m++) peak = ring[j] >= ring[j - m] && ring[j] >= ring[j + m];
        if (peak) return j;
      }
      return topJ;
    }
    // On each ray, the step nearest sample j0 within tol px that is a local peak at least minS strong.
    function edgePoints(e, rs, j0, tol, minS) {
      var pts = [];
      for (var a = 0; a < RAYS; a++) {
        var q = rs[a], s = q.s, W = Math.round(tol / (q.du * q.rho)), bj = -1;
        for (var d = 0; d <= W && bj < 0; d++) {
          for (var sg = -1; sg <= 1 && bj < 0; sg += 2) {
            var j = j0 + sg * d;
            if (j < 2 || j > s.length - 3) continue;
            if (s[j] >= minS && s[j] >= s[j - 1] && s[j] >= s[j + 1] && s[j] >= s[j - 2] && s[j] >= s[j + 2]) bj = j;
          }
        }
        if (bj < 0) continue;
        var r = q.rho * (q.u0 + subSample(s, bj) * q.du);
        pts.push([e.x + r * cosA[a], e.y + r * sinA[a]]);
      }
      return pts;
    }
    var noiseAt = 0;
    function settle(e) {
      var ringS = 0;
      for (var pass = 0; pass < 4; pass++) {
        var m0 = Math.sqrt(e.rx * e.ry), rs, j0;
        if (pass < 2) {
          rs = rays(e, LO * rU / m0, HI * rU / m0, COARSE); j0 = outerRing(rs); noiseAt = rs.noise;
          if (j0 < 0) return pass ? e : null;
          ringS = rs.ring[j0];
        } else {
          rs = rays(e, 0.92, 1.08, DS); rs.noise = noise(rs); j0 = Math.round(0.08 * m0 / DS);
        }
        // A step counts at twice the noise, and while choosing the ring at 30 % of the ring's own step.
        var pts = edgePoints(e, rs, j0, 3, Math.max(2 * rs.noise, pass < 2 ? 0.3 * ringS : 0));
        if (pts.length < RAYS / 3) break;
        var q = fitConic(pts, true), f = q && conicEllipse(q);
        if (!f) break;
        e = f;
      }
      return e;
    }
    // How clearly ellipse e is a ring: the step that 60 % of the rays reach within 1 px of it.
    function clarity(e) {
      var m0 = Math.sqrt(e.rx * e.ry), rs = rays(e, 0.95, 1.05, DS), j0 = Math.round(0.05 * m0 / DS), W = Math.round(1 / DS), v = new Float32Array(RAYS);
      for (var a = 0; a < RAYS; a++) {
        var mx = 0;
        for (var j = j0 - W; j <= j0 + W; j++) if (rs[a].s[j] > mx) mx = rs[a].s[j];
        v[a] = mx;
      }
      return quantile(v, 0.4);
    }

    // 3. The outermost clear result.
    var found = [];
    [[LO, HI], [0.72, 1.3]].forEach(function (r) {
      var e0 = firstOutline(r[0], r[1]), e = e0 && settle(e0);
      if (e) found.push({ e: e, s: clarity(e), noise: noiseAt });
    });
    var top = 0;
    found.forEach(function (f) { if (f.s > top) top = f.s; });
    found = found.filter(function (f) { return f.s >= 0.15 * top && f.s >= 3 * f.noise; }).sort(function (p, q) { return q.s - p.s; });
    if (!found.length) return null;
    // Distance from the patch centre along ray a to ellipse e.
    function reach(e, a) {
      var ct = Math.cos(e.tilt), st = Math.sin(e.tilt), ox = -e.x, oy = -e.y;
      var ux = (ox * ct + oy * st) / e.rx, uy = (-ox * st + oy * ct) / e.ry, vx = (cosA[a] * ct + sinA[a] * st) / e.rx, vy = (-cosA[a] * st + sinA[a] * ct) / e.ry;
      var A = vx * vx + vy * vy, B = 2 * (ux * vx + uy * vy), C = ux * ux + uy * uy - 1;
      return (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A);
    }
    function encloses(p, q) {
      var n = 0;
      for (var a = 0; a < RAYS; a++) if (reach(p, a) >= reach(q, a) - 0.5) n++;
      return n >= 0.9 * RAYS && p.rx * p.ry > q.rx * q.ry;
    }
    var pick = found[0].e;
    for (var changed = true; changed; ) {
      changed = false;
      found.forEach(function (f) { if (f.e !== pick && encloses(f.e, pick)) { pick = f.e; changed = true; } });
    }
    return pick;
  }

  // Least-squares conic x^2 + b xy + c (y^2 - x^2) + d x + e y + f = 0 through points [x, y] (a + c = 1 keeps it
  // away from the all-zero answer and doesn't favour any direction); robust: refitted five times with each point
  // weighted by how far it lies from the last fit (Tukey's biweight at 3 robust SDs, at least 1 px), so that a few
  // points off the rim don't pull it. Returns { a, b, c, d, e, f } in the points' own coordinates, or null.
  function fitConic(pts, robust) {
    var n = pts.length, mx = 0, my = 0, sc = 0, i;
    for (i = 0; i < n; i++) { mx += pts[i][0]; my += pts[i][1]; }
    mx /= n; my /= n;
    for (i = 0; i < n; i++) sc += Math.hypot(pts[i][0] - mx, pts[i][1] - my);
    sc = sc / n || 1;
    var w = new Float64Array(n), res = new Float64Array(n), q = null;
    for (i = 0; i < n; i++) w[i] = 1;
    for (var it = 0; it < (robust ? 6 : 1); it++) {
      var A = [], B = [0, 0, 0, 0, 0], cI, cJ;
      for (cI = 0; cI < 5; cI++) A.push([0, 0, 0, 0, 0]);
      for (i = 0; i < n; i++) {
        if (!(w[i] > 0)) continue;
        var x = (pts[i][0] - mx) / sc, y = (pts[i][1] - my) / sc, row = [x * y, y * y - x * x, x, y, 1], t = -x * x;
        for (cI = 0; cI < 5; cI++) { B[cI] += w[i] * row[cI] * t; for (cJ = 0; cJ < 5; cJ++) A[cI][cJ] += w[i] * row[cI] * row[cJ]; }
      }
      var sol = solve5(A, B);
      if (!sol) return null;
      // Back to the points' own coordinates: put (x - mx) / sc for x and (y - my) / sc for y, times sc^2.
      var a2 = 1 - sol[1], b2 = sol[0], c2 = sol[1], d2 = sol[2] * sc, e2 = sol[3] * sc, f2 = sol[4] * sc * sc;
      q = {
        a: a2, b: b2, c: c2,
        d: d2 - 2 * a2 * mx - b2 * my, e: e2 - 2 * c2 * my - b2 * mx,
        f: a2 * mx * mx + b2 * mx * my + c2 * my * my - d2 * mx - e2 * my + f2,
      };
      if (!robust) break;
      for (i = 0; i < n; i++) res[i] = conicDistance(q, pts[i][0], pts[i][1]);
      var sorted = Float64Array.from(res).sort();
      var cut = 3 * Math.max(1 / 3, 1.4826 * sorted[n >> 1]);
      for (i = 0; i < n; i++) { var z = res[i] / cut; w[i] = z < 1 ? (1 - z * z) * (1 - z * z) : 0; }
    }
    return q;
  }
  // How far (x, y) is from the conic, to first order (Sampson distance).
  function conicDistance(q, x, y) {
    var val = q.a * x * x + q.b * x * y + q.c * y * y + q.d * x + q.e * y + q.f;
    var gx = 2 * q.a * x + q.b * y + q.d, gy = q.b * x + 2 * q.c * y + q.e;
    return Math.abs(val) / (Math.sqrt(gx * gx + gy * gy) || 1e-12);
  }
  // The conic as { x, y, rx, ry, tilt } (rx along the x axis turned by tilt, ry along the turned y axis,
  // |tilt| <= 45 degrees), or null if it isn't an ellipse.
  function conicEllipse(q) {
    var det = 4 * q.a * q.c - q.b * q.b;
    if (!(det > 0)) return null;
    var x0 = (q.b * q.e - 2 * q.c * q.d) / det, y0 = (q.b * q.d - 2 * q.a * q.e) / det;
    var F0 = q.a * x0 * x0 + q.b * x0 * y0 + q.c * y0 * y0 + q.d * x0 + q.e * y0 + q.f;
    var tilt = 0.5 * Math.atan2(q.b, q.a - q.c);
    while (tilt > Math.PI / 4) tilt -= Math.PI / 2;
    while (tilt <= -Math.PI / 4) tilt += Math.PI / 2;
    function lam(p) { var c = Math.cos(p), s = Math.sin(p); return q.a * c * c + q.b * s * c + q.c * s * s; }
    var lx = lam(tilt), ly = lam(tilt + Math.PI / 2);
    if (!(-F0 / lx > 0 && -F0 / ly > 0)) return null;
    return { x: x0, y: y0, rx: Math.sqrt(-F0 / lx), ry: Math.sqrt(-F0 / ly), tilt: tilt };
  }
  // Solves the 5 x 5 system A s = B by Gaussian elimination with partial pivoting; null if it is singular.
  function solve5(A, B) {
    var n = 5, M = A.map(function (row, i) { return row.concat([B[i]]); });
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      var tmp = M[c]; M[c] = M[p]; M[p] = tmp;
      for (r = c + 1; r < n; r++) { var m = M[r][c] / M[c][c]; for (var j = c; j <= n; j++) M[r][j] -= m * M[c][j]; }
    }
    var s = new Array(n);
    for (r = n - 1; r >= 0; r--) { var v = M[r][n]; for (j = r + 1; j < n; j++) v -= M[r][j] * s[j]; s[r] = v / M[r][r]; }
    return s;
  }

  // The square of side 2·half+1 around (cx, cy) in video pixels, at k processing pixels per video pixel, as red,
  // green and blue planes.
  function grabColour(cx, cy, half, k) {
    var side = 2 * half + 1;
    // A canvas starts at 300 x 150: whatever is drawn past that is lost, and reads back as black.
    if (work.width < side || work.height < side) { work.width = Math.max(work.width, side); work.height = Math.max(work.height, side); }
    var sx = cx - (half + 0.5) / k, sy = cy - (half + 0.5) / k, sw = side / k, sh = side / k;
    wctx.fillStyle = '#000'; wctx.fillRect(0, 0, side, side);
    var x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(W, sx + sw), y1 = Math.min(H, sy + sh);
    if (x1 > x0 && y1 > y0) wctx.drawImage(video, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * k, (y0 - sy) * k, (x1 - x0) * k, (y1 - y0) * k);
    var d = wctx.getImageData(0, 0, side, side).data, r = new Float32Array(side * side), g = new Float32Array(side * side), b = new Float32Array(side * side);
    for (var i = 0, j = 0; i < r.length; i++, j += 4) { r[i] = d[j]; g[i] = d[j + 1]; b[i] = d[j + 2]; }
    return [r, g, b];
  }

  // The plate's height in the picture: the ellipse's chord straight down through its centre. Bar travel is up and
  // down, so this, not the long axis of a leaning ellipse, is how many pixels 45 cm of travel takes.
  function verticalDiameter(e) {
    var c = Math.cos(e.tilt || 0), s = Math.sin(e.tilt || 0);
    return 2 / Math.sqrt((c * c) / (e.ry * e.ry) + (s * s) / (e.rx * e.rx));
  }

  // ---- tracking ----
  var step = 1, plate;

  function grab(cx, cy, half) {
    // The square of side 2·half+1 processing pixels around (cx, cy) in video pixels, as grey levels.
    var side = 2 * half + 1, k = step;
    var sx = cx - (half + 0.5) / k, sy = cy - (half + 0.5) / k, sw = side / k, sh = side / k;
    wctx.fillStyle = '#000'; wctx.fillRect(0, 0, side, side);
    // Clip the source rectangle to the frame: Safari draws nothing for one that runs off the edge.
    var x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(W, sx + sw), y1 = Math.min(H, sy + sh);
    if (x1 > x0 && y1 > y0) wctx.drawImage(video, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * k, (y0 - sy) * k, (x1 - x0) * k, (y1 - y0) * k);
    var d = wctx.getImageData(0, 0, side, side).data, g = new Float32Array(side * side);
    for (var i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    return g;
  }

  // The plate as the first frame shows it, and where each pixel of the matching mask lies on the plate's face, so
  // the template can be redrawn turned: a plate turns a little on the sleeve during a rep (the bar rolls in the
  // hands), and a template that doesn't turn with it slides its best match towards the logo, a few pixels over a
  // rep and more the further the bar travels. Turning a fixed first-frame template, rather than letting the template
  // drift with the picture, keeps the tracked point the same point of the plate all set long.
  function setUpPlate(cx, cy, ax, ay, tilt) {
    // ax, ay: the ellipse's semi-axes in processing pixels before turning by tilt; the longer one is RP.
    var pad = Math.ceil(RP * 0.1) + 2, refHalf = RP + pad, ref = grab(cx, cy, refHalf);
    var c = Math.cos(tilt), s = Math.sin(tilt), mx = [], my = [], pu = [], pv = [], turns = [];
    for (var y = -RP; y <= RP; y++) for (var x = -RP; x <= RP; x++) {
      var u = (x * c + y * s) / ax, v = (-x * s + y * c) / ay;
      if (u * u + v * v > MASK * MASK) continue;
      mx.push(x); my.push(y); pu.push(u); pv.push(v);
      // The hub and the sleeve sticking out of it look the same however the plate turns: leave them as they are.
      turns.push(u * u + v * v >= HUB * HUB);
    }
    plate = { ref: ref, refHalf: refHalf, mx: mx, my: my, pu: pu, pv: pv, turns: turns, ax: ax, ay: ay, c: c, s: s, cnt: mx.length };
  }

  function templateAt(turn) {
    // The first-frame plate turned by turn (radians) about its centre, sampled at the mask's pixels; zero mean.
    var P = plate, side = 2 * P.refHalf + 1, cnt = P.cnt, vals = new Float32Array(cnt), sum = 0;
    var cr = Math.cos(turn), sr = Math.sin(turn);
    for (var i = 0; i < cnt; i++) {
      var qx = P.mx[i], qy = P.my[i];
      if (P.turns[i]) {
        // Turn on the plate's face (a circle there), then back into the picture through the ellipse.
        var u = P.pu[i] * cr - P.pv[i] * sr, v = P.pu[i] * sr + P.pv[i] * cr;
        qx = u * P.ax * P.c - v * P.ay * P.s; qy = u * P.ax * P.s + v * P.ay * P.c;
      }
      var fx = qx + P.refHalf, fy = qy + P.refHalf, xi = Math.floor(fx), yi = Math.floor(fy), ax = fx - xi, ay = fy - yi, j = yi * side + xi;
      vals[i] = P.ref[j] * (1 - ax) * (1 - ay) + P.ref[j + 1] * ax * (1 - ay) + P.ref[j + side] * (1 - ax) * ay + P.ref[j + side + 1] * ax * ay;
      sum += vals[i];
    }
    var mean = sum / cnt, ss = 0;
    for (i = 0; i < cnt; i++) { vals[i] -= mean; ss += vals[i] * vals[i]; }
    return { vals: vals, norm: Math.sqrt(ss), turn: turn };
  }

  function ncc(g, half, offs, tm, ox, oy) {
    // Normalised cross-correlation of template tm with the window g, the template's centre ox, oy from the window's.
    var side = 2 * half + 1, base = oy * side + ox, vals = tm.vals, cnt = offs.length, a = 0, b = 0, c = 0;
    for (var i = 0; i < cnt; i++) { var v = g[offs[i] + base]; a += vals[i] * v; b += v; c += v * v; }
    var varI = c - b * b / cnt;
    return varI > 1e-6 ? a / (tm.norm * Math.sqrt(varI)) : 0;
  }

  function match(g, half, tm) {
    // The best offset of the plate within ±SEARCH, starting with template tm; then whether the plate has turned a
    // little since (the template turned a step either way fitting better, near that offset), and the offset to a
    // fraction of a pixel. Returns the template it ended with.
    var side = 2 * half + 1, best = -2, bx = 0, by = 0;
    var P = plate, cnt = P.cnt, offs = new Int32Array(cnt);
    for (var i = 0; i < cnt; i++) offs[i] = (P.my[i] + half) * side + P.mx[i] + half;
    for (var oy = -SEARCH; oy <= SEARCH; oy++) {
      for (var ox = -SEARCH; ox <= SEARCH; ox++) {
        var score = ncc(g, half, offs, tm, ox, oy);
        if (score > best) { best = score; bx = ox; by = oy; }
      }
    }
    var edge = Math.abs(bx) === SEARCH || Math.abs(by) === SEARCH;
    if (edge) return { dx: bx, dy: by, score: best, edge: true, tm: tm };
    for (var tries = 0; tries < 2; tries++) {
      var better = null;
      for (var d = -1; d <= 1; d += 2) {
        var tt = templateAt(tm.turn + d * TURN);
        for (oy = by - 1; oy <= by + 1; oy++) for (ox = bx - 1; ox <= bx + 1; ox++) {
          if (Math.abs(ox) > SEARCH || Math.abs(oy) > SEARCH) continue;
          score = ncc(g, half, offs, tt, ox, oy);
          if (score > best && (!better || score > better.score)) better = { tm: tt, score: score, x: ox, y: oy };
        }
      }
      if (!better) break;
      tm = better.tm; best = better.score; bx = better.x; by = better.y;
      if (Math.abs(bx) === SEARCH || Math.abs(by) === SEARCH) return { dx: bx, dy: by, score: best, edge: true, tm: tm };
    }
    function vertex(l, m, r) { var den = l - 2 * m + r; return den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (l - r) / den)) : 0; }
    var fx = vertex(ncc(g, half, offs, tm, bx - 1, by), best, ncc(g, half, offs, tm, bx + 1, by));
    var fy = vertex(ncc(g, half, offs, tm, bx, by - 1), best, ncc(g, half, offs, tm, bx, by + 1));
    return { dx: bx + fx, dy: by + fy, score: best, edge: false, tm: tm };
  }

  function track(fps) {
    var fileFps = fps > 0 ? fps : CFG.fps > 0 ? CFG.fps : 30;
    // The scale is fixed now: nothing that moves the circle from here on can change it.
    var major = Math.max(circle.rx, circle.ry), diameter = verticalDiameter(circle), axes = { rx: circle.rx, ry: circle.ry, tilt: circle.tilt || 0 };
    step = RP / major;
    setUpPlate(circle.x, circle.y, circle.rx * step, circle.ry * step, circle.tilt || 0);
    var tm = templateAt(0);
    if (!(tm.norm > 1)) return Promise.resolve(post({ type: 'error', message: '圈里几乎是纯色，认不出杠铃片。把圈对准杠铃片再试。' }));
    var half = RP + SEARCH, x = circle.x, y = circle.y, vx = 0, vy = 0, lastT = null, unsure = 0, lost = false, samples = [], shownT = null;
    // Where the plate was last seen, sure or not: where it stopped when it stopped faster than predicted.
    var seenX = x, seenY = y;
    var span = Math.max(1e-3, duration - startTime);

    // The plate's best match in the window around (px, py), video pixels.
    function look(px, py) {
      var m = match(grab(px, py, half), half, tm);
      m.x = px + m.dx / step; m.y = py + m.dy / step;
      return m;
    }

    // One frame at media time t. Returns false once the plate is lost.
    function frame(t) {
      // Predict from the last two sure positions, in seconds: a variable frame rate video's frames aren't evenly
      // spaced, and its reported frame rate can be well off the rate it was filmed at.
      var dt = lastT == null ? 0 : t - lastT;
      var px = x + vx * dt, py = y + vy * dt;
      var m = look(px, py);
      // Best at the edge of the window: the plate may be just beyond it (it sped up or braked harder than
      // predicted). Look again around there.
      if (m.edge) { var m2 = look(m.x, m.y); if (m2.score > m.score || !m2.edge) m = m2; }
      // Still unsure: the bar may have stopped dead (a fast rep locking out) while the prediction ran on. Look
      // where the plate was last seen too, and keep the better of the two.
      if ((m.edge || m.score < SURE) && Math.hypot(px - seenX, py - seenY) * step > 1) {
        m2 = look(seenX, seenY);
        if (m2.score > m.score && !m2.edge || m.edge && !m2.edge) m = m2;
      }
      var nx = m.x, ny = m.y, ok = m.score >= SURE && !m.edge;
      // A match stuck at the edge of the search window is wherever the window ended, not the plate: say it's unsure.
      var c = ok ? m.score : Math.min(m.score, SURE - 0.01);
      samples.push([Math.round(t * 1e6) / 1e6, Math.round(nx * 100) / 100, Math.round(ny * 100) / 100, Math.round(c * 1000) / 1000]);
      if (!m.edge) { seenX = nx; seenY = ny; }
      if (ok) {
        if (lastT != null && dt > 0) { vx = (nx - x) / dt; vy = (ny - y) / dt; }
        x = nx; y = ny; lastT = t; unsure = 0; tm = m.tm;
      } else if (++unsure >= LOST_FRAMES) { lost = true; return false; }
      if (samples.length % 10 === 0) {
        var done = Math.min(1, (t - startTime) / span);
        document.getElementById('bar').style.width = (100 * done) + '%';
        post({ type: 'progress', done: done });
      }
      if (samples.length % 30 === 0) draw();
      return true;
    }

    function finish(ms) { post({ type: 'done', samples: samples, diameter: diameter, axes: axes, lost: lost, ms: ms }); }

    // Seek to every frame rather than play the video and grab frames as they show: during playback the picture
    // drawn can already be a frame ahead of the time reported for it, and a frame of error is 1/60 s on a rep.
    return bySeeking();

    async function bySeeking() {
      var began = Date.now(), rate = Math.min(fileFps, 120), f0 = Math.round(startTime * fileFps);
      // Seek to the middle of each frame on the file's frame grid, so a seek never lands on a boundary between two.
      for (var n = 0; ; n++) {
        var want = (f0 + 0.5 + n * fileFps / rate) / fileFps;
        if (want > duration) break;
        var shown = await seekTo(want);
        // The frame's own time where the browser reports it; the same frame twice (a variable frame rate video
        // holding a frame) is one sample.
        if (shown === 'same') continue;
        var t = shown != null ? shown : want;
        if (shownT != null && Math.abs(t - shownT) < 1e-6) continue;
        shownT = t;
        if (!frame(t)) break;
      }
      finish(Date.now() - began);
    }
  }

  window.startTrack = function (fps) {
    if (busy || !W) return post({ type: 'error', message: busy ? '已经在分析了。' : '视频还没载入好，稍等再试。' });
    busy = true;
    document.getElementById('busy').style.display = 'block';
    document.getElementById('seekRow').style.visibility = 'hidden';
    document.getElementById('sizeRow').style.visibility = 'hidden';
    msg.textContent = '正在跟踪杠铃片…';
    track(fps).catch(function (e) { post({ type: 'error', message: String(e && e.message || e) }); }).then(function () {
      busy = false;
      document.getElementById('busy').style.display = 'none';
      document.getElementById('seekRow').style.visibility = 'visible';
      document.getElementById('sizeRow').style.visibility = 'visible';
      msg.textContent = '';
      seekTo(startTime).then(draw);
    });
  };
  // For tests: place the circle directly, in video pixels.
  window.setCircle = function (x, y, r, snapIt) { circle = { x: x, y: y, rx: r, ry: r, tilt: 0 }; if (snapIt) snap(); draw(); return { x: circle.x, y: circle.y, r: verticalDiameter(circle) / 2, rx: circle.rx, ry: circle.ry, tilt: circle.tilt }; };

  video.addEventListener('error', function () { post({ type: 'error', message: '视频打不开：' + (video.error && video.error.message || '格式不支持') }); });
  video.addEventListener('loadedmetadata', function () {
    W = video.videoWidth; H = video.videoHeight; duration = video.duration;
    circle = { x: W / 2, y: H / 2, rx: Math.min(W, H) * 0.15, ry: Math.min(W, H) * 0.15, tilt: 0 };
    seekTo(Math.min(0.05, duration / 2)).then(function () {
      try { grab(circle.x, circle.y, 2); } catch (e) {
        // A file:// video can count as another origin and lock the canvas. Loaded as a blob it is this page's own.
        if (!viaBlob) return reloadAsBlob(e);
        return post({ type: 'error', message: '读不到视频画面（' + e.name + '）' });
      }
      msg.textContent = '';
      layout();
      post({ type: 'ready', duration: duration, width: W, height: H });
    });
  });
  var viaBlob = false;
  function reloadAsBlob(why) {
    viaBlob = true;
    // A canvas that has drawn another origin's frame stays unreadable for good: start a fresh one.
    work = document.createElement('canvas');
    wctx = work.getContext('2d', { willReadFrequently: true });
    var xhr = new XMLHttpRequest();
    xhr.open('GET', CFG.video);
    xhr.responseType = 'blob';
    xhr.onload = function () { video.src = URL.createObjectURL(xhr.response); video.load(); };
    xhr.onerror = function () { post({ type: 'error', message: '读不到视频画面（' + why.name + '）' }); };
    xhr.send();
  }
  window.addEventListener('resize', layout);
  video.src = CFG.video;
  video.load();
})();
</script></body></html>`;
}
