/**
 * Every Chinese text in the app has an English and a German translation, and nothing else is in the dictionaries.
 * The texts are found in the source: string literals with Chinese in them (tr() keys and module-level data that is
 * translated where it is shown), and the Chinese of the WebView pages (media/*Html.ts). A line marked
 * `i18n-ignore`, or the line after such a comment, is left out, and so are the migrations: their SQL is data.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

import { de } from '../de';
import { en } from '../en';
import { htmlTexts } from '..';

const SRC = path.join(__dirname, '../..');
const CHINESE = /[㐀-鿿　-〿！-～]/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ['__tests__', 'testing', 'i18n'].includes(e.name) ? [] : sourceFiles(p);
    return /\.tsx?$/.test(e.name) && p !== path.join(SRC, 'db/migrations.ts') ? [p] : [];
  });
}

type Found = { keys: Map<string, string>; untranslatable: string[] };

function scan(): Found {
  const keys = new Map<string, string>();
  const untranslatable: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const where = (n: ts.Node) => `${path.relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
    const ignored = (n: ts.Node) => {
      const line = sf.getLineAndCharacterOfPosition(n.getStart()).line;
      return /i18n-ignore/.test(lines[line]) || /^\s*\/\/.*i18n-ignore/.test(lines[line - 1] ?? '');
    };
    const html = /Html\.ts$|poseShared\.ts$/.test(file);
    const visit = (n: ts.Node) => {
      if (ts.isImportDeclaration(n) || ts.isLiteralTypeNode(n)) return;
      if (html && (ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n))) {
        const raw = ts.isTemplateExpression(n) ? [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join('${}') : n.text;
        for (const k of htmlTexts(raw)) {
          if (k.includes('${}')) untranslatable.push(`${where(n)} ${k}`);
          else keys.set(k, where(n));
        }
        return;
      }
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && CHINESE.test(n.text) && !ignored(n)) keys.set(n.text, where(n));
      if (ts.isTemplateExpression(n) && [n.head, ...n.templateSpans.map((s) => s.literal)].some((p) => CHINESE.test(p.text)) && !ignored(n)) {
        untranslatable.push(`${where(n)} ${n.getText().slice(0, 60)}`);
      }
      if (ts.isJsxText(n) && CHINESE.test(n.text)) untranslatable.push(`${where(n)} ${n.text.trim().slice(0, 60)}`);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { keys, untranslatable };
}

const found = scan();
const placeholders = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

describe.each([
  ['English', en],
  ['German', de],
])('%s dictionary', (_, dict) => {
  it('translates every Chinese text in the app', () => {
    const missing = [...found.keys].filter(([k]) => !(k in dict)).map(([k, at]) => `${at} ${k}`);
    expect(missing).toEqual([]);
  });

  it('has no texts the app no longer uses', () => {
    expect(Object.keys(dict).filter((k) => !found.keys.has(k))).toEqual([]);
  });

  it('keeps every {placeholder} of the Chinese text', () => {
    const wrong = Object.entries(dict).filter(([k, v]) => placeholders(k).join() !== placeholders(v).join());
    expect(wrong).toEqual([]);
  });

  it('has no Chinese left in a translation', () => {
    expect(Object.entries(dict).filter(([, v]) => CHINESE.test(v))).toEqual([]);
  });
});

it('writes Chinese only where it can be looked up: no Chinese in JSX text or in a template literal', () => {
  expect(found.untranslatable).toEqual([]);
});
