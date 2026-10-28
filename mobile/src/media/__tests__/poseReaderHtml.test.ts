import { decodePose, LANDMARK_COUNT, LANDMARK_FIELDS, LM, type Pose } from '@/domain/pose';
import { standing } from '@/domain/testing/standing';

import { poseReaderHtml } from '../poseReaderHtml';

/**
 * The clip page's script, run against a minimal DOM and a stand-in for MediaPipe's pose landmarker. The stand-in
 * reports the people of the current frame wherever the page drew them on its canvas, but, like the real model's
 * person detector, which looks at the picture shrunk to 224 px, it misses anyone under 60 px tall at that size, and
 * anyone mostly outside the square drawn.
 */

const W = 1920;
const H = 1080;
const FPS = 240;
const DETECTOR_PX = 224;
const SMALLEST = 60;

type Draw = { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number };
type Person = (frame: number) => Pose | null;
type Msg = { type: string; id?: number; items?: [number, number | null, ...number[][]][]; frame?: number; delegate?: string; source?: string; message?: string; stage?: string };

class FakeCanvas {
  width = 300;
  height = 150;
  clientWidth = 400;
  clientHeight = 300;
  last: Draw | null = null;
  addEventListener() {}
  getContext() {
    const c = this;
    const noop = () => {};
    return {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: '',
      fillRect: noop,
      strokeRect: noop,
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      stroke: noop,
      drawImage(_src: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
        c.last = { sx, sy, sw, sh, dx, dy, dw, dh };
      },
    };
  }
}

class FakeVideo {
  videoWidth = 0;
  videoHeight = 0;
  duration = 4;
  frame = 0;
  error = null;
  private listeners: Record<string, (() => void)[]> = {};
  private callbacks: ((now: number, meta: { mediaTime: number }) => void)[] = [];
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => void;
  constructor(
    public people: Person[],
    frameCallback: boolean,
  ) {
    if (frameCallback) this.requestVideoFrameCallback = (cb) => void this.callbacks.push(cb);
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((g) => g !== fn);
  }
  private fire(type: string) {
    for (const fn of [...(this.listeners[type] ?? [])]) fn();
  }
  set currentTime(t: number) {
    this.frame = Math.floor(t * FPS);
    Promise.resolve().then(() => {
      const due = this.callbacks.splice(0);
      for (const cb of due) cb(0, { mediaTime: this.frame / FPS });
      this.fire('seeked');
    });
  }
  set src(_: string) {}
  load() {
    this.videoWidth = W;
    this.videoHeight = H;
    Promise.resolve().then(() => this.fire('loadedmetadata'));
  }
}

/** What the stand-in landmarker sees on a canvas the page drew a square of the frame on. */
function landmarksOn(canvas: FakeCanvas, video: FakeVideo) {
  const m = canvas.last;
  if (!m) return { landmarks: [] };
  const d = canvas.width;
  const out: { x: number; y: number; z: number; visibility: number }[][] = [];
  for (const person of video.people) {
    const p = person(video.frame);
    if (!p) continue;
    const q = p.map((l) => ({ x: m.dx + ((l.x - m.sx) * m.dw) / m.sw, y: m.dy + ((l.y - m.sy) * m.dh) / m.sh, z: l.z, v: l.v }));
    const ys = q.map((l) => l.y);
    if (((Math.max(...ys) - Math.min(...ys)) * DETECTOR_PX) / d < SMALLEST) continue;
    const inside = q.filter((l) => l.x >= m.dx && l.x <= m.dx + m.dw && l.y >= m.dy && l.y <= m.dy + m.dh).length;
    if (inside < 0.8 * q.length) continue;
    out.push(q.map((l) => ({ x: l.x / d, y: l.y / d, z: l.z, visibility: l.v })));
  }
  return { landmarks: out };
}

type Opened = {
  messages: Msg[];
  win: Record<string, unknown> & { follow: (r: object) => void; crops: (r: object) => void; everyone: (r: object) => void };
  next: (type: string, id?: number) => Promise<Msg>;
  created: { fileset: { wasmLoaderPath: string; wasmBinaryPath: string }; opts: { baseOptions: { delegate: string; modelAssetBuffer: Uint8Array } } }[];
  scripts: string[];
  reads: string[];
};

