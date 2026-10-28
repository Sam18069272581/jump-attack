import { reachVanes } from '../vanes';

// The home screen's backdrop is a jump-and-reach tester (Vertec): one vane per step up a pole, the ones under the
// athlete's best touch swept aside, the ones between the touch and the dunk line still standing.

describe('reach vanes', () => {
  it('shows one vane per cm around a touch close to the line', () => {
    // 318 cm touch, 320 cm line: the window runs from 8 cm over the line down past the touch, 35 vanes, 1 cm apart.
    const r = reachVanes(318, 320, 305);
    expect(r.step).toBe(1);
    expect(r.vanes).toHaveLength(35);
    expect(r.vanes[0].cm).toBe(328);
    expect(r.vanes.at(-1)!.cm).toBe(294);
    const at = (cm: number) => r.vanes.find((v) => v.cm === cm)!;
    expect(at(318).state).toBe('swept');
    expect(at(319).state).toBe('gap');
    expect(at(320).state).toBe('gap');
    expect(at(321).state).toBe('idle');
    expect(at(320).line).toBe(true);
    expect(at(305).rim).toBe(true);
    expect(at(325).major).toBe(true);
    expect(at(324).major).toBe(false);
    // Positions run 0 at the top vane to 1 at the bottom one.
    expect(at(328).y).toBe(0);
    expect(at(294).y).toBe(1);
    expect(r.touchY).toBeCloseTo(10 / 34);
    expect(r.lineY).toBeCloseTo(8 / 34);
  });

  it('widens the step so a far-off touch and the line both fit', () => {
    // 270 cm touch, 320 cm line: 328 − 264 = 64 cm does not fit in 34 one-cm gaps, so the vanes go 2 cm apart.
    const r = reachVanes(270, 320, 305);
    expect(r.step).toBe(2);
    expect(r.vanes[0].cm).toBe(328);
    expect(r.vanes.at(-1)!.cm).toBe(260);
    expect(r.vanes.find((v) => v.cm === 320)!.line).toBe(true);
    expect(r.vanes.find((v) => v.cm === 270)!.state).toBe('swept');
    expect(r.vanes.find((v) => v.cm === 272)!.state).toBe('gap');
    // Major vanes every 5 steps.
    expect(r.vanes.find((v) => v.cm === 320)!.major).toBe(true);
    expect(r.vanes.find((v) => v.cm === 318)!.major).toBe(false);
  });

  it('sweeps past the line once the reach is there, and stands every vane up without a touch', () => {
    const over = reachVanes(324, 320, 305);
    expect(over.vanes.filter((v) => v.state === 'gap')).toEqual([]);
    expect(over.vanes.find((v) => v.cm === 324)!.state).toBe('swept');
    expect(over.vanes[0].cm).toBe(332);

    const none = reachVanes(null, 320, 305);
    expect(none.touchY).toBeNull();
    expect(none.vanes.every((v) => v.state === 'idle')).toBe(true);
    expect(none.vanes[0].cm).toBe(328);
  });
});
