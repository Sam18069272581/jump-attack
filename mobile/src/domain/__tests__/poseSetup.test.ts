import { LANDMARK_COUNT, LM, SIDE, type Pose } from '../pose';
import { AHEAD_S, BEHIND_S, checkSetup, HEADROOM_S, SETUP_CHECKS, type GravitySample, type SetupCheckKey, type SetupFrame } from '../poseSetup';

const W = 1280;
const H = 720;

type Stand = {
  /** Mid-hip, picture px. */
  x: number;
  /** Where the feet meet the floor, picture px. */
  floor: number;
  /** Floor to the top of the head, px. */
  stature: number;
  /** +1: toes point right (runs left to right); −1: toes point left. */
  facing?: 1 | -1;
  /** Turned this far from side-on, degrees: 0 is side-on, 90 faces the phone. */
  yaw?: number;
  /** The pose model's visibility for every point, or per side. */
  vis?: number;
  footVis?: number;
};

/**
 * A person standing on the take-off spot with Drillis and Contini's proportions (Winter fig. 4.1), heights as shares
 * of stature: ear 0.93, shoulder 0.818, elbow 0.63, wrist 0.485, hip 0.53, knee 0.285, ankle 0.039; foot 0.152 long.
 */
function standing({ x, floor, stature: S, facing = 1, yaw = 0, vis = 0.95, footVis = vis }: Stand): Pose {
  const p: Pose = Array.from({ length: LANDMARK_COUNT }, () => ({ x, y: floor - 0.93 * S, z: 0, v: vis }));
  const at = (share: number) => floor - share * S;
  // Left and right sit apart in the picture by how far the body is turned.
  const apart = Math.sin((yaw * Math.PI) / 180);
  const half = { shoulder: 0.1, hip: 0.07, knee: 0.05, ankle: 0.05 };
  for (const [side, sign] of [['left', -1], ['right', 1]] as const) {
    const k = SIDE[side];
    const off = (w: number) => x + sign * w * S * apart;
    p[k.shoulder] = { x: off(half.shoulder), y: at(0.818), z: 0, v: vis };
    p[k.elbow] = { x: off(half.shoulder), y: at(0.63), z: 0, v: vis };
    p[k.wrist] = { x: off(half.shoulder), y: at(0.485), z: 0, v: vis };
    p[k.index] = { x: off(half.shoulder), y: at(0.43), z: 0, v: vis };
    p[k.pinky] = { x: off(half.shoulder), y: at(0.43), z: 0, v: vis };
    p[k.hip] = { x: off(half.hip), y: at(0.53), z: 0, v: vis };
    p[k.knee] = { x: off(half.knee), y: at(0.285), z: 0, v: vis };
    p[k.ankle] = { x: off(half.ankle), y: at(0.039), z: 0, v: footVis };
    p[k.heel] = { x: off(half.ankle) - facing * 0.04 * S, y: floor, z: 0, v: footVis };
    p[k.toe] = { x: off(half.ankle) + facing * 0.112 * S, y: floor, z: 0, v: footVis };
  }
  p[LM.leftEar] = { x, y: at(0.93), z: 0, v: vis };
  p[LM.rightEar] = { x, y: at(0.93), z: 0, v: vis };
  p[LM.nose] = { x: x + facing * 0.05 * S, y: at(0.93), z: 0, v: vis };
  return p;
}

/**
 * The phone 7 m from the take-off spot and 1 m up, on its side, 16:9 at 1280 × 720 with a 41° vertical view: the
 * picture is 2 × 7 × tan 20.5° = 5.23 m tall at the athlete, so a 1.85 m athlete is 255 px and the floor 1 m below the
 * middle is at 360 + 720 / 5.23 = 498 px. The take-off spot sits 58 % of the way across from the run-up side.
 */
const GOOD: Stand = { x: 0.58 * W, floor: 498, stature: 255, facing: 1 };

