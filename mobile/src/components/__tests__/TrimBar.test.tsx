// The trim bar follows the finger: a handle moves by what the finger moves, the playhead stays inside the part kept.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { TrimBar } from '../TrimBar';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));

// 90 frames on a strip 300 px wide, 30 fps capture.
function render(span = { from: 0, to: 89 }) {
  const calls = { onChange: jest.fn(), onScrub: jest.fn(), onRelease: jest.fn() };
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<TrimBar total={90} span={span} frame={0} fps={30} thumbnails={[]} {...calls} />);
  });
  const strip = r.root.find((n) => typeof n.props.onLayout === 'function');
  act(() => strip.props.onLayout({ nativeEvent: { layout: { width: 300, height: 52 } } }));
  return { r, calls };
}

const touch = (pageX: number, locationX = 0) => ({ nativeEvent: { pageX, locationX } });
const handle = (root: ReactTestInstance, label: string) => root.find((n) => n.props.accessibilityLabel === label && typeof n.props.onResponderMove === 'function');

it('drags the start handle by the distance the finger moves, and ends the trim on letting go', () => {
  const { r, calls } = render();
  const start = handle(r.root, '片段开始');
  act(() => start.props.onResponderGrant(touch(40)));
  // 100 px of 300 is a third of 89 frames: frame 30.
  act(() => start.props.onResponderMove(touch(140)));
  expect(calls.onChange).toHaveBeenLastCalledWith({ from: 30, to: 89 }, 'from');
  expect(calls.onRelease).not.toHaveBeenCalled();
  act(() => start.props.onResponderRelease(touch(140)));
  expect(calls.onRelease).toHaveBeenCalledTimes(1);
});

it('cannot drag the end handle past the start', () => {
  const { r, calls } = render({ from: 30, to: 89 });
  const end = handle(r.root, '片段结束');
  act(() => end.props.onResponderGrant(touch(300)));
  act(() => end.props.onResponderMove(touch(0)));
  expect(calls.onChange).toHaveBeenLastCalledWith({ from: 30, to: 31 }, 'to');
});

it('scrubs only inside the part kept', () => {
  const { r, calls } = render({ from: 30, to: 60 });
  const strip = r.root.find((n) => typeof n.props.onLayout === 'function');
  act(() => strip.props.onResponderGrant(touch(500, 150)));
  expect(calls.onScrub).toHaveBeenLastCalledWith(45);
  act(() => strip.props.onResponderMove(touch(800)));
  expect(calls.onScrub).toHaveBeenLastCalledWith(60);
  act(() => strip.props.onResponderMove(touch(0)));
  expect(calls.onScrub).toHaveBeenLastCalledWith(30);
});
