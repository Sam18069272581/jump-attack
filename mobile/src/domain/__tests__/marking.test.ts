import { markedTrial, markProfile } from '../marking';
import { APPROACH_TOUCH, DROP_JUMP, getMetric, LOADED_SJ } from '../metrics';

function measured(code: string, marks: (number | null)[], fps: number, opts: { reachCm?: number; romCm?: number } = {}) {
  const outcome = markProfile(getMetric(code)!, opts)!.measure(marks, fps);
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome;
}

describe('markedTrial', () => {
  it('keeps the value, the flight time and the last two marks of a jump', () => {
    // 132 frames at 240 fps = 0.55 s of flight = 37.1 cm.
    const t = markedTrial(measured('cmj', [120, 252], 240), [120, 252], 240, {});
    expect(t).toEqual({ value: 37.1, flight_ms: expect.closeTo(550, 6), fps: 240, takeoff_frame: 120, landing_frame: 252 });
  });

  it('remembers which photo-library video the marks came from', () => {
    const t = markedTrial(measured('cmj', [120, 252], 240), [120, 252], 240, { asset: 'ABC-123/L0/001' });
    expect(t.detail).toEqual({ source: 'video', asset_id: 'ABC-123/L0/001' });
  });

  it('stores a drop jump’s touch-down frame and box height in the detail', () => {
    // Touch-down 0, take-off 48 (200 ms), landing 168 (0.5 s flight = 30.7 cm), RSI 1.53.
    const marks = [0, 48, 168];
    const t = markedTrial(measured(DROP_JUMP.code, marks, 240), marks, 240, { box: '40' });
    expect(t.takeoff_frame).toBe(48);
    expect(t.landing_frame).toBe(168);
    expect(t.detail).toEqual({ source: 'video', contact_frame: 0, contact_ms: 200, height_cm: 30.7, box_cm: 40 });
  });

  it('keeps the jump and standing reach behind a filmed touch', () => {
    // 120 frames at 240 fps = 0.5 s = 30.7 cm on top of a 240 cm standing reach.
    const t = markedTrial(measured(APPROACH_TOUCH.code, [0, 120], 240, { reachCm: 240 }), [0, 120], 240, {});
    expect(t.value).toBe(270.7);
    expect(t.detail).toEqual({ source: 'video', jump_cm: 30.7, standing_reach_cm: 240 });
  });

  it('saves the wall reading of a filmed touch as its value, keeping the video estimate to calibrate with', () => {
    const t = markedTrial(measured(APPROACH_TOUCH.code, [0, 120], 240, { reachCm: 240 }), [0, 120], 240, {}, { touchedCm: 276 });
    expect(t.value).toBe(276);
    expect(t.detail).toEqual({ source: 'video', jump_cm: 30.7, standing_reach_cm: 240, touched_cm: 276 });
  });

  it('adds the athlete’s calibration to a filmed touch without a wall reading', () => {
    // 240 + 30.7 + 5.5 = 276.2.
    const t = markedTrial(measured(APPROACH_TOUCH.code, [0, 120], 240, { reachCm: 240 }), [0, 120], 240, {}, { offsetCm: 5.5 });
    expect(t.value).toBe(276.2);
    expect(t.detail).toEqual({ source: 'video', jump_cm: 30.7, standing_reach_cm: 240, offset_cm: 5.5 });
  });

  it('records the load of a loaded jump and of a VBT set, with the VBT bar travel', () => {
    expect(markedTrial(measured(LOADED_SJ.code, [0, 120], 240), [0, 120], 240, { from: 'fvp', load: '40' }).load_kg).toBe(40);
    // 60 cm in 0.8 s = 0.75 m/s.
    const set = markedTrial(measured('vbt_squat', [0, 192], 240, { romCm: 60 }), [0, 192], 240, { from: 'vbt', load: '100', reps: '3', rom: '60' });
    expect(set).toMatchObject({ value: 0.75, load_kg: 100, detail: { source: 'video', rom_cm: 60, reps: 3 } });
  });
});
