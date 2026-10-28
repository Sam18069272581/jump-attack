import { barTrackerHtml } from '../barTrackerHtml';

/**
 * The tracker page's snap, run on drawn plates: its circle sets the scale, so a circle 3 % too big reads every speed
 * 3 % too slow. The page's script runs here against a minimal DOM whose canvas behaves like a browser's where it
 * matters: it starts at 300 × 150, and what is drawn past that is lost and reads back as transparent black.
 */

type RGB = [number, number, number];
type Frame = { width: number; height: number; at: (x: number, y: number) => RGB };
type Placed = { x: number; y: number; r: number; rx: number; ry: number; tilt: number };

class FakeCanvas {
  private w = 300;
  private h = 150;
  data = new Uint8ClampedArray(300 * 150 * 4);
  constructor(private video: FakeVideo) {}
  get width() { return this.w; }
  set width(v: number) { this.w = v; this.data = new Uint8ClampedArray(this.w * this.h * 4); }
  get height() { return this.h; }
  set height(v: number) { this.h = v; this.data = new Uint8ClampedArray(this.w * this.h * 4); }
  getContext() {
    const c = this;
    let fill: RGB = [0, 0, 0];
    const noop = () => {};
    return {
      set fillStyle(_: string) { fill = [0, 0, 0]; },
      fillRect(x: number, y: number, w: number, h: number) {
        for (let j = Math.max(0, y); j < Math.min(c.h, y + h); j++) {
          for (let i = Math.max(0, x); i < Math.min(c.w, x + w); i++) c.data.set([...fill, 255], 4 * (j * c.w + i));
        }
      },
      // drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh): each canvas pixel takes the frame at the matching point.
      drawImage(_src: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
        const f = c.video.frame;
        if (!f || dw === undefined) return;
        for (let j = Math.max(0, Math.ceil(dy - 0.5)); j < Math.min(c.h, dy + dh - 0.5); j++) {
          for (let i = Math.max(0, Math.ceil(dx - 0.5)); i < Math.min(c.w, dx + dw - 0.5); i++) {
            const p = f.at(sx + ((i + 0.5 - dx) * sw) / dw, sy + ((j + 0.5 - dy) * sh) / dh);
            c.data.set([...p, 255], 4 * (j * c.w + i));
          }
        }
      },
      getImageData(x: number, y: number, w: number, h: number) {
        const out = new Uint8ClampedArray(w * h * 4);
        for (let j = 0; j < h; j++) {
          for (let i = 0; i < w; i++) {
            const X = x + i, Y = y + j;
            if (X >= 0 && Y >= 0 && X < c.w && Y < c.h) out.set(c.data.subarray(4 * (Y * c.w + X), 4 * (Y * c.w + X) + 4), 4 * (j * w + i));
          }
        }
        return { data: out };
      },
      beginPath: noop, ellipse: noop, stroke: noop, moveTo: noop, lineTo: noop,
    };
  }
}

class FakeVideo {
  frame: Frame | null = null;
  videoWidth = 0;
  videoHeight = 0;
  duration = 2;
  private listeners: Record<string, (() => void)[]> = {};
  addEventListener(type: string, fn: () => void) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: () => void) { this.listeners[type] = (this.listeners[type] ?? []).filter((g) => g !== fn); }
  private fire(type: string) { for (const fn of [...(this.listeners[type] ?? [])]) fn(); }
  set currentTime(_: number) { Promise.resolve().then(() => this.fire('seeked')); }
  set src(_: string) {}
  load() {
    if (!this.frame) return;
    this.videoWidth = this.frame.width; this.videoHeight = this.frame.height;
    Promise.resolve().then(() => this.fire('loadedmetadata'));
  }
}

/** Loads the page on a still frame; resolves with its setCircle once the page says it is ready. */
async function openPage(frame: Frame): Promise<(x: number, y: number, r: number, snap: boolean) => Placed> {
  const html = barTrackerHtml({ video: 'v.mp4', fps: 30, accent: '#f80', bg: '#000', text: '#fff', muted: '#888' });
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const video = new FakeVideo();
  video.frame = frame;
  const el = () => ({ style: {}, value: '0', textContent: '', clientWidth: 400, clientHeight: 300, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) });
  const els: Record<string, unknown> = { video, view: new FakeCanvas(video), stage: el(), seek: el(), size: el(), msg: el(), bar: el(), busy: el(), seekRow: el(), sizeRow: el() };
  const document = { getElementById: (id: string) => els[id], createElement: () => new FakeCanvas(video) };
  let ready: () => void = () => {};
  const isReady = new Promise<void>((resolve) => { ready = resolve; });
  const win: Record<string, unknown> = {
    devicePixelRatio: 1,
    addEventListener() {},
    onTrackerMessage: (m: { type: string; message?: string }) => {
      if (m.type === 'ready') ready();
      if (m.type === 'error') throw new Error(m.message);
    },
  };
  // Timers only matter for a browser that never answers a seek; this one always does.
  new Function('window', 'document', 'setTimeout', 'XMLHttpRequest', script)(win, document, () => 0, undefined);
  await isReady;
  return win.setCircle as (x: number, y: number, r: number, snap: boolean) => Placed;
}

