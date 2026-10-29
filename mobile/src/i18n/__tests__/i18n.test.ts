import { decimal, getLang, htmlTexts, langFromLocales, localizeHtml, localized, setLang, speechLanguage, tr } from '..';

// The mechanism, with dictionaries of its own; the real ones are checked in dictionaries.test.ts.
jest.mock('../en', () => ({ en: { 我的: 'Me', '导出 {name} 的数据': 'Export {name}’s data', 引号: `it's <b>` } }));
jest.mock('../de', () => ({ de: { 我的: 'Ich', '导出 {name} 的数据': 'Daten von {name} exportieren', '{r} 倍': 'das {r}-Fache' } }));

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

describe('decimal numbers', () => {
  it('writes a decimal comma in German and a point otherwise', () => {
    expect(decimal(1.754, 2)).toBe('1.75');
    setLang('en');
    expect(decimal(1.754, 2)).toBe('1.75');
    setLang('de');
    expect(decimal(1.754, 2)).toBe('1,75');
    expect(decimal(-12.8, 1)).toBe('-12,8');
    expect(decimal(305, 0)).toBe('305');
  });

  it('gives German placeholder values a decimal comma when they are numbers, and leaves other text alone', () => {
    setLang('de');
    expect(tr('{r} 倍', { r: '1.75' })).toBe('das 1,75-Fache');
    expect(tr('{r} 倍', { r: 3.5 })).toBe('das 3,5-Fache');
    expect(tr('{r} 倍', { r: '29.10.' })).toBe('das 29.10.-Fache');
    expect(tr('{r} 倍', { r: 'v1.2' })).toBe('das v1.2-Fache');
    setLang('en');
    expect(tr('{a}{b}', { a: 3.5, b: '1.75' })).toBe('3.51.75');
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

  it('reaches into nested objects and arrays, and translates lists of text', () => {
    const shared = { name: '我的' };
    const listed = { name: '我的', steps: ['我的', '我的'] };
    const data = localized({ items: [shared, listed], again: shared }, 'name', 'steps');
    setLang('en');
    expect(data.items[0].name).toBe('Me');
    expect(listed.steps).toEqual(['Me', 'Me']);
    expect(data.again.name).toBe('Me');
  });

  it('translates every text field when no field is named, for tables keyed by code', () => {
    const table = localized({ a: '我的', b: { what: '我的' } });
    setLang('en');
    expect(table).toEqual({ a: 'Me', b: { what: 'Me' } });
  });

  it('keeps the Chinese key when the same data is wrapped twice, whatever the language', () => {
    const item = localized({ name: '我的' }, 'name');
    setLang('en');
    localized(item, 'name');
    setLang('de');
    expect(item.name).toBe('Ich');
  });

  it('lets code overwrite a translated field', () => {
    const item = localized({ name: '我的' }, 'name');
    item.name = 'Sam';
    setLang('en');
    expect(item.name).toBe('Sam');
  });
});

describe('localizeHtml', () => {
  const page = "<div id=\"msg\">我的</div><script>post({ message: '我的' }); post({ message: '我的：' + e.name });</script>";

  it('finds the Chinese text nodes and quoted script strings of a WebView page', () => {
    expect(htmlTexts(page)).toEqual(['我的', '我的', '我的：']);
  });

  it('leaves the page alone in Chinese and translates what it can in English', () => {
    expect(localizeHtml(page)).toBe(page);
    setLang('en');
    expect(localizeHtml(page)).toBe("<div id=\"msg\">Me</div><script>post({ message: 'Me' }); post({ message: '我的：' + e.name });</script>");
  });

  it('escapes what it puts into a script string or a text node', () => {
    setLang('en');
    expect(localizeHtml("<p>引号</p><script>x('引号')</script>")).toBe("<p>it's &lt;b&gt;</p><script>x('it\\'s <b>')</script>");
  });
});

describe('speechLanguage', () => {
  it('speaks cues in the app’s language', () => {
    expect(speechLanguage()).toBe('zh-CN');
    setLang('de');
    expect(speechLanguage()).toBe('de-DE');
  });
});
