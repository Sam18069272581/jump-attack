import { LIB_FROM_PAGE, POSE_CDN } from './poseLib';
import { POSE_SHARED_JS } from './poseShared';

import { localizeHtml } from '@/i18n';

/**
 * The page that reads people's poses out of a clip, run in a WebView (components/PoseReader.tsx). It seeks to each
 * frame asked for, runs the pose model on a square of it (media/poseShared.ts) and shows the frame with the square
 * and the athlete's skeleton while it reads.
 *
 * Messages to the app (`ReactNativeWebView.postMessage`, JSON):
 * - `{ type: 'ready', duration, width, height }` once the clip has loaded;
 * - `{ type: 'model', delegate, source }` once the model runs (on the 'GPU' or 'CPU'; from the phone's copy, 'local',
 *   or the 'cdn');
 * - `{ type: 'poses', id, items }`: frames of request `id`, each `[frame, time, ...people]`: a person is 132 numbers
 *   (domain/pose.ts `decodePose`), `time` the frame's own time in the file when the browser says (else null);
 * - `{ type: 'lost', id, frame }` when following the athlete loses them for good;
 * - `{ type: 'done', id }` after a request's last frame; `{ type: 'error', message, stage? }`.
 *
 * The app asks with:
 * - `window.follow({ id, frames, fps, at })`: the frames in the order given (forwards or backwards in the clip),
 *   following the person at `at` (video px) in the first;
 * - `window.crops({ id, frames, fps, crops })`: each frame read inside its own square `{ x, y, s }`;
 * - `window.everyone({ id, frames, fps })`: everyone in each frame, searched for across the whole picture.
 * `frames` are file frame numbers and `fps` the file's frame rate.
 */
export type PoseReaderOptions = {
  /** The clip, relative to the page. */
  video: string;
  bg: string;
  accent: string;
  /** The library's folder relative to the page (media/poseLib.ts). */
  lib?: string;
};

