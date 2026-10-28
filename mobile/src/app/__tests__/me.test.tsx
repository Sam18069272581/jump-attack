// Drives the profile screen with the real athlete provider and an in-memory database: edit the profile, save, switch athlete.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';

import { migrate } from '@/db/migrations';
import { createAthlete, getAthlete } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { AthleteProvider } from '@/state/athlete';

import Me from '../(tabs)/me';

const mockDb = openMemoryDb();
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

function pressable(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((n) => typeof n.props.onPress === 'function' && n.findAllByType(Text).some((t) => [t.props.children].flat().join('') === label));
}

const field = (root: ReactTestInstance, label: string) => root.findAll((n) => n.type === TextInput && n.props.accessibilityLabel === label)[0];

async function type(root: ReactTestInstance, label: string, value: string) {
  await act(async () => field(root, label).props.onChangeText(value));
}

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <AthleteProvider>
        <Me />
      </AthleteProvider>,
    );
  });
  return r;
}

beforeAll(async () => {
  await migrate(mockDb);
});

it('saves the profile the dunk diagnosis reads', async () => {
  const r = await render();
  expect(texts(r.root)).toContain('我自己');
  await type(r.root, '体重（kg）', '78,5');
  await type(r.root, '站立摸高（cm）', '242');
  await type(r.root, '篮筐高度（cm）', '300');
  // 300 cm rim + the default 15 cm clearance.
  expect(texts(r.root)).toContain('扣篮线 315 cm');
  await act(async () => pressable(r.root, '保存').props.onPress());

  expect(await getAthlete(mockDb, 1)).toMatchObject({ body_mass_kg: 78.5, standing_reach_cm: 242, rim_height_cm: 300, dunk_clearance_cm: null });
});

it('switches to another athlete with their own profile', async () => {
  await createAthlete(mockDb, '队友');
  const r = await render();
  await act(async () => r.root.find((n) => n.props.accessibilityRole === 'radio' && n.findAllByType(Text).some((t) => t.props.children === '队友')).props.onPress());
  expect(field(r.root, '名字').props.value).toBe('队友');
  expect(field(r.root, '体重（kg）').props.value).toBe('');
});
