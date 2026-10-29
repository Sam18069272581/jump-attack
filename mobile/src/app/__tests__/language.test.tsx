// Switching the app's language under 我的: the page redraws in the picked language and the choice is kept.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { migrate } from '@/db/migrations';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { setLang } from '@/i18n';
import { AthleteProvider } from '@/state/athlete';
import { initLanguage, LangProvider } from '@/state/lang';

import Me from '../(tabs)/me';

const mockDb = openMemoryDb();
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
const mockKv = new Map<string, string>();
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockKv.get(k) ?? null,
    setItem: async (k: string, v: string) => void mockKv.set(k, v),
    getItemSync: (k: string) => mockKv.get(k) ?? null,
    setItemSync: (k: string, v: string) => void mockKv.set(k, v),
    removeItemSync: (k: string) => mockKv.delete(k),
  },
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'zh-Hans-CN' }] }));
jest.mock('@/media/videos', () => ({ savedVideos: jest.fn(async () => ({ count: 0, bytes: 0 })), deleteSavedVideos: jest.fn(async () => {}) }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

const texts = (root: ReactTestInstance) =>
  root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');

const option = (root: ReactTestInstance, label: string) =>
  root.find((n) => n.props.accessibilityRole === 'radio' && typeof n.props.onPress === 'function' && n.findAllByType(Text).some((t) => t.props.children === label));

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <AthleteProvider>
        <LangProvider>
          <Me />
        </LangProvider>
      </AthleteProvider>,
    );
  });
  return r;
}

beforeAll(async () => {
  await migrate(mockDb);
});
afterEach(() => setLang('zh'));

it('redraws the page in English, then German, and keeps the pick', async () => {
  initLanguage();
  const r = await render();
  expect(texts(r.root)).toContain('语言');
  expect(option(r.root, '跟随手机').props.accessibilityState).toEqual({ selected: true });

  await act(async () => option(r.root, 'English').props.onPress());
  expect(texts(r.root)).toContain('Language');
  expect(texts(r.root)).toContain('Profile');
  expect(option(r.root, 'English').props.accessibilityState).toEqual({ selected: true });

  await act(async () => option(r.root, 'Deutsch').props.onPress());
  expect(texts(r.root)).toContain('Sprache');
  expect(mockKv.get('language')).toBe('de');

  await act(async () => option(r.root, 'Wie das Handy').props.onPress());
  expect(texts(r.root)).toContain('语言');
  expect(mockKv.has('language')).toBe(false);
});
