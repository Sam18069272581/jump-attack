/**
 * The page that reads frames out of a video, run in a WebView: Expo Go has no native module that hands JavaScript the
 * pixels of a video frame, but a web page can draw the frame into a canvas and read it back. The page does no analysis;
 * it seeks to each frame asked for, draws a rectangle of it at the size asked for, and sends it back as grey levels.
 *
 * Messages to the app (`ReactNativeWebView.postMessage`, JSON):
 * - `{ type: 'ready', duration, width, height }` once the video has loaded;
 * - `{ type: 'frames', id, from, w, h, data }`: grey pictures for frames `from`, `from + 1`, … of request `id`, each
 *   `w × h` bytes, all of them base64 in `data` (sent a few at a time, so no message is huge);
 * - `{ type: 'done', id }` after the last batch;
 * - `{ type: 'error', message }`.
 * The app asks with `window.grab({ id, frames, fps, rect: { x, y, w, h }, w, h })`: file frame numbers, the file's frame
 * rate, and the rectangle in video pixels.
 */
export type GrabberOptions = {
  /** Video URL relative to the page, or absolute. */
  video: string;
  bg: string;
  accent: string;
};

export function frameGrabberHtml(o: GrabberOptions): string {
  const config = JSON.stringify(o);
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html, body { margin: 0; height: 100%; background: ${o.bg}; overflow: hidden; }
  #view { width: 100%; height: 100%; display: block; }
</style></head>
<body>
<canvas id="view"></canvas>
<video id="video" playsinline muted preload="auto" style="position:absolute;width:1px;height:1px;opacity:0"></video>
<script>
(function () {
  var CFG = ${config};
  var BATCH_BYTES = 400000;
  var video = document.getElementById('video');
  var view = document.getElementById('view');
  var vctx = view.getContext('2d');
  var work = document.createElement('canvas');
  var wctx = work.getContext('2d', { willReadFrequently: true });
  var W = 0, H = 0, duration = 0;

  function post(m) {
    var s = JSON.stringify(m);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
    else if (window.onGrabberMessage) window.onGrabberMessage(m);
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

  // A small preview of the frame being read, so the screen shows progress.
  function preview(rect) {
    var dpr = window.devicePixelRatio || 1;
    var cw = view.clientWidth * dpr, ch = view.clientHeight * dpr;
    if (view.width !== cw) view.width = cw;
    if (view.height !== ch) view.height = ch;
    var s = Math.min(cw / W, ch / H), ox = (cw - W * s) / 2, oy = (ch - H * s) / 2;
    vctx.fillStyle = CFG.bg; vctx.fillRect(0, 0, cw, ch);
    vctx.drawImage(video, 0, 0, W, H, ox, oy, W * s, H * s);
    vctx.strokeStyle = CFG.accent; vctx.lineWidth = 2 * dpr;
    vctx.strokeRect(ox + rect.x * s, oy + rect.y * s, rect.w * s, rect.h * s);
  }

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64(bytes) {
    var out = [], i, n = bytes.length;
    for (i = 0; i + 2 < n; i += 3) {
      var v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out.push(B64[v >> 18] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63]);
    }
    if (i < n) {
      var a = bytes[i], b = i + 1 < n ? bytes[i + 1] : 0, v2 = (a << 16) | (b << 8);
      out.push(B64[v2 >> 18] + B64[(v2 >> 12) & 63] + (i + 1 < n ? B64[(v2 >> 6) & 63] : '=') + '=');
    }
    return out.join('');
  }

  var queue = Promise.resolve();
  window.grab = function (req) { queue = queue.then(function () { return run(req); }).catch(function (e) { post({ type: 'error', message: String(e && e.message || e) }); }); };

  async function run(req) {
    var r = req.rect, w = req.w, h = req.h, per = Math.max(1, Math.floor(BATCH_BYTES / (w * h)));
    work.width = w; work.height = h;
    // Clip the source rectangle to the frame: Safari draws nothing for one that runs off the edge.
    var x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(W, r.x + r.w), y1 = Math.min(H, r.y + r.h);
    var sx = w / r.w, sy = h / r.h;
    var batch = null, from = 0, filled = 0;
    for (var i = 0; i < req.frames.length; i++) {
      // Mid-frame, so the seek never lands on a frame boundary.
      await seekTo((req.frames[i] + 0.5) / req.fps);
      wctx.fillStyle = '#000'; wctx.fillRect(0, 0, w, h);
      wctx.drawImage(video, x0, y0, x1 - x0, y1 - y0, (x0 - r.x) * sx, (y0 - r.y) * sy, (x1 - x0) * sx, (y1 - y0) * sy);
      var d = wctx.getImageData(0, 0, w, h).data;
      if (!batch) { batch = new Uint8Array(per * w * h); from = i; filled = 0; }
      for (var p = 0, q = filled * w * h; p < w * h; p++, q++) batch[q] = (77 * d[4 * p] + 150 * d[4 * p + 1] + 29 * d[4 * p + 2]) >> 8;
      filled++;
      if (i % 8 === 0) preview(r);
      if (filled === per || i === req.frames.length - 1) {
        post({ type: 'frames', id: req.id, from: from, w: w, h: h, data: base64(batch.subarray(0, filled * w * h)) });
        batch = null;
      }
    }
    post({ type: 'done', id: req.id });
  }

  video.addEventListener('error', function () { post({ type: 'error', message: '视频打不开：' + (video.error && video.error.message || '格式不支持') }); });
  video.addEventListener('loadedmetadata', function () {
    W = video.videoWidth; H = video.videoHeight; duration = video.duration;
    seekTo(Math.min(0.05, duration / 2)).then(function () {
      try { wctx.drawImage(video, 0, 0, 1, 1); wctx.getImageData(0, 0, 1, 1); } catch (e) {
        // A file:// video can count as another origin and lock the canvas. Loaded as a blob it is this page's own.
        if (!viaBlob) return reloadAsBlob(e);
        return post({ type: 'error', message: '读不到视频画面（' + e.name + '）' });
      }
      preview({ x: 0, y: 0, w: 0, h: 0 });
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
  video.src = CFG.video;
  video.load();
})();
</script></body></html>`;
}