/** Deterministic pixel noise, ±amp grey levels. */
function grain(x: number, y: number, amp: number) {
  const h = Math.sin(Math.floor(x) * 12.9898 + Math.floor(y) * 78.233) * 43758.5453;
  return (h - Math.floor(h) - 0.5) * 2 * amp;
}
/** 0 inside, 1 outside, over about 1 px (a camera's blur) either side of a ring d px from the point. */
const ramp = (d: number) => Math.min(1, Math.max(0, 0.5 + d / 2));
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * A plate drawn the way a 20 kg bumper looks on video: a flat face, a lighter raised lip just inside the edge (0.92 to
 * 0.95 of the radius), a dark groove inside that (0.89 to 0.92) and a white printed arc on the upper half at 0.62.
 * Ellipse centre (cx, cy), semi-axes rx, ry turned by tilt (clockwise on screen), as the page writes them.
 */
function plate(o: { width: number; height: number; cx: number; cy: number; rx: number; ry: number; tilt: number; face: RGB; wall: (x: number, y: number) => RGB }): Frame {
  const c = Math.cos(o.tilt), s = Math.sin(o.tilt), lip: RGB = mix(o.face, [255, 255, 255], 0.3), groove: RGB = mix(o.face, [0, 0, 0], 0.45);
  return {
    width: o.width,
    height: o.height,
    at(x, y) {
      const dx = x - o.cx, dy = y - o.cy, u = (dx * c + dy * s) / o.rx, v = (-dx * s + dy * c) / o.ry, rho = Math.hypot(u, v);
      // Distances in pixels, to first order, from the rings at shares q of the ellipse.
      const toRing = (q: number) => (rho - q) * Math.sqrt(o.rx * o.ry);
      let p = mix(o.face, [235, 235, 230], ramp(toRing(0.6)) * (1 - ramp(toRing(0.64))) * (dy < -0.2 * o.ry ? 1 : 0));
      p = mix(p, groove, (1 - ramp(-toRing(0.89))) * (1 - ramp(toRing(0.92))));
      p = mix(p, lip, (1 - ramp(-toRing(0.92))) * (1 - ramp(toRing(0.95))));
      p = mix(p, o.wall(x, y), ramp(toRing(1)));
      const n = grain(x, y, 3);
      return [p[0] + n, p[1] + n, p[2] + n];
    },
  };
}

const verticalDiameter = (rx: number, ry: number, tilt: number) => 2 / Math.sqrt(Math.cos(tilt) ** 2 / ry ** 2 + Math.sin(tilt) ** 2 / rx ** 2);

describe('snapping the circle to the plate', () => {
  it('finds the edge of a grey plate in front of a wall just as bright, not the lip just inside it', async () => {
    // Grey (140, 140, 138) has luma 0.299·140 + 0.587·140 + 0.114·138 = 139.8; the olive wall (148, 145, 95) has
    // 0.299·148 + 0.587·145 + 0.114·95 = 140.2. In grey the edge all but vanishes and the lip at 0.935 R is the
    // outermost clear ring: a snap that took it would read the plate 6.5 % small, every speed 7 % fast.
    const setCircle = await openPage(plate({ width: 640, height: 480, cx: 330, cy: 250, rx: 90, ry: 90, tilt: 0, face: [140, 140, 138], wall: () => [148, 145, 95] }));
    // The athlete's circle: off centre and 12 % too big.
    const got = setCircle(338, 242, 101, true);
    expect(Math.abs(got.r * 2 / 180 - 1)).toBeLessThan(0.01);
    expect(Math.hypot(got.x - 330, got.y - 250)).toBeLessThan(1.5);
  });

  it('finds the edge of a leaning, foreshortened plate with a rack upright behind one side', async () => {
    // A plate filmed off square-on and to one side: an ellipse 70 × 80 px (semi-axes) turned 0.35 rad, about as
    // foreshortened as the validation set goes (axis ratio 0.875, some 29 degrees off square-on). Its height in the
    // picture is 2 / √(cos²0.35 / 80² + sin²0.35 / 70²) = 157.2 px, the scale the page must find.
    const truth = verticalDiameter(70, 80, 0.35);
    expect(truth).toBeCloseTo(157.2, 1);
    const wall = (x: number): RGB => (x > 368 && x < 392 ? [45, 45, 52] : [100 + x / 20, 96 + x / 20, 90]);
    const setCircle = await openPage(plate({ width: 640, height: 480, cx: 320, cy: 240, rx: 70, ry: 80, tilt: 0.35, face: [60, 62, 66], wall }));
    // 10 % too small.
    const got = setCircle(314, 244, 70, true);
    expect(Math.abs(got.r * 2 / truth - 1)).toBeLessThan(0.01);
  });

  it('leaves the circle where the athlete put it when nothing in the picture is a ring', async () => {
    const setCircle = await openPage({ width: 640, height: 480, at: (x, y) => { const n = grain(x, y, 3); return [120 + n, 120 + n, 120 + n]; } });
    const got = setCircle(300, 200, 80, true);
    expect(got).toEqual({ x: 300, y: 200, r: 80, rx: 80, ry: 80, tilt: 0 });
  });
});
