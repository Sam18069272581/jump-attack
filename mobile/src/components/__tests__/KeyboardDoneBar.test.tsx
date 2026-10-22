import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Keyboard, View, type KeyboardEvent } from 'react-native';

import { KeyboardDoneBar } from '../KeyboardDoneBar';

it('sits on top of the keyboard while it is up and puts it away', async () => {
  const handlers = new Map<string, (e: KeyboardEvent) => void>();
  jest.spyOn(Keyboard, 'addListener').mockImplementation((event, handler) => {
    handlers.set(event, handler as (e: KeyboardEvent) => void);
    return { remove: jest.fn() } as unknown as ReturnType<typeof Keyboard.addListener>;
  });
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});

  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<KeyboardDoneBar />);
  });
  expect(r.toJSON()).toBeNull();

  await act(async () => handlers.get('keyboardWillShow')!({ endCoordinates: { height: 336 } } as KeyboardEvent));
  const bar = r.root.findAllByType(View)[0];
  expect(bar.props.style).toContainEqual({ bottom: 336 });
  await act(async () => r.root.find((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function').props.onPress());
  expect(dismiss).toHaveBeenCalled();

  await act(async () => handlers.get('keyboardWillHide')!({} as KeyboardEvent));
  expect(r.toJSON()).toBeNull();
});