function frames(stand: Stand | Stand[] | null, over: Partial<SetupFrame> = {}, count = 6): SetupFrame[] {
  const people = stand == null ? [] : Array.isArray(stand) ? stand : [stand];
  return Array.from({ length: count }, (_, i) => ({
    t: i * 0.2,
    width: W,
    height: H,
    poses: people.map(standing),
    lumas: people.map(() => over.luma ?? 120),
    luma: 120,
    ...over,
  }));
}

/** Readings at 10 Hz over the frames' second and a bit: the phone on its side, `roll` and `pitch` off level. */
function gravity({ roll = 0, pitch = 0, wobble = 0, portrait = false, flat = false } = {}): GravitySample[] {
  return Array.from({ length: 15 }, (_, i) => {
    const r = ((roll + wobble * Math.sin(i * 1.7)) * Math.PI) / 180;
    const q = ((pitch + wobble * Math.cos(i * 2.3)) * Math.PI) / 180;
    if (flat) return { t: i * 0.1, x: 0, y: 0.05, z: -1 };
    if (portrait) return { t: i * 0.1, x: Math.sin(r), y: -Math.cos(r), z: Math.sin(q) };
    return { t: i * 0.1, x: -Math.cos(r) * Math.cos(q), y: Math.sin(r) * Math.cos(q), z: Math.sin(q) };
  });
}

const stateOf = (r: ReturnType<typeof checkSetup>, key: SetupCheckKey) => r.checks.find((c) => c.key === key)!;

