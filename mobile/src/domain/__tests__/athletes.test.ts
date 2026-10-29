import { setLang } from '@/i18n';

import { athleteName, greeting } from '../athletes';

afterEach(() => setLang('zh'));

describe('the athlete a fresh install starts with', () => {
  it('is named and greeted in the app’s language, though the database keeps 我自己', () => {
    expect(athleteName('我自己')).toBe('我自己');
    expect(greeting('我自己')).toBe('你好，我自己');
    setLang('en');
    expect(athleteName('我自己')).toBe('Me');
    expect(greeting('我自己')).toBe('Hi');
    setLang('de');
    expect(athleteName('我自己')).toBe('Ich');
    expect(greeting('我自己')).toBe('Hallo');
  });
});

it('shows any other name as typed', () => {
  setLang('en');
  expect(athleteName('Sam')).toBe('Sam');
  expect(greeting('Sam')).toBe('Hi, Sam');
});
