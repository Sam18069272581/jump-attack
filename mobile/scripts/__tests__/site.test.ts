import fs from 'node:fs';
import path from 'node:path';

// The product page in ../site is plain HTML: Chinese text is written in the page, English comes from site/i18n.js.
// Every key the page uses must have an English string, or switching language leaves a blank or Chinese line.
const siteDir = path.resolve(__dirname, '../../../site');
const html = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { en, ui } = require(path.join(siteDir, 'i18n.js')) as {
  en: Record<string, string>;
  ui: Record<'zh' | 'en', Record<string, string>>;
};

function keysInPage(): string[] {
  const keys = new Set<string>();
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) keys.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of m[1].split(';')) keys.add(pair.split(':')[1]);
  }
  return [...keys].sort();
}

it('has an English string for every translated part of the page, and no unused ones', () => {
  const used = keysInPage();
  expect(used.length).toBeGreaterThan(50);
  expect(Object.keys(en).sort()).toEqual(used);
  for (const key of used) expect(en[key].trim()).not.toBe('');
});

it('writes the same script messages in both languages', () => {
  expect(Object.keys(ui.en).sort()).toEqual(Object.keys(ui.zh).sort());
  for (const lang of ['zh', 'en'] as const) {
    for (const text of Object.values(ui[lang])) expect(text.trim()).not.toBe('');
  }
});

it('only loads files that ship with the page', () => {
  // The app's service worker also controls /intro/ and sets COEP require-corp, so cross-origin fonts or scripts would be blocked.
  const loads = [...html.matchAll(/<(?:script|link|img)[^>]*(?:src|href)="([^"]+)"/g)]
    .filter((m) => !/rel="(?:canonical|alternate)"/.test(m[0]))
    .map((m) => m[1]);
  expect(loads.length).toBeGreaterThan(0);
  for (const url of loads) {
    expect(url).not.toMatch(/^(https?:)?\/\//);
    expect(fs.existsSync(path.join(siteDir, url))).toBe(true);
  }
});
