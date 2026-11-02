import { decodePose, LANDMARK_COUNT, LANDMARK_FIELDS, LM, type Pose } from '@/domain/pose';
import { standing } from '@/domain/testing/standing';

import { poseReaderHtml } from '../poseReaderHtml';
import { FakeCanvas, runPage, type Page, type Picture } from '../testing/posePage';

/**
 * The clip page's script, run against a minimal DOM and a stand-in for MediaPipe's pose landmarker that, like the real
 * model, misses people too small in the square it is given (media/testing/posePage.ts).
 */

const W = 1920;
const H = 1080;
const FPS = 240;

type Person = (frame: number) => Pose | null;

class FakeVideo {
  videoWidth = 0;
  videoHeight = 0;
  duration = 4;
  frame = 0;
  error = null;
  source = '';
  private listeners: Record<string, (() => void)[]> = {};
  private callbacks: ((now: number, meta: { mediaTime: number }) => void)[] = [];
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => void;
  constructor(
    public people: Person[],
    frameCallback: boolean,
    /** Whether WebKit takes the clip for another origin's, and locks a canvas it is drawn on. */
    private locks: boolean,
    private size = { w: W, h: H },
  ) {
    if (frameCallback) this.requestVideoFrameCallback = (cb) => void this.callbacks.push(cb);
  }
  get picture(): Picture {
    const people = this.people.map((p) => p(this.frame)).filter((p): p is Pose => p != null);
    return { w: this.videoWidth, h: this.videoHeight, people, luma: () => 128, locked: this.locks && !this.source.startsWith('blob:') };
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
  set src(v: string) {
    this.source = v;
  }
  load() {
    this.videoWidth = this.size.w;
    this.videoHeight = this.size.h;
    Promise.resolve().then(() => this.fire('loadedmetadata'));
  }
}

type Opened = Page & { video: FakeVideo };

async function openPage(people: Person[], o: { gpuFails?: boolean; frameCallback?: boolean; locked?: boolean; size?: { w: number; h: number } } = {}): Promise<Opened> {
  const video = new FakeVideo(people, o.frameCallback ?? false, o.locked ?? false, o.size);
  const page = runPage(poseReaderHtml({ video: 'clip.mov', bg: '#000', accent: '#f80' }), { elements: { video, view: new FakeCanvas() }, gpuFails: o.gpuFails });
  await page.next('ready');
  return { ...page, video };
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
    .flatMap((m) => m.items as [number, number | null, ...number[][]][])
    .map(([frame, time, ...people]) => ({ frame, time, people: people.map((v) => decodePose(v, page.video.videoWidth, page.video.videoHeight)) }));
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

  // An upright clip filmed close: the athlete about 1.3 m from the phone, 1300 of the picture's 1920 px tall, standing
  // still with the feet at y 1750. Taps land anywhere on the body, not only on the hips.
  const PORTRAIT = { w: 1080, h: 1920 };
  const close: Person = () => standing({ x: 540, floor: 1750, stature: 1300, yaw: 90 });

  it.each([
    ['the head', LM.nose],
    ['a knee', LM.leftKnee],
    ['a foot', LM.leftAnkle],
    ['the hips', LM.leftHip],
  ])('locks on to an athlete filmed close wherever they were tapped (%s), and follows them', async (_, point) => {
    const page = await openPage([close], { size: PORTRAIT });
    const frames = Array.from({ length: 8 }, (_, i) => 100 + 4 * i);
    const tap = close(100)![point];
    page.win.follow({ id: 9, frames, fps: FPS, at: { x: tap.x, y: tap.y } });
    const got = await collect(page, 9);
    expect(got.map((g) => g.frame)).toEqual(frames);
    for (const g of got) {
      expect(g.people).toHaveLength(1);
      expect(Math.abs(hipOf(g.people[0]).y - hipOf(close(g.frame)!).y)).toBeLessThan(0.5);
    }
    expect(page.messages.some((m) => m.type === 'lost')).toBe(false);
  });

  it('locks on to the person tapped, not a bystander whose hips are nearer the tap', async () => {
    // The tap on the athlete's foot; a bystander behind them, smaller, with their hips beside it.
    const bystander: Person = () => standing({ x: 800, floor: 1500, stature: 500, facing: -1 });
    const page = await openPage([close, bystander], { size: PORTRAIT });
    const foot = close(100)![LM.leftAnkle];
    page.win.follow({ id: 10, frames: [100, 104, 108], fps: FPS, at: { x: foot.x, y: foot.y } });
    const got = await collect(page, 10);
    // Followed in a square around the athlete: one around the bystander would leave the athlete out.
    for (const g of got) expect(g.people.some((p) => Math.abs(hipOf(p).x - 540) < 1)).toBe(true);
  });

  it('searches the whole picture again once the square has missed the athlete twice, but won’t take someone twice their size for them', async () => {
    // Standing still at x 600; hidden from frame 120 to 131 (a frame is read every 4), while someone walks up close to the
    // phone right there, three times the athlete's size; from 132 the athlete is back, 300 px to the right.
    const athlete: Person = (f) => (f < 120 ? standing({ x: 600, floor: 900, stature: 380 }) : f >= 132 ? standing({ x: 900, floor: 900, stature: 380 }) : null);
    const passer: Person = (f) => (f >= 120 && f < 132 ? standing({ x: 640, floor: 1060, stature: 1050 }) : null);
    const page = await openPage([athlete, passer]);
    const frames = Array.from({ length: 12 }, (_, i) => 100 + 4 * i);
    page.win.follow({ id: 12, frames, fps: FPS, at: hipOf(athlete(100)!) });
    const got = await collect(page, 12);
    expect(page.messages.some((m) => m.type === 'lost' && m.id === 12)).toBe(false);
    // Found again where they reappeared, by the search across the whole picture, and followed from there.
    for (const g of got.filter((g) => g.frame >= 132)) expect(g.people.some((p) => Math.abs(hipOf(p).x - 900) < 1)).toBe(true);
  });

  it('finds a person taller than its squares: the whole picture is one of them', async () => {
    const tall: Person = () => standing({ x: 540, floor: 1850, stature: 1600, yaw: 90 });
    const page = await openPage([tall], { size: PORTRAIT });
    page.win.everyone({ id: 11, frames: [40], fps: FPS });
    const [g] = await collect(page, 11);
    expect(g.people).toHaveLength(1);
    expect(hipOf(g.people[0]).y).toBeCloseTo(hipOf(tall(40)!).y, 0);
  });

  it('finds everyone in the picture, once each, searching squares across it', async () => {
    const bystander: Person = () => standing({ x: 1500, floor: 820, stature: 300, facing: -1 });
    const page = await openPage([runner, bystander]);
    page.win.everyone({ id: 6, frames: [40], fps: FPS });
    const [g] = await collect(page, 6);
    expect(g.people.map((p) => Math.round(hipOf(p).x)).sort((a, b) => a - b)).toEqual([440, 1500]);
  });

  it('loads a clip the canvas is locked for (another origin to WebKit) again as a blob, and reads it', async () => {
    const page = await openPage([runner], { locked: true });
    expect(page.reads).toContain('clip.mov');
    expect(page.video.source).toBe('blob:file:///clip');
    page.win.crops({ id: 8, frames: [100], fps: FPS, crops: [{ x: 300, y: 300, s: 800 }] });
    expect((await collect(page, 8))[0].people).toHaveLength(1);
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
