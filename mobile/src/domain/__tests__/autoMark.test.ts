import { analyseCoarse, analyseFine, analysePoseFine, bareFloor, coarseRequest, contactSeries, findFlights, footprint, planFromPose, type DetectKind, type FrameRequest, type Grey } from '../autoMark';
import type { PoseFlight, Spot } from '../poseJump';
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

describe('bareFloor', () => {
  it("takes what is behind a sock from the wall, not from a pixel half covered by the sock's edge", () => {
    // One row, 40 frames: wall at 180 everywhere, a sock (200) over columns 7–12 for 32 frames and gone for 8. Column
    // 6 is the sock's edge, half wall: 192 while it stands, 180 when it's gone. With noise σ ≈ 4.4 (half the readings
    // within 3 grey levels), 12 levels is under the 3 σ that mark a pixel moved, so column 6 counts as still; settling
    // from its 192 would end in the sock's group, 8 levels off (within 2.5 σ), and erase the sock.
    const w = 24;
    const wobble = [-6, -3, -3, 0, 3, 3, 6];
    const strips = Array.from({ length: 40 }, (_, k): Grey => {
      const stands = k < 32;
      const data = new Uint8Array(w);
      for (let x = 0; x < w; x++) {
        const base = x === 6 ? (stands ? 192 : 180) : x >= 7 && x <= 12 && stands ? 200 : 180;
        data[x] = base + (x === 6 && !stands ? 0 : wobble[(k * 3 + x * 5) % 7]);
      }
      return { w, h: 1, data };
    });
    const bare = bareFloor(strips);
    for (let x = 7; x <= 12; x++) expect(Math.abs(bare.data[x] - 180)).toBeLessThan(6);
  });
});

describe('contactSeries', () => {
  // Strips 40 rows high with the floor line at row 34. A foot is a dark column block hanging from the top edge down to
  // its sole's row; everything else is bare floor. eps 1, hold 6 and span 2 are what the fine pass uses at 240 fps.
  const H = 40;
  type Foot = [from: number, to: number, sole: number];
  const frame = (w: number, feet: Foot[]): Grey => {
    const data = new Uint8Array(w * H).fill(130);
    for (const [from, to, sole] of feet) for (let y = 0; y <= sole; y++) for (let x = from; x <= to; x++) data[y * w + x] = 40;
    return { w, h: H, data };
  };
  const bare = (w: number) => frame(w, []);
  const seq = (n: number, f: (k: number) => Foot[], w: number) => Array.from({ length: n }, (_, k) => frame(w, f(k)));

  it('does not let a foot held still in mid-air, far from where feet stood, raise the floor elsewhere', () => {
    // Feet stand at both ends of a 240-column strip for 12 frames while a run-up foot holds still at row 24, 10 rows up,
    // in columns more than a strip's height from either: it is its own only neighbour. A fourth foot walks across new
    // floor, 2 columns a frame, and from frame 12 on is 3 rows up. Fitted through all three, the floor line would be
    // near row 31, and the lifted foot would still look down against it.
    const w = 240;
    const strips = seq(
      20,
      (k) => [
        ...(k < 12
          ? ([
              [10, 30, 34],
              [200, 220, 34],
              [110, 125, 24],
            ] as Foot[])
          : []),
        [40 + 2 * k, 48 + 2 * k, k < 12 ? 34 : 31],
      ],
      w,
    );
    const down = contactSeries(strips, bare(w), 1, 6, 2);
    expect(down).toEqual([...Array(12).fill(true), ...Array(8).fill(false)]);
  });

  it('keeps a foot down while compression breaks its join to the floor in most frames', () => {
    // A foot stands on columns 20–40 for 12 frames, then for 5 frames only 4 of its columns, a different 4 each frame,
    // still reach the floor row; the rest stop 4 rows short (on its toes, sole and mirror image meet through a neck
    // a pixel wide that video compression wipes out in some frames). Then it is in the air, 9 rows up. Smoothed over
    // 5 frames each column is short of the floor from frame 13 on; each frame on its own still touches.
    const w = 100;
    const strips = seq(
      23,
      (k) =>
        k < 12
          ? [[20, 40, 34]]
          : k < 17
            ? [
                [20, 40, 30],
                [20 + 4 * (k - 12), 23 + 4 * (k - 12), 34],
              ]
            : [[20, 40, 25]],
      w,
    );
    const down = contactSeries(strips, bare(w), 1, 6, 2);
    expect(down).toEqual([...Array(17).fill(true), ...Array(6).fill(false)]);
  });

  it("keeps the floor where a foot on its toes stood, though a glossy floor's mirror image runs deeper elsewhere", () => {
    // Two fine-pass windows. Around take-off (24 frames) a toe on columns 100–104 reaches row 37 with its mirror image
    // for 4 frames, row 32 without it for 8 (compression cut the neck between them), 37 for 4 more, 32 for 2, then
    // leaves the floor at frame 18. Around landing (20 frames), feet with their mirror images land at row 36 on
    // columns 20–55 and 150–190, more than a strip's height away. The line through all of them runs 4 rows below the
    // toe's row 32, more than the 2 rows (≈ 15 mm) that mark a hovering foot; but the toe reached lower both before and
    // after it held row 32, in the same window, so it stood there.
    const w = 200;
    const toe = (k: number): Foot[] => [[100, 104, k < 4 || (k >= 12 && k < 16) ? 37 : k < 18 ? 32 : 25]];
    const land = (k: number): Foot[] => [
      [20, 55, k < 30 ? 22 : 36],
      [150, 190, k < 30 ? 22 : 36],
    ];
    const strips = seq(44, (k) => (k < 24 ? toe(k) : land(k)), w);
    const segment = Array.from({ length: 44 }, (_, k) => (k < 24 ? 0 : 1));
    const down = contactSeries(strips, bare(w), 1, 6, 2, segment);
    expect(down).toEqual([...Array(18).fill(true), ...Array(12).fill(false), ...Array(14).fill(true)]);
  });
});

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
    const texture = Array.from({ length: 163 * 90 }, () => (seed = (seed * 16807) % 2147483647) % 256);
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

