/**
 * The replay and export page, run in a WebView like the frame reader (media/frameGrabberHtml.ts): Expo Go has no
 * native module that composes video, but a web page can draw each frame into a canvas with the numbers on top and
 * record the canvas with MediaRecorder.
 *
 * The picture is portrait, 720 × 1280, for sharing: the clip in slow motion at the top with what is happening now,
 * the jump curve (centre-of-mass height, domain/jumpAnalysis.flightCurve) filling in underneath, the set's numbers,
 * a strip with every jump, and the app's name as a watermark. The page computes nothing about the jumps: every number
 * and label comes in the config.
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
};

export function replayHtml(c: ReplayConfig): string {
  // `<` can't close the script it sits in once escaped.
  const config = JSON.stringify(c).replace(/</g, '\\u003c');
  return `<!doctype html>
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
      if (f >= j.takeoff && f < j.landing) return { phase: '腾空', i: i, color: K.accent };
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

  var VX = 24, VY = 112, VW = 672, VH = 700;
  var CX = 24, CY = 828, CW = 672, CH = 180;

  function draw(f) {
    g.fillStyle = K.paper; g.fillRect(0, 0, W, H);

    // Watermark and title.
    g.strokeStyle = K.rim; g.lineWidth = 5; g.beginPath(); g.arc(52, 58, 18, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(34, 58); g.lineTo(70, 58); g.moveTo(52, 40); g.lineTo(52, 76); g.lineWidth = 2; g.stroke();
    text(C.brand, 82, 72, 'italic 800 40px ' + NUM, K.ink);
    text(C.title, W - 24, 52, '700 24px ' + CJK, K.ink, 'right');
    text(C.date + ' · ' + C.speed, W - 24, 80, '400 18px ' + CJK, K.muted, 'right');

    // The clip, filling its panel.
    g.save(); rr(VX, VY, VW, VH, 28); g.clip();
    g.fillStyle = '#000'; g.fillRect(VX, VY, VW, VH);
    var vw = video.videoWidth, vh = video.videoHeight;
    if (vw && vh) {
      // Fill the panel, but never so far that the athlete is cut off; centre on them, without running off the picture.
      var F = C.focus || { x: 0, y: 0, w: vw, h: vh };
      var s = Math.min(Math.max(VW / vw, VH / vh), VW / F.w, VH / F.h), dw = vw * s, dh = vh * s;
      var cx = (F.x + F.w / 2) * s, cy = (F.y + F.h / 2) * s;
      var dx = dw <= VW ? (VW - dw) / 2 : Math.min(0, Math.max(VW - dw, VW / 2 - cx));
      var dy = dh <= VH ? (VH - dh) / 2 : Math.min(0, Math.max(VH - dh, VH / 2 - cy));
      g.drawImage(video, VX + dx, VY + dy, dw, dh);
    }
    var st = stateAt(f);
    var pill = st.phase + (st.i >= 0 ? ' · 第 ' + (st.i + 1) + ' 跳' : '');
    g.font = '700 26px ' + CJK; var pw = g.measureText(pill).width + 36;
    rr(VX + 20, VY + 20, pw, 48, 24); g.fillStyle = st.color; g.fill();
    text(pill, VX + 38, VY + 53, '700 26px ' + CJK, '#FFFFFF');
    var t = ((f - C.from) / C.captureFps).toFixed(3);
    text(t + ' s', VX + VW - 20, VY + 54, '700 28px ' + NUM, 'rgba(255,255,255,0.85)', 'right');
    // The last jump's numbers pop up as it lands, for about a second of real time.
    var l = landedAt(f);
    if (l && l.ago < C.captureFps * 0.35) {
      var j = C.jumps[l.i], k = Math.min(1, l.ago / (C.captureFps * 0.04));
      g.globalAlpha = k;
      rr(VX + 20, VY + VH - 150, VW - 40, 130, 24); g.fillStyle = 'rgba(23,19,14,0.78)'; g.fill();
      text(j.label, VX + 44, VY + VH - 64, '800 76px ' + NUM, j.counted ? '#FFFFFF' : 'rgba(255,255,255,0.5)');
      text(j.detail, VX + VW - 44, VY + VH - 72, '600 26px ' + CJK, 'rgba(255,255,255,0.85)', 'right');
      g.globalAlpha = 1;
    }
    g.restore();

    // The jump curve: centre-of-mass height over the part shown, lit up to now.
    rr(CX, CY, CW, CH, 24); g.fillStyle = K.card; g.fill();
    text('起跳曲线 · 重心高度', CX + 20, CY + 34, '700 20px ' + CJK, K.ink);
    var top = Math.max.apply(null, C.curve.concat([10]));
    var px = function (ff) { return CX + 20 + ((ff - C.from) / Math.max(1, C.to - C.from)) * (CW - 40); };
    var py = function (h) { return CY + CH - 20 - (h / top) * (CH - 92); };
    g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,0.12)'; g.beginPath(); g.moveTo(px(C.from), py(0)); g.lineTo(px(C.to), py(0)); g.stroke();
    function trace(upto, color, width) {
      g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.beginPath();
      for (var ff = C.from; ff <= upto; ff++) { var x = px(ff), y = py(C.curve[ff - C.from]); if (ff === C.from) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    }
    trace(C.to, 'rgba(35,64,200,0.18)', 3);
    trace(Math.min(f, C.to), K.accent, 4);
    C.jumps.forEach(function (j, i) {
      if (j.takeoff < C.from || j.landing > C.to) return;
      var mid = Math.round((j.takeoff + j.landing) / 2), peak = C.curve[mid - C.from] || 0;
      if (f >= mid) text(String(j.label).replace(/ .*$/, ''), px(mid), py(peak) - 10, '800 22px ' + NUM, j.counted ? K.ink : K.muted, 'center');
      if (f >= j.takeoff) { g.fillStyle = K.accent; g.beginPath(); g.arc(px(j.takeoff), py(0), 5, 0, 7); g.fill(); }
      if (f >= j.landing) { g.fillStyle = K.rim; g.beginPath(); g.arc(px(j.landing), py(0), 5, 0, 7); g.fill(); }
    });
    g.fillStyle = K.ink; g.beginPath(); g.arc(px(Math.min(f, C.to)), py(C.curve[Math.min(f, C.to) - C.from] || 0), 7, 0, 7); g.fill();

    // The set's numbers.
    var DY = 1020;
    rr(24, DY, 672, 150, 24); g.fillStyle = K.card; g.fill();
    text(C.headline.label, 48, DY + 40, '600 20px ' + CJK, K.muted);
    g.font = '800 84px ' + NUM; var hw = g.measureText(C.headline.value).width;
    text(C.headline.value, 46, DY + 122, '800 84px ' + NUM, K.accent);
    text(C.headline.unit, 54 + hw, DY + 122, '700 28px ' + CJK, K.muted);
    C.stats.slice(0, 3).forEach(function (s, i) {
      var x = 290 + i * 132;
      text(s.label, x, DY + 40, '600 18px ' + CJK, K.muted);
      text(s.value, x, DY + 92, '800 38px ' + NUM, K.ink);
    });
    text(C.note, 290, DY + 130, '400 16px ' + CJK, K.muted);

    // Every jump, the one in the air highlighted.
    var n = C.jumps.length, cw = Math.min(120, (672 - (n - 1) * 8) / n);
    C.jumps.forEach(function (j, i) {
      var x = 24 + i * (cw + 8), y = 1186;
      rr(x, y, cw, 64, 16); g.fillStyle = i === st.i ? K.accent : K.card; g.fill();
      var on = i === st.i ? '#FFFFFF' : j.counted ? K.ink : K.muted;
      text(String(i + 1), x + 10, y + 24, '700 16px ' + NUM, on);
      text(String(j.label).replace(/ .*$/, ''), x + cw / 2, y + 54, '800 ' + (cw < 70 ? 22 : 28) + 'px ' + NUM, on, 'center');
    });
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
</script></body></html>`;
}
