// Drives logging dunk attempts and the home screen's attempt row against an in-memory database.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Text, TextInput } from 'react-native';

import { addDunkAttempt, listDunkAttempts } from '@/db/dunkAttempts';
import { migrate } from '@/db/migrations';
import { getAthlete, type Athlete } from '@/db/repo';
import { addTechniqueTake, listTechniqueTakes } from '@/db/technique';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { analyseTechnique } from '@/domain/technique';
import { poseScene } from '@/domain/testing/poseScene';

import AttemptView from '../attempt';
import Attempts from '../attempts';
import Home from '../(tabs)/index';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
let mockParams: Record<string, string> = {};
const mockPose = { ready: true };
const mockPicked: { uri: string | null } = { uri: null };

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
const mockAthlete: { current: Athlete | null } = { current: null };
jest.mock('@/state/athlete', () => ({ useAthlete: () => mockAthlete }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(), notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    get router() {
      return mockRouter;
    },
    Link: ({ children }: { children: React.ReactNode }) => children,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    Stack: { Screen: () => null },
  };
});

jest.mock('@/media/poseLib', () => ({ poseLibReady: () => mockPose.ready }));
// The app's copies of the videos: here, every one is on this phone but take-gone.mov.
jest.mock('@/media/takes', () => ({ pruneTakes: jest.fn(), takeUri: (uri: string) => (uri.endsWith('take-gone.mov') ? null : uri) }));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: async () => (mockPicked.uri ? { canceled: false, assets: [{ uri: mockPicked.uri }] } : { canceled: true, assets: [] }),
  UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' },
}));
jest.mock('expo-video', () => ({
  useVideoPlayer: (uri: string | null) => ({ uri }),
  VideoView: () => null,
}));

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

async function press(root: ReactTestInstance, label: string, nth = 0) {
  const all = root.findAll((n) => typeof n.props.onPress === 'function' && n.props.accessibilityLabel === label);
  await act(async () => all[nth].props.onPress());
}

async function render(el: React.ReactElement): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(el);
  });
  await act(async () => {});
  return r;
}

beforeAll(async () => {
  await migrate(mockDb);
  mockAthlete.current = await getAthlete(mockDb, 1);
});

it('logs each attempt with one tap and counts the recent ones at that rim and ball', async () => {
  const r = await render(<Attempts />);
  expect(texts(r.root)).toContain('还没记录');
  const rim = r.root.find((n) => n.type === TextInput && n.props.accessibilityLabel === '篮筐高度（cm）');
  expect(rim.props.value).toBe('305'); // the athlete's rim, regulation by default

  await press(r.root, '没够到');
  await press(r.root, '碰框没进');
  await press(r.root, '扣进');
  expect(texts(r.root)).toContain('最近 3 次扣进 1 次');
  expect((await listDunkAttempts(mockDb, 1)).map((a) => [a.rimCm, a.ball, a.outcome])).toEqual([
    [305, 'basketball', 'short'],
    [305, 'basketball', 'rim'],
    [305, 'basketball', 'made'],
  ]);
  expect(texts(r.root)).toContain('第一次扣进');

  // A lower rim with a volleyball is practice, counted on its own.
  await act(async () => rim.props.onChangeText('295'));
  await press(r.root, '排球');
  expect(texts(r.root)).toContain('还没记录');
  await press(r.root, '扣进');
  expect(texts(r.root)).toContain('最近 1 次扣进 1 次');
  expect((await listDunkAttempts(mockDb, 1)).at(-1)).toMatchObject({ rimCm: 295, ball: 'volleyball', outcome: 'made' });
});

it('takes back an attempt logged by mistake', async () => {
  const before = (await listDunkAttempts(mockDb, 1)).length;
  const r = await render(<Attempts />);
  await press(r.root, '删除这次');
  expect(await listDunkAttempts(mockDb, 1)).toHaveLength(before - 1);
});

it('does not save a rim height no hoop is set to', async () => {
  const before = (await listDunkAttempts(mockDb, 1)).length;
  const r = await render(<Attempts />);
  const rim = r.root.find((n) => n.type === TextInput && n.props.accessibilityLabel === '篮筐高度（cm）');
  await act(async () => rim.props.onChangeText('30.5'));
  expect(texts(r.root)).toContain('篮筐高度一般在 200–320 cm');
  await press(r.root, '扣进');
  expect(await listDunkAttempts(mockDb, 1)).toHaveLength(before);
});

