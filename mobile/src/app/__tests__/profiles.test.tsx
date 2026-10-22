// Drives the force-velocity profile and drop-jump ladder screens against an in-memory database.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';

import { migrate } from '@/db/migrations';
import { listSessionResults, listTrials } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';

import DropJumpLadder from '../jumps/dj';
import ForceVelocity from '../jumps/fvp';
import JumpTests from '../jumps/index';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
let mockParams: Record<string, string> = {};

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
const mockAthlete: { current: Record<string, unknown> } = { current: { id: 1, name: '我自己' } };
jest.mock('@/state/athlete', () => ({ useAthlete: () => mockAthlete }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
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

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

function pressable(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((n) => typeof n.props.onPress === 'function' && (n.props.accessibilityLabel === label || n.findAllByType(Text).some((t) => [t.props.children].flat().includes(label))));
}

async function type(root: ReactTestInstance, label: string, value: string) {
  await act(async () => root.findAll((n) => n.type === TextInput && n.props.accessibilityLabel === label)[0].props.onChangeText(value));
}

async function press(root: ReactTestInstance, label: string) {
  await act(async () => pressable(root, label).props.onPress());
  await act(async () => {});
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
});

beforeEach(() => {
  for (const f of Object.values(mockRouter)) f.mockClear();
});

it('opens both profile tests from the jump list with a new session', async () => {
  const r = await render(<JumpTests />);
  await press(r.root, '力-速度曲线');
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/jumps/fvp', params: { session: expect.any(String) } });
  await press(r.root, 'DJ 跳深 · 找最佳箱高');
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/jumps/dj', params: { session: expect.any(String) } });
});

describe('force-velocity profile', () => {
  it('asks for body mass and leg measurements first', async () => {
    mockParams = { session: 'fv-0' };
    const r = await render(<ForceVelocity />);
    expect(texts(r.root)).toContain('先在「我的」填三个数');
    await press(r.root, '去填写');
    expect(mockRouter.navigate).toHaveBeenCalledWith('/me');
  });

  it('fits the profile from typed jumps and suggests what to train', async () => {
    mockAthlete.current = { id: 1, name: '我自己', body_mass_kg: 75, leg_length_cm: 100, squat_height_cm: 60 };
    mockParams = { session: 'fv-1' };
    const r = await render(<ForceVelocity />);
    expect(texts(r.root)).toContain('至少两级不同负重后');

    for (const [kg, cm] of [['0', '36.2'], ['20', '26.4'], ['40', '19.3'], ['60', '13.8']]) {
      await type(r.root, '负重（含杆）（kg）', kg);
      await type(r.root, '跳高（手填）（cm）', cm);
      await press(r.root, '记手填的跳高');
    }
    const t = texts(r.root);
    expect(t).toContain('今天的力-速度曲线');
    expect(t).toContain('32.0'); // F0, N/kg
    expect(t).toContain('3.21'); // v0, m/s (heights typed to 0.1 cm)
    expect(t).toContain('71'); // FV%
    expect(t).toContain('力量端偏弱');
    expect(t).toContain('训练建议 · 力量轻度不足');
    expect(t).toContain('每周 6 个下肢练习：力量 2 · 力量-爆发 2 · 爆发 2');
    expect(t).not.toContain('单次测试的斜率误差较大'); // 71 % is clearly off balance
    expect(t).toContain('按 4 级负重、蹬伸距离 40 cm 计算');

    // Saved under their own metric with their loads, so the plain SJ history stays unloaded.
    expect((await listTrials(mockDb, 'fv-1')).map((x) => [x.load_kg, x.value])).toEqual([
      [0, 36.2],
      [20, 26.4],
      [40, 19.3],
      [60, 13.8],
    ]);
    expect(await listSessionResults(mockDb, 1, 'sj')).toEqual([]);
    expect((await listSessionResults(mockDb, 1, 'fvp_sj')).map((x) => x.best)).toEqual([36.2]);
  });

  it('sends a jump to video marking with its load', async () => {
    mockParams = { session: 'fv-2' };
    const r = await render(<ForceVelocity />);
    // No jumps today yet: the last profile is shown.
    expect(texts(r.root)).toContain('最近一次的力-速度曲线');
    await type(r.root, '负重（含杆）（kg）', '37.5');
    await press(r.root, '录像测这一跳');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/measure/capture', params: { metric: 'fvp_sj', session: 'fv-2', from: 'fvp', load: '37.5' } });
  });
});

describe('drop-jump ladder', () => {
  it('finds the box height with the highest RSI', async () => {
    mockParams = { session: 'dj-1' };
    const r = await render(<DropJumpLadder />);
    for (const [box, ms, cm] of [['20', '200', '30'], ['30', '180', '32'], ['40', '230', '31']]) {
      await press(r.root, box);
      await type(r.root, '触地（手填）（ms）', ms);
      await type(r.root, '跳高（手填）（cm）', cm);
      await press(r.root, '记手填的这一跳');
    }
    const t = texts(r.root);
    expect(t).toContain('最佳跳深高度');
    expect(t).toContain('1.78'); // 0.32 m / 0.18 s at 30 cm
    expect(t).toContain('这个高度的 RSI 最高（1.78）');
    expect(t).not.toContain('下次可以再加一级');
    const saved = await listTrials(mockDb, 'dj-1');
    expect(saved.map((x) => x.detail)).toEqual([
      { source: 'manual', box_cm: 20, contact_ms: 200, height_cm: 30 },
      { source: 'manual', box_cm: 30, contact_ms: 180, height_cm: 32 },
      { source: 'manual', box_cm: 40, contact_ms: 230, height_cm: 31 },
    ]);
  });

  it('rejects a contact time that is a squat, not a rebound', async () => {
    mockParams = { session: 'dj-2' };
    const r = await render(<DropJumpLadder />);
    await type(r.root, '触地（手填）（ms）', '1500');
    await type(r.root, '跳高（手填）（cm）', '30');
    expect(texts(r.root)).toContain('这是下蹲而不是反弹');
    expect(pressable(r.root, '记手填的这一跳').props.disabled).toBe(true);
  });

  it('sends a jump to video marking with its box height', async () => {
    mockParams = { session: 'dj-3' };
    const r = await render(<DropJumpLadder />);
    await press(r.root, '50');
    await press(r.root, '录像测 50 cm 这一跳');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/measure/capture', params: { metric: 'dj_rsi', session: 'dj-3', from: 'dj', box: '50' } });
  });
});
