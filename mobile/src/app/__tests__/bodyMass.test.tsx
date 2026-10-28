// Body mass as history, end to end against an in-memory database: a weigh-in from 我的, then the diagnosis's
// estimate of what a few kilos lighter is worth, from the athlete's own force-velocity profile.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';

import { listBodyMass } from '@/db/bodyMass';
import { migrate } from '@/db/migrations';
import { addTrial, ensureSession, getAthlete, updateAthlete, type Athlete } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';

import Me from '../(tabs)/me';
import Dunk from '../dunk';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
const mockAthlete: { current: Athlete | null; athletes: Athlete[]; select: jest.Mock; reload: () => Promise<void> } = {
  current: null,
  athletes: [],
  select: jest.fn(),
  reload: async () => {
    mockAthlete.current = await getAthlete(mockDb, 1);
    mockAthlete.athletes = [mockAthlete.current!];
  },
};

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('@/state/athlete', () => ({ useAthlete: () => mockAthlete }));
jest.mock('@/media/videos', () => ({ savedVideos: jest.fn(async () => ({ count: 0, bytes: 0 })), deleteSavedVideos: jest.fn(async () => {}) }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    get router() {
      return mockRouter;
    },
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    Stack: { Screen: () => null },
    Link: ({ children }: { children: React.ReactNode }) => children,
  };
});

jest.useFakeTimers({
  now: new Date(2026, 9, 28, 10),
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'],
});

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
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
  await mockAthlete.reload();
});

it('keeps each new weight in 我的 as a weigh-in', async () => {
  const r = await render(<Me />);
  const mass = r.root.find((n) => n.type === TextInput && n.props.accessibilityLabel === '体重（kg）');
  await act(async () => mass.props.onChangeText('80'));
  await act(async () => r.root.find((n) => typeof n.props.onPress === 'function' && n.findAllByType(Text).some((t) => t.props.children === '保存')).props.onPress());
  expect(await listBodyMass(mockDb, 1)).toEqual([{ date: '2026-10-28', kg: 80 }]);
  // Saving again without a change adds nothing.
  await mockAthlete.reload();
  const again = await render(<Me />);
  await act(async () => again.root.find((n) => typeof n.props.onPress === 'function' && n.findAllByType(Text).some((t) => t.props.children === '保存')).props.onPress());
  expect(await listBodyMass(mockDb, 1)).toHaveLength(1);
});

it('asks for a force-velocity profile before estimating what losing weight is worth', async () => {
  const r = await render(<Dunk />);
  expect(texts(r.root)).toContain('先测力-速度曲线，才能估算减体重能多摸几厘米');
});

it('estimates the centimetres from the athlete’s own profile', async () => {
  await updateAthlete(mockDb, { ...(await getAthlete(mockDb, 1))!, leg_length_cm: 100, squat_height_cm: 60 });
  await mockAthlete.reload();
  await ensureSession(mockDb, 'fv', 1, 'fvp_sj');
  for (const [load, cm] of [
    [0, 30],
    [20, 22],
    [40, 16],
  ])
    await addTrial(mockDb, { session_id: 'fv', value: cm, load_kg: load });
  const r = await render(<Dunk />);
  expect(texts(r.root)).toMatch(/体重 −1 kg ≈ 摸高 \+\d\.\d cm，−3 kg ≈ \+\d\.\d cm（按你的力-速度曲线估算，假设减的是脂肪、力量和速度不变）/);
  expect(texts(r.root)).toContain('只是估算，不改诊断。');
});
