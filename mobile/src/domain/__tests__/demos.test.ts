import { DEMO_MAX_S, DEMOS, demoClipProblem, demoFor, figure, FIGURE_SIZE, type PoseSpec } from '../demos';
import { BLOCK_TEMPLATES, TEMPLATES } from '../templates';

const STAND: PoseSpec = { torso: 0, legs: [[0, 0], [0, 0]], arms: [[0, 0], [0, 0]] };

describe('demos', () => {
  it('cover every exercise a plan can prescribe, with steps and the main mistakes', () => {
    const blocks = Object.values(BLOCK_TEMPLATES);
    const items = [...TEMPLATES.flatMap((t) => t.sessions), ...blocks.flatMap((b) => b.sessions)].flatMap((s) => s.items);
    const extras = blocks.flatMap((b) => Object.values(b.extras ?? {}).map((e) => e.item));
    const codes = new Set([...items, ...extras].map((p) => p.code));
    expect(codes.size).toBe(16);
    for (const code of codes) {
      const d = demoFor(code);
      expect({ code, steps: (d?.steps.length ?? 0) >= 3, mistakes: (d?.mistakes.length ?? 0) >= 1 }).toEqual({ code, steps: true, mistakes: true });
    }
    expect(demoFor('no_such_exercise')).toBeNull();
  });

  it('draw every position inside the frame', () => {
    for (const [code, d] of Object.entries(DEMOS))
      for (const pose of d.poses) {
        const f = figure(pose);
        const points = [...f.limbs.flatMap((l) => l.points), [f.head.c[0], f.head.c[1] - f.head.r], ...f.rects.flatMap((r) => [[r.x, r.y], [r.x + r.w, r.y + r.h]]), ...f.lines.flat()];
        const out = points.filter(([x, y]) => x < 0 || x > FIGURE_SIZE || y < 0 || y > FIGURE_SIZE);
        expect({ code, out }).toEqual({ code, out: [] });
      }
  });
});

describe('figure', () => {
  it('stands on the ground line at 0.68 scale: shin 20 + thigh 20 + torso 28 + neck 7 + head 5.5 = 80.5 units tall', () => {
    const f = figure(STAND);
    const ys = f.limbs.flatMap((l) => l.points.map((p) => p[1]));
    expect(Math.max(...ys)).toBeCloseTo(92, 6);
    expect(f.head.c[1] - f.head.r).toBeCloseTo(92 - 80.5 * 0.68, 6);
  });

  it('lifts an airborne pose off the ground and stands a pose on its box', () => {
    const lowest = (p: PoseSpec) => Math.max(...figure(p).limbs.flatMap((l) => l.points.map((q) => q[1])));
    expect(lowest({ ...STAND, air: 10 })).toBeCloseTo(92 - 10 * 0.68, 6);
    const onBox = figure({ ...STAND, on: 20, props: [{ kind: 'box', dx: -10, w: 20, h: 20 }] });
    expect(onBox.rects[0].y).toBeCloseTo(92 - 20 * 0.68, 6);
    expect(Math.max(...onBox.limbs.flatMap((l) => l.points.map((q) => q[1])))).toBeCloseTo(onBox.rects[0].y, 6);
  });
});

describe('demoClipProblem', () => {
  it('takes clips up to 30 seconds, and any clip whose length the picker did not report', () => {
    expect(DEMO_MAX_S).toBe(30);
    expect(demoClipProblem(30000)).toBeNull();
    expect(demoClipProblem(null)).toBeNull();
    expect(demoClipProblem(30600)).toBe('这段有 31 秒，示范剪到 30 秒以内再选');
  });
});
