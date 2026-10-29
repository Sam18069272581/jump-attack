// The main screens in English and German, with data in them: no Chinese is left on screen or in what VoiceOver reads.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { addDropJump } from '@/db/jumps';
import { migrate } from '@/db/migrations';
import { saveRecoveryDay } from '@/db/recovery';
import { addTrial, ensureSession } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { startPlan } from '@/db/training';
import { addVbtSet } from '@/db/vbt';
import { toISODate } from '@/domain/dates';
import { setLang, type Lang } from '@/i18n';

import History from '../(tabs)/history';
import Home from '../(tabs)/index';
import Me from '../(tabs)/me';
import Train from '../(tabs)/train';
import Dunk from '../dunk';
import Recovery from '../recovery';
import Team from '../team';
import TestDay from '../test-day';
import WorkoutScreen from '../workout/[date]';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn(), replace: jest.fn() };
let mockParams: Record<string, string> = {};

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
// The athlete the first migration creates, named 我自己 in the database whatever the language.
const mockAthlete = {
  current: { id: 1, name: '我自己', body_mass_kg: 75, standing_reach_cm: 240 },
  athletes: [{ id: 1, name: '我自己' }],
  select: jest.fn(),
  reload: jest.fn(),
};
jest.mock('@/state/athlete', () => ({ useAthlete: () => mockAthlete }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(), notificationAsync: jest.fn(), NotificationFeedbackType: {} }));
jest.mock('@/media/videos', () => ({ savedVideos: jest.fn(async () => ({ count: 0, bytes: 0 })), deleteSavedVideos: jest.fn(async () => {}) }));
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

const CHINESE = /[㐀-鿿　-〿！-～]/;
const today = toISODate(new Date());

/** Every text on screen and every accessibility label, one per line. */
function shown(root: ReactTestInstance): string[] {
  const texts = root.findAllByType(Text).map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''));
  const labels = root.findAll((n) => typeof n.props.accessibilityLabel === 'string').map((n) => n.props.accessibilityLabel as string);
  return [...texts, ...labels];
}

async function render(el: React.ReactElement): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(el);
  });
  await act(async () => {});
  return r;
}

async function jumps(metric: string, session: string, values: number[]) {
  await ensureSession(mockDb, session, 1, metric);
  for (const value of values) await addTrial(mockDb, { session_id: session, value });
}

beforeAll(async () => {
  await migrate(mockDb);
  await mockDb.runAsync('UPDATE athlete SET body_mass_kg = 75, standing_reach_cm = 240 WHERE id = 1');
  await jumps('cmj', 'cmj-1', [44, 45]);
  await jumps('sj', 'sj-1', [40]);
  await jumps('approach_touch', 'touch-1', [300, 302, 301]);
  await addDropJump(mockDb, 1, 'dj-1', { boxCm: 30, rsi: 1.6, contactMs: 210, heightCm: 34, flightS: 0.53 });
  await addVbtSet(mockDb, 1, 'vbt-1', 'vbt_squat', { load: 60, v: 1.0, reps: 3, source: 'manual' });
  await addVbtSet(mockDb, 1, 'vbt-1', 'vbt_squat', { load: 80, v: 0.8, reps: 3, source: 'manual' });
  await addVbtSet(mockDb, 1, 'vbt-1', 'vbt_squat', { load: 100, v: 0.6, reps: 2, source: 'manual' });
  await saveRecoveryDay(mockDb, 1, { date: today, hrv: 58, rhr: 52, sleep: 7.4, resp: 14.5 });
  await startPlan(mockDb, 1, { templateCode: 'jump-4-1', startDate: today, weekdays: [1, 2, 3, 4, 5, 6, 7] });
});
afterEach(() => setLang('zh'));

const screens: [string, () => React.ReactElement][] = [
  ['home', () => <Home />],
  ['train', () => <Train />],
  ['history', () => <History />],
  ['me', () => <Me />],
  ['dunk diagnosis', () => <Dunk />],
  ['recovery', () => <Recovery />],
  ['today’s workout', () => <WorkoutScreen />],
  ['team', () => <Team />],
  ['test day', () => <TestDay />],
];

describe.each<[string, Lang]>([
  ['English', 'en'],
  ['German', 'de'],
])('%s', (_, lang) => {
  it.each(screens)('shows the %s screen without Chinese', async (_name, screen) => {
    mockParams = { date: today };
    setLang(lang);
    const r = await render(screen());
    const lines = shown(r.root);
    expect(lines.length).toBeGreaterThan(3);
    // The language picker names each language in itself, 中文 included.
    expect(lines.filter((l) => CHINESE.test(l) && l !== '中文')).toEqual([]);
  });
});

it('shows the same screens in Chinese by default', async () => {
  const r = await render(<Home />);
  expect(shown(r.root).some((l) => CHINESE.test(l))).toBe(true);
});