describe('strips placed by the skeleton', () => {
  // Where the scene's feet stand, in video px: the take-off toe at scene x 0 is (0 − originX) / mmPerPx = 180 px, the
  // heel about 26 cm behind it and the far foot 4 cm further; the athlete (hips 920 mm up, 0.53 of stature) about
  // 1.74 m, 580 px at 3 mm a pixel.
  const spot = (o: SceneOptions, y: number): Spot => ({ y, left: (-300 - o.originX) / o.mmPerPx, right: (0 - o.originX) / o.mmPerPx, stature: 580 });

  /** What the pose pass hands over: each event a few coarse frames either side of the truth, at the floor it stood on. */
  function flightsFor(o: SceneOptions, shift = 0): PoseFlight[] {
    const t = sceneTruth(o);
    return [
      {
        ...(t.touchdown != null ? { touchdown: { at: [t.touchdown - 5, t.touchdown + 3] as [number, number], spot: spot(o, o.floorRow) } } : {}),
        takeoff: { at: [t.takeoff - 5, t.takeoff + 3], spot: spot(o, o.floorRow) },
        landing: { at: [t.landing - 3, t.landing + 5], spot: spot(o, o.floorRow + shift) },
      },
    ];
  }

  function detectByPose(o: SceneOptions, flights: PoseFlight[], kind: DetectKind = 'jump') {
    const video = { width: o.width, height: o.height, frames: Math.floor(o.durationS * o.fps), captureFps: o.fps };
    const plan = planFromPose(video, flights, kind, 8);
    return analysePoseFine(
      plan,
      plan.events.map((e) => e.request.frames.map((f) => renderScene(o, f, e.request.rect, e.request.w, e.request.h))),
    );
  }

  it('the strip pass alone misses a landing 50 px lower in the picture than the take-off', () => {
    // 50 px at 3 mm a pixel: the strip, 17 % of the athlete (≈ 100 px) above the lowest point anything moved, then
    // starts where the take-off foot stands.
    const r = detect(defaultScene('cmj', { landShiftPx: 50 }));
    expect(r.ok).toBe(false);
  });

  it('times take-off and landing each in a strip at its own floor', () => {
    const o = defaultScene('cmj', { landShiftPx: 50 });
    const r = detectByPose(o, flightsFor(o, 50));
    if (!r.ok) throw new Error(r.problem);
    const truth = sceneTruth(o);
    expect(r.jumps).toHaveLength(1);
    expect(Math.abs(r.jumps[0].marks[0] - truth.takeoff)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.jumps[0].marks[1] - truth.landing)).toBeLessThanOrEqual(1);
  });

  it('times a CMJ, a glossy-floor CMJ and a drop jump as closely as the strip pass does', () => {
    for (const o of [defaultScene('cmj'), defaultScene('cmj', { shadow: 0.5, reflection: 0.3, flicker: 0.04, noise: 3, exposureS: 1 / 500 }), defaultScene('drop')]) {
      const kind = o.kind === 'drop' ? 'drop' : 'jump';
      const r = detectByPose(o, flightsFor(o), kind);
      if (!r.ok) throw new Error(`${o.kind}: ${r.problem}`);
      const t = sceneTruth(o);
      const want = kind === 'drop' ? [t.touchdown!, t.takeoff, t.landing] : [t.takeoff, t.landing];
      r.jumps[0].marks.forEach((m, i) => expect(Math.abs(m - want[i])).toBeLessThanOrEqual(1));
    }
  });

  it('says it is unsure when a strip shows no take-off', () => {
    // The take-off strip put a body height too high: nothing there ever stands.
    const o = defaultScene('cmj');
    const [f] = flightsFor(o);
    const r = detectByPose(o, [{ ...f, takeoff: { ...f.takeoff, spot: { ...f.takeoff.spot, y: o.floorRow - 400 } } }]);
    expect(r).toEqual({ ok: false, problem: 'unsure' });
  });
});
