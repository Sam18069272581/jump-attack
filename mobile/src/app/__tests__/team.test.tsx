// Several athletes on one phone, against an in-memory database and the real athlete provider: adding people, the phone
// remembering whose data it shows, the team board, taking turns on a test day, and handing an athlete their own data.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Text, TextInput, type AlertButton } from 'react-native';

import { exportAthlete } from '@/db/athleteData';
import { migrate } from '@/db/migrations';
import { addTrial, ensureSession, listAthletes, updateAthlete } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { AthleteProvider, useAthlete } from '@/state/athlete';

import Me from '../(tabs)/me';
import TestDay from '../test-day';
import Team from '../team';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), dismissAll: jest.fn(), canGoBack: () => true };
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
/** The latest screen's focus callback, to come back to it the way the result screen's 完成 does. */
let mockFocus = () => {};
let mockParams: Record<string, string> = {};
const mockKv = new Map<string, string>();
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItem: async (k: string) => mockKv.get(k) ?? null, setItem: async (k: string, v: string) => void mockKv.set(k, v) },
}));
jest.mock('@/media/videos', () => ({ savedVideos: jest.fn(async () => ({ count: 0, bytes: 0 })), deleteSavedVideos: jest.fn() }));
const mockShared: unknown[] = [];
let mockPicked: string | null = null;
jest.mock('@/sync/files', () => ({ shareAthleteFile: async (f: unknown) => void mockShared.push(f), pickBackupText: async () => mockPicked }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    get router() {
      return mockRouter;
    },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void) => {
      mockFocus = cb;
      React.useEffect(cb, [cb]);
    },
  };
});

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

const pressable = (root: ReactTestInstance, label: string) =>
  root.find((n) => typeof n.props.onPress === 'function' && (n.props.accessibilityLabel === label || n.findAllByType(Text).some((t) => [t.props.children].flat().join('') === label)));

/** The test day's 谁来测 chip for an athlete. */
const chip = (root: ReactTestInstance, name: string) =>
  root.find((n) => n.props.accessibilityRole === 'checkbox' && typeof n.props.onPress === 'function' && n.findAllByType(Text).some((t) => t.props.children === name));

/** Shows whose data the screens are on, the way the home screen's name does. */
const mockSeen = jest.fn();
function Probe() {
  mockSeen(useAthlete().current?.name);
  return null;
}
const current = () => mockSeen.mock.lastCall?.[0];

async function render(el: React.ReactElement): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <AthleteProvider>
        <Probe />
        {el}
      </AthleteProvider>,
    );
  });
  await act(async () => {});
  return r;
}

async function touch(athleteId: number, session: string, at: string, values: number[]) {
  await mockDb.runAsync("INSERT INTO test_session (id, athlete_id, metric_code, started_at) VALUES (?, ?, 'approach_touch', ?)", session, athleteId, at);
  for (const value of values) await addTrial(mockDb, { session_id: session, value });
}

beforeAll(async () => {
  await migrate(mockDb);
});

beforeEach(() => {
  mockRouter.push.mockClear();
});

it('adds teammates on any phone and opens the team board once there are two', async () => {
  const r = await render(<Me />);
  expect(texts(r.root)).not.toContain('团队总览');
  await act(async () => r.root.find((n) => n.type === TextInput && n.props.accessibilityLabel === '新运动员的名字').props.onChangeText('小明'));
  await act(async () => pressable(r.root, '添加').props.onPress());
  await act(async () => {});
  expect((await listAthletes(mockDb)).map((a) => a.name)).toEqual(['我自己', '小明']);
  expect(current()).toBe('小明');

  await act(async () => pressable(r.root, '团队总览').props.onPress());
  expect(mockRouter.push).toHaveBeenCalledWith('/team');
});

it('opens on the athlete picked last time, not always the first one', async () => {
  const r = await render(<Me />);
  expect(current()).toBe('小明');
  await act(async () => pressable(r.root, '我自己').props.onPress());
  await act(async () => r.unmount());
  await render(<Me />);
  expect(current()).toBe('我自己');
});

