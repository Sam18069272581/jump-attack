import { localizeHtml } from '@/i18n';

/**
 * The replay and export page, run in a WebView like the frame reader (media/frameGrabberHtml.ts): Expo Go has no
 * native module that composes video, but a web page can draw each frame into a canvas with the numbers on top and
 * record the canvas with MediaRecorder.
 *
 * The picture is portrait, 720 × 1280, for sharing: the clip in slow motion fills it, with the app's name as a
 * watermark and what is happening now at the top, the height climbing while the athlete is in the air, and along the
 * bottom either one jump's estimated force by phase (domain/forceCurve.ts, when the whole body was in the picture) or
 * the jump curve (centre-of-mass height, domain/jumpAnalysis.flightCurve) with the set's numbers and every jump. The
 * bottom 150 px stay clear for the captions of the apps it is posted to. The page computes nothing about the jumps:
 * every number and label comes in the config.
 *
 * Messages to the app (`ReactNativeWebView.postMessage`, JSON):
 * - `{ type: 'ready' }` once the clip has loaded and the first frame is drawn;
 * - `{ type: 'progress', done, total }` while exporting;
 * - `{ type: 'file', mime, part, parts, data }`: the recorded video, base64, in parts;
 * - `{ type: 'unsupported' }` when this WebView can't record a canvas;
 * - `{ type: 'error', message }`.
 * The app calls `window.replay.play()` to replay, `window.replay.show(frame)` to stop on one file frame, and
 * `window.replay.exportVideo()` to record and send the video.
 */
export type ReplayJump = { takeoff: number; landing: number; touchdown?: number; counted: boolean; label: string; detail: string };

/**
 * One jump's estimated ground force (domain/forceCurve.ts), in the clip's file frames, with its labels: drawn as the
 * curve along the bottom, and naming the phase on screen while that jump is shown.
 */
export type ReplayForce = {
  /** File frame of each estimate, and the force there, × body weight. */
  frames: number[];
  values: number[];
  /** Top of the curve's scale, × body weight. */
  top: number;
  peak: { frame: number; label: string };
  phases: { label: string; from: number; to: number; time: string; tone: 'ecc' | 'con' | 'air' }[];
  title: string;
  summary: string;
};

export type ReplayConfig = {
  /** Video URL relative to the page, or absolute. */
  video: string;
  fileFps: number;
  /** Real-time frames per second, for times on screen (240 for a slow-motion clip the file plays at 30). */
  captureFps: number;
  /** The part of the clip to show, in file frames. */
  from: number;
  to: number;
  /** File frames per output frame: 2 at 240 fps shown at 30 fps is quarter speed. */
  stride: number;
  outFps: number;
  /** Centre-of-mass height (cm) for every file frame from `from` to `to`. */
  curve: number[];
  jumps: ReplayJump[];
  /** The athlete, in video pixels: the picture is cropped around them, never cutting them off. */
  focus?: { x: number; y: number; w: number; h: number };
  title: string;
  headline: { label: string; value: string; unit: string };
  stats: { label: string; value: string }[];
  /** Under the headline: how far to trust it. */
  note: string;
  date: string;
  brand: string;
  speed: string;
  colors: { ink: string; paper: string; card: string; accent: string; rim: string; muted: string; touch: string };
  force?: ReplayForce;
};