export function poseReaderHtml(o: PoseReaderOptions): string {
  const config = JSON.stringify({ video: o.video, bg: o.bg, accent: o.accent, lib: o.lib ?? LIB_FROM_PAGE, cdn: POSE_CDN, numPoses: 2 });
  return localizeHtml(`<!doctype html>
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
<script id="main">
(function () {
  var CFG = ${config};
  var video = document.getElementById('video');
  var view = document.getElementById('view');
  var vctx = view.getContext('2d');
  var W = 0, H = 0, duration = 0;

  function post(m) {
    var s = JSON.stringify(m);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
    else if (window.onPoseMessage) window.onPoseMessage(m);
  }
${POSE_SHARED_JS}
  function seekTo(t) {
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (done) return; done = true; video.removeEventListener('seeked', finish); resolve(); }
      video.addEventListener('seeked', finish);
      setTimeout(finish, 4000);
      video.currentTime = Math.max(0, Math.min(duration, t));
    });
  }

  // Mid-frame, so the seek never lands on a boundary. The browser's own time for the frame shown, when it says, tells
  // a clip recorded at an uneven rate (the camera page's) from its nominal frame times.
  var frameCallback = typeof video.requestVideoFrameCallback === 'function';
  var unanswered = 0;
  function seekFrame(f, fps) {
    var shown = null;
    if (frameCallback) video.requestVideoFrameCallback(function (now, meta) { shown = meta.mediaTime; });
    return seekTo((f + 0.5) / fps).then(function () {
      if (!frameCallback || shown != null) { unanswered = 0; return shown; }
      return new Promise(function (resolve) {
        setTimeout(function () {
          // A browser that doesn't call back for a paused video's frames: stop asking, and stop waiting.
          if (shown == null && ++unanswered >= 3) frameCallback = false;
          resolve(shown);
        }, 60);
      });
    });
  }

  function preview(crop, athlete) {
    var dpr = window.devicePixelRatio || 1;
    var cw = view.clientWidth * dpr, ch = view.clientHeight * dpr;
    if (view.width !== cw) view.width = cw;
    if (view.height !== ch) view.height = ch;
    var s = Math.min(cw / W, ch / H), ox = (cw - W * s) / 2, oy = (ch - H * s) / 2;
    vctx.fillStyle = CFG.bg;
    vctx.fillRect(0, 0, cw, ch);
    vctx.drawImage(video, 0, 0, W, H, ox, oy, W * s, H * s);
    vctx.strokeStyle = 'rgba(255,255,255,0.6)';
    vctx.lineWidth = dpr;
    vctx.strokeRect(ox + crop.x * s, oy + crop.y * s, crop.s * s, crop.s * s);
    if (athlete) POSE.draw(vctx, athlete, W, H, function (p) { return { x: ox + p.x * s, y: oy + p.y * s }; }, CFG.accent, 2.5 * dpr);
  }

  function Batch(id) { this.id = id; this.items = []; }
  Batch.prototype.add = function (item) { this.items.push(item); if (this.items.length >= 12) this.flush(); };
  Batch.prototype.flush = function () { if (this.items.length) post({ type: 'poses', id: this.id, items: this.items }); this.items = []; };

  /** The model on one square; when the GPU has gone, once more on the CPU. */
  async function read(crop) {
    try {
      return POSE.detect(video, W, H, crop);
    } catch (e) {
      if (!(await POSE.recover(CFG))) throw e;
      return POSE.detect(video, W, H, crop);
    }
  }

  async function follow(req) {
    var tr = new POSE.Tracker(req.at, 0), out = new Batch(req.id);
    for (var i = 0; i < req.frames.length; i++) {
      var f = req.frames[i];
      var t = await seekFrame(f, req.fps);
      var crop = tr.crop(f, W, H);
      var people = await read(crop);
      var athlete = tr.update(f, people, W, H);
      out.add([f, t].concat(people));
      if (i % 2 === 0) preview(crop, athlete);
      if (tr.misses > 4) { out.flush(); post({ type: 'lost', id: req.id, frame: f }); break; }
    }
    out.flush();
    post({ type: 'done', id: req.id });
  }

  async function crops(req) {
    var out = new Batch(req.id);
    for (var i = 0; i < req.frames.length; i++) {
      var t = await seekFrame(req.frames[i], req.fps);
      var people = await read(req.crops[i]);
      out.add([req.frames[i], t].concat(people));
      if (i % 3 === 0) preview(req.crops[i], people[0] || null);
    }
    out.flush();
    post({ type: 'done', id: req.id });
  }

  async function everyone(req) {
    var out = new Batch(req.id);
    for (var i = 0; i < req.frames.length; i++) {
      var t = await seekFrame(req.frames[i], req.fps);
      var people = POSE.search(video, W, H);
      out.add([req.frames[i], t].concat(people));
      preview({ x: 0, y: 0, s: 0 }, people[0] || null);
    }
    out.flush();
    post({ type: 'done', id: req.id });
  }

  var model = POSE.start(CFG).then(
    function (info) { post({ type: 'model', delegate: info.delegate, source: info.source }); },
    function (e) { post({ type: 'error', stage: 'model', message: String((e && e.message) || e) }); throw e; },
  );
  var queue = Promise.resolve();
  function enqueue(run) {
    queue = queue.then(function () { return model; }).then(run).catch(function (e) { post({ type: 'error', message: String((e && e.message) || e) }); });
  }
  window.follow = function (req) { enqueue(function () { return follow(req); }); };
  window.crops = function (req) { enqueue(function () { return crops(req); }); };
  window.everyone = function (req) { enqueue(function () { return everyone(req); }); };

  // A file:// video can count as another origin and lock a canvas it is drawn on, and the model can't read a locked
  // canvas. Loaded as a blob it is this page's own. The check draws on a canvas of its own, so the model's stays open.
  function locked() {
    try {
      var c = document.createElement('canvas');
      c.width = 2; c.height = 2;
      var x = c.getContext('2d');
      x.drawImage(video, 0, 0, 2, 2);
      x.getImageData(0, 0, 1, 1);
      return null;
    } catch (e) { return e; }
  }
  var viaBlob = false;
  function reloadAsBlob(why) {
    viaBlob = true;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', CFG.video);
    xhr.responseType = 'blob';
    xhr.onload = function () { video.src = URL.createObjectURL(xhr.response); video.load(); };
    xhr.onerror = function () { post({ type: 'error', stage: 'video', message: '读不到视频画面（' + why.name + '）' }); };
    xhr.send();
  }

  video.addEventListener('error', function () { post({ type: 'error', stage: 'video', message: '视频打不开：' + ((video.error && video.error.message) || '格式不支持') }); });
  video.addEventListener('loadedmetadata', function () {
    W = video.videoWidth; H = video.videoHeight; duration = video.duration;
    seekTo(Math.min(0.05, duration / 2)).then(function () {
      var e = locked();
      if (e && !viaBlob) return reloadAsBlob(e);
      if (e) return post({ type: 'error', stage: 'video', message: '读不到视频画面（' + e.name + '）' });
      preview({ x: 0, y: 0, s: 0 }, null);
      post({ type: 'ready', duration: duration, width: W, height: H });
    });
  });
  video.src = CFG.video;
  video.load();
})();
</script>
</body></html>`);
}
