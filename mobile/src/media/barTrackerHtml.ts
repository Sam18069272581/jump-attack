/**
 * The page that tracks a barbell plate through a video, run in a WebView: Expo Go has no native module that hands
 * JavaScript the pixels of a video frame, but a web page can draw the frame into a canvas and read it back.
 *
 * The athlete drags a circle over the plate on the first frame and it snaps to the plate's rim as an ellipse: a
 * plate filmed a little off square-on looks narrower than it is tall, and one off to the side of the picture leans.
 * Its height in the picture (the ellipse's chord straight down through its centre) is the 45 cm of up-and-down bar
 * travel, so that is the scale. The ellipse is also the template: every later frame is searched near the predicted position
 * for the patch that best matches it (normalised cross-correlation inside the ellipse, so the background behind the
 * plate doesn't count), refined to a fraction of a pixel. Each frame is stamped with its own media time where the
 * browser reports it (requestVideoFrameCallback), so a variable frame rate video keeps its real timing. The page
 * posts the plate centre for every frame; the app does the rest.
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
  // The scale is the plate's diameter, so a circle 3 % too big reads every speed 3 % too slow. Look around the
  // circle the athlete placed for the ring with the strongest light/dark step across it all the way round, then
  // fit an ellipse to the plate's outer edge around it: its width, height and tilt differ when the camera isn't
  // square on to the plate or the plate isn't in the middle of the picture.
  function snap() {
    var R0 = 60, k = R0 / Math.max(circle.rx, circle.ry), half = Math.ceil(R0 * 1.3), side = 2 * half + 1;
    var saved = step; step = k;
    var g = grab(circle.x, circle.y, half);
    step = saved;
    function px(x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      if (xi < 0 || yi < 0 || xi + 1 >= side || yi + 1 >= side) return null;
      var i = yi * side + xi;
      return g[i] * (1 - fx) * (1 - fy) + g[i + 1] * fx * (1 - fy) + g[i + side] * (1 - fx) * fy + g[i + side + 1] * fx * fy;
    }
    var ANGLES = 90, cos = [], sin = [];
    for (var a = 0; a < ANGLES; a++) { cos.push(Math.cos(2 * Math.PI * a / ANGLES)); sin.push(Math.sin(2 * Math.PI * a / ANGLES)); }
    // e: { x, y, rx, ry, tilt } with rx, ry the semi-axes before turning by tilt (radians, clockwise on screen).
    function score(e) {
      var steps = [], ct = Math.cos(e.tilt), st = Math.sin(e.tilt);
      for (var a = 0; a < ANGLES; a++) {
        // Step 1.5 px out and in along the normal of the ellipse at this point.
        var ex = e.rx * cos[a], ey = e.ry * sin[a], nx = e.ry * cos[a], ny = e.rx * sin[a], nl = Math.hypot(nx, ny) || 1;
        nx = 1.5 * nx / nl; ny = 1.5 * ny / nl;
        var qx = ex * ct - ey * st, qy = ex * st + ey * ct, mx = nx * ct - ny * st, my = nx * st + ny * ct;
        var o = px(half + e.x + qx + mx, half + e.y + qy + my), i = px(half + e.x + qx - mx, half + e.y + qy - my);
        if (o != null && i != null) steps.push(Math.abs(o - i));
      }
      if (steps.length < ANGLES / 2) return 0;
      steps.sort(function (p, q) { return p - q; });
      // The 40th percentile: a rim that steps all the way round beats a bright logo on one side.
      return steps[Math.floor(steps.length * 0.4)];
    }
    function range(mid, span, st) { var out = []; for (var v = mid - span; v <= mid + span + 1e-9; v += st) out.push(v); return out; }
    var best = { x: 0, y: 0, rx: R0 * circle.rx / Math.max(circle.rx, circle.ry), ry: R0 * circle.ry / Math.max(circle.rx, circle.ry), tilt: 0 };
    best.s = score(best);
    // Tries every combination of the values given for each of x, y, rx, ry and tilt ('ry' for rx: a circle).
    function search(o) {
      var c = best;
      o.x.forEach(function (x) { o.x.forEach(function (y) { o.ry.forEach(function (ry) { o.rx.forEach(function (rx) { o.tilt.forEach(function (tilt) {
        var e = { x: c.x + x, y: c.y + y, rx: rx === 'ry' ? ry : rx, ry: ry, tilt: tilt };
        e.s = score(e);
        if (e.s > best.s) best = e;
      }); }); }); }); });
    }
    var DEG = Math.PI / 180;
    // As a circle: where the plate is and about how big. A circle put down by thumb is easily 15 % off.
    search({ x: range(0, 10, 2), ry: range(R0 * 1.025, R0 * 0.275, 1), rx: ['ry'], tilt: [0] });
    // That ring may be the inner side of the lighter lip many plates have round the edge, which can step more
    // clearly all the way round than the outside does against a busy background. So look along each of the rays
    // out from the centre for the plate's outer edge: the outermost place where the brightness steps at least
    // 40 % as sharply as anywhere on that ray, at the peak of that step.
    var c0 = best, pts = [];
    for (var a = 0; a < ANGLES; a++) {
      var lo = c0.ry * 0.85, hi = c0.ry * 1.25, prof = [];
      for (var r = lo - 1; r <= hi + 1 + 1e-9; r += 0.25) prof.push(px(half + c0.x + r * cos[a], half + c0.y + r * sin[a]));
      if (prof.some(function (v) { return v == null; })) continue;
      var grad = [], top = 0;
      for (var i = 4; i < prof.length - 4; i++) { var gv = Math.abs(prof[i + 4] - prof[i - 4]); grad.push(gv); if (gv > top) top = gv; }
      if (top < 4) continue;
      var j = grad.length - 1;
      while (j > 0 && grad[j] < 0.4 * top) j--;
      while (j > 0 && grad[j - 1] >= grad[j]) j--;
      var f = j > 0 && j < grad.length - 1 ? 0.5 * (grad[j - 1] - grad[j + 1]) / (grad[j - 1] - 2 * grad[j] + grad[j + 1] || 1) : 0;
      var re = lo + (j + Math.max(-0.5, Math.min(0.5, f))) * 0.25;
      pts.push([c0.x + re * cos[a], c0.y + re * sin[a]]);
    }
    // Fit the ellipse to those edge points, letting a few stray ones (a hand, a rack upright) go: each point's
    // misfit counts up to 2 px at most.
    function misfit(e) {
      var ct = Math.cos(e.tilt), st = Math.sin(e.tilt), m = (e.rx + e.ry) / 2, sum = 0;
      for (var i = 0; i < pts.length; i++) {
        var dx = pts[i][0] - e.x, dy = pts[i][1] - e.y, u = dx * ct + dy * st, v = -dx * st + dy * ct;
        var d = (Math.sqrt((u * u) / (e.rx * e.rx) + (v * v) / (e.ry * e.ry)) - 1) * m;
        sum += Math.min(d * d, 4);
      }
      return sum;
    }
    if (pts.length >= ANGLES / 2) {
      var fitE = { x: c0.x, y: c0.y, rx: c0.ry, ry: c0.ry, tilt: 0 };
      var ends = pts.map(function (p) { return Math.hypot(p[0] - c0.x, p[1] - c0.y); }).sort(function (p, q) { return p - q; });
      fitE.rx = fitE.ry = ends[ends.length >> 1];
      fitE.cost = misfit(fitE);
      function refine(o) {
        var c = fitE;
        o.x.forEach(function (x) { o.x.forEach(function (y) { o.ry.forEach(function (ry) { o.rx.forEach(function (rx) { o.tilt.forEach(function (tilt) {
          var e = { x: c.x + x, y: c.y + y, rx: c.rx * rx, ry: c.ry * ry, tilt: c.tilt + tilt };
          e.cost = misfit(e);
          if (e.cost < fitE.cost) fitE = e;
        }); }); }); }); });
      }
      refine({ x: range(0, 4, 1), ry: range(1, 0.05, 0.01), rx: [1], tilt: [0] });
      refine({ x: [0], ry: range(1, 0.03, 0.01), rx: range(0.94, 0.08, 0.02), tilt: range(0, 40 * DEG, 5 * DEG) });
      for (var pass = 0; pass < 3; pass++) refine({ x: range(0, 1, 0.25), ry: range(1, 0.008, 0.004), rx: range(1, 0.01, 0.005), tilt: range(0, 3 * DEG, 1.5 * DEG) });
      best = fitE;
    } else {
      // Too few clear edges to fit: settle for the ring, letting width, height and tilt differ.
      search({ x: [0], ry: range(best.ry, best.ry * 0.04, 1), rx: range(best.ry * 0.88, best.ry * 0.12, 1.5), tilt: range(0, 40 * DEG, 5 * DEG) });
      search({ x: range(0, 2, 0.5), ry: range(best.ry, 1.5, 0.25), rx: range(best.rx, 1.5, 0.5), tilt: range(best.tilt, 4 * DEG, 2 * DEG) });
    }
    circle = { x: circle.x + best.x / k, y: circle.y + best.y / k, rx: best.rx / k, ry: best.ry / k, tilt: best.tilt };
    size.value = String(circle.ry / Math.min(W, H));
    draw();
  }

  // The plate's height in the picture: the ellipse's chord straight down through its centre. Bar travel is up and
  // down, so this, not the long axis of a leaning ellipse, is how many pixels 45 cm of travel takes.
  function verticalDiameter(e) {
    var c = Math.cos(e.tilt || 0), s = Math.sin(e.tilt || 0);
    return 2 / Math.sqrt((c * c) / (e.ry * e.ry) + (s * s) / (e.rx * e.rx));
  }

  // ---- tracking ----
  var step = 1, maskIdx, tmpl, tnorm;

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

  function buildTemplate(g, ax, ay, tilt) {
    // ax, ay: the ellipse's semi-axes in processing pixels before turning by tilt; the longer one is RP.
    var side = 2 * RP + 1, idx = [], sum = 0, c = Math.cos(tilt), s = Math.sin(tilt);
    for (var y = -RP; y <= RP; y++) for (var x = -RP; x <= RP; x++) {
      var u = (x * c + y * s) / ax, v = (-x * s + y * c) / ay;
      if (u * u + v * v <= MASK * MASK) idx.push([x, y]);
    }
    var vals = new Float32Array(idx.length);
    for (var i = 0; i < idx.length; i++) { vals[i] = g[(idx[i][1] + RP) * side + idx[i][0] + RP]; sum += vals[i]; }
    var mean = sum / idx.length, ss = 0;
    for (i = 0; i < vals.length; i++) { vals[i] -= mean; ss += vals[i] * vals[i]; }
    return { idx: idx, vals: vals, norm: Math.sqrt(ss) };
  }

  function match(g, half) {
    // NCC of the template at every offset within ±SEARCH; returns the best offset, refined, and its score.
    var side = 2 * half + 1, span = 2 * SEARCH + 1, map = new Float32Array(span * span), best = -2, bx = 0, by = 0;
    var idx = maskIdx, vals = tmpl, cnt = idx.length;
    var offs = new Int32Array(cnt);
    for (var i = 0; i < cnt; i++) offs[i] = (idx[i][1] + half) * side + idx[i][0] + half;
    for (var oy = -SEARCH; oy <= SEARCH; oy++) {
      for (var ox = -SEARCH; ox <= SEARCH; ox++) {
        var base = oy * side + ox, a = 0, b = 0, c = 0;
        for (i = 0; i < cnt; i++) { var v = g[offs[i] + base]; a += vals[i] * v; b += v; c += v * v; }
        var varI = c - b * b / cnt, score = varI > 1e-6 ? a / (tnorm * Math.sqrt(varI)) : 0;
        map[(oy + SEARCH) * span + ox + SEARCH] = score;
        if (score > best) { best = score; bx = ox; by = oy; }
      }
    }
    function at(x, y) { return map[(y + SEARCH) * span + x + SEARCH]; }
    function vertex(l, m, r) { var den = l - 2 * m + r; return den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (l - r) / den)) : 0; }
    var fx = bx > -SEARCH && bx < SEARCH ? vertex(at(bx - 1, by), best, at(bx + 1, by)) : 0;
    var fy = by > -SEARCH && by < SEARCH ? vertex(at(bx, by - 1), best, at(bx, by + 1)) : 0;
    return { dx: bx + fx, dy: by + fy, score: best, edge: Math.abs(bx) === SEARCH || Math.abs(by) === SEARCH };
  }

  function blendTemplate(g, half, cx, cy) {
    // Let the template follow slow changes (light, a turning logo) from confident frames only.
    var side = 2 * half + 1, cnt = maskIdx.length, fresh = new Float32Array(cnt), sum = 0;
    for (var i = 0; i < cnt; i++) { fresh[i] = g[(maskIdx[i][1] + half + cy) * side + maskIdx[i][0] + half + cx]; sum += fresh[i]; }
    var mean = sum / cnt, fss = 0;
    for (i = 0; i < cnt; i++) { fresh[i] -= mean; fss += fresh[i] * fresh[i]; }
    var fn = Math.sqrt(fss) || 1, ss = 0;
    for (i = 0; i < cnt; i++) { tmpl[i] = 0.9 * (tmpl[i] / tnorm) + 0.1 * (fresh[i] / fn); ss += tmpl[i] * tmpl[i]; }
    tnorm = Math.sqrt(ss);
  }

  function track(fps) {
    var fileFps = fps > 0 ? fps : CFG.fps > 0 ? CFG.fps : 30;
    // The scale is fixed now: nothing that moves the circle from here on can change it.
    var major = Math.max(circle.rx, circle.ry), diameter = verticalDiameter(circle), axes = { rx: circle.rx, ry: circle.ry, tilt: circle.tilt || 0 };
    step = RP / major;
    var t0 = buildTemplate(grab(circle.x, circle.y, RP), circle.rx * step, circle.ry * step, circle.tilt || 0);
    maskIdx = t0.idx; tmpl = t0.vals; tnorm = t0.norm;
    if (!(tnorm > 1)) return Promise.resolve(post({ type: 'error', message: '圈里几乎是纯色，认不出杠铃片。把圈对准杠铃片再试。' }));
    var half = RP + SEARCH, x = circle.x, y = circle.y, vx = 0, vy = 0, lastT = null, unsure = 0, lost = false, samples = [], shownT = null;
    var span = Math.max(1e-3, duration - startTime);

    // One frame at media time t. Returns false once the plate is lost.
    function frame(t) {
      // Predict from the last two positions, per frame of the file, so a skipped frame doesn't throw it off.
      var gap = lastT == null ? 0 : Math.max(1, Math.round((t - lastT) * fileFps));
      var px = x + vx * gap, py = y + vy * gap;
      var g = grab(px, py, half), m = match(g, half);
      var nx = px + m.dx / step, ny = py + m.dy / step, ok = m.score >= SURE && !m.edge;
      // A match stuck at the edge of the search window is wherever the window ended, not the plate: say it's unsure.
      var c = ok ? m.score : Math.min(m.score, SURE - 0.01);
      samples.push([Math.round(t * 1e6) / 1e6, Math.round(nx * 100) / 100, Math.round(ny * 100) / 100, Math.round(c * 1000) / 1000]);
      if (ok) {
        if (lastT != null) { vx = (nx - x) / gap; vy = (ny - y) / gap; }
        x = nx; y = ny; lastT = t; unsure = 0;
        if (m.score > 0.8) blendTemplate(g, half, Math.round(m.dx), Math.round(m.dy));
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
