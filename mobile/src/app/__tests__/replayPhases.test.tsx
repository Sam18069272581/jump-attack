// The replay screen reads the athlete's skeleton through a counter-movement jump before it shows the replay, so the
// exported video can carry the eccentric, concentric and flight phases; without the whole body in the picture it exports
// as before.
import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type { Pose } from '@/domain/pose';
import { cmjScene } from '@/domain/testing/cmjScene';

import Replay from '../measure/replay';

// The synthetic CMJ of domain/testing/cmjScene: 22 cm down, 41.7 cm up, filmed at 240 fps.
const mockScene = cmjScene({ noisePx: 0.5, quietS: 0.8 });
const mockTakeoff = Math.round(mockScene.truth.takeoffS * 240);
const mockLanding = Math.round(mockScene.truth.landingS * 240);

const mockWeb: { props: Record<string, any> | null; inject: jest.Mock } = { props: null, inject: jest.fn() };
const mockPages: string[] = [];
const mockPose = { cutHead: false, fail: false, hang: false, asked: [] as number[][] };

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({
    uri: 'file:///picked/IMG_0007.MOV',
    metric: 'cmj',
    fileFps: '240',
    captureFps: '240',
    from: '0',
    to: String(mockLanding + 60),
    events: JSON.stringify([{ takeoff: mockTakeoff, landing: mockLanding, counted: true }]),
  }),
}));
jest.mock('@/media/frameGrabber', () => ({
  ...jest.requireActual('@/media/frameGrabber'),
  stageForGrabbing: async (_uri: string, page: (video: string) => string) => {
    mockPages.push(page('clip-1.mov'));
    return { page: 'file:///cache/jump-detect/grab.html', dir: 'file:///cache/jump-detect/' };
  },
  unstage: jest.fn(),
}));
jest.mock('expo-file-system', () => ({ Paths: { cache: 'file:///cache/' }, File: class {} }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));
jest.mock('react-native-webview', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const WebView = React.forwardRef((props: Record<string, any>, ref: unknown) => {
    mockWeb.props = props;
    React.useImperativeHandle(ref, () => ({ injectJavaScript: mockWeb.inject, reload: jest.fn() }));
    return <View />;
  });
  WebView.displayName = 'WebView';
  return { WebView };
});
// The pose page, answering with a standing athlete whose centre of mass follows the synthetic jump.
jest.mock('@/components/PoseReader', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const athlete: Pose = jest.requireActual('@/domain/testing/standing').standing({ x: 540, floor: 1700, stature: 1000 });
  const { LM } = jest.requireActual('@/domain/pose');
  const wire = (frames: number[]) =>
    frames.map((f) => {
      const dy = mockScene.samples[f].y - 900;
      const pose = athlete.map((l, k) => ({ ...l, y: mockPose.cutHead && (k === LM.leftEar || k === LM.rightEar) ? -30 : l.y + dy }));
      return [f, f / 240, pose.flatMap((l) => [l.x / 1080, l.y / 1920, 0, l.v])];
    });
  const PoseReader = React.forwardRef(({ onReady }: { onReady: (c: object) => void }, ref: unknown) => {
    React.useEffect(() => {
      onReady({ duration: 5, width: 1080, height: 1920 });
      // Once, as the page says it has the clip.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    React.useImperativeHandle(ref, () => ({
      everyone: async (frames: number[]) => {
        if (mockPose.fail) throw new Error('骨架识别启动不了：offline');
        return wire(frames);
      },
      follow: async (frames: number[], _at: unknown, onProgress?: (n: number) => void) => {
        mockPose.asked.push(frames);
        if (mockPose.hang) return new Promise(() => {});
        onProgress?.(frames.length);
        return wire(frames);
      },
      crops: async () => [],
    }));
    return <View />;
  });
  PoseReader.displayName = 'PoseReader';
  return { PoseReader };
});

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

const config = () => JSON.parse(/var C = (\{.*\});\n/.exec(mockPages.at(-1)!)![1]);

let r: ReactTestRenderer;

afterEach(async () => {
  await act(async () => r?.unmount());
  mockPages.length = 0;
  mockPose.cutHead = false;
  mockPose.fail = false;
  mockPose.hang = false;
  mockPose.asked.length = 0;
});

async function open() {
  await act(async () => {
    r = create(<Replay />);
  });
  // Let the reading's promises settle.
  await act(async () => {});
}

it('reads every frame from 1.3 s before take-off to landing, and exports the phases with their times', async () => {
  await open();
  expect(mockPose.asked[0][0]).toBe(mockTakeoff - 312);
  expect(mockPose.asked[0].at(-1)).toBe(mockLanding);
  const c = config();
  expect(c.phases.phases.map((p: { label: string }) => p.label)).toEqual(['离心', '向心', '腾空']);
  expect(c.phases.stats.map((x: { label: string; value: string }) => [x.label, x.value])).toEqual([
    ['下蹲', '22 cm'],
    ['起跳速度', '2.86 m/s'],
  ]);
  expect(texts(r.root)).toContain('离心向心用时');
});

it('exports without the phases, and says why, when the head is out of the picture', async () => {
  mockPose.cutHead = true;
  await open();
  expect(config().phases).toBeUndefined();
  expect(texts(r.root)).toContain('没拍到全身');
});

it('exports without the phases when the pose model can’t start', async () => {
  mockPose.fail = true;
  await open();
  expect(config().phases).toBeUndefined();
  expect(texts(r.root)).toContain('骨架识别没能启动');
});

it('lets the athlete skip the reading and export as before', async () => {
  mockPose.hang = true;
  await open();
  expect(mockPages).toHaveLength(0);
  expect(texts(r.root)).toContain('正在读骨架');
  const skip = r.root.find((n) => typeof n.props.onPress === 'function' && n.findAllByType(Text).some((t) => t.props.children === '跳过，不标阶段'));
  await act(async () => skip.props.onPress());
  expect(config().phases).toBeUndefined();
});