it('ranks the team by the gap to each one’s dunk line and names each one’s weak link', async () => {
  const [me, ming] = await listAthletes(mockDb);
  await updateAthlete(mockDb, { ...me, body_mass_kg: 80, standing_reach_cm: 240 });
  await updateAthlete(mockDb, { ...ming, body_mass_kg: 70, standing_reach_cm: 236 });
  await touch(me.id, 'me-1', '2026-10-14T10:00:00.000Z', [309, 310, 311]);
  await touch(ming.id, 'ming-1', '2026-10-07T10:00:00.000Z', [312, 313, 314]);
  await touch(ming.id, 'ming-2', '2026-10-21T10:00:00.000Z', [315, 316, 317]);

  const r = await render(<Team />);
  const shown = texts(r.root);
  // 320 − 316 (mean of the best three) = 4; 320 − 310 = 10.
  expect(shown.indexOf('小明')).toBeLessThan(shown.indexOf('我自己'));
  expect(shown).toContain('差 4.0 cm');
  expect(shown).toContain('差 10.0 cm');
  expect(shown).toContain('先测：深蹲 1RM、跳深、CMJ');
  expect(shown).toContain('316.0 · 313.0');
  expect(shown).toContain('+3.0');

  await act(async () => pressable(r.root, '看 我自己 的扣篮诊断').props.onPress());
  expect(current()).toBe('我自己');
  expect(mockRouter.push).toHaveBeenCalledWith('/dunk');

  await act(async () => pressable(r.root, '测试日 · 全队轮流测').props.onPress());
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/test-day', params: { crew: 'all' } });
});

it('starts with everyone picked when opened from the team board', async () => {
  mockParams = { crew: 'all' };
  const r = await render(<TestDay />);
  mockParams = {};
  expect(texts(r.root)).toContain('2 人轮流测');
});

it('lets several athletes take turns on a test day, each test for everyone before the next', async () => {
  const r = await render(<TestDay />);
  await act(async () => chip(r.root, '小明').props.onPress());
  expect(texts(r.root)).toContain('2 人轮流测');

  await act(async () => pressable(r.root, '下一位：我自己 · CMJ 反向跳').props.onPress());
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/measure/capture', params: { metric: 'cmj', session: expect.any(String), from: 'testday' } });

  // 我自己 jumped; back on the wizard, 小明 is up for the same test.
  await ensureSession(mockDb, 'me-cmj', 1, 'cmj');
  await addTrial(mockDb, { session_id: 'me-cmj', value: 44 });
  await act(async () => mockFocus());
  await act(async () => {});
  await act(async () => pressable(r.root, '下一位：小明 · CMJ 反向跳').props.onPress());
  expect(current()).toBe('小明');

  // Back to 小明 alone: until his own tests load, 我自己's CMJ must not show up (or be added to) as his.
  act(() => chip(r.root, '我自己').props.onPress());
  expect(texts(r.root)).not.toContain('已测 1 跳');
  await act(async () => {});
  expect(texts(r.root)).toContain('下一项：CMJ 反向跳');
});

it('hands an athlete their own data as a file, and brings it back without touching anyone else', async () => {
  const r = await render(<Me />);
  expect(current()).toBe('小明');
  await act(async () => pressable(r.root, '导出 小明 的数据').props.onPress());
  expect(mockShared).toHaveLength(1);
  const file = mockShared[0] as Awaited<ReturnType<typeof exportAthlete>>;
  expect(file.tables.athlete.map((a) => a.name)).toEqual(['小明']);

  // Bringing the same athlete back asks before replacing their records.
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons?: AlertButton[]) => {
    buttons?.find((b) => b.style === 'destructive')?.onPress?.();
  });
  mockPicked = JSON.stringify(file);
  await act(async () => pressable(r.root, '导入运动员').props.onPress());
  await act(async () => {});
  expect(alert.mock.calls[0][0]).toBe('更新小明的数据？');
  expect(alert.mock.calls[0][1]).toContain('手机上现在：1 个测试对象、');
  expect((await listAthletes(mockDb)).map((a) => a.name)).toEqual(['我自己', '小明']);

  // The profile on screen is the file's, so 保存 can't write the old values back over it.
  const field = (label: string) => r.root.find((n) => n.type === TextInput && n.props.accessibilityLabel === label);
  await act(async () => field('站立摸高（cm）').props.onChangeText('230'));
  await act(async () => pressable(r.root, '保存').props.onPress());
  expect((await listAthletes(mockDb))[1].standing_reach_cm).toBe(230);
  await act(async () => pressable(r.root, '导入运动员').props.onPress());
  await act(async () => {});
  expect(field('站立摸高（cm）').props.value).toBe('236');
  await act(async () => pressable(r.root, '保存').props.onPress());
  expect((await listAthletes(mockDb))[1].standing_reach_cm).toBe(236);

  // A whole-phone backup is not taken for one athlete.
  mockPicked = JSON.stringify({ format: 'jump-attack-backup', schema_version: 1, exported_at: '', tables: { athlete: [{ id: 1, name: 'x' }] } });
  await act(async () => pressable(r.root, '导入运动员').props.onPress());
  expect(alert).toHaveBeenLastCalledWith('没有导入', '这是整台手机的备份文件，请用「从备份文件恢复」。');
});
