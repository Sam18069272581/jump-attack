import { frameAt, moveHandle, nudgeHandle, stripTimes, xOf } from '../trim';

// A 3 s slow-motion export at 30 fps file rate: 90 frames, 0…89, on a bar 300 px wide.
const TOTAL = 90;
const W = 300;

describe('the trim bar maps the clip onto its width', () => {
  it('puts the first frame at the left edge and the last at the right edge', () => {
    expect(xOf(0, W, TOTAL)).toBe(0);
    expect(xOf(89, W, TOTAL)).toBe(300);
    // Halfway along the frames is halfway along the bar: 44.5 / 89 × 300.
    expect(xOf(44.5, W, TOTAL)).toBeCloseTo(150, 6);
  });

  it('reads the nearest frame back from a finger position, and stays inside the clip', () => {
    expect(frameAt(0, W, TOTAL)).toBe(0);
    expect(frameAt(300, W, TOTAL)).toBe(89);
    // 100 px of 300 is a third of 89 frames: 29.67 → 30.
    expect(frameAt(100, W, TOTAL)).toBe(30);
    expect(frameAt(-40, W, TOTAL)).toBe(0);
    expect(frameAt(999, W, TOTAL)).toBe(89);
    for (const f of [0, 1, 17, 45, 88, 89]) expect(frameAt(xOf(f, W, TOTAL), W, TOTAL)).toBe(f);
  });

  it('has nothing to map before the clip is measured', () => {
    expect(frameAt(120, 0, TOTAL)).toBe(0);
    expect(frameAt(120, W, 0)).toBe(0);
    expect(xOf(10, W, 1)).toBe(0);
  });
});

describe('dragging a handle', () => {
  const whole = { from: 0, to: 89 };

  it('moves only the handle that is dragged', () => {
    expect(moveHandle(whole, 'from', 20, TOTAL)).toEqual({ from: 20, to: 89 });
    expect(moveHandle(whole, 'to', 60, TOTAL)).toEqual({ from: 0, to: 60 });
  });

  it('keeps the start before the end, at least a frame apart, as the two sliders did', () => {
    expect(moveHandle({ from: 20, to: 60 }, 'from', 75, TOTAL)).toEqual({ from: 59, to: 60 });
    expect(moveHandle({ from: 20, to: 60 }, 'to', 5, TOTAL)).toEqual({ from: 20, to: 21 });
  });

  it('cannot drag a handle off the clip', () => {
    expect(moveHandle(whole, 'from', -10, TOTAL)).toEqual(whole);
    expect(moveHandle(whole, 'to', 200, TOTAL)).toEqual(whole);
  });

  it('steps a handle by a twentieth of the clip for VoiceOver (swipe up or down)', () => {
    // 89 / 20 = 4.45 → 4 frames a step.
    expect(nudgeHandle(whole, 'from', 1, TOTAL)).toEqual({ from: 4, to: 89 });
    expect(nudgeHandle(whole, 'to', -1, TOTAL)).toEqual({ from: 0, to: 85 });
    // At least a frame a step, however short the clip.
    expect(nudgeHandle({ from: 0, to: 9 }, 'to', -1, 10)).toEqual({ from: 0, to: 8 });
  });
});

describe('the filmstrip', () => {
  it('takes one picture from the middle of each cell along the clip', () => {
    // 3 s in 6 cells of 0.5 s: 0.25, 0.75, … 2.75.
    expect(stripTimes(3, 6)).toEqual([0.25, 0.75, 1.25, 1.75, 2.25, 2.75]);
  });

  it('takes none from a clip with no length yet', () => {
    expect(stripTimes(0, 6)).toEqual([]);
    expect(stripTimes(3, 0)).toEqual([]);
  });
});
