// The replay screen hands an analysed set to the replay page and passes the video the page records to the share sheet.
import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import Replay from '../measure/replay';

const mockWeb: { props: Record<string, any> | null; inject: jest.Mock; reload: jest.Mock } = { props: null, inject: jest.fn(), reload: jest.fn() };
const mockShare = jest.fn(async (_uri: string, _options?: object) => {});
const mockPages: string[] = [];
const mockWrites: { name: string; content: string; options?: object }[] = [];
const mockDeleted: string[] = [];
const mockFs = { failOnPart: -1 };

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({
    uri: 'file:///picked/IMG_0004.MOV',
    metric: 'rj_rsi',
    fileFps: '240',
    captureFps: '240',
    from: '150',
    to: '700',
    events: JSON.stringify([
      { takeoff: 200, landing: 300, counted: true },
      { takeoff: 348, landing: 450, counted: true },
      { takeoff: 510, landing: 610, counted: true },
    ]),
    focus: JSON.stringify({ x: 10, y: 0, w: 200, h: 600 }),
  }),
}));
jest.mock('@/media/frameGrabber', () => ({
  ...jest.requireActual('@/media/frameGrabber'),
  stageForGrabbing: async (_uri: string, page: (video: string) => string) => {
    mockPages.push(page('clip-1.mov'));
    return { page: 'file:///cache/jump-detect/grab.html', dir: 'file:///cache/jump-detect/' };
  },
  unstage: jest.fn(),
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache/' },
  File: class {
    name: string;
    uri: string;
    constructor(_dir: string, name: string) {
      this.name = name;
      this.uri = `file:///cache/${name}`;
    }
    create() {}
    write(content: string, options?: object) {
      if (mockWrites.length === mockFs.failOnPart) throw new Error('No space left on device');
      mockWrites.push({ name: this.name, content, options });
    }
    delete() {
      mockDeleted.push(this.name);
    }
  },
}));
jest.mock('expo-sharing', () => ({ shareAsync: (uri: string, options?: object) => mockShare(uri, options) }));
jest.mock('react-native-webview', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const WebView = React.forwardRef((props: Record<string, any>, ref: unknown) => {
    mockWeb.props = props;
    React.useImperativeHandle(ref, () => ({ injectJavaScript: mockWeb.inject, reload: mockWeb.reload }));
    return <View />;
  });
  WebView.displayName = 'WebView';
  return { WebView };
});

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

async function post(m: unknown) {
  await act(async () => mockWeb.props!.onMessage({ nativeEvent: { data: JSON.stringify(m) } }));
}

let r: ReactTestRenderer;

afterEach(async () => {
  await act(async () => r?.unmount());
  mockWrites.length = 0;
  mockDeleted.length = 0;
  mockFs.failOnPart = -1;
  mockShare.mockClear();
});

function button(label: string) {
  return r.root.find((n) => typeof n.props.onPress === 'function' && n.findAllByType(Text).some((t) => t.props.children === label));
}

async function startExport() {
  await act(async () => {
    r = create(<Replay />);
  });
  await post({ type: 'ready' });
  await act(async () => button('导出视频').props.onPress());
}

it('gives the page the set it shows: the clip, the part of it, every jump labelled and the 10/5 score', async () => {
  await act(async () => {
    r = create(<Replay />);
  });
  const config = JSON.parse(/var C = (\{.*\});\n/.exec(mockPages.at(-1)!)![1]);
  expect(config).toMatchObject({ video: 'clip-1.mov', from: 150, to: 700, stride: 2, headline: { label: '10/5 RSI' }, focus: { x: 10, w: 200 }, title: '10/5 连跳 RSI' });
  expect(config.jumps).toHaveLength(3);
  expect(config.curve).toHaveLength(551);

  await post({ type: 'ready' });
  expect(mockWeb.inject).toHaveBeenLastCalledWith('window.replay.play(); true;');
});

it('records the video and hands it to the share sheet', async () => {
  await act(async () => {
    r = create(<Replay />);
  });
  await post({ type: 'ready' });
  const exportButton = r.root.find((n) => typeof n.props.onPress === 'function' && n.findAllByType(Text).some((t) => t.props.children === '导出视频'));
  await act(async () => exportButton.props.onPress());
  expect(mockWeb.inject).toHaveBeenLastCalledWith('window.replay.exportVideo(); true;');

  await post({ type: 'progress', done: 50, total: 200 });
  expect(texts(r.root)).toContain('正在导出');
  await post({ type: 'file', mime: 'video/mp4;codecs=avc1', part: 0, parts: 2, data: 'AAAA' });
  await post({ type: 'file', mime: 'video/mp4;codecs=avc1', part: 1, parts: 2, data: 'BBBB' });

  // Each part goes into the file as it arrives, base64 straight to bytes.
  expect(mockWrites.map((w) => [w.content, w.options])).toEqual([
    ['AAAA', { encoding: 'base64' }],
    ['BBBB', { encoding: 'base64', append: true }],
  ]);
  expect(mockWrites[0].name).toMatch(/^jump-attack-rj_rsi-.*\.mp4$/);
  expect(mockShare).toHaveBeenCalledWith(`file:///cache/${mockWrites[0].name}`, { mimeType: 'video/mp4', UTI: 'public.mpeg-4', dialogTitle: '保存或分享视频' });
});

it('says what to do when this phone cannot record the page', async () => {
  await act(async () => {
    r = create(<Replay />);
  });
  await post({ type: 'ready' });
  await post({ type: 'unsupported' });
  expect(texts(r.root)).toContain('录屏');
});

it('shows the export under way from the tap, before the page reports, so it can’t be started twice', async () => {
  await startExport();
  expect(texts(r.root)).toContain('正在导出');
  expect(button('再放一次').props.disabled).toBe(true);
});

it('shares nothing when the page stops a recording before the end', async () => {
  await startExport();
  await post({ type: 'cancelled' });
  expect(mockShare).not.toHaveBeenCalled();
  expect(texts(r.root)).not.toContain('正在导出');
  expect(button('导出视频').props.disabled).toBe(false);
});

it('says when the video can’t be written, removes the part written, and lets the export be tried again', async () => {
  await startExport();
  mockFs.failOnPart = 1;
  await post({ type: 'file', mime: 'video/mp4', part: 0, parts: 2, data: 'AAAA' });
  await post({ type: 'file', mime: 'video/mp4', part: 1, parts: 2, data: 'BBBB' });
  expect(texts(r.root)).toContain('导出失败');
  expect(mockShare).not.toHaveBeenCalled();
  expect(mockDeleted).toHaveLength(1);
  expect(button('导出视频').props.disabled).toBe(false);
});

it('clears the video out of the cache once it is shared', async () => {
  await startExport();
  await post({ type: 'file', mime: 'video/mp4', part: 0, parts: 1, data: 'AAAA' });
  expect(mockShare).toHaveBeenCalled();
  expect(mockDeleted).toEqual([mockWrites[0].name]);
});

it('reloads the page when iOS ends it in the middle of an export, and says so', async () => {
  await startExport();
  await act(async () => mockWeb.props!.onContentProcessDidTerminate());
  expect(texts(r.root)).toContain('导出中断');
  expect(mockWeb.reload).toHaveBeenCalled();
  await post({ type: 'ready' });
  expect(button('导出视频').props.disabled).toBe(false);
});
