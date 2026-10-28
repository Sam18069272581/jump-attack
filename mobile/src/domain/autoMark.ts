/**
 * Finds take-off and landing in a jump video without anyone stepping through it frame by frame.
 *
 * The idea is the one a person uses: watch the strip of floor under the feet. With the phone on the floor and the lens
 * at ankle height (as the capture guide asks), a foot on the ground is one shape running from the shin down to the
 * floor; once the toes leave, a sliver of floor opens between the sole and the ground. So for every frame the detector
 * asks, column by column, how far down the shape that hangs from the shins reaches, and the athlete is on the ground
 * when that reaches the floor. A shadow or a glossy floor's mirror image is joined to the shoe while it stands and cut
 * off as soon as it lifts, so neither moves the answer.
 *
 * What counts as "not floor" needs a picture of the bare floor, and an athlete who stands in one place covers the same
 * patch in nearly every frame. So the bare floor is built pixel by pixel (`bareFloor`): each pixel takes the values it
 * shows when it looks like the still pixels beside it, which for the patch under the feet is mid-flight.
 *
 * 1. Coarse pass: about 24 frames a second of the whole clip, small. The pixels that ever change locate the athlete
 *    and the floor under them; gaps between ground contacts with a plausible flight time (0.15–1.2 s) are the
 *    candidate jumps.
 * 2. Fine pass: every frame around each candidate take-off and landing (and a drop jump's touch-down), the strip
 *    only, about 3 mm a pixel. Take-off is the first frame after the last one on the ground, landing the first frame
 *    back on it, the same convention as marking by hand (`flightTimeFromFrames`).
 *
 * Everything here is pure: the screen grabs the frames each pass asks for and hands them in.
 */
import { MAX_CONTACT_S, MIN_CONTACT_S } from './dropJump';
import { MAX_FLIGHT_S, MIN_FLIGHT_S } from './jump';

// Math's functions as locals: these loops run millions of times, and a global lookup per call is slow under Jest.
const { abs, ceil, max, min, round } = Math;

/** An 8-bit grey picture, row by row. */
export type Grey = { w: number; h: number; data: Uint8Array };
/** A rectangle in video pixels. */
export type Rect = { x: number; y: number; w: number; h: number };

export type VideoInfo = {
  width: number;
  height: number;
  /** Frames in the file. */
  frames: number;
  /** Real-time frames per second: 240 for a slow-motion clip even when the file plays it at 30. */
  captureFps: number;
};

/** File frames to grab, each drawn from `rect` into a `w` × `h` picture. */
export type FrameRequest = {
  frames: number[];
  rect: Rect;
  w: number;
  h: number;
};

/** A jump test has a take-off and a landing; a drop jump also the touch-down before the rebound. */
export type DetectKind = 'jump' | 'drop';

export type DetectProblem = 'shaky' | 'no-jump' | 'unsure';

/** One jump found: its marks in the marking profile's order, in file frames. */
export type DetectedJump = { marks: number[]; flightS: number };

/** Samples per real second in the coarse pass, and the most it takes from one clip. */
const COARSE_PER_S = 24;
const COARSE_MAX = 360;
/** Long side of the coarse pictures. */
const COARSE_SIDE = 160;
/** The fine pass draws the athlete about this many pixels tall (≈ 3 mm a pixel), at most this wide. */
const FINE_PERSON_PX = 600;
const FINE_MAX_W = 400;
/** The strip under the feet: from this share of the athlete's height above the lowest moving point to this below. */
const BAND_UP = 0.17;
const BAND_DOWN = 0.03;
/** A foot stands where it holds still this long (s) in the fine pass; the coarse pass asks for three samples. */
const FINE_HOLD_S = 0.025;
/** A pixel differs from the bare floor by more than this many grey levels (or 4 noise sigmas, if larger). */
const MIN_THRESHOLD = 12;

export function coarseRequest(v: VideoInfo): FrameRequest {
  let step = max(1, round(v.captureFps / COARSE_PER_S));
  if (v.frames / step > COARSE_MAX) step = ceil(v.frames / COARSE_MAX);
  const frames: number[] = [];
  for (let f = 0; f < v.frames; f += step) frames.push(f);
  const scale = min(1, COARSE_SIDE / max(v.width, v.height));
  return {
    frames,
    rect: { x: 0, y: 0, w: v.width, h: v.height },
    w: max(1, round(v.width * scale)),
    h: max(1, round(v.height * scale)),
  };
}

