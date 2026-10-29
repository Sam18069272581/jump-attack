// The app's language: the phone's on first launch, then whatever the user picked under 我的, kept across launches.
import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { getLang, setLang, tr } from '@/i18n';

import { initLanguage, LangProvider, useLang } from '../lang';

const mockKv = new Map<string, string>();
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: (k: string) => mockKv.get(k) ?? null,
    setItemSync: (k: string, v: string) => void mockKv.set(k, v),
    removeItemSync: (k: string) => mockKv.delete(k),
  },
}));
let mockLocales = ['de-DE', 'en-US'];
jest.mock('expo-localization', () => ({ getLocales: () => mockLocales.map((languageTag) => ({ languageTag })) }));

let probe!: ReturnType<typeof useLang>;
// A language change remounts everything under the provider, so no screen keeps text in the old language.
let mounts = 0;
function Probe() {
  const lang = useLang();
  useEffect(() => {
    probe = lang;
  });
  useEffect(() => {
    mounts++;
  }, []);
  return <Text>{tr('我的')}</Text>;
}

beforeEach(() => {
  mockKv.clear();
  mockLocales = ['de-DE', 'en-US'];
  mounts = 0;
});
afterEach(() => setLang('zh'));

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <LangProvider>
        <Probe />
      </LangProvider>,
    );
  });
  return r;
}

it('starts in the phone’s language until the user picks one', () => {
  initLanguage();
  expect(getLang()).toBe('de');
  mockLocales = ['fr-FR'];
  initLanguage();
  expect(getLang()).toBe('en');
  mockLocales = ['zh-Hans-CN'];
  initLanguage();
  expect(getLang()).toBe('zh');
});

it('switches the whole app to a picked language and remembers it over the phone’s', async () => {
  initLanguage();
  const r = await render();
  expect(r.root.findByType(Text).props.children).toBe('Ich');
  expect(probe.choice).toBe('system');

  await act(async () => probe.choose('en'));
  expect(r.root.findByType(Text).props.children).toBe('Me');
  expect(mounts).toBe(2);
  expect(probe).toMatchObject({ lang: 'en', choice: 'en' });

  // Next launch: the phone is still German, the app stays English.
  initLanguage();
  expect(getLang()).toBe('en');
});

it('goes back to following the phone', async () => {
  mockKv.set('language', 'zh');
  initLanguage();
  const r = await render();
  expect(probe.choice).toBe('zh');
  await act(async () => probe.choose('system'));
  expect(r.root.findByType(Text).props.children).toBe('Ich');
  expect(mockKv.has('language')).toBe(false);
});

it('still starts when the stored choice can’t be read', () => {
  mockKv.set('language', 'fr');
  initLanguage();
  expect(getLang()).toBe('de');
});