async function openPage(people: Person[], o: { gpuFails?: boolean; frameCallback?: boolean } = {}): Promise<Opened> {
  const html = poseReaderHtml({ video: 'clip.mov', bg: '#000', accent: '#f80' });
  const start = html.indexOf('<script id="main">') + '<script id="main">'.length;
  const script = html.slice(start, html.indexOf('</script>', start));
  const video = new FakeVideo(people, o.frameCallback ?? false);
  const view = new FakeCanvas();
  const messages: Msg[] = [];
  const waiting: { type: string; id?: number; resolve: (m: Msg) => void; reject: (e: Error) => void }[] = [];
  const created: Opened['created'] = [];
  const scripts: string[] = [];
  const reads: string[] = [];
  const win: Record<string, unknown> = {
    devicePixelRatio: 1,
    onPoseMessage: (m: Msg) => {
      messages.push(m);
      // A page error fails whatever the test waits for, rather than leaving it to time out.
      if (m.type === 'error') return waiting.splice(0).forEach((w) => w.reject(new Error(`${m.stage ?? ''} ${m.message}`)));
      const i = waiting.findIndex((w) => w.type === m.type && (w.id == null || w.id === m.id));
      if (i >= 0) waiting.splice(i, 1)[0].resolve(m);
    },
  };
  const vision = {
    PoseLandmarker: {
      createFromOptions: async (fileset: Opened['created'][0]['fileset'], opts: Opened['created'][0]['opts']) => {
        created.push({ fileset, opts });
        // As the library does: it takes the loader's factory, and clears it.
        if (!win.ModuleFactory) throw new Error('ModuleFactory not set.');
        win.ModuleFactory = undefined;
        if (o.gpuFails && opts.baseOptions.delegate === 'GPU') throw new Error('WebGL unavailable');
        return { detect: (c: FakeCanvas) => landmarksOn(c, video), close() {} };
      },
    },
  };
  const document = {
    getElementById: (id: string) => (id === 'video' ? video : view),
    createElement: (tag: string) => (tag === 'canvas' ? new FakeCanvas() : { src: '', onload: null as null | (() => void), onerror: null }),
    body: {
      appendChild(s: { src: string; onload: () => void }) {
        scripts.push(s.src);
        Promise.resolve().then(() => {
          if (s.src.endsWith('/vision.js')) win.MPVision = vision;
          if (s.src.endsWith('/vision_wasm_internal.js')) win.ModuleFactory = () => {};
          s.onload();
        });
      },
    },
  };
  class XHR {
    status = 0;
    response: ArrayBuffer | null = null;
    onload: () => void = () => {};
    onerror: () => void = () => {};
    responseType = '';
    private url = '';
    open(_method: string, url: string) {
      this.url = url;
    }
    send() {
      reads.push(this.url);
      Promise.resolve().then(() => {
        this.response = new Uint8Array([1, 2, 3]).buffer;
        this.onload();
      });
    }
  }
  // Only the short waits run: the 4 s guard against a seek that never ends never fires here.
  const timer = (fn: () => void, ms: number) => (ms <= 100 ? setImmediate(fn) : 0);
  const location = { href: 'file:///app/Documents/pose/run-1/page.html' };
  new Function('window', 'self', 'document', 'setTimeout', 'XMLHttpRequest', 'location', 'fetch', script)(win, win, document, timer, XHR, location, undefined);
  const next = (type: string, id?: number) =>
    new Promise<Msg>((resolve, reject) => {
      const failed = messages.find((m) => m.type === 'error');
      if (failed) return reject(new Error(`${failed.stage ?? ''} ${failed.message}`));
      const seen = messages.find((m) => m.type === type && (id == null || m.id === id) && !(m as { taken?: boolean }).taken);
      if (seen) {
        (seen as { taken?: boolean }).taken = true;
        return resolve(seen);
      }
      waiting.push({ type, id, resolve, reject });
    });
  await next('ready');
  return { messages, win: win as Opened['win'], next, created, scripts, reads };
}

/** A runner across the picture: hips 200 px in at frame 0, 6 px a frame (about 6 m/s seen from 7 m at 240 fps). */
const runner: Person = (f) => {
  const x = 200 + 6 * f;
  return x < W + 200 ? standing({ x, floor: 900, stature: 380 }) : null;
};
const hipOf = (p: Pose) => ({ x: (p[LM.leftHip].x + p[LM.rightHip].x) / 2, y: (p[LM.leftHip].y + p[LM.rightHip].y) / 2 });

/** Every frame of a request, people decoded. */
async function collect(page: Opened, id: number): Promise<{ frame: number; time: number | null; people: Pose[] }[]> {
  await page.next('done', id);
  return page.messages
    .filter((m) => m.type === 'poses' && m.id === id)
    .flatMap((m) => m.items!)
    .map(([frame, time, ...people]) => ({ frame, time, people: people.map((v) => decodePose(v, W, H)) }));
}