type Window = { from: number; to: number };

type JumpPlan = {
  touchdown?: Window;
  takeoff: Window;
  landing: Window;
  /** Frames from the middle of the flight: the bare floor. */
  empty: number[];
};

export type FinePlan = {
  kind: DetectKind;
  captureFps: number;
  request: FrameRequest;
  eps: number;
  jumps: JumpPlan[];
};

export function analyseCoarse(v: VideoInfo, req: FrameRequest, frames: Grey[], kind: DetectKind): { ok: true; plan: FinePlan } | { ok: false; problem: DetectProblem } {
  const n = frames.length;
  if (n < 8) return { ok: false, problem: 'no-jump' };
  const { w, h } = req;
  const step = n > 1 ? req.frames[1] - req.frames[0] : 1;

  // Where the athlete is: pixels that differ from the clip's median picture in more than one sample, each row's
  // brightness matched first so mains flicker doesn't drown the legs.
  const bg = medianOf(frames);
  const norm = frames.map((f) => rowMatched(f, bg));
  const sigma = noiseSigma(norm, bg);
  const thr = max(15, 4 * sigma);
  const count = new Uint16Array(w * h);
  for (const f of norm) for (let p = 0; p < w * h; p++) if (abs(f[p] - bg.data[p]) > thr) count[p]++;
  const active = new Uint8Array(w * h);
  let activeCount = 0;
  for (let p = 0; p < w * h; p++)
    if (count[p] >= 2) {
      active[p] = 1;
      activeCount++;
    }
  if (activeCount > 0.5 * w * h) return { ok: false, problem: 'shaky' };
  const person = keepLargest(active, w, h);
  if (!person) return { ok: false, problem: 'no-jump' };
  const { top, low } = person;
  const tall = low - top + 1;
  if (tall < 12) return { ok: false, problem: 'no-jump' };

  // The strip under the feet, in coarse pixels, wide enough that every row is mostly floor.
  const y0 = max(0, low - round(BAND_UP * tall));
  const y1 = min(h - 1, low + max(2, round(BAND_DOWN * tall)));
  let xa = w;
  let xb = -1;
  for (let y = y0; y <= y1; y++)
    for (let x = 0; x < w; x++)
      if (person.mask[y * w + x]) {
        xa = min(xa, x);
        xb = max(xb, x);
      }
  if (xb < 0) return { ok: false, problem: 'no-jump' };
  const margin = round(0.2 * tall);
  xa -= margin;
  xb += margin;
  const minW = round(0.6 * tall);
  if (xb - xa + 1 < minW) {
    const mid = (xa + xb) / 2;
    xa = round(mid - minW / 2);
    xb = xa + minW - 1;
  }
  xa = max(0, xa);
  xb = min(w - 1, xb);
  const band: Rect = { x: xa, y: y0, w: xb - xa + 1, h: y1 - y0 + 1 };
  const strips = frames.map((f) => crop(f, band));

  const samplesPerS = v.captureFps / step;
  const contact = contactSeries(strips, bareFloor(strips), 1, 3, 0);
  const flights = findFlights(contact, samplesPerS);
  const f = (k: number) => max(0, min(v.frames - 1, req.frames[max(0, min(n - 1, k))]));
  // Two samples either side: the coarse pass can misjudge a sample next to the event.
  const around = (a: number, b: number): Window => ({
    from: max(0, f(a) - 2 * step),
    to: min(v.frames - 1, f(b) + 2 * step),
  });

  const jumps: JumpPlan[] = [];
  for (const fl of flights) {
    let touchdown: Window | undefined;
    if (kind === 'drop') {
      // The rebound follows a short ground contact, which itself follows the drop off the box.
      let p = fl.from - 1;
      while (p > 0 && contact[p - 1]) p--;
      if (p === 0 || (fl.from - p - 1) / samplesPerS > MAX_CONTACT_S) continue;
      touchdown = around(p - 1, p);
    }
    const a = req.frames[fl.from];
    const b = req.frames[fl.to];
    const empties = new Set<number>();
    for (let i = 0; i < 7; i++) empties.add(round(a + (b - a) * (0.25 + (0.5 * i) / 6)));
    jumps.push({
      ...(touchdown ? { touchdown } : {}),
      takeoff: around(fl.from - 1, fl.from),
      landing: around(fl.to, fl.to + 1),
      empty: [...empties],
    });
  }
  if (!jumps.length) return { ok: false, problem: 'no-jump' };

  // The fine pass: the same strip in video pixels, drawn about 3 mm a pixel.
  const sx = v.width / w;
  const sy = v.height / h;
  const rect: Rect = {
    x: band.x * sx,
    y: band.y * sy,
    w: band.w * sx,
    h: band.h * sy,
  };
  let scale = min(1, FINE_PERSON_PX / (tall * sy));
  if (rect.w * scale > FINE_MAX_W) scale = FINE_MAX_W / rect.w;
  const all = new Set<number>();
  for (const j of jumps) {
    for (const win of [j.touchdown, j.takeoff, j.landing]) if (win) for (let i = win.from; i <= win.to; i++) all.add(i);
    for (const e of j.empty) all.add(e);
  }
  const request: FrameRequest = {
    frames: [...all].sort((p, q) => p - q),
    rect,
    w: max(1, round(rect.w * scale)),
    h: max(1, round(rect.h * scale)),
  };
  // A foot is down when it reaches within a pixel or so (≈ 3 mm) of where it stood.
  const eps = max(1, round(tall * sy * scale * 0.0015));
  return {
    ok: true,
    plan: { kind, captureFps: v.captureFps, request, eps, jumps },
  };
}

