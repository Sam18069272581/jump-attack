// Runs the tracking page's own script (barTrackerHtml) outside a browser, on a drawn video whose plate path is known
// exactly: the video element, the canvases and the frame callbacks are stand-ins, the tracking code is the page's.
import vm from 'vm';

import { barTrackerHtml } from '../barTrackerHtml';

type Path = (t: number) => { x: number; y: number; turn: number };
type Msg = { type: string; [k: string]: any };

const W = 480;
const H = 640;
const R = 60; // plate radius, px: 120 px is the 45 cm plate

function smooth(d: number): number {
  // 0 → 1 across a 1.5 px edge, like an edge in a real frame.
  return Math.min(1, Math.max(0, d / 1.5 + 0.5));
}

/** Grey level of the picture at (X, Y), canvas coordinates, with the plate's centre at p and turned by p.turn. */
function picture(X: number, Y: number, p: { x: number; y: number; turn: number }): number {
  const bg = 120 + 25 * Math.sin(X / 37) * Math.cos(Y / 53) + 15 * Math.sin((X + 2 * Y) / 11);
  const dx = X - p.x;
  const dy = Y - p.y;
  const r = Math.hypot(dx, dy);
  if (r > R + 1) return bg;
  // Back on the plate's face: undo its turn.
  const c = Math.cos(-p.turn);
  const s = Math.sin(-p.turn);
  const u = (dx * c - dy * s) / R;
  const v = (dx * s + dy * c) / R;
  const q = r / R;
  let g = 40 + 12 * Math.sin(u * 23) * Math.sin(v * 19); // rubber with some grain
  g += 60 * smooth(1.5 - Math.abs(q - 0.93) * R); // the raised lip
  // The logo: a band along the top-left and a block of lettering low on the right, nowhere near symmetric.
  const a = Math.atan2(v, u);
  if (a > -2.6 && a < -0.4) g += 170 * smooth(0.07 * R - Math.abs(q - 0.62) * R);
  if (u > 0.15 && u < 0.6 && v > 0.35 && v < 0.55) g += 150 * smooth(Math.min(u - 0.15, 0.6 - u, v - 0.35, 0.55 - v) * R);
  g += 120 * smooth((0.24 - q) * R); // steel hub
  g -= 150 * smooth((0.115 - q) * R); // the sleeve's hole
  const inPlate = smooth((1 - q) * R);
  return bg * (1 - inPlate) + g * inPlate;
}

/** Runs the page on a video of `duration` s whose frames are `frameDt` apart, the file saying `fps`. */
async function runTracker(path: Path, opts: { duration: number; frameDt: number; fps: number }): Promise<Msg> {
  const html = barTrackerHtml({ video: 'clip.mp4', fps: opts.fps, accent: '#fff', bg: '#000', text: '#fff', muted: '#999' });
  const script = html.match(/<script>([\s\S]*)<\/script>/)![1];
  const msgs: Msg[] = [];

  const listeners = (): any => {
    const on: Record<string, ((e?: unknown) => void)[]> = {};
    return {
      on,
      addEventListener: (k: string, f: (e?: unknown) => void) => (on[k] = on[k] || []).push(f),
      removeEventListener: (k: string, f: (e?: unknown) => void) => (on[k] = (on[k] || []).filter((g) => g !== f)),
      fire: (k: string) => (on[k] || []).slice().forEach((f) => f({})),
    };
  };
  const frameAt = (t: number) => Math.min(Math.floor(t / opts.frameDt + 1e-9), Math.floor(opts.duration / opts.frameDt + 1e-9) - 1) * opts.frameDt;
  let videoT = 0;
  const frameCallbacks: ((now: number, meta: { mediaTime: number }) => void)[] = [];
  const video = {
    ...listeners(),
    videoWidth: W,
    videoHeight: H,
    duration: opts.duration,
    style: {},
    error: null,
    load() {
      setTimeout(() => video.fire('loadedmetadata'), 0);
    },
    requestVideoFrameCallback(f: (now: number, meta: { mediaTime: number }) => void) {
      frameCallbacks.push(f);
    },
  };
  // (Not in the literal: the spread above would be compiled to copy an accessor's value, not the accessor.)
  Object.defineProperty(video, 'currentTime', {
    get: () => videoT,
    set: (t: number) => {
      videoT = t;
      setTimeout(() => {
        // The browser reports the frame it shows, then that the seek is done.
        frameCallbacks.splice(0).forEach((f) => f(0, { mediaTime: frameAt(videoT) }));
        video.fire('seeked');
      }, 0);
    },
  });
  const noop = () => undefined;
  const viewCtx = new Proxy({}, { get: () => noop, set: () => true });
  const workCtx = {
    fillStyle: '',
    fillRect: noop,
    image: new Float32Array(0),
    side: 0,
    drawImage(_v: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
      // Point-sample the frame showing at each destination pixel's centre.
      const p = path(frameAt(videoT));
      for (let j = Math.max(0, Math.ceil(dy - 0.5)); j < Math.min(this.side, dy + dh - 0.5); j++)
        for (let i = Math.max(0, Math.ceil(dx - 0.5)); i < Math.min(this.side, dx + dw - 0.5); i++)
          this.image[j * this.side + i] = picture(sx + ((i + 0.5 - dx) * sw) / dw, sy + ((j + 0.5 - dy) * sh) / dh, p);
    },
    getImageData(_x: number, _y: number, w: number, h: number) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = Math.round(this.image[y * this.side + x]);
          data[4 * i + 3] = 255;
        }
      return { data };
    },
  };
  // The page draws into the top-left side × side square of its work canvas; give it room for the largest it asks for.
  workCtx.side = 200;
  workCtx.image = new Float32Array(200 * 200);
  const work = { getContext: () => workCtx };
  const elements: Record<string, any> = {
    video,
    view: { ...listeners(), getContext: () => viewCtx, getBoundingClientRect: () => ({ left: 0, top: 0 }), width: 0, height: 0 },
    stage: { ...listeners(), clientWidth: 390, clientHeight: 500, setPointerCapture: noop },
  };
  const document = {
    getElementById: (id: string) => elements[id] ?? (elements[id] = { ...listeners(), style: {}, value: '0', textContent: '' }),
    createElement: () => work,
  };
  const window: any = { devicePixelRatio: 1, addEventListener: noop, onTrackerMessage: (m: Msg) => msgs.push(m) };
  const sandbox = {
    window,
    document,
    setTimeout: (f: () => void, ms: number) => (ms >= 1000 ? 0 : setTimeout(f, ms)),
    Date,
    Promise,
    URL,
    XMLHttpRequest: function () {},
  };
  vm.runInNewContext(script, sandbox);

  const until = async (type: string) => {
    for (let i = 0; i < 20000 && !msgs.some((m) => m.type === type || m.type === 'error'); i++) await new Promise((r) => setTimeout(r, 0));
    const m = msgs.find((x) => x.type === type || x.type === 'error');
    if (!m || m.type === 'error') throw new Error(`tracker: ${m ? m.message : 'no ' + type}`);
    return m;
  };
  await until('ready');
  const p0 = path(0);
  window.setCircle(p0.x, p0.y, R, false);
  window.startTrack(opts.fps);
  return until('done');
}

