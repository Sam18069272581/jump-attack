// The take-off technique screen: the pose model is downloaded once before anything can be filmed or imported, and the
// takes saved so far are listed with the run-up touch of their day.
import { Alert, Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { migrate } from '@/db/migrations';
import { addTrial, ensureSession } from '@/db/repo';
import { addTechniqueTake, listTechniqueTakes } from '@/db/technique';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { analyseTechnique, type TechniqueResult } from '@/domain/technique';
import { poseScene } from '@/domain/testing/poseScene';
import { pruneTakes } from '@/media/takes';

import Technique from '../technique/index';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn() };
const mockLib = { ready: false, fail: null as string | null };

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('@/state/athlete', () => ({ useAthlete: () => ({ current: { id: 1, name: '我自己' } }) }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    get router() {
      return mockRouter;
    },
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
  };
});
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///picked/IMG_0012.MOV' }] })),
  UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' },
}));
jest.mock('@/media/poseLib', () => ({
  ...jest.requireActual('@/media/poseLib'),
  poseLibReady: () => mockLib.ready,
  downloadPoseLib: async (onProgress: (s: number) => void) => {
    onProgress(0.5);
    if (mockLib.fail) throw new Error(mockLib.fail);
    mockLib.ready = true;
  },
  clearPoseRuns: jest.fn(),
}));
jest.mock('@/media/takes', () => ({ pruneTakes: jest.fn(), dropTake: jest.fn() }));

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

const byLabel = (label: string) =>
  r.root.find((x) => typeof x.props.onPress === 'function' && (x.props.accessibilityLabel === label || x.findAllByType(Text).some((t) => t.props.children === label)));
const disabled = (label: string) => byLabel(label).props.disabled === true;

async function press(label: string) {
  await act(async () => byLabel(label).props.onPress({ nativeEvent: {} }));
}

async function open() {
  await act(async () => {
    r = create(<Technique />);
  });
  await act(async () => {});
}

let r: ReactTestRenderer;
let result: TechniqueResult;

beforeAll(async () => {
  await migrate(mockDb);
  const scene = poseScene();
  const a = analyseTechnique({ frames: scene.frames, captureFps: 240, markers: scene.markers });
  if (!a.ok) throw new Error(a.problem);
  result = a.result;
});

beforeEach(() => {
  mockRouter.push.mockClear();
  mockLib.ready = false;
  mockLib.fail = null;
});

afterEach(async () => {
  await act(async () => r?.unmount());
});

it('downloads the pose model once, then films or imports a take', async () => {
  await open();
  expect(texts(r.root)).toContain('不上传');
  expect(disabled('现场拍摄')).toBe(true);
  expect(disabled('导入慢动作视频')).toBe(true);

  await press('下载模型');
  expect(disabled('现场拍摄')).toBe(false);

  await press('现场拍摄');
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/technique/camera', params: { session: expect.any(String) } });
  await press('导入慢动作视频');
  expect(mockRouter.push).toHaveBeenLastCalledWith({
    pathname: '/technique/analyse',
    params: { uri: 'file:///picked/IMG_0012.MOV', fps: '0', source: 'import', session: expect.any(String) },
  });
});

it('says why the download failed and lets it be tried again', async () => {
  mockLib.fail = '网络断了';
  await open();
  await press('下载模型');
  expect(texts(r.root)).toContain('网络断了');
  expect(disabled('现场拍摄')).toBe(true);
  mockLib.fail = null;
  await press('下载模型');
  expect(disabled('现场拍摄')).toBe(false);
});

it('lists the takes with the run-up touch of their day, clears films no take keeps, and deletes a take after asking', async () => {
  mockLib.ready = true;
  await ensureSession(mockDb, 'touch-1', 1, 'approach_touch');
  for (const v of [316, 318, 317]) await addTrial(mockDb, { session_id: 'touch-1', value: v });
  const uri = 'file:///app/Documents/technique/take-1.mp4';
  await addTechniqueTake(mockDb, 1, { sessionId: 'tt-1', result, captureFps: 60, source: 'camera', markers: null, videoUri: uri });
  await open();

  const shown = texts(r.root);
  expect(shown).toContain('App 拍摄 · 60 帧');
  expect(shown).toContain('单脚起跳（右脚）');
  expect(shown).toContain(`起跳垂直速度 ${result.metrics.vz!.value.toFixed(2)}`);
  expect(shown).toContain('当天助跑摸高 317.0 cm');
  expect(pruneTakes).toHaveBeenLastCalledWith([uri]);

  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.style === 'destructive')?.onPress?.());
  await press('展开第 1 条');
  await press('删除这条记录');
  expect(await listTechniqueTakes(mockDb, 1)).toEqual([]);
  expect(texts(r.root)).not.toContain('单脚起跳（右脚）');
  expect(pruneTakes).toHaveBeenLastCalledWith([]);
});

it('still opens, and lets the take be deleted, when a saved figure lost its error', async () => {
  mockLib.ready = true;
  const unbounded = { ...result, metrics: { ...result.metrics, plant: { value: 134, error: Infinity, status: 'imprecise' as const } } };
  await addTechniqueTake(mockDb, 1, { sessionId: 'tt-2', result: unbounded, captureFps: 240, source: 'import', markers: null });
  await open();

  expect(texts(r.root)).toContain('单脚起跳（右脚）');
  expect(texts(r.root)).not.toContain('最后一步触地 134');
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.style === 'destructive')?.onPress?.());
  await press('展开第 1 条');
  await press('删除这条记录');
  expect(await listTechniqueTakes(mockDb, 1)).toEqual([]);
});
