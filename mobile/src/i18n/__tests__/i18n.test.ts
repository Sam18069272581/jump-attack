import { getLang, langFromLocales, localized, setLang, tr } from '..';

afterEach(() => setLang('zh'));

describe('tr', () => {
  it('returns the Chinese source text in Chinese, the default', () => {
    expect(getLang()).toBe('zh');
    expect(tr('我的')).toBe('我的');
  });

  it('looks the Chinese text up in the English and German dictionaries', () => {
    setLang('en');
    expect(tr('我的')).toBe('Me');
    setLang('de');
    expect(tr('我的')).toBe('Ich');
  });

  it('fills in {name} placeholders in every language', () => {
    expect(tr('导出 {name} 的数据', { name: 'Sam' })).toBe('导出 Sam 的数据');
    setLang('en');
    expect(tr('导出 {name} 的数据', { name: 'Sam' })).toBe('Export Sam’s data');
    setLang('de');
    expect(tr('导出 {name} 的数据', { name: 'Sam' })).toBe('Daten von Sam exportieren');
  });

  it('writes placeholder values the way a template literal would', () => {
    expect(tr('{a}{b}', { a: 3.5, b: null })).toBe('3.5null');
  });

  it('falls back to the Chinese text when a translation is missing', () => {
    setLang('en');
    expect(tr('这句没有翻译 {n}', { n: 1 })).toBe('这句没有翻译 1');
  });
});

describe('langFromLocales', () => {
  it('picks the first of the phone’s languages the app speaks', () => {
    expect(langFromLocales(['zh-Hans-CN'])).toBe('zh');
    expect(langFromLocales(['zh-Hant-TW'])).toBe('zh');
    expect(langFromLocales(['de-DE', 'en-US'])).toBe('de');
    expect(langFromLocales(['fr-FR', 'de-AT', 'zh-CN'])).toBe('de');
    expect(langFromLocales(['en-GB'])).toBe('en');
  });

  it('falls back to English for a phone in none of the three', () => {
    expect(langFromLocales(['fr-FR', 'ja-JP'])).toBe('en');
    expect(langFromLocales([])).toBe('en');
  });
});

describe('localized', () => {
  it('reads text fields of module-level data in the language current at the time', () => {
    const item = localized({ code: 'me', name: '我的' }, 'name');
    expect(item.name).toBe('我的');
    setLang('en');
    expect(item.name).toBe('Me');
    expect({ ...item }).toEqual({ code: 'me', name: 'Me' });
    expect(JSON.stringify(item)).toBe('{"code":"me","name":"Me"}');
  });
});