export function analyseFine(plan: FinePlan, frames: Grey[]): { ok: true; jumps: DetectedJump[] } | { ok: false; problem: DetectProblem } {
  const byFrame = new Map<number, Grey>();
  plan.request.frames.forEach((f, i) => byFrame.set(f, frames[i]));
  const jumps: DetectedJump[] = [];
  let unsure = false;
  for (const j of plan.jumps) {
    const wins = [j.touchdown, j.takeoff, j.landing].filter((x): x is Window => x != null);
    const idx = wins.flatMap((win) => range(win.from, win.to));
    const segment = wins.flatMap((win, i) => range(win.from, win.to).map(() => i));
    const empty = bareFloor([...idx, ...j.empty].map((f) => byFrame.get(f)!));
    const contact = new Map<number, boolean>();
    const series = contactSeries(
      idx.map((f) => byFrame.get(f)!),
      empty,
      plan.eps,
      max(3, round(FINE_HOLD_S * plan.captureFps)),
      2,
      segment,
    );
    idx.forEach((f, i) => contact.set(f, series[i]));
    const seq = (win: Window) => clean(range(win.from, win.to).map((f) => contact.get(f)!));

    const off = seq(j.takeoff);
    const lastDown = off.lastIndexOf(true);
    const on = seq(j.landing);
    const firstUp = on.indexOf(false);
    const firstDown = firstUp < 0 ? -1 : on.indexOf(true, firstUp);
    if (lastDown < 0 || lastDown >= off.length - 2 || firstDown < 0) {
      unsure = true;
      continue;
    }
    const takeoff = j.takeoff.from + lastDown + 1;
    const landing = j.landing.from + firstDown;
    const flightS = (landing - takeoff) / plan.captureFps;
    if (flightS < MIN_FLIGHT_S || flightS > MAX_FLIGHT_S) continue;
    if (j.touchdown) {
      const td = seq(j.touchdown);
      const up = td.indexOf(false);
      const down = up < 0 ? -1 : td.indexOf(true, up);
      if (down < 0) {
        unsure = true;
        continue;
      }
      const touchdown = j.touchdown.from + down;
      const contactS = (takeoff - touchdown) / plan.captureFps;
      if (contactS < MIN_CONTACT_S || contactS > MAX_CONTACT_S) {
        unsure = true;
        continue;
      }
      jumps.push({ marks: [touchdown, takeoff, landing], flightS });
    } else {
      jumps.push({ marks: [takeoff, landing], flightS });
    }
  }
  if (!jumps.length) return { ok: false, problem: unsure ? 'unsure' : 'no-jump' };
  return { ok: true, jumps };
}

/**
 * Gaps between ground contacts that could be a jump, as runs of samples in the air. A gap before the first contact
 * (the athlete still on a box, or not yet in the picture) or after the last is not one.
 */