/** Each sample's position error against the path, px. */
function errors(done: Msg, path: Path) {
  return (done.samples as [number, number, number, number][]).map(([t, x, y, c]) => {
    const p = path(t);
    return { t, ex: x - p.x, ey: y - p.y, c };
  });
}

describe('bar tracker page', () => {
  it('follows a plate that turns on the sleeve without its height drifting', async () => {
    // The plate goes 200 px down and back up over 2 s while it turns 20° with depth, as a plate does when the bar rolls
    // in the hands. 20° is the largest turn the synthetic validation set (tools/vbt-validation/synth.py) gives a
    // rep. A template that doesn't turn with the plate slides its match towards the logo: on that set the shipped
    // tracker's height error grew in step with depth by up to 1.9 % of the travel, which is 1.9 % on every speed.
    const path: Path = (t) => {
      const depth = t < 0.4 ? 0 : t < 1.4 ? (1 - Math.cos((Math.PI * (t - 0.4)) / 1)) / 2 : t < 2.4 ? (1 + Math.cos((Math.PI * (t - 1.4)) / 1)) / 2 : 0;
      return { x: 200 + 4 * depth, y: 260 + 200 * depth, turn: (20 * Math.PI * depth) / 180 };
    };
    const done = await runTracker(path, { duration: 2.8, frameDt: 1 / 30, fps: 30 });
    expect(done.lost).toBe(false);
    const e = errors(done, path);
    expect(e.every((s) => s.c >= 0.5)).toBe(true);
    // The error at the start is where the circle sits on the plate; what moves the speeds is how it changes. 0.6 px
    // of 200 is 0.3 % of the travel.
    const e0 = e[0].ey;
    const worst = Math.max(...e.map((s) => Math.abs(s.ey - e0)));
    expect(worst).toBeLessThan(0.6);
  });

  it('finds the plate again when the bar stops dead after a fast rep on a low frame rate clip', async () => {
    // 2 m/s (533 px/s with 120 px for the 45 cm plate) at 15 frames a second in a file that says 30, as a variable
    // frame rate phone clip does where it halves its rate: 36 px between frames. Then the bar locks out and stops
    // within a frame. Predicting on at full speed puts the search window past the plate.
    const v = 533;
    const path: Path = (t) => {
      // At rest until 0.4 s, speeding up evenly to v by 0.65 s, on at v until 0.85 s, then stopped.
      const y0 = 480;
      let d: number;
      if (t < 0.4) d = 0;
      else if (t < 0.65) d = (v * (t - 0.4) ** 2) / 2 / 0.25;
      else if (t < 0.85) d = (v * 0.25) / 2 + v * (t - 0.65);
      else d = (v * 0.25) / 2 + v * 0.2;
      return { x: 240, y: y0 - d, turn: 0 };
    };
    const done = await runTracker(path, { duration: 1.6, frameDt: 1 / 15, fps: 30 });
    expect(done.lost).toBe(false);
    const e = errors(done, path);
    const after = e.filter((s) => s.t > 0.9);
    expect(after.length).toBeGreaterThan(5);
    expect(after.every((s) => s.c >= 0.5 && Math.abs(s.ey - e[0].ey) < 1)).toBe(true);
  });
});
