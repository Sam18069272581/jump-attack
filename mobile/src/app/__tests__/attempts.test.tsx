// Drives logging dunk attempts and the home screen's attempt row against an in-memory database.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';

import { listDunkAttempts } from '@/db/dunkAttempts';
import { migrate } from '@/db/migrations';
import { getAthlete, type Athlete } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';

import Attempts from '../attempts';
import Home from '../(tabs)/index';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };

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
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    Stack: { Screen: () => null },
  };
});

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