export function findFlights(contact: boolean[], samplesPerS: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let i = 0;
  while (i < contact.length) {
    if (contact[i] || i === 0) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < contact.length && !contact[j + 1]) j++;
    const bracketed = contact[i - 1] && j + 1 < contact.length;
    // The real flight lies between (j − i) and (j − i + 2) sample gaps.
    if (bracketed && (j - i + 2) / samplesPerS >= MIN_FLIGHT_S && (j - i) / samplesPerS <= MAX_FLIGHT_S) out.push({ from: i, to: j });
    i = j + 1;
  }
  return out;
}

/**
 * For each column, the lowest row of what differs from the bare floor and hangs down unbroken from the top edge of the
 * strip (the shins), or -1. Each row's overall brightness is matched to the floor first, so mains flicker, which slow
 * motion catches as bands across the rows, doesn't read as a change.
 */
export function footprint(img: Grey, empty: Grey, minThreshold = MIN_THRESHOLD): Int16Array {
  const { w, h } = img;
  const res = new Int16Array(w * h);
  const hist = new Uint32Array(511);
  for (let y = 0; y < h; y++) {
    hist.fill(0);
    for (let x = 0; x < w; x++) hist[img.data[y * w + x] - empty.data[y * w + x] + 255]++;
    const off = histMedian(hist, w) - 255;
    for (let x = 0; x < w; x++) res[y * w + x] = img.data[y * w + x] - empty.data[y * w + x] - off;
  }
  const sizes = new Uint32Array(511);
  for (let p = 0; p < w * h; p++) sizes[abs(res[p])]++;
  const sigma = 1.4826 * histMedian(sizes, w * h);
  const thr = max(minThreshold, 4 * sigma);
  // Up among the shins a leg can be nearly the colour of the wall behind it, so there a fainter difference counts,
  // averaged over 3×3 pixels to keep noise from breaking the leg into specks. Near the floor (the lowest third or so of
  // the strip, the floor being 85 % of the way down), where a gap of a few pixels decides, only a clear difference in
  // the pixel itself does.
  const half = round(h * 0.65);
  const smooth = new Float32Array(w * half);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
          sum += abs(res[yy * w + xx]);
          cnt++;
        }
      }
      smooth[y * w + x] = sum / cnt;
    }
  }
  // Averaged sizes of differences (signs would cancel where a dark shin meets a white sock): noise alone averages 0.8 σ.
  const faint = max(minThreshold / 2, 1.6 * sigma);
  const differs = (p: number) => (p < w * half ? smooth[p] > faint : abs(res[p]) > thr);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++)
    if (differs(x)) {
      seen[x] = 1;
      stack.push(x);
    }
  const bottom = new Int16Array(w).fill(-1);
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    if (y > bottom[x]) bottom[x] = y;
    const next = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
    for (const q of next)
      if (q >= 0 && !seen[q] && differs(q)) {
        seen[q] = 1;
        stack.push(q);
      }
  }
  return bottom;
}

/**
 * On the ground, frame by frame: some column reaches within `eps` rows of where that column's foot stood (or, in that
 * frame alone, all the way). Where a foot stood is the lowest row a column held for a few frames in a row; columns no
 * foot stood in use a line through the others, so a foot swinging low over new ground still has a floor to be measured
 * against.
 */
