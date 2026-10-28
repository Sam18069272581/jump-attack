import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { ErrorScreen } from '../ErrorScreen';

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

it('says what failed instead of a blank screen, and retries', async () => {
  const retry = jest.fn(async () => {});
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<ErrorScreen error={new Error('database disk image is malformed')} retry={retry} />);
  });
  const t = r.root
    .findAllByType(Text)
    .map((n) => [n.props.children].flat().join(''))
    .join('\n');
  expect(t).toContain('出错了');
  expect(t).toContain('database disk image is malformed');
  expect(t).toContain('记录都还在手机上');

  await act(async () => r.root.find((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function').props.onPress());
  expect(retry).toHaveBeenCalled();
});

it('says the records are in the browser on the web version', async () => {
  jest.replaceProperty(jest.requireActual('react-native').Platform, 'OS', 'web');
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<ErrorScreen error={new Error('x')} retry={async () => {}} />);
  });
  const t = r.root
    .findAllByType(Text)
    .map((n) => [n.props.children].flat().join(''))
    .join('\n');
  expect(t).toContain('记录都还在这个浏览器里');
  expect(t).not.toContain('手机');
  jest.restoreAllMocks();
});