describe('the clip page', () => {
  it('starts the model from the phone’s copy of the library, on the GPU', async () => {
    const page = await openPage([runner]);
    expect(await page.next('model')).toMatchObject({ delegate: 'GPU', source: 'local' });
    expect(page.scripts).toEqual(['../lib/0.10.35/vision.js', '../lib/0.10.35/vision_wasm_internal.js']);
    expect(page.reads).toEqual(['../lib/0.10.35/pose_landmarker_full.task']);
    // The wasm loader reads a file: URL with XHR only when the URL is whole.
    expect(page.created[0].fileset).toEqual({ wasmLoaderPath: '', wasmBinaryPath: 'file:///app/Documents/pose/lib/0.10.35/vision_wasm_internal.wasm' });
    expect(page.created[0].opts).toMatchObject({ runningMode: 'IMAGE', numPoses: 2 });
  });

  it('falls back to the CPU when the GPU won’t start, loading the wasm loader again', async () => {
    const page = await openPage([runner], { gpuFails: true });
    expect(await page.next('model')).toMatchObject({ delegate: 'CPU' });
    expect(page.created.map((c) => c.opts.baseOptions.delegate)).toEqual(['GPU', 'CPU']);
    expect(page.scripts.filter((s) => s.endsWith('vision_wasm_internal.js'))).toHaveLength(2);
  });

  it('can’t find an athlete a third of the picture tall in the whole picture, which is why it reads squares', async () => {
    const page = await openPage([runner]);
    page.win.crops({ id: 1, frames: [100], fps: FPS, crops: [{ x: 0, y: -420, s: W }] });
    const [whole] = await collect(page, 1);
    expect(whole.people).toEqual([]);
    page.win.crops({ id: 2, frames: [100], fps: FPS, crops: [{ x: 300, y: 300, s: 800 }] });
    const [square] = await collect(page, 2);
    expect(square.people).toHaveLength(1);
    // Back in the picture's pixels to within the page's rounding (1e-5 of the width).
    const truth = runner(100)!;
    square.people[0].forEach((l, i) => {
      expect(l.x).toBeCloseTo(truth[i].x, 1);
      expect(l.y).toBeCloseTo(truth[i].y, 1);
    });
  });

  it('follows the athlete from a tap, forwards and backwards', async () => {
    const page = await openPage([runner]);
    const frames = Array.from({ length: 26 }, (_, i) => 100 + 4 * i);
    page.win.follow({ id: 3, frames, fps: FPS, at: hipOf(runner(100)!) });
    page.win.follow({ id: 4, frames: [...frames].reverse(), fps: FPS, at: hipOf(runner(200)!) });
    for (const id of [3, 4]) {
      const got = await collect(page, id);
      expect(got.map((g) => g.frame)).toEqual(id === 3 ? frames : [...frames].reverse());
      for (const g of got) {
        expect(g.people).toHaveLength(1);
        const h = hipOf(g.people[0]);
        const want = hipOf(runner(g.frame)!);
        expect(Math.hypot(h.x - want.x, h.y - want.y)).toBeLessThan(0.1);
      }
    }
    expect(page.messages.some((m) => m.type === 'lost' || m.type === 'error')).toBe(false);
  });

  it('says when the athlete is gone for good (here off the side of the picture)', async () => {
    const page = await openPage([runner]);
    const frames = Array.from({ length: 40 }, (_, i) => 250 + 8 * i);
    page.win.follow({ id: 5, frames, fps: FPS, at: hipOf(runner(250)!) });
    const lost = await page.next('lost', 5);
    const got = await collect(page, 5);
    expect(lost.frame).toBe(got[got.length - 1].frame);
    // Lost once the hips are past the edge and the body is mostly out of the picture, five frames in a row.
    const firstMissing = got.findIndex((g) => !g.people.length);
    expect(hipOf(runner(got[firstMissing].frame)!).x).toBeGreaterThan(W - 200);
    expect(got.length - firstMissing).toBe(5);
  });

  it('finds everyone in the picture, once each, searching squares across it', async () => {
    const bystander: Person = () => standing({ x: 1500, floor: 820, stature: 300, facing: -1 });
    const page = await openPage([runner, bystander]);
    page.win.everyone({ id: 6, frames: [40], fps: FPS });
    const [g] = await collect(page, 6);
    expect(g.people.map((p) => Math.round(hipOf(p).x)).sort((a, b) => a - b)).toEqual([440, 1500]);
  });

  it('reports each frame’s own time in the file when the browser gives it', async () => {
    const page = await openPage([runner], { frameCallback: true });
    page.win.crops({ id: 7, frames: [120, 121], fps: FPS, crops: [{ x: 300, y: 300, s: 800 }, { x: 300, y: 300, s: 800 }] });
    expect((await collect(page, 7)).map((g) => g.time)).toEqual([120 / FPS, 121 / FPS]);
  });

  it('sends 132 numbers a person, the landmarks decodePose reads', () => {
    expect(LANDMARK_COUNT * LANDMARK_FIELDS).toBe(132);
  });
});