export function contactSeries(strips: Grey[], empty: Grey, eps: number, hold: number, span: number, segment?: number[]): boolean[] {
  const bottoms = strips.map((s) => footprint(s, empty));
  const { w, h } = empty;
  const n = bottoms.length;
  const ground = new Int16Array(w).fill(-1);
  const pts: [number, number][] = [];
  // Each column's bottom, smoothed over `span` frames either side: in the fine pass the edge of a faint mirror image on a
  // glossy floor wobbles a pixel or two with noise. A median keeps the step a take-off or landing makes where it is, and
  // a column with nothing in it counts, so a foot that has moved on doesn't linger.
  const seg = (k: number) => (segment ? segment[k] : 0);
  const steady = bottoms.map((b, k) => {
    const out = new Int16Array(w);
    const near: number[] = [];
    for (let x = 0; x < w; x++) {
      if (b[x] < 0) {
        out[x] = -1;
        continue;
      }
      near.length = 0;
      for (let i = max(0, k - span); i <= min(n - 1, k + span); i++) if (seg(i) === seg(k)) near.push(bottoms[i][x]);
      near.sort((p, q) => p - q);
      out[x] = near[near.length >> 1];
    }
    return out;
  });
  // Only a column that is the lowest point around it (within ≈ 7 cm) can be touching: the sole behind toes that a
  // push-off has tipped up hangs above the floor, and must not teach the detector a floor that high.
  const reach = max(1, round(0.2 * h));
  const lowest = steady.map((b) => {
    const out = new Int16Array(w).fill(-1);
    for (let x = 0; x < w; x++) {
      if (b[x] < 0) continue;
      let m = -1;
      for (let i = max(0, x - reach); i <= min(w - 1, x + reach); i++) m = max(m, b[i]);
      if (b[x] >= m - 1) out[x] = b[x];
    }
    return out;
  });
  // How far above the floor a still foot counts as hovering (≈ 15 mm: the strip is about a fifth of the athlete's
  // height).
  const tol = max(1, round(h / 24));
  // A fine-pass window reaches at most three coarse steps (≈ 0.13 s) past the take-off or landing it is around, less
  // than the shortest flight, so it can't hold a whole flight. A column that reached lower both before and after a
  // level it held, in the same window, stood through it (see the line below). The coarse pass has no windows: its one
  // series runs through every flight, and a foot reaches lower before and after the top of one.
  const stood = new Uint8Array(w);
  const lowerBy = (x: number, k: number, dir: number, level: number) => {
    for (let i = k + dir; i >= 0 && i < n && seg(i) === seg(k); i += dir) if (steady[i][x] > level + tol) return true;
    return false;
  };
  for (let x = 0; x < w; x++) {
    // `hold` frames in a row within two pixels (the sole's edge wobbles with noise). A foot in the air rarely holds still
    // that long, except near the top of a flight, or when a run-up carries it forward as it rises and a column sees its
    // sloping sole at one height for a few frames.
    for (let k = 0; k + hold - 1 < lowest.length; k++) {
      if (segment && segment[k] !== segment[k + hold - 1]) continue;
      let lo = Infinity;
      let hi = -1;
      for (let i = k; i < k + hold && hi - lo <= 2; i++) {
        const v = lowest[i][x];
        if (v < 0) hi = Infinity;
        lo = min(lo, v);
        hi = max(hi, v);
      }
      if (hi - lo <= 2) {
        const inside = segment != null && lowerBy(x, k, -1, hi) && lowerBy(x, k + hold - 1, 1, hi);
        if (hi > ground[x]) stood[x] = inside ? 1 : 0;
        else if (hi === ground[x] && inside) stood[x] = 1;
        ground[x] = max(ground[x], hi);
      }
    }
    // The floor is in the lower half of the strip; a foot hanging at the top edge near the peak is not standing.
    if (ground[x] >= 0 && ground[x] < h / 2) ground[x] = -1;
    if (ground[x] >= 0) pts.push([x, ground[x]]);
  }
  // Most columns that held still held still on the floor; one that held well above its neighbours saw a foot hovering
  // at the top of a low jump. Mirror images on a glossy floor only make a standing foot reach lower, so they never look
  // like that.
  const onFloor = pts.filter(([x, y]) => {
    const near = pts.filter(([x2]) => abs(x2 - x) <= h).map(([, y2]) => y2);
    return y >= middle(near) - tol;
  });
  // A foot carried forward at one height by a run-up can hold still over columns no foot stood near, and then it is its
  // own only neighbour. So also measure every point against the line through all of them: drop the one furthest above
  // it and refit, until none is more than that same margin above. One at a time, because the hovering points tilt the
  // first line, and the floor at the far end of the strip can look high against it. A column that stood through its
  // level is never dropped: on a glossy floor a foot on its toes holds two levels, with its mirror image and without it
  // when compression cuts the neck between them (see the end), and the line, drawn mostly through feet with their
  // mirror images, runs below the higher one.
  let line = fitLine(onFloor);
  while (line) {
    const l = line;
    const above = ([x, y]: [number, number]) => (stood[x] ? Infinity : y - l(x));
    let worst = -1;
    for (let i = 0; i < onFloor.length; i++) if (worst < 0 || above(onFloor[i]) < above(onFloor[worst])) worst = i;
    if (above(onFloor[worst]) >= -tol) break;
    onFloor.splice(worst, 1);
    line = fitLine(onFloor);
  }
  ground.fill(-1);
  for (const [x, y] of onFloor) ground[x] = y;
  const reaches = (b: Int16Array, slack: number) => {
    for (let x = 0; x < w; x++) {
      if (b[x] < 0) continue;
      const ref = ground[x] >= 0 ? ground[x] : line ? line(x) : Infinity;
      if (b[x] >= ref - slack) return true;
    }
    return false;
  };
  // A frame whose own footprint reaches all the way to where the foot stood is down, whatever its neighbours show. On
  // its toes, a foot meets its mirror image through a neck a pixel wide at the floor line, and video compression wipes
  // that neck out in some frames: the footprint then stops at the sole. Late in a push-off that happens in most of the
  // five frames the median above takes, and the median alone would call a foot still pushing off gone. Only the
  // smoothed bottoms get `eps` of slack: a single frame's edge wobbles by that much in the air too.
  return steady.map((b, k) => reaches(b, eps) || reaches(bottoms[k], 0));
}