describe('checkSetup', () => {
  it('passes a phone 7 m away, 1 m up, on its side, with the athlete side-on on the take-off spot', () => {
    const r = checkSetup(frames(GOOD), gravity());
    expect(r.checks.filter((c) => c.state !== 'ok')).toEqual([]);
    expect(r.ready).toBe(true);
    expect(r.main).toBeNull();
    expect(r.athlete).toEqual({ index: 0, stature: expect.closeTo(255, 6) });
    expect(r.level!.roll).toBeCloseTo(0, 6);
  });

  it('lists every check once, in the order to fix them', () => {
    const r = checkSetup(frames(GOOD), gravity());
    expect(r.checks.map((c) => c.key)).toEqual(SETUP_CHECKS.map(([k]) => k));
  });

  it('leaves room for what the analysis needs: 1.8 statures up, 2.4 behind, 1.4 ahead', () => {
    expect([HEADROOM_S, BEHIND_S, AHEAD_S]).toEqual([1.8, 2.4, 1.4]);
  });

  describe('the phone', () => {
    it('upright: turn it on its side', () => {
      const r = checkSetup(frames(GOOD), gravity({ portrait: true }));
      expect(stateOf(r, 'phone')).toMatchObject({ state: 'fix', hint: expect.stringContaining('横过来') });
      expect(r.ready).toBe(false);
      expect(r.main?.key).toBe('phone');
    });

    it('lying flat: stand it up', () => {
      expect(stateOf(checkSetup(frames(GOOD), gravity({ flat: true })), 'phone').hint).toContain('立起来');
    });

    it('leaning 5° across the picture: says by how much (3° is allowed)', () => {
      expect(stateOf(checkSetup(frames(GOOD), gravity({ roll: 5 })), 'phone')).toMatchObject({ state: 'fix', hint: expect.stringContaining('5 度') });
      expect(stateOf(checkSetup(frames(GOOD), gravity({ roll: -5 })), 'phone').state).toBe('fix');
      expect(stateOf(checkSetup(frames(GOOD), gravity({ roll: 2.5 })), 'phone').state).toBe('ok');
    });

    it('tipped 15° forwards or back (10° is allowed)', () => {
      expect(stateOf(checkSetup(frames(GOOD), gravity({ pitch: 15 })), 'phone')).toMatchObject({ state: 'fix', hint: expect.stringContaining('15 度') });
      expect(stateOf(checkSetup(frames(GOOD), gravity({ pitch: -15 })), 'phone').state).toBe('fix');
      expect(stateOf(checkSetup(frames(GOOD), gravity({ pitch: 8 })), 'phone').state).toBe('ok');
    });

    it('held in the hand (it wobbles a degree or two): set it down', () => {
      const r = checkSetup(frames(GOOD), gravity({ wobble: 2 }));
      expect(stateOf(r, 'steady')).toMatchObject({ state: 'fix', hint: expect.stringContaining('三脚架') });
      expect(stateOf(checkSetup(frames(GOOD), gravity({ wobble: 0.2 })), 'steady').state).toBe('ok');
    });

    it('without a motion sensor: says to check by eye, and doesn’t hold the recording back', () => {
      const r = checkSetup(frames(GOOD), []);
      expect(stateOf(r, 'phone').state).toBe('warn');
      expect(r.level).toBeNull();
      expect(r.ready).toBe(true);
    });
  });

  describe('who is in the picture', () => {
    it('nobody: stand on the take-off spot', () => {
      const r = checkSetup(frames(null), gravity());
      expect(stateOf(r, 'person')).toMatchObject({ state: 'fix', hint: expect.stringContaining('起跳点') });
      expect(r.ready).toBe(false);
      expect(r.athlete).toBeNull();
      expect(stateOf(r, 'whole').state).toBe('wait');
    });

    it('nobody in a dark picture: too dark to see anyone', () => {
      expect(stateOf(checkSetup(frames(null, { luma: 20 }), gravity()), 'person').hint).toContain('太暗');
    });

    it('a second person: a warning, and the athlete is the one on the take-off spot (the tallest in the picture)', () => {
      const far = { x: 200, floor: 420, stature: 150 };
      const r = checkSetup(frames([far, GOOD]), gravity());
      expect(stateOf(r, 'person')).toMatchObject({ state: 'warn', hint: expect.stringContaining('2 个人') });
      expect(r.athlete?.index).toBe(1);
      expect(r.ready).toBe(true);
      expect(r.main?.key).toBe('person');
    });

    it('one frame without anyone doesn’t undo a second of frames with them', () => {
      const f = frames(GOOD);
      f[f.length - 1] = { ...f[f.length - 1], poses: [], lumas: [] };
      expect(checkSetup(f, gravity()).ready).toBe(true);
    });

    it('waits for a second frame before judging', () => {
      const r = checkSetup(frames(GOOD, {}, 1), gravity());
      expect(stateOf(r, 'person').state).toBe('wait');
      expect(r.ready).toBe(false);
    });

    it('waits for the camera before the first frame', () => {
      const r = checkSetup([], gravity());
      expect(stateOf(r, 'person').state).toBe('wait');
      expect(r.ready).toBe(false);
    });
  });

  describe('where the athlete is in the picture', () => {
    it('feet at the bottom edge', () => {
      expect(stateOf(checkSetup(frames({ ...GOOD, floor: 710 }), gravity()), 'whole')).toMatchObject({ state: 'fix', hint: expect.stringContaining('脚') });
    });

    it('too small: closer (a stature under a fifth of the picture)', () => {
      expect(stateOf(checkSetup(frames({ ...GOOD, stature: 130 }), gravity()), 'size')).toMatchObject({ state: 'fix', hint: expect.stringContaining('太小') });
    });

    it('the phone 4 m away: the hands would leave the picture at the top of the jump', () => {
      // At 4 m the picture is 2.99 m tall: a 1.85 m athlete fills 446 px, the floor 1 m down is at 601 px.
      const r = checkSetup(frames({ x: 0.58 * W, floor: 601, stature: 446 }), gravity());
      expect(stateOf(r, 'size')).toMatchObject({ state: 'fix', hint: expect.stringContaining('上面不够高') });
    });

    it('too near the run-up edge: move the phone towards the run-up', () => {
      const r = checkSetup(frames({ ...GOOD, x: 0.35 * W }), gravity());
      expect(stateOf(r, 'room')).toMatchObject({ state: 'fix', hint: expect.stringContaining('助跑那边') });
    });

    it('too near the landing edge: move the phone towards the basket', () => {
      const r = checkSetup(frames({ ...GOOD, x: 0.85 * W }), gravity());
      expect(stateOf(r, 'room')).toMatchObject({ state: 'fix', hint: expect.stringContaining('落地那边') });
    });

    it('runs the other way: the run-up is on the right', () => {
      expect(stateOf(checkSetup(frames({ ...GOOD, facing: -1, x: 0.42 * W }), gravity()), 'room').state).toBe('ok');
      expect(stateOf(checkSetup(frames({ ...GOOD, facing: -1 }), gravity()), 'room').hint).toContain('助跑那边');
    });

    it('neither side has room: move back', () => {
      // 2.4 + 1.4 statures of 400 px is 1520 px, wider than the picture.
      const r = checkSetup(frames({ x: 800, floor: 690, stature: 400 }), gravity());
      expect(stateOf(r, 'room').hint).toContain('两边');
    });

    it('feet pointing at the phone: can’t tell the run-up side yet', () => {
      const r = checkSetup(frames({ ...GOOD, yaw: 0 }).map((f) => ({ ...f, poses: f.poses.map((p) => p.map((q, i) => ((i === LM.leftToe || i === LM.rightToe || i === LM.leftHeel || i === LM.rightHeel) ? { ...q, x: GOOD.x } : q))) })), gravity());
      expect(stateOf(r, 'room')).toMatchObject({ state: 'wait', hint: expect.stringContaining('面朝跑的方向') });
    });
  });

  describe('how well the athlete shows', () => {
    it('dark: more light; dim: a warning that fast feet blur; blown out: turn away', () => {
      expect(stateOf(checkSetup(frames(GOOD, { luma: 30 }), gravity()), 'light')).toMatchObject({ state: 'fix', hint: expect.stringContaining('太暗') });
      expect(stateOf(checkSetup(frames(GOOD, { luma: 60 }), gravity()), 'light')).toMatchObject({ state: 'warn', hint: expect.stringContaining('糊') });
      expect(stateOf(checkSetup(frames(GOOD, { luma: 235 }), gravity()), 'light')).toMatchObject({ state: 'fix', hint: expect.stringContaining('太亮') });
    });

    it('lit from behind: a dark figure in a bright picture', () => {
      const f = frames(GOOD).map((x) => ({ ...x, lumas: [50], luma: 150 }));
      expect(stateOf(checkSetup(f, gravity()), 'light').hint).toContain('逆光');
    });

    it('the pose model unsure of the feet: names them', () => {
      expect(stateOf(checkSetup(frames({ ...GOOD, footVis: 0.3 }), gravity()), 'clear')).toMatchObject({ state: 'fix', hint: expect.stringContaining('看不清脚') });
    });

    it('turned towards the phone: side-on within about 20°, a warning to 40°, beyond that fix it', () => {
      // Shoulder spread over torso length is 0.2 sin(yaw) / 0.288 = 0.69 sin(yaw).
      expect(stateOf(checkSetup(frames({ ...GOOD, yaw: 10 }), gravity()), 'side').state).toBe('ok');
      expect(stateOf(checkSetup(frames({ ...GOOD, yaw: 30 }), gravity()), 'side').state).toBe('warn');
      expect(stateOf(checkSetup(frames({ ...GOOD, yaw: 60 }), gravity()), 'side')).toMatchObject({ state: 'fix', hint: expect.stringContaining('侧对') });
    });
  });

  it('says the first thing to fix: the phone before the picture', () => {
    const r = checkSetup(frames({ ...GOOD, stature: 130 }), gravity({ roll: 6 }));
    expect(r.main?.key).toBe('phone');
  });
});
