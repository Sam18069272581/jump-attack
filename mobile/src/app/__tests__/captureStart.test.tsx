// The jump test and the VBT set start the same way: filming in the app or importing a clip is the first thing on the
// screen, above how to film.
import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { migrate } from '@/db/migrations';
import { openMemoryDb } from '@/db/testing/memoryDb';

import Capture from '../measure/capture';
import TrackSet from '../vbt/track';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('@/state/athlete', () => ({ useAthlete: () => ({ current: { id: 1, name: '我自己' } }) }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(), notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    get router() {
      return mockRouter;
    },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    Stack: { Screen: () => null },
  };
});
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'file:///picked/IMG_0001.MOV' }] }),
  UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' },
}));
jest.mock('expo-video', () => ({ useVideoPlayer: (uri: string | null) => jest.requireActual('react').useMemo(() => ({ uri }), [uri]) }));
jest.mock('expo', () => ({ ...jest.requireActual('expo'), useEventListener: jest.fn() }));
jest.mock('@/media/videos', () => ({
  stageForTracking: async () => ({ page: 'file:///cache/bar-track/track.html', dir: 'file:///cache/bar-track/' }),
  persistVideo: async () => 'file:///docs/videos/set-1.mov',
}));

beforeAll(async () => {
  await migrate(mockDb);
});

beforeEach(() => {
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  mockRouter.back.mockClear();
});

function label(n: ReactTestInstance): string {
  return n.props.accessibilityLabel ?? n.findAllByType(Text).map((t) => [t.props.children].flat().join('')).join(' ');
}

/** What can be pressed, top to bottom. */
function pressables(root: ReactTestInstance): string[] {
  return root.findAll((n) => typeof n.props.onPress === 'function' && typeof n.type !== 'string', { deep: false }).map(label);
}

function texts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((t) => [t.props.children].flat(Infinity).join(''));
}

async function render(screen: React.ReactElement) {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(screen);
  });
  return r;
}

function press(root: ReactTestInstance, name: string) {
  const n = root.find((x) => typeof x.props.onPress === 'function' && label(x).startsWith(name));
  return act(async () => n.props.onPress());
}

describe.each<{ name: string; screen: () => React.ReactElement; params: Record<string, string>; firstStep: string }>([
  { name: 'jump test', screen: () => <Capture />, params: { metric: 'cmj', session: 'cmj-1' }, firstStep: '打开 240 fps 慢动作' },
  { name: 'VBT set', screen: () => <TrackSet />, params: { lift: 'vbt_squat', session: 'set-1', load: '120' }, firstStep: '相机设成 60 fps' },
])('$name', ({ screen, params, firstStep }) => {
  it('offers filming in the app and importing a clip first, above how to film', async () => {
    mockParams = params;
    const r = await render(screen());
    const shown = pressables(r.root);
    const film = shown.findIndex((l) => l.startsWith('App 里直接拍'));
    const pick = shown.findIndex((l) => l.startsWith('从相册导入视频'));
    expect(film).toBeGreaterThanOrEqual(0);
    expect(pick).toBe(film + 1);
    // Both choices before the first filming step.
    const t = texts(r.root);
    expect(t.findIndex((x) => x.startsWith('从相册导入视频'))).toBeLessThan(t.indexOf(firstStep));
    await act(async () => r.unmount());
  });
});

it('opens the camera for a jump, to the automatic analysis', async () => {
  mockParams = { metric: 'cmj', session: 'cmj-1' };
  const r = await render(<Capture />);
  await press(r.root, 'App 里直接拍');
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/measure/camera', params: { metric: 'cmj', session: 'cmj-1', to: '/measure/analyse' } });
  await act(async () => r.unmount());
});

it('tracks the VBT clip imported from the start screen, and closes it like the jump test', async () => {
  mockParams = { lift: 'vbt_squat', session: 'set-1', load: '120' };
  const r = await render(<TrackSet />);
  await press(r.root, '从相册导入视频');
  expect(texts(r.root)).toContain('拖动圆圈套住外侧那片 45 cm 杠铃片，双指缩放，松手后会自动贴合杠铃片边缘。下面的进度条拖到这一组开始前。');
  await act(async () => r.unmount());

  const again = await render(<TrackSet />);
  await press(again.root, '关闭');
  expect(mockRouter.back).toHaveBeenCalled();
  await act(async () => again.unmount());
});
