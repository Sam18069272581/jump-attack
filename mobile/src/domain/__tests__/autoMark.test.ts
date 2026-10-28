import { analyseCoarse, analyseFine, coarseRequest, findFlights, footprint, type DetectKind, type FrameRequest, type Grey } from '../autoMark';
import { defaultScene, renderScene, sceneTruth, type SceneOptions } from '../testing/jumpScene';

/** Runs both passes on a synthetic clip, rendering exactly the frames and crops the detector asks for. */
function detect(o: SceneOptions, kind: DetectKind = o.kind === 'drop' ? 'drop' : 'jump') {
  const video = { width: o.width, height: o.height, frames: Math.floor(o.durationS * o.fps), captureFps: o.fps };
  const grab = (r: FrameRequest) => r.frames.map((f) => renderScene(o, f, r.rect, r.w, r.h));
  const req = coarseRequest(video);
  const coarse = analyseCoarse(video, req, grab(req), kind);
  if (!coarse.ok) return coarse;
  return analyseFine(coarse.plan, grab(coarse.plan.request));
}

function grey(rows: string[], values: Record<string, number>): Grey {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8Array(w * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => (data[y * w + x] = values[ch])));
  return { w, h, data };
}

describe('footprint', () => {
  // `.` empty floor, `#` shin or shoe, `s` a shadow (or a glossy floor's mirror image) on the floor. The strip is
  // 20 rows: shins come in at the top, the shoe is in rows 12–16, the floor line is row 17. Like a real strip it is
  // mostly floor, so each row's brightness can be matched.
  const values = { '.': 130, '#': 40, s: 80, e: 117, f: 119 };
  const pad = '.'.repeat(16);
  const W = 30;
  const blank = '.'.repeat(W);
  const shin = '...###........' + pad;
  const strip = (feet: string[]) => grey([...Array(12).fill(shin), ...feet.map((r) => r + pad), ...Array(8 - feet.length).fill(blank)], values);
  const empty = grey(Array(20).fill(blank), values);
  const shoe = ['...########...', '...#########..', '...##########.', '...##########.', '...##########.'];

  it('finds the lowest row of what hangs down from the shins, column by column', () => {
    const b = footprint(strip(shoe), empty);
    expect(Array.from(b.slice(4, 13))).toEqual([16, 16, 16, 16, 16, 16, 16, 16, 16]);
    expect(b[0]).toBe(-1);
  });

  it('ignores a shadow left on the floor once a gap opens under the shoe', () => {
    const lifted = ['...########...', '...#########..', '...##########.', '..............', '..............', '..ssssssssss..'];
    const b = footprint(strip(lifted), empty);
    expect(max(b)).toBe(14);
  });

  it('counts a shadow or mirror image joined to the shoe as part of it', () => {
    const b = footprint(strip([...shoe, '..ssssssssss..', '..ssssssssss..']), empty);
    expect(max(b)).toBe(18);
  });

  it('near the floor counts a difference of more than 12 grey levels, and nothing fainter', () => {
    // On a clean strip the noise is 0, so the threshold is its floor, MIN_THRESHOLD = 12 (on the 0–255 scale; about
    // 4 σ of a phone's slow-motion noise, σ ≈ 3). Row 15 is a sole 13 (`e`, 130 − 117) or 11 (`f`, 130 − 119) levels
    // darker than the floor.
    const top = shoe.slice(0, 3);
    expect(max(footprint(strip([...top, '...eeeeeeeeee.']), empty))).toBe(15);
    expect(max(footprint(strip([...top, '...ffffffffff.']), empty))).toBe(14);
  });

  it('is not fooled by flicker that brightens a whole row', () => {
    const img = strip(shoe.slice(0, 3));
    for (let x = 0; x < W; x++) img.data[16 * W + x] += 25;
    expect(max(footprint(img, empty))).toBe(14);
  });
});

const max = (a: Int16Array) => Math.max(...Array.from(a));

describe('findFlights', () => {
  const t = true;
  const f = false;

  it('takes gaps between ground contacts, not the time before the athlete arrives', () => {
    // 24 samples per second: a 7-sample gap is about 0.3 s in the air.
    const contact = [f, f, f, t, t, t, f, f, f, f, f, f, f, t, t, t];
    expect(findFlights(contact, 24)).toEqual([{ from: 6, to: 12 }]);
  });

  it('drops gaps too short or too long to be a jump', () => {
    const contact = [t, f, t, t, ...Array(40).fill(f), t];
    expect(findFlights(contact, 24)).toEqual([]);
  });
});

