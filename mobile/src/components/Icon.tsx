import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

// Stroke icons from the design canvas, 24×24 viewBox.
const PATHS = {
  jump: ['M12 3v10M8 7l4-4 4 4M5 21h14M8 17h8'],
  speed: ['M13 9v4l3 2M10 2h6M3 9h3M2 13h3'],
  vbt: ['M2 12h20M5 8v8M8 6v12M16 6v12M19 8v8'],
  mobility: ['M12 6v6l-5 4M12 12l6 2M7 16l-2 5M18 14l1 7'],
  recovery: ['M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21.5l8.8-8.8a5 5 0 0 0 0-7.1z', 'M3 12h5l2-3 3 6 2-3h6'],
  conditioning: ['M17 2l4 4-4 4', 'M3 11V9a3 3 0 0 1 3-3h15', 'M7 22l-4-4 4-4', 'M21 13v2a3 3 0 0 1-3 3H3'],
  home: ['M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
  trend: ['M3 17l6-6 4 4 8-8M15 7h6v6'],
  user: ['M4 21c0-4 4-6 8-6s8 2 8 6'],
  chevronRight: ['M9 6l6 6-6 6'],
  chevronLeft: ['M15 18l-6-6 6-6'],
  chevronDown: ['M6 9l6 6 6-6'],
  close: ['M18 6L6 18M6 6l12 12'],
  info: ['M12 8v.01M11 12h1v5h1'],
  check: ['M5 12l5 5L20 7'],
  plus: ['M12 5v14M5 12h14'],
  trash: ['M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13 7l4 4'],
  plan: ['M3 10h18M8 3v4M16 3v4M8 14h2M14 14h2M8 18h2'],
} as const;

export type IconName = keyof typeof PATHS | 'gallery';

export function Icon({ name, size = 22, color = '#F2F3F5', strokeWidth = 2 }: { name: IconName; size?: number; color?: ColorValue; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {name === 'speed' && <Circle cx={13} cy={13} r={8} />}
      {name === 'mobility' && <Circle cx={12} cy={4} r={2} />}
      {name === 'user' && <Circle cx={12} cy={8} r={4} />}
      {name === 'info' && <Circle cx={12} cy={12} r={9} />}
      {name === 'plan' && <Rect x={3} y={5} width={18} height={16} rx={3} />}
      {name === 'gallery' ? (
        <>
          <Rect x={3} y={3} width={18} height={18} rx={3} />
          <Circle cx={9} cy={9} r={2} />
          <Path d="M21 16l-5-5L5 21" />
        </>
      ) : (
        PATHS[name].map((d) => <Path key={d} d={d} />)
      )}
    </Svg>
  );
}
