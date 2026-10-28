// The marking screen as it runs in a browser: expo-video's web player never sends sourceLoad, so the
// clip length comes from the player once it is ready and the frame rate from timing the frames.
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { Text } from 'react-native';

import Mark from '../measure/mark';

const mockHandlers: Record<string, (e: unknown) => void> = {};
const mockPlayer = { duration: 0, currentTime: 0, muted: false, pause: jest.fn() };
jest.mock('expo', () => ({ useEventListener: (_p: unknown, name: string, cb: (e: unknown) => void) => void (mockHandlers[name] = cb) }));
jest.mock('expo-video', () => ({ useVideoPlayer: () => mockPlayer, VideoView: () => null }));
jest.mock('@/media/frameRate', () => ({ probeFrameRate: async () => 30 }));
jest.mock('@react-native-community/slider', () => () => null);
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({}) }));
jest.mock('@/state/athlete', () => ({ useAthlete: () => ({ current: { id: 1, name: '我自己', standing_reach_cm: null } }) }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), dismiss: jest.fn() },
  useLocalSearchParams: () => ({ metric: 'cmj', session: 's1', uri: 'blob:http://localhost/clip', fps: '0' }),
}));

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

it('steps through a slow-motion clip whose length and frame rate the web player does not report', async () => {
  const r = create(<Mark />);
  await act(async () => {});

  // A 30 fps export of an iPhone slow-motion clip, 2 s long once ready.
  mockPlayer.duration = 2;
  await act(async () => mockHandlers.statusChange({ status: 'readyToPlay' }));
  expect(texts(r.root)).toContain('拍摄帧率（视频 30 fps）');
  expect(texts(r.root)).toContain('这个视频是 30 fps');

  const step = r.root.find((n) => n.props.accessibilityLabel === '前进 10 帧' && typeof n.props.onPress === 'function');
  await act(async () => step.props.onPress());
  expect(texts(r.root)).toContain('#10');
  // Frames are 1/30 s apart in the file (the seek lands mid-frame), whatever capture rate is chosen.
  expect(mockPlayer.currentTime).toBeCloseTo(10.5 / 30);
});