it('shows the real dunks on the home screen and opens the log from there', async () => {
  const r = await render(<Home />);
  expect(texts(r.root)).toContain('扣篮尝试');
  expect(texts(r.root)).toContain('305 cm 篮球：最近 3 次扣进 1 次');
  await press(r.root, '扣篮尝试');
  expect(mockRouter.push).toHaveBeenCalledWith('/attempts');
});

describe('filming an attempt', () => {
  it('films the attempt or imports its slow-motion clip, at the rim and ball set', async () => {
    const r = await render(<Attempts />);
    const rim = r.root.find((n) => n.type === TextInput && n.props.accessibilityLabel === '篮筐高度（cm）');
    await act(async () => rim.props.onChangeText('300'));
    await press(r.root, '篮球');
    mockRouter.push.mockClear();
    await press(r.root, '拍这一次');
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/technique/camera', params: { session: expect.any(String), rim: '300', ball: 'basketball' } });

    mockPicked.uri = 'file:///picked/IMG_0030.MOV';
    await press(r.root, '导入慢动作视频');
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: '/technique/analyse',
      params: { uri: 'file:///picked/IMG_0030.MOV', fps: '0', source: 'import', session: expect.any(String), rim: '300', ball: 'basketball' },
    });
    mockPicked.uri = null;
  });

  it('sends the athlete to download the pose model first', async () => {
    mockPose.ready = false;
    try {
      const r = await render(<Attempts />);
      mockRouter.push.mockClear();
      await press(r.root, '先下载骨架识别模型');
      expect(mockRouter.push).toHaveBeenLastCalledWith('/technique');
      expect(r.root.findAll((n) => n.props.accessibilityLabel === '拍这一次')).toHaveLength(0);
    } finally {
      mockPose.ready = true;
    }
  });

  it('lists each filmed attempt with its jump height, and plays it back with its analysis', async () => {
    const scene = poseScene();
    const res = analyseTechnique({ frames: scene.frames, captureFps: 240, markers: scene.markers });
    if (!res.ok) throw new Error(res.problem);
    const trialId = await addTechniqueTake(mockDb, 1, { sessionId: 'att-1', result: res.result, captureFps: 240, source: 'import', markers: scene.markers });
    const vz = res.result.metrics.vz!.value;
    const cm = Math.round(((vz * vz) / (2 * 9.81)) * 100);
    // Last week's, filmed: in the list of filmed attempts, not today's.
    const id = await addDunkAttempt(mockDb, 1, { rimCm: 305, ball: 'basketball', outcome: 'rim', at: '2026-10-24T18:00:00Z', trialId, videoUri: 'file:///app/Documents/technique/take-30.mov' });

    const r = await render(<Attempts />);
    expect(texts(r.root)).toContain('录像记录');
    expect(texts(r.root)).toContain(`弹跳 ${cm} cm`);
    mockRouter.push.mockClear();
    await press(r.root, '看这次录像');
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/attempt', params: { id: String(id) } });

    mockParams = { id: String(id) };
    const v = await render(<AttemptView />);
    const shown = texts(v.root);
    expect(shown).toContain('碰框没进');
    expect(shown).toContain('305 cm · 篮球');
    expect(shown).toContain('弹跳高度');
    expect(shown).toMatch(new RegExp(`${cm} ± \\d+ cm`));
    expect(shown).toContain('起跳垂直速度');
    expect(shown).toContain('助跑速度');
    expect(v.root.findAll((n) => n.props.accessibilityLabel === '录像')).not.toHaveLength(0);

    // Deleting the attempt takes its analysis with it.
    jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, _m, buttons) => buttons?.find((b) => b.style === 'destructive')?.onPress?.());
    await press(v.root, '删除这次尝试');
    expect((await listDunkAttempts(mockDb, 1)).find((a) => a.id === id)).toBeUndefined();
    expect((await listTechniqueTakes(mockDb, 1)).find((t) => t.id === trialId)).toBeUndefined();
    expect(mockRouter.back).toHaveBeenCalled();
    mockParams = {};
  });

  it('says so when an attempt’s video is not on this phone, and when it was not analysed', async () => {
    const id = await addDunkAttempt(mockDb, 1, { rimCm: 305, ball: 'basketball', outcome: 'short', at: '2026-10-25T18:00:00Z', videoUri: 'file:///app/Documents/technique/take-gone.mov' });
    mockParams = { id: String(id) };
    const v = await render(<AttemptView />);
    expect(texts(v.root)).toContain('录像不在这台手机上');
    expect(texts(v.root)).toContain('这次没有起跳分析。');
    expect(v.root.findAll((n) => n.props.accessibilityLabel === '录像')).toHaveLength(0);
    mockParams = {};
  });
});
