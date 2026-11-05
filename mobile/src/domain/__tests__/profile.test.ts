import { readProfile, type ProfileText } from '../profile';

const blank: ProfileText = { mass: '', reach: '', leg: '', squat: '', rim: '', clearance: '' };

describe('reading the profile', () => {
  it('reads typed numbers, a decimal comma too, and leaves blanks empty', () => {
    const r = readProfile({ ...blank, mass: '78,5', reach: '242', rim: '305', clearance: '15' });
    expect(r).toEqual({
      ok: true,
      values: { body_mass_kg: 78.5, standing_reach_cm: 242, leg_length_cm: null, squat_height_cm: null, rim_height_cm: 305, dunk_clearance_cm: 15 },
    });
  });

  it('turns away numbers no one has, before they reach the diagnosis or a backup', () => {
    // Infinity used to save, then came out of a backup as null and made the whole backup impossible to restore.
    expect(readProfile({ ...blank, mass: 'Infinity' })).toEqual({ ok: false, problem: '体重要填一个数' });
    expect(readProfile({ ...blank, mass: '1e999' }).ok).toBe(false);
    expect(readProfile({ ...blank, mass: 'abc' }).ok).toBe(false);
    // −5 kg made the squat ratio negative and the diagnosis call for strength. Body mass keeps the app's 30–200 kg.
    expect(readProfile({ ...blank, mass: '-5' })).toEqual({ ok: false, problem: '体重一般在 30–200 kg，检查一下输入' });
    expect(readProfile({ ...blank, mass: '30' }).ok).toBe(true);
    expect(readProfile({ ...blank, mass: '200' }).ok).toBe(true);
    // Standing reach 150–300 cm.
    expect(readProfile({ ...blank, reach: '999' })).toEqual({ ok: false, problem: '站立摸高一般在 150–300 cm，检查一下输入' });
    expect(readProfile({ ...blank, reach: '149' }).ok).toBe(false);
    // The rim keeps the 200–320 cm of the dunk attempt log: −305 gave a dunk line of −290.
    expect(readProfile({ ...blank, rim: '-305' })).toEqual({ ok: false, problem: '篮筐高度一般在 200–320 cm，检查一下输入' });
    // Clearance 0–50 cm.
    expect(readProfile({ ...blank, clearance: '-1' }).ok).toBe(false);
    expect(readProfile({ ...blank, clearance: '51' }).ok).toBe(false);
    expect(readProfile({ ...blank, clearance: '0' }).ok).toBe(true);
    // Leg length and squat height only need to be numbers; pushOff checks the pair.
    expect(readProfile({ ...blank, leg: 'Infinity' }).ok).toBe(false);
    expect(readProfile({ ...blank, leg: '100', squat: '60' }).ok).toBe(true);
  });
});
