import { LIB_FROM_PAGE, POSE_CDN } from './poseLib';
import { POSE_SHARED_JS } from './poseShared';

import { localizeHtml } from '@/i18n';

/**
 * The page that watches the phone's camera while a run-up jump is set up and filmed, run in a WebView
 * (components/PoseCamera.tsx). It shows the camera's picture with the skeletons the pose model finds in it, says what
 * it sees for the setup checks (domain/poseSetup.ts), and records the take.
 *
 * The camera is the back one at up to 60 frames a second, all a web page gets on an iPhone: WebKit offers only the
 * first capture mode the phone lists for each picture size, and phones list their 30 or 60 fps modes before the
 * slow-motion ones. A back camera made of several lenses working as one (the "dual wide" and "triple" cameras) switches
 * lenses by itself, which changes the picture's scale in the middle of a take, so the page asks for the single wide
 * lens by name.
 *
 * The pose model reads the picture a few times a second: the whole picture in squares (media/poseShared.ts `search`)
 * now and then, and in between only a square around the biggest person found, the athlete on the take-off spot.
 * Reading stops while recording, leaving the phone's GPU to the video.
 *
 * Messages to the app (`ReactNativeWebView.postMessage`, JSON):
 * - `{ type: 'camera', label, physical, fps, maxFps, width, height }` once the camera's picture comes: the camera's
 *   name, whether it is a single lens, its frame rate and the most it can do, the picture's size;
 * - `{ type: 'model', delegate, source }` once the model runs;
 * - `{ type: 'frame', width, height, luma, lumas, poses, crowd }` for each picture read: the people found, 132 numbers
 *   each (domain/pose.ts `decodePose`); the mean brightness (0–255) of the picture and of each person's box; and how
 *   many people the latest search of the whole picture found;
 * - `{ type: 'recording', mime }` once recording has started;
 * - `{ type: 'chunk', seq, data }`: the recording so far, base64, a piece at a time; the app answers `window.ack(seq)`
 *   once it has written the piece, and only then comes the next;
 * - `{ type: 'recorded', chunks, size, mime, seconds }` after the last piece;
 * - `{ type: 'error', stage, name, message }`, stage 'camera', 'model' or 'record'.
 *
 * The app asks with `window.startRecording()`, `window.stopRecording()` (the page also stops by itself after `maxSeconds`) and
 * `window.stopCamera()` before it leaves.
 */
export type PoseCameraOptions = {
  bg: string;
  accent: string;
  /** The library's folder relative to the page (media/poseLib.ts). */
  lib?: string;
  /** The recording's bit rate, bits a second. */
  bitrate?: number;
  /** The longest take, s. */
  maxSeconds?: number;
};

/** WebKit's own default: about 1.25 MB a second of video. */
export const CAMERA_BITRATE = 10_000_000;
/** Time to start, run up, jump, land and stop. */
export const MAX_TAKE_S = 20;
/** The most the page sends in one message, bytes (before base64). */
export const CHUNK_BYTES = 786_432;
/** Pause between reads of the picture, ms. */
const READ_EVERY_MS = 120;
/** Reads around the athlete between searches of the whole picture. */
const SEARCH_EVERY = 16;

