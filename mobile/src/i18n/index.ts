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

/** The voice for spoken cues (expo-speech), in the app's language. */
export function speechLanguage(): string {
  return { zh: 'zh-CN', en: 'en-US', de: 'de-DE' }[current];
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
 * Module-level data whose text is read in the current language each time, e.g. metric names. In `data` and every
 * object and array inside it, each field named in `keys` that holds Chinese text, or a list of it, becomes a getter
 * that translates it; with no `keys`, every such field does. Call it once the data is built: spreading a wrapped object copies the translation of that moment.
 */
export function localized<T>(data: T, ...keys: string[]): T {
  const seen = new Set<object>();
  const visit = (node: unknown) => {
    if (node == null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(node))) {
      if (!('value' in desc)) continue;
      const zh: unknown = desc.value;
      const text = typeof zh === 'string' || (Array.isArray(zh) && zh.length > 0 && zh.every((x) => typeof x === 'string'));
      if ((keys.length === 0 || keys.includes(key)) && text && desc.configurable) {
        Object.defineProperty(node, key, {
          get: () => (typeof zh === 'string' ? tr(zh) : (zh as string[]).map((s) => tr(s))),
          set(value: unknown) {
            Object.defineProperty(this, key, { value, writable: true, enumerable: true, configurable: true });
          },
          enumerable: desc.enumerable,
          configurable: true,
        });
      } else {
        visit(zh);
      }
    }
  };
  visit(data);
  return data;
}

/** Chinese in a WebView page: text between tags (not script), and single-quoted strings in its script. */
const HTML_TEXT = /'([^'\n\\]*[\u3400-\u9fff][^'\n\\]*)'|>([^<>\n'"(){};=]*[\u3400-\u9fff][^<>\n'"(){};=]*)</g;

/** The Chinese texts of a WebView page, each a dictionary key. */
export function htmlTexts(html: string): string[] {
  return [...html.matchAll(HTML_TEXT)].map((m) => m[1] ?? m[2]);
}

/** A WebView page (media/*Html.ts) with its Chinese texts in the current language. */
export function localizeHtml(html: string): string {
  if (current === 'zh') return html;
  return html.replace(HTML_TEXT, (_, js: string | undefined, text: string | undefined) =>
    js != null
      ? `'${tr(js).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
      : `>${tr(text!).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}<`,
  );
}