describe('automatic take-off and landing', () => {
  function expectNear(o: SceneOptions, kind?: DetectKind) {
    const r = detect(o, kind);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const truth = sceneTruth(o);
    const want = o.kind === 'drop' ? [truth.touchdown!, truth.takeoff, truth.landing] : [truth.takeoff, truth.landing];
    expect(r.jumps).toHaveLength(1);
    const got = r.jumps[0].marks;
    // Within one frame of what a careful marker would pick, at 240 fps that is ±4 ms per mark.
    got.forEach((m, i) => expect(Math.abs(m - want[i])).toBeLessThanOrEqual(1));
    return got;
  }

  it('finds a CMJ in a clean clip', () => {
    expectNear(defaultScene('cmj'));
  });

  it('finds a CMJ with a shadow, a glossy floor, flicker, noise and motion blur', () => {
    expectNear(defaultScene('cmj', { shadow: 0.55, reflection: 0.35, flicker: 0.05, noise: 4, exposureS: 1 / 480, seed: 7 }));
  });

  it('sees shins only a few noise levels off the wall behind them, after a long stand', () => {
    expectNear(defaultScene('cmj', { takeoffS: 1.2019, flightS: 0.6144, shadow: 0.6, reflection: 0.4, flicker: 0.06, noise: 4.9, exposureS: 1 / 480, farFootPx: 1, seed: 4 }));
  });

  it('finds a single-leg jump with the free foot held up behind', () => {
    expectNear(defaultScene('cmj', { singleLeg: true, flightS: 0.3017, shadow: 0.4, reflection: 0.25 }));
  });

  it('finds a low jump (0.3 s in the air)', () => {
    expectNear(defaultScene('cmj', { flightS: 0.3017, shadow: 0.4 }));
  });

  it('finds the take-off and landing of a run-up jump, not the running steps', () => {
    expectNear(defaultScene('approach', { shadow: 0.4, secondFootLagS: 0.025 }));
  });

  it('does not take a foot rising over new floor for one standing there', () => {
    // A run-up carries the take-off foot forward as it rises; for a few frames a column can see its sole at one height.
    expectNear(defaultScene('approach', { takeoffS: 1.1028, flightS: 0.4559, shadow: 0.6, reflection: 0.25, flicker: 0.03, noise: 4, secondFootLagS: 0.019, farFootPx: 1, seed: 12 }));
  });

  it('finds the end of a short run-up plant while the sole and its mirror image wobble a pixel or two', () => {
    expectNear(defaultScene('approach', { takeoffS: 1.1028, flightS: 0.4559, shadow: 0.6, reflection: 0.25, flicker: 0.03, noise: 4.4, secondFootLagS: 0.019, farFootPx: 2, seed: 12 }));
  });

  it('finds the legs of a run-up under strong mains flicker', () => {
    expectNear(defaultScene('approach', { takeoffS: 1.1035, flightS: 0.6272, reflection: 0.4, flicker: 0.06, noise: 3, exposureS: 1 / 480, secondFootLagS: 0.016, courtLineMm: 23, seed: 2 }));
  });

  it('finds touch-down, take-off and landing of a drop jump from a box', () => {
    expectNear(defaultScene('drop', { shadow: 0.4 }));
  });

  it('works on a court line right behind the feet', () => {
    expectNear(defaultScene('cmj', { courtLineMm: 30, reflection: 0.3 }));
  });

  it('finds a short flight in a long clip, where the feet are off the floor in under 3 % of the samples', () => {
    // 20 s at 240 fps is sampled every 14 frames (360 samples at most): a 0.3 s flight is only about 5 of them.
    expectNear(defaultScene('cmj', { durationS: 20, takeoffS: 9.2031, flightS: 0.3017, shadow: 0.4 }));
  });

  it('gives up on a clip where the camera moves', () => {
    // 20 still samples and 4 with the picture panned 3 pixels: nearly every pixel changes in more than one sample,
    // well over the half of the picture that a person, however close, would cover.
    const video = { width: 160, height: 90, frames: 24, captureFps: 24 };
    const req = coarseRequest(video);
    let seed = 1;
    const texture = Array.from({ length: 163 * 90 }, () => ((seed = (seed * 16807) % 2147483647) % 256));
    const picture = (dx: number): Grey => {
      const data = new Uint8Array(160 * 90);
      for (let y = 0; y < 90; y++) for (let x = 0; x < 160; x++) data[y * 160 + x] = texture[y * 163 + x + dx];
      return { w: 160, h: 90, data };
    };
    const frames = req.frames.map((f) => picture(f >= 10 && f < 14 ? 3 : 0));
    expect(analyseCoarse(video, req, frames, 'jump')).toEqual({ ok: false, problem: 'shaky' });
  });

  it('reports a clip with no jump', () => {
    const r = detect(defaultScene('cmj', { takeoffS: 9, durationS: 2 }));
    expect(r).toEqual({ ok: false, problem: 'no-jump' });
  });
});
