import Svg, { Circle, Polyline, Rect } from 'react-native-svg';

import { figure, FIGURE_SIZE, type PoseSpec } from '@/domain/demos';
import { colors } from '@/theme';

const points = (ps: [number, number][]) => ps.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/** One position of an exercise as a side-view stick figure; the far arm and leg are drawn lighter. */
export function DemoFigure({ pose, size }: { pose: PoseSpec; size: number }) {
  const f = figure(pose);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${FIGURE_SIZE} ${FIGURE_SIZE}`}>
      {f.rects.map((r, i) => (
        <Rect key={`r${i}`} x={r.x} y={r.y} width={r.w} height={r.h} rx={1} fill={colors.border} />
      ))}
      {f.lines.map((l, i) => (
        <Polyline key={`l${i}`} points={points(l)} fill="none" stroke={colors.textFaint} strokeWidth={1.5} />
      ))}
      {f.limbs.map((l, i) => (
        <Polyline key={`b${i}`} points={points(l.points)} fill="none" stroke={colors.accent} strokeOpacity={l.far ? 0.45 : 1} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      <Circle cx={f.head.c[0]} cy={f.head.c[1]} r={f.head.r} fill={colors.accent} />
      {f.plates.map((p, i) => (
        <Circle key={`p${i}`} cx={p.c[0]} cy={p.c[1]} r={p.r} fill="none" stroke={colors.rim} strokeWidth={2} />
      ))}
    </Svg>
  );
}
