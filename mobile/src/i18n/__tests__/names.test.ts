// Session and exercise names are titles on the training pages, so in English and German they start with a capital.
import { setLang, type Lang } from '..';
import { BLOCK_TEMPLATES, TEMPLATES } from '@/domain/templates';

afterEach(() => setLang('zh'));

const sessions = () => [...Object.values(BLOCK_TEMPLATES).flatMap((b) => b.sessions), ...TEMPLATES.flatMap((t) => t.sessions)];

it.each<Lang>(['en', 'de'])('capitalizes every session and exercise name in %s', (lang) => {
  setLang(lang);
  const names = sessions().flatMap((s) => [s.name, ...s.items.map((i) => i.name)]);
  expect(names.length).toBeGreaterThan(20);
  expect(names.filter((n) => !/^[A-Z0-9ÄÖÜ]/.test(n))).toEqual([]);
});
