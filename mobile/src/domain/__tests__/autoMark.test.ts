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
  const values = { '.': 130, '#': 40, s: 80 };
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

  it('finds a low single-leg jump', () => {
    expectNear(defaultScene('cmj', { flightS: 0.3017, shadow: 0.4 }));
  });

  it('finds the take-off and landing of a run-up jump, not the running steps', () => {
    expectNear(defaultScene('approach', { shadow: 0.4, secondFootLagS: 0.025 }));
  });

  it('finds touch-down, take-off and landing of a drop jump from a box', () => {
    expectNear(defaultScene('drop', { shadow: 0.4 }));
  });

  it('works on a court line right behind the feet', () => {
    expectNear(defaultScene('cmj', { courtLineMm: 30, reflection: 0.3 }));
  });

  it('reports a clip with no jump', () => {
    const r = detect(defaultScene('cmj', { takeoffS: 9, durationS: 2 }));
    expect(r).toEqual({ ok: false, problem: 'no-jump' });
  });
});
