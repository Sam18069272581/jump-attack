import { de } from './de';
import { en } from './en';

/**
 * The app's languages. Chinese is the source: every text is written in Chinese in the code and that text is the key
 * of the English and German dictionaries (en.ts, de.ts), the way gettext and Qt's tr() work.
 */
export type Lang = 'zh' | 'en' | 'de';

/** For the language picker, each name in its own language. */
export const LANGS: { code: Lang; name: string }[] = [
  { code: 'zh', name: '中文' },
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
];

const DICTIONARIES: Record<Exclude<Lang, 'zh'>, Record<string, string>> = { en, de };

let current: Lang = 'zh';

export function getLang(): Lang {
  return current;
}

/** Sets the language every later tr() call answers in. Screens re-render through state/lang.tsx. */
export function setLang(lang: Lang): void {
  current = lang;
}

export function isLang(s: unknown): s is Lang {
  return s === 'zh' || s === 'en' || s === 'de';
}

/** The first of the phone's languages (BCP 47 tags, most preferred first) the app speaks; English for any other. */
export function langFromLocales(tags: string[]): Lang {
  for (const tag of tags) {
    const code = tag.toLowerCase().split(/[-_]/)[0];
    if (isLang(code)) return code;
  }
  return 'en';
}

/**
 * The text in the current language. `zh` is the Chinese text, which is also the key; `{name}` in it is filled from
 * `params`, written as a template literal would write the value. A text missing from a dictionary stays Chinese.
 * Call it when the text is shown, never at module level, or the text keeps the language the app started in.
 */
export function tr(zh: string, params?: Record<string, unknown>): string {
  const text = current === 'zh' ? zh : (DICTIONARIES[current][zh] ?? zh);
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/**
 * Module-level data whose text fields are read in the current language each time, e.g. metric names. Each listed
 * field holds the Chinese text and becomes a getter that translates it; spreading the object copies the
 * translation of that moment.
 */
export function localized<T extends object>(data: T, ...keys: (keyof T)[]): T {
  for (const key of keys) {
    const zh = data[key];
    if (typeof zh !== 'string') continue;
    Object.defineProperty(data, key, { get: () => tr(zh), enumerable: true, configurable: true });
  }
  return data;
}
