// Drives the speed, mobility, recovery and VBT screens, and the training tab's use of their data, against an in-memory database.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Text, TextInput, type AlertButton } from 'react-native';

import { saveRecoveryDay } from '@/db/recovery';
import { migrate } from '@/db/migrations';
import { listSessionResults } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { getActivePlan, startPlan } from '@/db/training';
import { addVbtSet } from '@/db/vbt';
import { addDays, toISODate } from '@/domain/dates';

import Home from '../(tabs)/index';
import Train from '../(tabs)/train';
import ManualEntry from '../measure/entry';
import Result from '../measure/result';
import MobilityEntry from '../mobility/[test]';
import Mobility from '../mobility/index';
import HealthImportGuide from '../recovery/health';
import Recovery from '../recovery/index';
import SpeedTests from '../speed/index';
import VbtSession from '../vbt/[lift]';
import WorkoutScreen from '../workout/[date]';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismiss: jest.fn(), dismissTo: jest.fn(), dismissAll: jest.fn() };
let mockParams: Record<string, string> = {};

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
const mockAthlete = { current: { id: 1, name: '我自己' } };
jest.mock('@/state/athlete', () => ({ useAthlete: () => mockAthlete }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
jest.mock('expo-sensors', () => ({ Accelerometer: { isAvailableAsync: async () => false, setUpdateInterval: jest.fn(), addListener: jest.fn() } }));
let mockClipboard = '';
jest.mock('expo-clipboard', () => ({ getStringAsync: async () => mockClipboard, setStringAsync: async (t: string) => void (mockClipboard = t) }));
const mockKv = new Map<string, string>();
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockKv.get(k) ?? null,
    setItem: async (k: string, v: string) => void mockKv.set(k, v),
    removeItem: async (k: string) => void mockKv.delete(k),
  },
}));
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
    Link: ({ children }: { children: React.ReactNode }) => children,
  };
});

// Monday 2026-10-19, 10:00. Only Date is faked.
jest.useFakeTimers({
  now: new Date(2026, 9, 19, 10),
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'],
});
const today = toISODate(new Date());

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

function pressable(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((n) => typeof n.props.onPress === 'function' && (n.props.accessibilityLabel === label || n.findAllByType(Text).some((t) => [t.props.children].flat().includes(label))));
}

function input(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.findAll((n) => n.type === TextInput && n.props.accessibilityLabel === label)[0];
}

