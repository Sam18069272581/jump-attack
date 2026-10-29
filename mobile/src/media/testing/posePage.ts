import type { Pose } from '@/domain/pose';

/**
 * Stand-ins for what the pose pages (media/poseReaderHtml.ts reads a clip, media/poseCameraHtml.ts watches the camera)
 * use in a browser, for running their scripts in tests: videos and canvases that know who is in their picture and how
 * bright it is, and MediaPipe's pose landmarker, which reports the people on the canvas it is given. Like the real
 * model's person detector, which looks at the picture shrunk to 224 px, the landmarker misses anyone under 60 px tall
 * at that size, and anyone mostly outside the square drawn.
 */

export const DETECTOR_PX = 224;
export const SMALLEST = 60;

/** What a video or canvas shows: its size, the people in it and its brightness (0–255) at a point, all in its px. */
export type Picture = { w: number; h: number; people: Pose[]; luma: (x: number, y: number) => number; locked: boolean };

export type Draw = { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number };

const insecure = () => Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' });

export class FakeCanvas {
  width = 300;
  height = 150;
  clientWidth = 400;
  clientHeight = 300;
  /** The last square drawn on it: where from in the source, where to on the canvas. */
  last: Draw | null = null;
  private shown: Omit<Picture, 'w' | 'h'> = { people: [], luma: () => 0, locked: false };

  get picture(): Picture {
    return { w: this.width, h: this.height, ...this.shown };
  }

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
      clearRect: noop,
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      stroke: noop,
      drawImage(src: { picture: Picture }, ...args: number[]) {
        const from = src.picture;
        const [sx, sy, sw, sh, dx, dy, dw, dh] = args.length === 4 ? [0, 0, from.w, from.h, ...args] : args;
        c.last = { sx, sy, sw, sh, dx, dy, dw, dh };
        const kx = dw / sw;
        const ky = dh / sh;
        c.shown = {
          people: from.people.map((p) => p.map((l) => ({ ...l, x: dx + (l.x - sx) * kx, y: dy + (l.y - sy) * ky }))),
          luma: (x, y) => (x >= dx && x < dx + dw && y >= dy && y < dy + dh ? from.luma(sx + (x - dx) / kx, sy + (y - dy) / ky) : 0),
          // A canvas that has shown another origin's frame stays locked.
          locked: c.shown.locked || from.locked,
        };
      },
      getImageData(x: number, y: number, w: number, h: number) {
        if (c.shown.locked) throw insecure();
        const data = new Uint8ClampedArray(4 * w * h);
        for (let j = 0; j < h; j++) {
          for (let i = 0; i < w; i++) {
            const v = c.shown.luma(x + i + 0.5, y + j + 0.5);
            data.set([v, v, v, 255], 4 * (j * w + i));
          }
        }
        return { data };
      },
    };
  }
}

/** Brightness `bg`, and `body` inside each person's outline box. */
export function lit(people: Pose[], bg: number, body: number) {
  const boxes = people.map((p) => ({ x0: Math.min(...p.map((l) => l.x)), x1: Math.max(...p.map((l) => l.x)), y0: Math.min(...p.map((l) => l.y)), y1: Math.max(...p.map((l) => l.y)) }));
  return (x: number, y: number) => (boxes.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) ? body : bg);
}

/** What the stand-in landmarker reports for a canvas, in MediaPipe's form: shares of the canvas's side. */
export function landmarksOn(canvas: FakeCanvas) {
  const m = canvas.last;
  const { people, locked } = canvas.picture;
  // WebGL won't take a locked canvas, nor will the CPU path read one.
  if (locked) throw insecure();
  if (!m) return { landmarks: [] };
  const d = canvas.width;
  const out: { x: number; y: number; z: number; visibility: number }[][] = [];
  for (const q of people) {
    const ys = q.map((l) => l.y);
    if (((Math.max(...ys) - Math.min(...ys)) * DETECTOR_PX) / d < SMALLEST) continue;
    const inside = q.filter((l) => l.x >= m.dx && l.x <= m.dx + m.dw && l.y >= m.dy && l.y <= m.dy + m.dh).length;
    if (inside < 0.8 * q.length) continue;
    out.push(q.map((l) => ({ x: l.x / d, y: l.y / d, z: l.z, visibility: l.v })));
  }
  return { landmarks: out };
}

