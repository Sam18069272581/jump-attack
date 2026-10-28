// An exercise's demo page: the drawn positions and steps for everyone, and a clip the athlete filmed themselves.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { deleteDemoClip, demoClip, saveDemoClip } from '@/media/demos';

import ExerciseDemo from '../exercise/[code]';

let mockParams: Record<string, string> = {};
const mockClips: Record<string, string> = {};

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-video', () => ({ useVideoPlayer: (uri: string | null) => ({ uri }), VideoView: () => null }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/media/demos', () => ({
  demoClip: jest.fn((code: string) => mockClips[code] ?? null),
  saveDemoClip: jest.fn(async (code: string, uri: string) => (mockClips[code] = `file:///docs/demos/${code}.mov`)),
  deleteDemoClip: jest.fn((code: string) => delete mockClips[code]),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: ({ options }: { options: { title: string } }) => jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, options.title) },
}));

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

const pressable = (root: ReactTestInstance, label: string) =>
  root.find((n) => typeof n.props.onPress === 'function' && n.findAllByType(Text).some((t) => [t.props.children].flat().join('') === label));

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<ExerciseDemo />);
  });
  return r;
}

it('shows how the exercise is done: its name, both positions, the steps and the mistakes', async () => {
  mockParams = { code: 'depth_jump' };
  const r = await render();
  const shown = texts(r.root);
  expect(shown).toContain('跳深');
  expect(shown).toContain('起始');
  expect(shown).toContain('关键动作');
  expect(shown).toContain('1. 站在箱子边缘，一只脚迈出去，自然落下，不要先往上跳。');
  expect(shown).toContain('落地后蹲很深、停顿，再起跳。');
  expect(demoClip).toHaveBeenCalledWith('depth_jump');
});

it('swaps in a clip the athlete filmed, kept on this phone only, and can remove it again', async () => {
  mockParams = { code: 'pogo' };
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///picked/pogo.mov', width: 0, height: 0, duration: 8000 }] });
  const r = await render();
  expect(texts(r.root)).toContain('只存在这台手机上');
  await act(async () => pressable(r.root, '用自己拍的视频').props.onPress());
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['videos'] }));
  expect(saveDemoClip).toHaveBeenCalledWith('pogo', 'file:///picked/pogo.mov');
  expect(texts(r.root)).toContain('删掉自己的视频');

  await act(async () => pressable(r.root, '删掉自己的视频').props.onPress());
  expect(deleteDemoClip).toHaveBeenCalledWith('pogo');
  expect(texts(r.root)).toContain('用自己拍的视频');
});

it('turns down a clip longer than 30 seconds', async () => {
  mockParams = { code: 'rdl' };
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///picked/long.mov', width: 0, height: 0, duration: 95000 }] });
  jest.mocked(saveDemoClip).mockClear();
  const r = await render();
  await act(async () => pressable(r.root, '用自己拍的视频').props.onPress());
  expect(saveDemoClip).not.toHaveBeenCalled();
  expect(texts(r.root)).toContain('这段有 95 秒，示范剪到 30 秒以内再选');
});
