import { dropJump, dropJumpFromMarks, flightFromHeight, ladder } from '../dropJump';
import { markProfile } from '../marking';
import { DROP_JUMP } from '../metrics';

describe('drop jump from marks', () => {
  it('measures contact, flight and RSI', () => {
    // 200 ms contact, 500 ms flight → 30.7 cm, RSI 1.53.
    const r = dropJumpFromMarks(0, 48, 168, 240);
    expect(r).toMatchObject({ ok: true, value: { contactS: 0.2, flightS: 0.5 } });
    if (r.ok) {
      expect(r.value.heightCm).toBeCloseTo(30.66, 1);
      expect(r.value.rsi).toBeCloseTo(1.53, 2);
    }
  });

  it('explains marks it cannot use', () => {
    expect(dropJumpFromMarks(0, null, 168, 240)).toEqual({ ok: false, problem: 'missing' });
    expect(dropJumpFromMarks(48, 0, 168, 240)).toEqual({ ok: false, problem: 'order' });
    expect(dropJumpFromMarks(0, 300, 420, 240)).toEqual({ ok: false, problem: 'contact-long' });
    expect(dropJumpFromMarks(0, 10, 130, 240)).toEqual({ ok: false, problem: 'contact-short' });
  });

  it('accepts a typed-in height through its flight time', () => {
    const r = dropJump(0.2, flightFromHeight(30.66));
    expect(r.ok && r.value.rsi).toBeCloseTo(1.53, 2);
  });

  it('is marked with three frames and keeps the contact time', () => {
    const p = markProfile(DROP_JUMP)!;
    expect(p.marks.map((m) => m.title)).toEqual(['触地帧', '起跳帧', '落地帧']);
    expect(p.phases).toHaveLength(4);
    expect(p.measure([0, 48, 168], 240)).toMatchObject({ ok: true, value: 1.53, detail: { contact_frame: 0, contact_ms: 200, height_cm: 30.7 } });
  });
});

describe('box height ladder', () => {
  const jump = (boxCm: number, rsi: number, contactMs = 200) => ({ boxCm, rsi, contactMs, heightCm: 30 });

  it('keeps the best jump per box and finds the peak', () => {
    const l = ladder([jump(40, 1.9), jump(20, 1.6), jump(30, 1.8), jump(30, 2.0), jump(50, 1.7)]);
    expect(l.steps.map((s) => [s.boxCm, s.rsi, s.attempts])).toEqual([
      [20, 1.6, 1],
      [30, 2.0, 2],
      [40, 1.9, 1],
      [50, 1.7, 1],
    ]);
    expect(l.best?.boxCm).toBe(30);
    expect(l.tryHigher).toBe(false);
    expect(l.slowContact).toBe(false);
  });

  it('suggests a higher box while RSI still rises, and flags slow rebounds', () => {
    const l = ladder([jump(20, 1.2, 260), jump(30, 1.4, 270)]);
    expect(l.best?.boxCm).toBe(30);
    expect(l.tryHigher).toBe(true);
    expect(l.slowContact).toBe(true);
  });

  it('is empty without jumps', () => {
    expect(ladder([])).toEqual({ steps: [], best: null, tryHigher: false, slowContact: false });
  });
});
