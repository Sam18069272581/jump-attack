// Runs the conditioning tests end to end on a fake clock against a real (in-memory) database.
import { Alert, Text, TextInput, type AlertButton } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import CooperTest from '@/app/conditioning/cooper';
import RsaTest from '@/app/conditioning/rsa';
import YoyoTest from '@/app/conditioning/yoyo';
import { migrate } from '@/db/migrations';
import { listMetricResults, listSessionValues } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { YOYO_IR1 } from '@/domain/conditioning';
import { getMetric } from '@/domain/metrics';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() };
const mockAthlete = { current: { id: 1, name: '我自己' } };
const mockSpeak = jest.fn();
const mockPlay = jest.fn();

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('@/state/athlete', () => ({ useAthlete: () => mockAthlete }));
jest.mock('expo-haptics', () => ({
  impactAsync: () => Promise.resolve(),
  notificationAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: {},
  NotificationFeedbackType: {},
}));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
jest.mock('expo-speech', () => ({ speak: (...a: unknown[]) => mockSpeak(...a), stop: () => Promise.resolve() }));
jest.mock('expo-audio', () => {
  const player = { seekTo: () => Promise.resolve(), play: () => mockPlay() };
  return { useAudioPlayer: () => player, setAudioModeAsync: () => Promise.resolve() };
});
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  Stack: { Screen: () => null },
}));

jest.useFakeTimers();

beforeAll(() => migrate(mockDb));
beforeEach(() => jest.clearAllMocks());

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

function button(root: ReactTestInstance, label: string, handler = 'onPress'): ReactTestInstance {
  return root.find((n) => typeof n.props[handler] === 'function' && n.findAllByType(Text).some((t) => [t.props.children].flat().join('') === label));
}

async function tick(seconds: number) {
  await act(async () => {
    jest.advanceTimersByTime(seconds * 1000);
  });
}

async function press(r: ReactTestRenderer, label: string, handler = 'onPress') {
  await act(async () => {
    button(r.root, label, handler).props[handler]();
  });
}

/** Answers the "结束测试？" alert with its destructive button. */
function acceptStop() {
  jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, _m, buttons?: AlertButton[]) => buttons?.find((b) => b.style === 'destructive')?.onPress?.());
}

it('times six repeated sprints, then saves them as one set', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<RsaTest />);
  });
  await press(r, '开始（10 秒后第 1 趟）');
  expect(texts(r.root)).toContain('等待起跑音');

  const sprint = [7.1, 7.2, 7.3, 7.4, 7.5, 7.6];
  for (const [i, s] of sprint.entries()) {
    await tick(i === 0 ? 10 : 20);
    expect(texts(r.root)).toContain(`第 ${i + 1} / 6 趟 · 冲刺中`);
    await tick(s);
    await press(r, '到线 · 停表', 'onPressIn');
  }
  expect(mockPlay).toHaveBeenCalled();
  expect(mockSpeak).toHaveBeenCalledWith('测试完成', expect.anything());

  // Confirm page lists every sprint; the mean is the recorded result.
  expect(texts(r.root)).toContain('7.35');
  await press(r, '保存成绩');
  const [saved] = await listMetricResults(mockDb, 1, getMetric('rsa')!);
  expect(saved.best).toBeCloseTo(7.35, 2);
  expect(Object.values(await listSessionValues(mockDb, 1, 'rsa'))[0].map((v) => +v.toFixed(1))).toEqual(sprint);
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/conditioning/result', params: { metric: 'rsa', session: saved.session_id } });
});

it('scores the Yo-Yo test by the last shuttle finished before it was stopped', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<YoyoTest />);
  });
  await press(r, '开始（5 秒后起跑）');
  // Stop just after shuttle 5 (level 12.1) has finished.
  await tick(5 + YOYO_IR1[4].end + 2);
  expect(texts(r.root)).toContain('恢复 · 慢跑绕后方桶');
  acceptStop();
  await press(r, '结束测试');

  expect(texts(r.root)).toContain('12.1');
  expect(texts(r.root)).toContain('200 m');
  await press(r, '保存成绩');
  const [saved] = await listMetricResults(mockDb, 1, getMetric('yoyo_ir1')!);
  expect(saved.best).toBe(200);
});

it('counts Cooper laps, ends at 12 minutes and adds the last partial lap', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<CooperTest />);
  });
  await press(r, '开始（5 秒后起跑）');
  await tick(5);
  for (let i = 0; i < 7; i++) await press(r, '+1 圈');
  expect(texts(r.root)).toContain('2800');
  await tick(12 * 60);
  await tick(2); // results page follows a moment after the final signal

  expect(texts(r.root)).toContain('记了 7 圈 × 400 m = 2800 m');
  await act(async () => {
    r.root.findByType(TextInput).props.onChangeText('150');
  });
  expect(texts(r.root)).toContain('2950 m');
  await press(r, '保存成绩');
  const [saved] = await listMetricResults(mockDb, 1, getMetric('cooper')!);
  expect(saved.best).toBe(2950);
  expect(mockSpeak).toHaveBeenCalledWith('时间到，停在原地', expect.anything());
});