export function replayHtml(c: ReplayConfig): string {
  // `<` can't close the script it sits in once escaped.
  const config = JSON.stringify(c).replace(/</g, '\\u003c');
  return localizeHtml(`<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html, body { margin: 0; height: 100%; background: ${c.colors.paper}; overflow: hidden; }
  #out { position: absolute; inset: 0; margin: auto; max-width: 100%; max-height: 100%; aspect-ratio: 9 / 16; display: block; }
</style></head>
<body>
<canvas id="out" width="720" height="1280"></canvas>
<video id="video" playsinline muted preload="auto" style="position:absolute;width:1px;height:1px;opacity:0"></video>
<script>
(function () {
  var C = ${config};
  var K = C.colors;
  var W = 720, H = 1280;
  var NUM = '"Avenir Next Condensed","HelveticaNeue-CondensedBold","Arial Narrow",sans-serif';
  var CJK = '-apple-system,"PingFang SC","Noto Sans CJK SC",sans-serif';
  var video = document.getElementById('video');
  var out = document.getElementById('out');
  var g = out.getContext('2d');
  var duration = 0, busy = false, stopAsked = false;

  function post(m) {
    var s = JSON.stringify(m);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
    else if (window.onReplayMessage) window.onReplayMessage(m);
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
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function rr(x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function text(s, x, y, font, color, align) { g.font = font; g.fillStyle = color; g.textAlign = align || 'left'; g.fillText(s, x, y); }

  // Which jump a frame belongs to and what is happening in it.
  function stateAt(f) {
    for (var i = 0; i < C.jumps.length; i++) {
      var j = C.jumps[i];
      if (f >= j.takeoff && f < j.landing) return { phase: '腾空', i: i, color: K.rim };
      if (j.touchdown != null && f >= j.touchdown && f < j.takeoff) return { phase: '触地', i: i, color: K.touch };
      var prev = C.jumps[i - 1];
      if (prev && f >= prev.landing && f < j.takeoff && j.takeoff - prev.landing < C.captureFps) return { phase: '触地', i: i, color: K.touch };
    }
    return { phase: f < C.jumps[0].takeoff ? '准备' : '落地', i: -1, color: K.muted };
  }
  // The jump that landed most recently, and how many frames ago.
  function landedAt(f) {
    for (var i = C.jumps.length - 1; i >= 0; i--) if (f >= C.jumps[i].landing) return { i: i, ago: f - C.jumps[i].landing };
    return null;
  }

  // The whole picture is the clip; the numbers sit over dark bands at the top and bottom. Nothing to read goes in the
  // bottom 150 px, where the apps people post to put their captions and buttons.
  var SAFE = H - 150;
  var LEFT = 36, RIGHT = W - 36;
  var ATHLETE_TOP = 290, ATHLETE_BOTTOM = 770;

  // A colour mixed towards white, for lines and labels over the dark bands.
  function tint(hex, k) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, gg = (n >> 8) & 255, b = n & 255;
    function m(c) { return Math.round(c + (255 - c) * k); }
    return 'rgb(' + m(r) + ',' + m(gg) + ',' + m(b) + ')';
  }
  var TONE = { ecc: K.touch, con: K.accent, air: K.rim };
  var LIGHT = { ecc: tint(K.touch, 0.45), con: tint(K.accent, 0.5), air: tint(K.rim, 0.4) };
  var WHITE = '#FFFFFF', SOFT = 'rgba(255,255,255,0.75)', FAINT = 'rgba(255,255,255,0.5)';

  // What is happening in a frame: the force curve's phases for the jump it covers, otherwise in the air or not.
  function phaseAt(f) {
    var P = C.force && C.force.phases;
    if (P && f >= P[0].from - C.captureFps && f < P[P.length - 1].to) {
      if (f < P[0].from) return { phase: '准备', color: 'rgba(23,19,14,0.6)' };
      for (var i = 0; i < P.length; i++) if (f < P[i].to) return { phase: P[i].label, color: TONE[P[i].tone] };
    }
    return stateAt(f);
  }

  function clip() {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    // The athlete goes between the phase label and the numbers along the bottom (ATHLETE_TOP to ATHLETE_BOTTOM), so
    // nothing is drawn over them: the clip as large as fills the picture, smaller if they wouldn't fit there, but always
    // as wide as the picture, centred on them. Lifting them clear of the bottom can leave the bottom of the picture
    // empty, under the dark band.
    var F = C.focus || { x: 0, y: 0, w: vw, h: vh };
    var s = Math.max(W / vw, Math.min(Math.max(W / vw, H / vh), (ATHLETE_BOTTOM - ATHLETE_TOP) / F.h)), dw = vw * s, dh = vh * s;
    var cx = (F.x + F.w / 2) * s, cy = (F.y + F.h / 2) * s;
    var dx = dw <= W ? (W - dw) / 2 : Math.min(0, Math.max(W - dw, W / 2 - cx));
    var dy = Math.min(0, (ATHLETE_TOP + ATHLETE_BOTTOM) / 2 - cy);
    g.drawImage(video, dx, dy, dw, dh);
  }

  function band(y0, y1, a0, a1) {
    var grd = g.createLinearGradient(0, y0, 0, y1);
    grd.addColorStop(0, 'rgba(10,10,14,' + a0 + ')'); grd.addColorStop(1, 'rgba(10,10,14,' + a1 + ')');
    g.fillStyle = grd; g.fillRect(0, y0, W, y1 - y0);
  }

  function pill(label, color, x, y) {
    g.font = '700 28px ' + CJK; var w = g.measureText(label).width + 40;
    rr(x, y, w, 52, 26); g.fillStyle = color; g.fill();
    text(label, x + 20, y + 37, '700 28px ' + CJK, WHITE);
    return w;
  }

  // The jump in the air now, or the last one landed: its height climbing in flight, its result once down.
  function bigNumber(f) {
    var air = -1;
    for (var i = 0; i < C.jumps.length; i++) if (f >= C.jumps[i].takeoff && f < C.jumps[i].landing) air = i;
    var title, value, unit, detail, dim = false;
    if (air >= 0) {
      title = '离地'; value = (C.curve[f - C.from] || 0).toFixed(1); unit = 'cm'; detail = '';
    } else {
      var l = landedAt(f);
      if (!l) return;
      var j = C.jumps[l.i], parts = String(j.label).split(' ');
      title = '第 ' + (l.i + 1) + ' 跳'; value = parts[0]; unit = parts.slice(1).join(' '); detail = j.detail; dim = !j.counted;
    }
    // Above the athlete (ATHLETE_TOP), not over them.
    g.save(); g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 16;
    text(title + (detail ? ' · ' + detail : ''), RIGHT, 150, '700 22px ' + CJK, SOFT, 'right');
    g.font = '700 30px ' + CJK; var uw = unit ? g.measureText(unit).width + 10 : 0;
    text(value, RIGHT - uw, 266, '800 120px ' + NUM, dim ? FAINT : WHITE, 'right');
    if (unit) text(unit, RIGHT, 266, '700 30px ' + CJK, SOFT, 'right');
    g.restore();
  }

  // The estimated force along the bottom, by phase, lit up to now.
  function forcePanel(f) {
    var F = C.force, P = F.phases, x0 = F.frames[0], x1 = P[P.length - 1].to;
    var top = 820, h = 170, bottom = top + h;
    var px = function (ff) { return LEFT + ((ff - x0) / Math.max(1, x1 - x0)) * (RIGHT - LEFT); };
    var py = function (v) { return bottom - (Math.max(0, v) / F.top) * h; };
    text(F.title, LEFT, 800, '700 20px ' + CJK, SOFT);
    g.setLineDash([6, 6]); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(LEFT, py(1)); g.lineTo(RIGHT, py(1)); g.stroke(); g.setLineDash([]);
    text('1×', RIGHT, py(1) - 8, '700 18px ' + NUM, FAINT, 'right');
    var takeoff = P[P.length - 1].from;
    function toneAt(ff) { for (var i = 0; i < P.length; i++) if (ff < P[i].to) return ff >= P[i].from ? LIGHT[P[i].tone] : WHITE; return LIGHT.air; }
    function line(upto, ghost) {
      g.lineWidth = ghost ? 3 : 5; g.lineJoin = 'round'; g.lineCap = 'round';
      var prev = null, color = null;
      for (var i = 0; i < F.frames.length && F.frames[i] <= upto; i++) {
        var pt = { x: px(F.frames[i]), y: py(F.values[i]) }, c = ghost ? 'rgba(255,255,255,0.16)' : toneAt(F.frames[i]);
        if (prev) { g.strokeStyle = c; g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(pt.x, pt.y); g.stroke(); }
        prev = pt; color = c;
      }
      // In the air the feet push on nothing.
      if (upto > takeoff) {
        g.strokeStyle = ghost ? 'rgba(255,255,255,0.16)' : LIGHT.air; g.beginPath();
        g.moveTo(prev ? prev.x : px(takeoff), prev ? prev.y : py(0)); g.lineTo(px(takeoff), py(0)); g.lineTo(px(Math.min(upto, x1)), py(0)); g.stroke();
      }
      return prev;
    }
    line(x1, true);
    var now = line(Math.min(f, x1), false);
    if (f >= F.peak.frame) {
      var k = F.frames.indexOf(F.peak.frame), X = px(F.peak.frame), Y = py(F.values[k]);
      g.fillStyle = WHITE; g.beginPath(); g.arc(X, Y, 7, 0, 7); g.fill();
      text(F.peak.label, X + 14, Y + 4, '700 20px ' + CJK, WHITE, X > W - 200 ? 'right' : 'left');
    }
    if (now && f <= x1) {
      var cx = f > takeoff ? px(f) : now.x, cy = f > takeoff ? py(0) : now.y;
      g.fillStyle = WHITE; g.beginPath(); g.arc(cx, cy, 6, 0, 7); g.fill();
    }
    // Each phase under its stretch of the curve, and its time in a column of its own: a short phase's stretch is too
    // narrow to write under.
    var col = (RIGHT - LEFT) / 3;
    P.forEach(function (p, i) {
      var a = px(p.from), b = px(p.to), on = f >= p.from, x = LEFT + (i + 3 - P.length) * col;
      g.globalAlpha = on ? 1 : 0.3;
      rr(a + 2, 1004, Math.max(4, b - a - 4), 8, 4); g.fillStyle = LIGHT[p.tone]; g.fill();
      g.fillStyle = LIGHT[p.tone]; g.beginPath(); g.arc(x + 7, 1036, 7, 0, 7); g.fill();
      text(p.label, x + 22, 1044, '700 22px ' + CJK, LIGHT[p.tone]);
      g.globalAlpha = 1;
      if (f >= p.to) text(p.time, x, 1084, '800 34px ' + NUM, WHITE);
    });
    text(F.summary, LEFT, 1120, '400 18px ' + CJK, FAINT);
  }

  // Without a force curve: the centre of mass's flight curve, the set's numbers and every jump.
  function setPanel(f, st) {
    var top = 820, h = 130;
    text('起跳曲线 · 重心高度', LEFT, 800, '700 20px ' + CJK, SOFT);
    var peak = Math.max.apply(null, C.curve.concat([10]));
    var px = function (ff) { return LEFT + ((ff - C.from) / Math.max(1, C.to - C.from)) * (RIGHT - LEFT); };
    var py = function (hh) { return top + h - (hh / peak) * (h - 30); };
    g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.moveTo(px(C.from), py(0)); g.lineTo(px(C.to), py(0)); g.stroke();
    function trace(upto, color, width) {
      g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.beginPath();
      for (var ff = C.from; ff <= upto; ff++) { var x = px(ff), y = py(C.curve[ff - C.from]); if (ff === C.from) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    }
    trace(C.to, 'rgba(255,255,255,0.16)', 3);
    trace(Math.min(f, C.to), LIGHT.con, 4);
    C.jumps.forEach(function (j) {
      if (j.takeoff < C.from || j.landing > C.to) return;
      var mid = Math.round((j.takeoff + j.landing) / 2), top2 = C.curve[mid - C.from] || 0;
      if (f >= mid) text(String(j.label).replace(/ .*$/, ''), px(mid), py(top2) - 10, '800 22px ' + NUM, j.counted ? WHITE : FAINT, 'center');
    });
    g.fillStyle = WHITE; g.beginPath(); g.arc(px(Math.min(f, C.to)), py(C.curve[Math.min(f, C.to) - C.from] || 0), 6, 0, 7); g.fill();

    // The set's numbers.
    text(C.headline.label, LEFT, 986, '600 18px ' + CJK, FAINT);
    g.font = '800 60px ' + NUM; var hw = g.measureText(C.headline.value).width;
    text(C.headline.value, LEFT, 1044, '800 60px ' + NUM, WHITE);
    if (C.headline.unit) text(C.headline.unit, LEFT + hw + 8, 1044, '700 24px ' + CJK, SOFT);
    C.stats.slice(0, 3).forEach(function (s, i) {
      var x = 270 + i * 140;
      text(s.label, x, 986, '600 18px ' + CJK, FAINT);
      text(s.value, x, 1036, '800 34px ' + NUM, WHITE);
    });
    // Every jump, the one in the air highlighted.
    var n = C.jumps.length, cw = Math.min(110, (RIGHT - LEFT - (n - 1) * 8) / n);
    C.jumps.forEach(function (j, i) {
      var x = LEFT + i * (cw + 8), y = 1066;
      rr(x, y, cw, 56, 14); g.fillStyle = i === st.i ? K.accent : 'rgba(255,255,255,0.14)'; g.fill();
      text(String(j.label).replace(/ .*$/, ''), x + cw / 2, y + 38, '800 ' + (cw < 70 ? 20 : 26) + 'px ' + NUM, j.counted || i === st.i ? WHITE : FAINT, 'center');
    });
  }

  function draw(f) {
    clip();
    band(0, 300, 0.62, 0);
    band(620, 760, 0, 0.72);
    band(760, H, 0.72, 0.88);

    // Watermark and title.
    g.strokeStyle = K.rim; g.lineWidth = 5; g.beginPath(); g.arc(LEFT + 18, 66, 18, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(LEFT, 66); g.lineTo(LEFT + 36, 66); g.moveTo(LEFT + 18, 48); g.lineTo(LEFT + 18, 84); g.lineWidth = 2; g.stroke();
    text(C.brand, LEFT + 50, 80, 'italic 800 40px ' + NUM, WHITE);
    text(C.title, RIGHT, 60, '700 24px ' + CJK, WHITE, 'right');
    text(C.date + ' · ' + C.speed, RIGHT, 88, '400 18px ' + CJK, SOFT, 'right');

    var st = stateAt(f), ph = phaseAt(f);
    var pw = pill(ph.phase + (st.i >= 0 && C.jumps.length > 1 ? ' · 第 ' + (st.i + 1) + ' 跳' : ''), ph.color, LEFT, 124);
    text(((f - C.from) / C.captureFps).toFixed(3) + ' s', LEFT + pw + 16, 160, '700 26px ' + NUM, SOFT);
    bigNumber(f);

    if (C.note) text(C.note, RIGHT, 800, '400 16px ' + CJK, FAINT, 'right');
    if (C.force) forcePanel(f); else setPanel(f, st);
  }

  function frames() {
    var list = [];
    for (var f = C.from; f <= C.to; f += C.stride) list.push(f);
    if (list[list.length - 1] !== C.to) list.push(C.to);
    return list;
  }

  async function run(record) {
    var list = frames(), t0 = performance.now();
    for (var i = 0; i < list.length; i++) {
      if (stopAsked) return;
      await seekTo((list[i] + 0.5) / C.fileFps);
      draw(list[i]);
      if (record) post({ type: 'progress', done: i + 1, total: list.length });
      var due = t0 + ((i + 1) * 1000) / C.outFps - performance.now();
      if (due > 0) await wait(due);
    }
    // Hold the last frame a moment, so the numbers can be read.
    await wait(record ? 1500 : 800);
    return !stopAsked;
  }

  async function play() {
    if (busy) { stopAsked = true; while (busy) await wait(20); }
    stopAsked = false; busy = true;
    try { await run(false); } finally { busy = false; }
  }

  function pickType() {
    var types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    for (var i = 0; i < types.length; i++) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(types[i])) return types[i];
    return '';
  }

  async function exportVideo() {
    if (typeof MediaRecorder === 'undefined' || !out.captureStream) return post({ type: 'unsupported' });
    if (busy) { stopAsked = true; while (busy) await wait(20); }
    stopAsked = false; busy = true;
    try {
      var type = pickType();
      var stream = out.captureStream(C.outFps);
      var rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6000000 } : undefined);
      var parts = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) parts.push(e.data); };
      var stopped = new Promise(function (r) { rec.onstop = r; });
      draw(C.from);
      rec.start(500);
      var finished = await run(true);
      rec.stop();
      await stopped;
      // Stopped part-way (a replay or another export asked): what was recorded is not the video, so none of it goes out.
      if (!finished) return post({ type: 'cancelled' });
      var blob = new Blob(parts, { type: rec.mimeType || type || 'video/mp4' });
      var url = await new Promise(function (r) { var fr = new FileReader(); fr.onload = function () { r(fr.result); }; fr.readAsDataURL(blob); });
      var b64 = String(url).slice(String(url).indexOf(',') + 1), size = 512 * 1024, n = Math.ceil(b64.length / size);
      for (var i = 0; i < n; i++) post({ type: 'file', mime: blob.type, part: i, parts: n, data: b64.slice(i * size, (i + 1) * size) });
    } catch (e) {
      post({ type: 'error', message: String(e && e.message || e) });
    } finally { busy = false; }
  }

  async function show(f) {
    if (busy) { stopAsked = true; while (busy) await wait(20); }
    f = Math.max(C.from, Math.min(C.to, Math.round(f)));
    await seekTo((f + 0.5) / C.fileFps);
    draw(f);
  }

  window.replay = { play: play, show: show, exportVideo: exportVideo };

  video.addEventListener('error', function () { post({ type: 'error', message: '视频打不开：' + (video.error && video.error.message || '格式不支持') }); });
  video.addEventListener('loadedmetadata', function () {
    duration = video.duration;
    seekTo((C.from + 0.5) / C.fileFps).then(function () {
      try { draw(C.from); out.toDataURL('image/png', 0.1); } catch (e) {
        // A file:// video can count as another origin and lock the canvas. Loaded as a blob it is this page's own.
        if (!viaBlob) return reloadAsBlob(e);
        return post({ type: 'error', message: '读不到视频画面（' + e.name + '）' });
      }
      post({ type: 'ready' });
    });
  });
  var viaBlob = false;
  function reloadAsBlob(why) {
    viaBlob = true;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', C.video);
    xhr.responseType = 'blob';
    xhr.onload = function () { video.src = URL.createObjectURL(xhr.response); video.load(); };
    xhr.onerror = function () { post({ type: 'error', message: '读不到视频画面（' + why.name + '）' }); };
    xhr.send();
  }
  video.src = C.video;
  video.load();
})();
</script></body></html>`);
}
