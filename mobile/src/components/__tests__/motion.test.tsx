import { AccessibilityInfo, Animated, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { motion } from '@/theme';

import { PressScale, Rise } from '../motion';

const mockSelection = jest.fn(() => Promise.resolve());
jest.mock('expo-haptics', () => ({ selectionAsync: () => mockSelection() }));

function opacityOf(r: ReactTestRenderer): number {
  const view = r.root.findByType(Animated.View);
  const style = [view.props.style].flat(Infinity).reduce((acc, s) => ({ ...acc, ...s }), {});
  return typeof style.opacity === 'number' ? style.opacity : style.opacity.__getValue();
}

afterEach(() => jest.restoreAllMocks());

it('rises into place after a delay that staggers it behind earlier siblings', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  const timing = jest.spyOn(Animated, 'timing');
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <Rise index={2}>
        <Text>摸高</Text>
      </Rise>,
    );
  });
  // The animation runs on the native driver, so the test checks where it starts and what it is asked to do.
  expect(opacityOf(r)).toBe(0);
  expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, delay: 2 * motion.stagger }));
  await act(async () => r.unmount());
});

it('shows content at once when the phone asks for less motion', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <Rise>
        <Text>摸高</Text>
      </Rise>,
    );
  });
  expect(opacityOf(r)).toBe(1);
});

it('gives a light tick on press and still runs the action if haptics fail', async () => {
  const onPress = jest.fn();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <PressScale accessibilityLabel="跳跃测试" onPress={onPress}>
        <Text>跳跃测试</Text>
      </PressScale>,
    );
  });
  const button = () => r.root.findAll((n) => n.type !== PressScale && typeof n.props.onPress === 'function')[0];
  await act(async () => button().props.onPress());
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(mockSelection).toHaveBeenCalledTimes(1);

  mockSelection.mockImplementationOnce(() => {
    throw new Error('no haptics engine');
  });
  await act(async () => button().props.onPress());
  expect(onPress).toHaveBeenCalledTimes(2);
});