function fitLine(pts: [number, number][]): ((x: number) => number) | null {
  if (!pts.length) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  const sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  const sxy = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  const slope = sxx > 0 ? max(-0.05, min(0.05, sxy / sxx)) : 0;
  return (x) => my + slope * (x - mx);
}

/** Single-frame flips are noise: a foot isn't down for one frame in the middle of a flight, or up for one mid-stance. */
function clean(seq: boolean[]): boolean[] {
  return seq.map((c, i) => (i > 0 && i < seq.length - 1 && seq[i - 1] === seq[i + 1] && c !== seq[i - 1] ? seq[i - 1] : c));
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

function histMedian(hist: Uint32Array, total: number): number {
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc * 2 >= total) return i;
  }
  return hist.length - 1;
}

/**
 * The floor without the athlete, pixel by pixel, from a set of strips. Each pixel takes the values it shows when it
 * looks like the still pixels next to it in the same row: the floor where nobody stands, or the wall behind the shins.
 * Picking whole frames doesn't work: an athlete who stands in one place stands in nearly all of them, and the frames
 * where they don't (mid-flight) are the ones still to be found.
 */
export function bareFloor(strips: Grey[]): Grey {
  const { w, h } = strips[0];
  const n = strips.length;
  const usual = medianOf(strips);
  // Each strip with its rows' overall brightness matched to the usual strip (flicker).
  const norm = strips.map((s) => rowMatched(s, usual));
  const dev = new Uint32Array(256);
  let total = 0;
  for (const f of norm)
    for (let p = 0; p < w * h; p += 5) {
      dev[min(255, abs(f[p] - usual.data[p]))]++;
      total++;
    }
  const sigma = max(1, 1.4826 * histMedian(dev, total));
  const thr = max(MIN_THRESHOLD, 4 * sigma);
  // Still pixels: never more than noise away from usual, bar three frames. "More than noise" is 3 sigmas, not the 4
  // that mark the athlete: a shin barely lighter than the wall, there in most frames, must not pass for still. And
  // three frames, not a share of the clip: a short flight in a long clip uncovers the floor in only a few samples.
  const still = new Uint8Array(w * h);
  const stillThr = max(MIN_THRESHOLD / 2, 3 * sigma);
  const allowed = 3;
  for (let p = 0; p < w * h; p++) {
    let moved = 0;
    for (let k = 0; k < n && moved <= allowed; k++) if (abs(norm[k][p] - usual.data[p]) > stillThr) moved++;
    still[p] = moved <= allowed ? 1 : 0;
  }
  const out = new Uint8Array(w * h);
  const vals = new Float32Array(n);
  // The values a pixel keeps coming back to near `from`: the mean of those within 2.5 noise sigmas, moved until it
  // settles. A shin a few noise sigmas off the wall stays out of the wall's group, however long the athlete stands.
  const settle = (from: number) => {
    let at = from;
    let support = 0;
    for (let it = 0; it < 6; it++) {
      let sum = 0;
      support = 0;
      for (let k = 0; k < n; k++)
        if (abs(vals[k] - at) <= 2.5 * sigma) {
          sum += vals[k];
          support++;
        }
      if (!support) break;
      at = sum / support;
    }
    return { at, support };
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (still[p]) {
        out[p] = usual.data[p];
        continue;
      }
      for (let k = 0; k < n; k++) vals[k] = norm[k][p];
      // The nearest still pixels to the left and right show what is behind; whichever this pixel shows more often wins.
      // A pixel the athlete never leaves takes its neighbours' background.
      let best = { at: usual.data[p], support: 0 };
      let fallback = -1;
      for (const dir of [-1, 1]) {
        let i = x + dir;
        while (i >= 0 && i < w && !still[y * w + i]) i += dir;
        if (i < 0 || i >= w) continue;
        // The first still pixel can be one the athlete's edge half covers the whole time a foot stands: a blend that
        // changes by less than noise when the foot leaves, and whose value can draw the search below into the sock's
        // or shoe's group. The one beyond it, if still too, is clear of the edge.
        if (i + dir >= 0 && i + dir < w && still[y * w + i + dir]) i += dir;
        const ref = usual.data[y * w + i];
        fallback = fallback < 0 ? ref : (fallback + ref) / 2;
        const m = settle(ref);
        if (m.support >= 3 && abs(m.at - ref) <= thr && m.support > best.support) best = m;
      }
      out[p] = max(0, min(255, round(best.support ? best.at : fallback >= 0 ? fallback : usual.data[p])));
    }
  }
  return { w, h, data: out };
}

