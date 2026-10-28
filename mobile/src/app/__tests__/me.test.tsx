// Drives the profile screen with the real athlete provider and an in-memory database: edit the profile, save, switch athlete.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Text, TextInput, type AlertButton } from 'react-native';

import { migrate } from '@/db/migrations';
import { addTrial, createAthlete, ensureSession, getAthlete, listTrials } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { deleteSavedVideos } from '@/media/videos';
import { AthleteProvider } from '@/state/athlete';

import Me from '../(tabs)/me';

const mockDb = openMemoryDb();
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
// Three old copies of slow-motion clips, 94 MB in all.
jest.mock('@/media/videos', () => ({ savedVideos: jest.fn(async () => ({ count: 3, bytes: 94_000_000 })), deleteSavedVideos: jest.fn(async () => {}) }));
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

it('clears old video copies after confirming', async () => {
  await ensureSession(mockDb, 'v', 1, 'cmj');
  await addTrial(mockDb, { session_id: 'v', value: 40, video_uri: 'file:///Documents/videos/v-1.mov' });
  const r = await render();
  expect(texts(r.root)).toContain('3 段旧录像，共 94 MB');

  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons?: AlertButton[]) => {
    buttons?.find((b) => b.style === 'destructive')?.onPress?.();
  });
  await act(async () => pressable(r.root, '清理旧录像').props.onPress());
  await act(async () => {});
  expect(alert).toHaveBeenCalled();
  expect(deleteSavedVideos).toHaveBeenCalled();
  expect((await listTrials(mockDb, 'v'))[0].video_uri).toBeNull();
});