export type PageMsg = { type: string; id?: number; [k: string]: unknown };

export type Page = {
  messages: PageMsg[];
  win: Record<string, any>;
  /** The next message of a type (and request id) not yet taken; rejects once the page posts an error. */
  next: (type: string, id?: number) => Promise<PageMsg>;
  /** Each start of the landmarker: the files it was given, and its options. */
  created: { fileset: { wasmLoaderPath: string; wasmBinaryPath: string }; opts: { baseOptions: { delegate: string; modelAssetBuffer: Uint8Array }; runningMode: string; numPoses: number } }[];
  /** Scripts the page loaded, and files it read with XHR. */
  scripts: string[];
  reads: string[];
};

/**
 * Runs a page's main script against a minimal DOM: `elements` by id, a stand-in for the MediaPipe library behind the
 * page's script tags and file reads, and `globals` for anything else the script uses (the camera, the recorder, timers).
 */
export function runPage(
  html: string,
  o: { elements: Record<string, unknown>; globals?: Record<string, unknown>; gpuFails?: boolean; timer?: (fn: () => void, ms: number) => unknown },
): Page {
  const start = html.indexOf('<script id="main">') + '<script id="main">'.length;
  const script = html.slice(start, html.indexOf('</script>', start));
  const messages: PageMsg[] = [];
  const waiting: { type: string; id?: number; resolve: (m: PageMsg) => void; reject: (e: Error) => void }[] = [];
  const created: Page['created'] = [];
  const scripts: string[] = [];
  const reads: string[] = [];
  const failure = (m: PageMsg) => new Error(`${m.stage ?? ''} ${m.message}`);
  const win: Record<string, any> = {
    devicePixelRatio: 1,
    onPoseMessage: (m: PageMsg) => {
      messages.push(m);
      // A page error fails whatever the test waits for, rather than leaving it to time out.
      if (m.type === 'error') return waiting.splice(0).forEach((w) => w.reject(failure(m)));
      const i = waiting.findIndex((w) => w.type === m.type && (w.id == null || w.id === m.id));
      if (i >= 0) {
        (m as { taken?: boolean }).taken = true;
        waiting.splice(i, 1)[0].resolve(m);
      }
    },
  };
  const vision = {
    PoseLandmarker: {
      createFromOptions: async (fileset: Page['created'][0]['fileset'], opts: Page['created'][0]['opts']) => {
        created.push({ fileset, opts });
        // As the library does: it takes the loader's factory, and clears it.
        if (!win.ModuleFactory) throw new Error('ModuleFactory not set.');
        win.ModuleFactory = undefined;
        if (o.gpuFails && opts.baseOptions.delegate === 'GPU') throw new Error('WebGL unavailable');
        return { detect: landmarksOn, close() {} };
      },
    },
  };
  const document = {
    getElementById: (id: string) => o.elements[id],
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
  class PageURL extends URL {
    static createObjectURL() {
      return 'blob:file:///clip';
    }
  }
  // By default only the short waits run: guards of several seconds never fire here.
  const timer = o.timer ?? ((fn: () => void, ms: number) => (ms <= 100 ? setImmediate(fn) : 0));
  const location = { href: 'file:///app/Documents/pose/run-1/page.html' };
  const globals = { window: win, self: win, document, setTimeout: timer, XMLHttpRequest: XHR, location, fetch: undefined, URL: PageURL, ...o.globals };
  new Function(...Object.keys(globals), script)(...Object.values(globals));
  const next = (type: string, id?: number) =>
    new Promise<PageMsg>((resolve, reject) => {
      const failed = messages.find((m) => m.type === 'error');
      if (failed) return reject(failure(failed));
      const seen = messages.find((m) => m.type === type && (id == null || m.id === id) && !(m as { taken?: boolean }).taken);
      if (seen) {
        (seen as { taken?: boolean }).taken = true;
        return resolve(seen);
      }
      waiting.push({ type, id, resolve, reject });
    });
  return { messages, win, next, created, scripts, reads };
}