function middle(a: number[]): number {
  const s = [...a].sort((p, q) => p - q);
  return s[s.length >> 1];
}

/** Pixel-wise median of same-sized pictures. */
function medianOf(frames: Grey[]): Grey {
  const { w, h } = frames[0];
  const out = new Uint8Array(w * h);
  const counts = new Uint32Array(256);
  const n = frames.length;
  for (let p = 0; p < w * h; p++) {
    for (const f of frames) counts[f.data[p]]++;
    let acc = 0;
    let v = 0;
    while (v < 255 && (acc += counts[v]) * 2 < n) v++;
    out[p] = v;
    for (const f of frames) counts[f.data[p]] = 0;
  }
  return { w, h, data: out };
}

function noiseSigma(frames: Int16Array[], bg: Grey): number {
  const hist = new Uint32Array(256);
  let total = 0;
  for (const f of frames)
    for (let p = 0; p < f.length; p += 7) {
      hist[min(255, abs(f[p] - bg.data[p]))]++;
      total++;
    }
  return 1.4826 * histMedian(hist, total);
}

/** A picture with each row's overall brightness moved to match `ref`'s: slow motion catches mains flicker as bands. */
function rowMatched(s: Grey, ref: Grey): Int16Array {
  const { w, h } = s;
  const out = new Int16Array(w * h);
  const hist = new Uint32Array(511);
  for (let y = 0; y < h; y++) {
    hist.fill(0);
    for (let x = 0; x < w; x++) hist[s.data[y * w + x] - ref.data[y * w + x] + 255]++;
    const off = histMedian(hist, w) - 255;
    for (let x = 0; x < w; x++) out[y * w + x] = s.data[y * w + x] - off;
  }
  return out;
}

function crop(f: Grey, r: Rect): Grey {
  const data = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) data.set(f.data.subarray((r.y + y) * f.w + r.x, (r.y + y) * f.w + r.x + r.w), y * r.w);
  return { w: r.w, h: r.h, data };
}

/** The biggest group of changing pixels, plus any group at least a sixth its size (arms, the other leg). */
function keepLargest(mask: Uint8Array, w: number, h: number): { mask: Uint8Array; top: number; low: number } | null {
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (!mask[p] || label[p] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [p];
    label[p] = id;
    while (stack.length) {
      const q = stack.pop()!;
      size++;
      const x = q % w;
      const y = (q - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const r = ny * w + nx;
          if (mask[r] && label[r] < 0) {
            label[r] = id;
            stack.push(r);
          }
        }
      }
    }
    sizes.push(size);
  }
  if (!sizes.length) return null;
  const biggest = max(...sizes);
  if (biggest < 0.002 * w * h) return null;
  const keep = sizes.map((s) => s >= max(4, biggest / 6));
  const out = new Uint8Array(w * h);
  let top = h;
  let low = -1;
  const rowCount = new Uint16Array(h);
  for (let p = 0; p < w * h; p++)
    if (label[p] >= 0 && keep[label[p]]) {
      out[p] = 1;
      rowCount[(p - (p % w)) / w]++;
    }
  for (let y = 0; y < h; y++)
    if (rowCount[y] >= 2) {
      top = min(top, y);
      low = y;
    }
  return low < 0 ? null : { mask: out, top, low };
}
