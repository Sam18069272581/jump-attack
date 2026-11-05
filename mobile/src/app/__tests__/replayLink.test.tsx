// A replay link carries the analysed jumps as JSON. One with broken data (stale, cut off, made by hand) says what to do
// instead of crashing the screen.
import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import Replay from '../measure/replay';

let mockParams: Record<string, string> = {};
const mockStaged: string[] = [];
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('@/media/frameGrabber', () => ({
  ...jest.requireActual('@/media/frameGrabber'),
  stageForGrabbing: async (_uri: string, page: (video: string) => string) => {
    mockStaged.push(page('clip-1.mov'));
    return { page: 'file:///cache/jump-detect/grab.html', dir: 'file:///cache/jump-detect/' };
  },
  unstage: jest.fn(),
}));
jest.mock('expo-file-system', () => ({ Paths: { cache: 'file:///cache/' }, File: class {} }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));
jest.mock('react-native-webview', () => {
  const { View } = jest.requireActual('react-native');
  return { WebView: () => <View /> };
});

const link = {
  uri: 'file:///picked/IMG_0004.MOV',
  metric: 'rj_rsi',
  fileFps: '240',
  captureFps: '240',
  from: '150',
  to: '700',
  events: JSON.stringify([
    { takeoff: 200, landing: 300, counted: true },
    { takeoff: 348, landing: 450, counted: true },
  ]),
};

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string').join(''))
    .join('\n');
}

let r: ReactTestRenderer;
async function open(params: Record<string, string>) {
  mockParams = params;
  mockStaged.length = 0;
  await act(async () => {
    r = create(<Replay />);
  });
}
afterEach(async () => {
  await act(async () => r?.unmount());
});

const broken = '回放链接里的数据不完整，回上一页重新分析。';

it('says the link is broken when its jumps are cut off or are not a list of jumps', async () => {
  for (const events of ['[{"takeoff":200,', '{"takeoff":200}', '[{"takeoff":"200","landing":300}]', '', '[]']) {
    await open({ ...link, events });
    expect({ events, text: texts(r.root) }).toEqual({ events, text: expect.stringContaining(broken) });
    expect(mockStaged).toEqual([]);
  }
});

it('replays without the framing when only that part of the link is broken', async () => {
  await open({ ...link, focus: '{"x":10,' });
  expect(texts(r.root)).not.toContain(broken);
  expect(mockStaged).toHaveLength(1);
});

it('says the link is broken when its numbers can’t be replayed', async () => {
  const cases: Record<string, string | undefined>[] = [
    { captureFps: '0' },
    { captureFps: '-240' },
    { captureFps: undefined },
    { fileFps: '0' },
    { fileFps: 'abc' },
    { from: '-1' },
    { from: '700', to: '150' },
    { to: 'Infinity' },
    // A clip of a few thousand seconds: one value per frame would hold the screen up, then run out of memory.
    { to: '3000000' },
    // Over what the page can draw: it finds the curve's peak with one argument per frame.
    { to: '100150' },
    // Past 2^53 a frame and the next are the same number, and a loop over them never ends.
    { from: '9007199254740900', to: '9007199254741000', events: JSON.stringify([{ takeoff: 9007199254740950, landing: 9007199254740990, counted: true }]) },
    { from: '150.5' },
  ];
  for (const change of cases) {
    const params = Object.fromEntries(Object.entries({ ...link, ...change }).filter(([, v]) => v !== undefined)) as Record<string, string>;
    await open(params);
    expect({ change, text: texts(r.root) }).toEqual({ change, text: expect.stringContaining(broken) });
    expect(mockStaged).toEqual([]);
  }
});

// The analysis screen finds every jump within the frames it puts in the link. One outside them, or landing before it
// takes off, would have the skeleton read a slice of frames that is endless, or of a negative length.
it('says the link is broken when a jump is not within the frames it spans, or there are too many', async () => {
  for (const events of [
    [{ takeoff: 300, landing: 200, counted: true }],
    [{ takeoff: 200, landing: 300000000, counted: true }],
    [{ takeoff: 100, landing: 300, counted: true }],
    // More than any set: each jump is looked through at every frame.
    Array.from({ length: 101 }, (_, i) => ({ takeoff: 150 + 5 * i, landing: 152 + 5 * i, counted: true })),
  ]) {
    await open({ ...link, events: JSON.stringify(events) });
    expect({ events, text: texts(r.root) }).toEqual({ events, text: expect.stringContaining(broken) });
    expect(mockStaged).toEqual([]);
  }
});

it('replays a jump whose other fields are broken without them', async () => {
  await open({ ...link, events: JSON.stringify([{ takeoff: 200, landing: 300, counted: true, flags: 1, touchdown: 'x' }, { takeoff: 348, landing: 450, counted: 'yes' }]) });
  expect(texts(r.root)).not.toContain(broken);
  expect(mockStaged).toHaveLength(1);
});
