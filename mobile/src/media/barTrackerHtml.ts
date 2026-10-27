/**
 * The page that tracks a barbell plate through a video, run in a WebView: Expo Go has no native module that hands
 * JavaScript the pixels of a video frame, but a web page can draw the frame into a canvas and read it back.
 *
 * The athlete drags a circle over the plate on the first frame. That circle is both the scale (the plate is 45 cm
 * across) and the template: every later frame is searched near the predicted position for the patch that best
 * matches it (normalised cross-correlation inside the circle, so the background behind the plate doesn't count),
 * refined to a fraction of a pixel. The page posts the plate centre for every frame; the app does the rest.
 *
 * Messages to the app (`ReactNativeWebView.postMessage`, JSON):
 * - `{ type: 'ready', duration, width, height }` once the first frame is on screen;
 * - `{ type: 'progress', done }` while tracking, 0–1;
 * - `{ type: 'done', samples: [t, x, y, c][], diameter, lost }` with video-pixel positions and match quality;
 * - `{ type: 'error', message }`.
 * The app starts tracking with `window.startTrack()`.
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
  var circle = { x: 0, y: 0, r: 0 };   // video pixels
  var fit = { s: 1, ox: 0, oy: 0 };   // video → view canvas

  function post(m) {
    var s = JSON.stringify(m);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
    else if (window.onTrackerMessage) window.onTrackerMessage(m);
  }

  function seekTo(t) {
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (done) return; done = true; video.removeEventListener('seeked', finish); resolve(); }
      video.addEventListener('seeked', finish);
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
    var cx = fit.ox + circle.x * fit.s, cy = fit.oy + circle.y * fit.s, cr = circle.r * fit.s;
    var dpr = window.devicePixelRatio || 1;
    vctx.lineWidth = 3 * dpr; vctx.strokeStyle = CFG.accent;
    vctx.beginPath(); vctx.arc(cx, cy, cr, 0, Math.PI * 2); vctx.stroke();
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
      gesture = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y) || 1, r: circle.r };
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
    delete pointers[e.pointerId];
    startGesture();
    if (Object.keys(pointers).length === 0 && W) snap();
  }
  stage.addEventListener('pointerup', lift);
  stage.addEventListener('pointercancel', lift);

  function setRadius(r) {
    var m = Math.min(W, H);
    circle.r = Math.max(m * 0.03, Math.min(m * 0.5, r));
    size.value = String(circle.r / m);
  }
  size.addEventListener('input', function () { circle.r = Number(size.value) * Math.min(W, H); draw(); });
  size.addEventListener('change', function () { snap(); });
  seek.addEventListener('input', function () {
    startTime = Number(seek.value) * duration;
    seekTo(startTime).then(draw);
  });

  // ---- snapping the circle to the plate's rim ----
  // The scale is the plate's diameter, so a circle 3 % too big reads every speed 3 % too slow. Look around the
  // circle the athlete placed for the one whose edge has the strongest light/dark step across it all the way round.
  function snap() {
    var R0 = 60, k = R0 / circle.r, half = Math.ceil(R0 * 1.3), side = 2 * half + 1;
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
    function score(cx, cy, r) {
      var steps = [];
      for (var a = 0; a < ANGLES; a++) {
        var o = px(half + cx + (r + 1.5) * cos[a], half + cy + (r + 1.5) * sin[a]), i = px(half + cx + (r - 1.5) * cos[a], half + cy + (r - 1.5) * sin[a]);
        if (o != null && i != null) steps.push(Math.abs(o - i));
      }
      if (steps.length < ANGLES / 2) return 0;
      steps.sort(function (p, q) { return p - q; });
      // The 40th percentile: a rim that steps all the way round beats a bright logo on one side.
      return steps[Math.floor(steps.length * 0.4)];
    }
    var best = { s: score(0, 0, R0), x: 0, y: 0, r: R0 };
    function search(spanXY, stepXY, rLo, rHi, rStep) {
      var c = best;
      for (var dy = -spanXY; dy <= spanXY; dy += stepXY)
        for (var dx = -spanXY; dx <= spanXY; dx += stepXY)
          for (var r = rLo; r <= rHi; r += rStep) {
            var v = score(c.x + dx, c.y + dy, r);
            if (v > best.s) best = { s: v, x: c.x + dx, y: c.y + dy, r: r };
          }
    }
    search(8, 2, R0 * 0.88, R0 * 1.12, 1);
    search(2, 0.5, best.r - 1.5, best.r + 1.5, 0.25);
    circle = { x: circle.x + best.x / k, y: circle.y + best.y / k, r: best.r / k };
    size.value = String(circle.r / Math.min(W, H));
    draw();
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

  function buildTemplate(g) {
    var side = 2 * RP + 1, lim = (RP * MASK) * (RP * MASK), idx = [], sum = 0;
    for (var y = -RP; y <= RP; y++) for (var x = -RP; x <= RP; x++) if (x * x + y * y <= lim) idx.push([x, y]);
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

  function track() {
    var fileFps = CFG.fps > 0 ? CFG.fps : 30;
    step = RP / circle.r;
    var t0 = buildTemplate(grab(circle.x, circle.y, RP));
    maskIdx = t0.idx; tmpl = t0.vals; tnorm = t0.norm;
    if (!(tnorm > 1)) return Promise.resolve(post({ type: 'error', message: '圈里几乎是纯色，认不出杠铃片。把圈对准杠铃片再试。' }));
    var half = RP + SEARCH, x = circle.x, y = circle.y, vx = 0, vy = 0, lastT = null, unsure = 0, lost = false, samples = [];
    var span = Math.max(1e-3, duration - startTime);

    // One frame at media time t. Returns false once the plate is lost.
    function frame(t) {
      // Predict from the last two positions, per frame of the file, so a skipped frame doesn't throw it off.
      var gap = lastT == null ? 0 : Math.max(1, Math.round((t - lastT) * fileFps));
      var px = x + vx * gap, py = y + vy * gap;
      var g = grab(px, py, half), m = match(g, half);
      var nx = px + m.dx / step, ny = py + m.dy / step;
      samples.push([Math.round(t * 1e5) / 1e5, Math.round(nx * 100) / 100, Math.round(ny * 100) / 100, Math.round(m.score * 1000) / 1000]);
      if (m.score >= SURE && !m.edge) {
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

    function finish(ms) { post({ type: 'done', samples: samples, diameter: circle.r * 2, lost: lost, ms: ms }); }

    // Seek to every frame rather than play the video and grab frames as they show: during playback the picture
    // drawn can already be a frame ahead of the time reported for it, and a frame of error is 1/60 s on a rep.
    return bySeeking();

    async function bySeeking() {
      var began = Date.now(), rate = Math.min(fileFps, 120);
      // Sample mid-frame so a seek never lands on a frame boundary.
      for (var t = startTime + 0.5 / fileFps; t <= duration; t += 1 / rate) {
        await seekTo(t);
        if (!frame(t)) break;
      }
      finish(Date.now() - began);
    }
  }

  window.startTrack = function () {
    if (busy || !W) return;
    busy = true;
    document.getElementById('busy').style.display = 'block';
    document.getElementById('seekRow').style.visibility = 'hidden';
    document.getElementById('sizeRow').style.visibility = 'hidden';
    msg.textContent = '正在跟踪杠铃片…';
    track().catch(function (e) { post({ type: 'error', message: String(e && e.message || e) }); }).then(function () {
      busy = false;
      document.getElementById('busy').style.display = 'none';
      document.getElementById('seekRow').style.visibility = 'visible';
      document.getElementById('sizeRow').style.visibility = 'visible';
      msg.textContent = '';
      seekTo(startTime).then(draw);
    });
  };
  // For tests: place the circle directly, in video pixels.
  window.setCircle = function (x, y, r, snapIt) { circle = { x: x, y: y, r: r }; if (snapIt) snap(); draw(); return circle; };

  video.addEventListener('error', function () { post({ type: 'error', message: '视频打不开：' + (video.error && video.error.message || '格式不支持') }); });
  video.addEventListener('loadedmetadata', function () {
    W = video.videoWidth; H = video.videoHeight; duration = video.duration;
    circle = { x: W / 2, y: H / 2, r: Math.min(W, H) * 0.15 };
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