async function type(root: ReactTestInstance, label: string, value: string) {
  await act(async () => input(root, label).props.onChangeText(value));
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

it('opens every module from the home screen', async () => {
  const r = await render(<Home />);
  expect(texts(r.root)).not.toContain('即将上线');
});

describe('speed', () => {
  it('starts a sprint test, takes a typed time and keeps the fastest attempt', async () => {
    const list = await render(<SpeedTests />);
    await press(list.root, '30 m 冲刺');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/measure/capture', params: { metric: 'sprint_30', session: expect.any(String) } });

    mockParams = { metric: 'sprint_30', session: 'sprint-a' };
    for (const time of ['4,42', '4.36']) {
      const entry = await render(<ManualEntry />);
      await type(entry.root, '30 m 冲刺（s）', time);
      await press(entry.root, '保存这一次');
    }
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/measure/result', params: { metric: 'sprint_30', session: 'sprint-a' } });

    const result = await render(<Result />);
    expect(texts(result.root)).toContain('4.36');
    expect(texts(result.root)).toContain('含手动输入的成绩');
    await press(result.root, '完成');
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/speed');
  });

  it('rejects an impossible time', async () => {
    mockParams = { metric: 'sprint_10', session: 'sprint-b' };
    const entry = await render(<ManualEntry />);
    await type(entry.root, '10 m 冲刺（s）', '0.5');
    expect(texts(entry.root)).toContain('一般在');
    expect(pressable(entry.root, '保存这一次').props.disabled).toBe(true);
  });
});

describe('mobility', () => {
  it('records both sides and flags a 10% difference', async () => {
    mockParams = { test: 'mob_ankle' };
    const entry = await render(<MobilityEntry />);
    await type(entry.root, '踝背屈 · 膝触墙 · 左（cm）', '11.5');
    await type(entry.root, '踝背屈 · 膝触墙 · 右（cm）', '9.8');
    expect(texts(entry.root)).toContain('超过提醒线');
    await press(entry.root, '保存');
    expect(mockRouter.back).toHaveBeenCalled();

    const table = await render(<Mobility />);
    const t = texts(table.root);
    expect(t).toContain('11.5cm');
    expect(t).toContain('左右差 15%');
  });
});

describe('recovery and the training tab', () => {
  beforeAll(async () => {
    // A steady week of HRV and resting heart rate, and a plan that trains today (Monday).
    for (let i = 7; i >= 1; i--) await saveRecoveryDay(mockDb, 1, { date: addDays(today, -i), hrv: [62, 66, 70, 64, 68, 60, 65][7 - i], rhr: 52, sleep: 7.5, resp: null });
    await startPlan(mockDb, 1, { templateCode: 'jump-4-1', startDate: today, weekdays: [1, 3, 5] });
  });

  it('records today and reads fatigue from a low HRV', async () => {
    const r = await render(<Recovery />);
    await type(r.root, 'HRV (SDNN)（ms）', '48');
    await type(r.root, '静息心率（bpm）', '58');
    await type(r.root, '睡眠（h）', '6.5');
    await press(r.root, '保存');
    const t = texts(r.root);
    expect(t).toContain('疲劳');
    expect(t).toContain('HRV 48 ms，低于你 7 天基线');
    expect((await listSessionResults(mockDb, 1, 'rec_hrv')).at(-1)?.best).toBe(48);
  });

  it('cuts today’s session on the recovery signal without a CMJ test', async () => {
    const r = await render(<Train />);
    const t = texts(r.root);
    expect(t).toContain('疲劳信号');
    expect(t).toContain('HRV 48 ms');
    expect(t).toContain('已按疲劳信号减量');
    expect(t).toContain('杠铃后蹲：4 组 → 3 组');
  });

  it('suggests a deload week after three fatigued readings and inserts it', async () => {
    await saveRecoveryDay(mockDb, 1, { date: addDays(today, -1), hrv: 47, rhr: 58, sleep: 6, resp: null });
    await saveRecoveryDay(mockDb, 1, { date: addDays(today, -2), hrv: 49, rhr: 57, sleep: 6, resp: null });
    const r = await render(<Train />);
    expect(texts(r.root)).toContain('建议插入一周减量');
    await press(r.root, '从今天开始减量周');
    expect((await getActivePlan(mockDb, 1))!.deloads).toEqual([today]);
    const t = texts(r.root);
    expect(t).toContain('插入的减量周');
    expect(t).not.toContain('建议插入一周减量');
  });
});

describe('VBT', () => {
  it('logs sets, warns on velocity loss and estimates 1RM', async () => {
    mockParams = { lift: 'vbt_squat', session: 'vbt-a' };
    const r = await render(<VbtSession />);
    for (const [kg, v] of [['60', '0.9'], ['80', '0.7'], ['100', '0.5'], ['100', '0.38']]) {
      await type(r.root, '重量（kg）', kg);
      await type(r.root, '平均速度（m/s）', v);
      await press(r.root, '记一组');
    }
    const t = texts(r.root);
    expect(t).toContain('加速力量'); // 0.7 m/s
    expect(t).toContain('速度损失 24%，建议停组');
    expect(t).toMatch(/估算 1RM 1\d\d/);
  });

  it('suggests the squat weight in today’s workout from that 1RM', async () => {
    await addVbtSet(mockDb, 1, 'vbt-b', 'vbt_squat', { load: 60, v: 0.9, reps: 3, source: 'manual' });
    await addVbtSet(mockDb, 1, 'vbt-b', 'vbt_squat', { load: 100, v: 0.5, reps: 3, source: 'manual' });
    mockParams = { date: today };
    const r = await render(<WorkoutScreen />);
    // 1RM 120 kg. The deload week and today's low HRV bring the squat to 1 × 5 at RPE 5: 120 / (1 + 10/30) = 90 kg.
    expect(texts(r.root)).toContain('按 VBT 估算 1RM 120 kg，5 次 @ RPE 5 建议 90 kg');
    const kg = r.root.findAll((n) => n.type === TextInput && n.props.accessibilityLabel === 'kg')[0];
    expect(kg.props.placeholder).toBe('90');
  });
});

describe('Apple Health import', () => {
  const alerts: { title: string; buttons?: AlertButton[] }[] = [];
  let answer = '同意并导入';
  beforeAll(() => {
    jest.spyOn(Alert, 'alert').mockImplementation((title, _message, buttons) => {
      alerts.push({ title, buttons });
      buttons?.find((b) => b.text === answer)?.onPress?.();
    });
  });
  beforeEach(() => {
    alerts.length = 0;
  });

  it('asks for consent first and imports nothing without it', async () => {
    mockClipboard = 'HRV: 71 毫秒\n静息心率: 50 次/分\n睡眠: 8小时6分钟';
    answer = '不同意';
    const r = await render(<Recovery />);
    await press(r.root, '从苹果健康导入');
    expect(alerts.map((a) => a.title)).toEqual(['读取健康数据']);
    expect(input(r.root, 'HRV (SDNN)（ms）').props.value).not.toBe('71');
    expect(mockKv.size).toBe(0);
  });

  it('fills the form from the clipboard once agreed, and saves the values as from Health', async () => {
    answer = '同意并导入';
    const r = await render(<Recovery />);
    await press(r.root, '从苹果健康导入');
    expect(input(r.root, 'HRV (SDNN)（ms）').props.value).toBe('71');
    expect(input(r.root, '静息心率（bpm）').props.value).toBe('50');
    expect(input(r.root, '睡眠（h）').props.value).toBe('8.1');
    expect(texts(r.root)).toContain('已从健康导入HRV、静息心率、睡眠，核对后点保存。');
    await type(r.root, '静息心率（bpm）', '51'); // typed over
    await press(r.root, '保存');
    const rows = await mockDb.getAllAsync<{ code: string; value: number; detail: string }>(
      `SELECT s.metric_code AS code, t.value, t.detail FROM test_session s JOIN trial t ON t.session_id = s.id WHERE s.id LIKE ?`,
      `day-1-%-${today}`,
    );
    const source = Object.fromEntries(rows.map((x) => [x.code, [x.value, JSON.parse(x.detail).source]]));
    expect(source).toMatchObject({ rec_hrv: [71, 'health'], rec_rhr: [51, 'manual'], rec_sleep: [8.1, 'health'] });
  });

  it('does not ask again, and points to the setup when the clipboard has no Health data', async () => {
    mockClipboard = 'hello';
    const r = await render(<Recovery />);
    await press(r.root, '从苹果健康导入');
    expect(alerts.map((a) => a.title)).toEqual(['剪贴板里没有健康数据']);
    answer = '查看设置方法';
    await press(r.root, '从苹果健康导入');
    expect(mockRouter.push).toHaveBeenCalledWith('/recovery/health');
  });

  it('shows the Shortcut setup and lets consent be withdrawn', async () => {
    const r = await render(<HealthImportGuide />);
    expect(texts(r.root)).toContain('你已同意导入健康数据。');
    await press(r.root, '撤回同意');
    expect(mockKv.size).toBe(0);
    expect(texts(r.root)).toContain('第一次导入时会先问你');
    await press(r.root, '复制示例试一下');
    expect(mockClipboard).toContain('HRV: 58');
  });
});
