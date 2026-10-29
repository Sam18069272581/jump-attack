import { tr } from '@/i18n';

/** The athlete the first migration creates for the phone's owner. The database keeps this name in every language. */
const DEFAULT_NAME = '我自己';

/** An athlete's name as shown: the default athlete's in the app's language, any other as typed. */
export function athleteName(name: string): string {
  return name === DEFAULT_NAME ? tr(DEFAULT_NAME) : name;
}

/** The home screen's hello. "Hi, Me" reads oddly, so the default athlete is just greeted. */
export function greeting(name: string): string {
  return name === DEFAULT_NAME ? tr('你好，我自己') : tr('你好，{name}', { name });
}