export function poseCameraHtml(o: PoseCameraOptions): string {
  const config = JSON.stringify({
    accent: o.accent,
    lib: o.lib ?? LIB_FROM_PAGE,
    cdn: POSE_CDN,
    numPoses: 2,
    bitrate: o.bitrate ?? CAMERA_BITRATE,
    maxSeconds: o.maxSeconds ?? MAX_TAKE_S,
    chunk: CHUNK_BYTES,
    readEvery: READ_EVERY_MS,
    searchEvery: SEARCH_EVERY,
  });
  return localizeHtml(`<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html, body { margin: 0; height: 100%; background: ${o.bg}; overflow: hidden; }
  #video, #overlay { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
  #video { object-fit: contain; }
</style></head>
<body>
<video id="video" autoplay muted playsinline></video>
<canvas id="overlay"></canvas>
<script id="main">
(function () {
  var CFG = ${config};
  var video = document.getElementById('video');
  var overlay = document.getElementById('overlay');
  var octx = overlay.getContext('2d');
  // The picture being read, held still while the model reads squares of it.
  var still = document.createElement('canvas');
  var sctx = still.getContext('2d');
  // The picture shrunk to 64 px across, for its brightness.
  var small = document.createElement('canvas');
  var lctx = small.getContext('2d', { willReadFrequently: true });
  var stream = null, W = 0, H = 0;

  function post(m) {
    var s = JSON.stringify(m);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
    else if (window.onPoseMessage) window.onPoseMessage(m);
  }
  function fail(stage, e) { post({ type: 'error', stage: stage, name: (e && e.name) || '', message: String((e && e.message) || e) }); }
${POSE_SHARED_JS}
  // ---- The camera.

  var WANT = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } };
  function open(which) { return navigator.mediaDevices.getUserMedia({ audio: false, video: Object.assign({}, which, WANT) }); }
  function end(s) { s.getTracks().forEach(function (t) { t.stop(); }); }
  function settings(t) { try { return t.getSettings() || {}; } catch (e) { return {}; } }
  function capabilities(t) { try { return (t.getCapabilities && t.getCapabilities()) || {}; } catch (e) { return {}; } }
  // Several lenses working as one can zoom out past 1; a single lens can't.
  function severalLenses(t) { var z = capabilities(t).zoom; return !!(z && z.min < 1); }

  async function backCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('这个页面用不了相机'), { name: 'NotSupportedError' });
    var first = await open({ facingMode: { ideal: 'environment' } });
    var track = first.getVideoTracks()[0];
    if (!severalLenses(track)) return { stream: first, physical: true };
    // The cameras' names are in the phone's language; the plain wide lens has the shortest name of the back ones
    // (后置相机, Back Camera). Only one camera runs at a time, so each is opened in turn.
    var id = settings(track).deviceId;
    var cams = (await navigator.mediaDevices.enumerateDevices()).filter(function (d) { return d.kind === 'videoinput' && d.deviceId && d.deviceId !== id; });
    cams.sort(function (a, b) { return a.label.length - b.label.length; });
    end(first);
    for (var i = 0; i < cams.length && i < 4; i++) {
      var s;
      try { s = await open({ deviceId: { exact: cams[i].deviceId } }); } catch (e) { continue; }
      var t = s.getVideoTracks()[0];
      if (settings(t).facingMode !== 'user' && !severalLenses(t)) return { stream: s, physical: true };
      end(s);
    }
    return { stream: await open({ facingMode: { ideal: 'environment' } }), physical: false };
  }

  function firstPicture() {
    return new Promise(function (resolve, reject) {
      var waited = 0;
      (function look() {
        if (video.videoWidth > 0 && video.readyState >= 2) resolve();
        else if ((waited += 50) > 10000) reject(new Error('相机没有画面'));
        else setTimeout(look, 50);
      })();
    });
  }

  async function startCamera() {
    var got = await backCamera();
    stream = got.stream;
    var track = stream.getVideoTracks()[0];
    track.addEventListener('ended', function () { fail('camera', new Error('相机断开了')); });
    video.srcObject = stream;
    try { await video.play(); } catch (e) {}
    await firstPicture();
    W = video.videoWidth; H = video.videoHeight;
    var st = settings(track), caps = capabilities(track);
    post({ type: 'camera', label: track.label || '', physical: got.physical, fps: st.frameRate || null, maxFps: (caps.frameRate && caps.frameRate.max) || null, width: W, height: H });
  }

  window.stopCamera = function () { if (stream) end(stream); stream = null; };

  // ---- Reading the picture.

  // Mean brightness (Rec. 601 luma, 0–255) of the picture, and of each person's box: the pixels of the shrunk picture
  // whose centres are in it, or the one it is in when it is narrower than a pixel.
  function brightness(people) {
    var w = 64, h = Math.max(1, Math.round((64 * H) / W));
    if (small.width !== w || small.height !== h) { small.width = w; small.height = h; }
    lctx.drawImage(still, 0, 0, W, H, 0, 0, w, h);
    var d = lctx.getImageData(0, 0, w, h).data;
    function mean(x0, y0, x1, y1) {
      var s = 0, n = 0;
      for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { var k = 4 * (y * w + x); s += 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]; n++; }
      return n ? s / n : 0;
    }
    function span(lo, hi, n) {
      var a = Math.max(0, Math.ceil(lo * n - 0.5)), b = Math.min(n, Math.floor(hi * n - 0.5) + 1);
      if (b > a) return [a, b];
      var c = Math.max(0, Math.min(n - 1, Math.floor(((lo + hi) / 2) * n)));
      return [c, c + 1];
    }
    var all = mean(0, 0, w, h);
    return {
      luma: Math.round(all),
      lumas: people.map(function (v) {
        var x0 = 1, y0 = 1, x1 = 0, y1 = 0;
        for (var i = 0; i < 33; i++) { x0 = Math.min(x0, v[4 * i]); x1 = Math.max(x1, v[4 * i]); y0 = Math.min(y0, v[4 * i + 1]); y1 = Math.max(y1, v[4 * i + 1]); }
        var xs = span(Math.max(0, x0), Math.min(1, x1), w), ys = span(Math.max(0, y0), Math.min(1, y1), h);
        return Math.round(mean(xs[0], ys[0], xs[1], ys[1]));
      }),
    };
  }

  function draw(people, athlete) {
    var dpr = window.devicePixelRatio || 1;
    var cw = overlay.clientWidth * dpr, ch = overlay.clientHeight * dpr;
    if (overlay.width !== cw) overlay.width = cw;
    if (overlay.height !== ch) overlay.height = ch;
    octx.clearRect(0, 0, cw, ch);
    // Where the video element shows the picture: whole and centred.
    var s = Math.min(cw / W, ch / H), ox = (cw - W * s) / 2, oy = (ch - H * s) / 2;
    function map(p) { return { x: ox + p.x * s, y: oy + p.y * s }; }
    people.forEach(function (v) { if (v !== athlete) POSE.draw(octx, v, W, H, map, 'rgba(255,255,255,0.7)', 2 * dpr); });
    if (athlete) POSE.draw(octx, athlete, W, H, map, CFG.accent, 3 * dpr);
  }

  function biggest(people) {
    var best = null, len = 0;
    people.forEach(function (v) { var l = POSE.length(v, W, H); if (l > len) { len = l; best = v; } });
    return best;
  }

  var tracker = null, sinceSearch = 0, crowd = 0, reads = 0, recording = null;

  /** Reads the picture once: all of it now and then, else around the athlete. */
  function readOnce() {
    W = video.videoWidth; H = video.videoHeight;
    if (!W || !H) return;
    if (still.width !== W || still.height !== H) { still.width = W; still.height = H; }
    sctx.drawImage(video, 0, 0, W, H);
    reads++;
    var people, athlete;
    if (!tracker || tracker.misses > 2 || sinceSearch >= CFG.searchEvery) {
      people = POSE.search(still, W, H);
      crowd = people.length;
      sinceSearch = 0;
      athlete = biggest(people);
      tracker = null;
      if (athlete) {
        tracker = new POSE.Tracker(POSE.hip(athlete, W, H), 0);
        tracker.update(reads, [athlete], W, H);
      }
    } else {
      sinceSearch++;
      people = POSE.detect(still, W, H, tracker.crop(reads, W, H));
      athlete = tracker.update(reads, people, W, H);
    }
    var b = brightness(people);
    post({ type: 'frame', width: W, height: H, luma: b.luma, lumas: b.lumas, poses: people, crowd: crowd });
    draw(people, athlete);
  }

  async function loop() {
    if (!stream) return;
    if (!recording) {
      try {
        readOnce();
      } catch (e) {
        // The GPU went away (iOS takes it back from pages in the background): on to the CPU, or give up.
        if (!(await POSE.recover(CFG).catch(function () { return null; }))) return fail('model', e);
      }
    }
    setTimeout(loop, CFG.readEvery);
  }

  // ---- Recording.

  function pickType() {
    var types = ['video/mp4;codecs=avc1', 'video/mp4'];
    for (var i = 0; i < types.length; i++) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(types[i])) return types[i];
    return '';
  }

  function base64(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf);
      if (typeof u8.toBase64 === 'function') return u8.toBase64();
      var s = '';
      for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(s);
    });
  }

  /** Sends what has been recorded so far, a piece at a time, each once the app has written the one before. */
  async function send(r) {
    if (r.sending) return;
    r.sending = true;
    try {
      while (r.queue.length) {
        var blob = r.queue.shift();
        for (var at = 0; at < blob.size; at += CFG.chunk) {
          var piece = blob.slice(at, Math.min(blob.size, at + CFG.chunk));
          var data = await base64(piece);
          var seq = r.seq++;
          var written = new Promise(function (resolve) { r.acks[seq] = resolve; });
          post({ type: 'chunk', seq: seq, data: data });
          await written;
          r.size += piece.size;
        }
      }
      if (r.stopped && recording === r) {
        recording = null;
        if (overlay.width) octx.clearRect(0, 0, overlay.width, overlay.height);
        post({ type: 'recorded', chunks: r.seq, size: r.size, mime: r.mime, seconds: r.seconds });
      }
    } catch (e) {
      recording = null;
      fail('record', e);
    } finally {
      r.sending = false;
    }
  }

  window.ack = function (seq) {
    var r = recording, done = r && r.acks[seq];
    if (done) { delete r.acks[seq]; done(); }
  };

  window.startRecording = function () {
    if (recording || !stream) return;
    if (typeof MediaRecorder === 'undefined') return fail('record', new Error('这台手机的系统不能在网页里录像'));
    var type = pickType(), rec;
    try {
      rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: CFG.bitrate } : { videoBitsPerSecond: CFG.bitrate });
    } catch (e) { return fail('record', e); }
    var r = { rec: rec, queue: [], seq: 0, size: 0, acks: {}, sending: false, stopped: false, started: Date.now(), seconds: 0, mime: type || 'video/mp4', limit: 0 };
    recording = r;
    octx.clearRect(0, 0, overlay.width, overlay.height);
    rec.ondataavailable = function (e) { if (e.data && e.data.size) { r.queue.push(e.data); send(r); } };
    rec.onstart = function () { r.started = Date.now(); r.mime = rec.mimeType || r.mime; post({ type: 'recording', mime: r.mime }); };
    rec.onstop = function () { clearTimeout(r.limit); r.seconds = (Date.now() - r.started) / 1000; r.stopped = true; send(r); };
    rec.onerror = function (e) { clearTimeout(r.limit); if (recording === r) recording = null; fail('record', (e && e.error) || e); };
    // A slice a second: without one, iOS 26 and 27 stop putting video in the file after about 15 s (WebKit bug 315091).
    rec.start(1000);
    r.limit = setTimeout(window.stopRecording, CFG.maxSeconds * 1000);
  };

  window.stopRecording = function () {
    var r = recording;
    if (r && !r.stopped && r.rec.state !== 'inactive') r.rec.stop();
  };

  var model = POSE.start(CFG).then(
    function (info) { post({ type: 'model', delegate: info.delegate, source: info.source }); },
    function (e) { fail('model', e); throw e; },
  );
  var camera = startCamera().catch(function (e) { fail('camera', e); throw e; });
  Promise.all([model, camera]).then(loop, function () {});
})();
</script>
</body></html>`);
}
