import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { copySite, finishHtml, normalizeBase } = require('../webBuild');

it('normalizes the GitHub Pages sub-path', () => {
  expect(normalizeBase(undefined)).toBe('');
  expect(normalizeBase('')).toBe('');
  expect(normalizeBase('/')).toBe('');
  expect(normalizeBase('jump-attack')).toBe('/jump-attack');
  expect(normalizeBase('/jump-attack/')).toBe('/jump-attack');
});

it('points the manifest, icon and service worker at the sub-path', () => {
  const html = '<link rel="manifest" href="%BASE_URL%manifest.json"><script>register("%BASE_URL%sw.js")</script>';
  expect(finishHtml(html, '/jump-attack')).toBe('<link rel="manifest" href="/jump-attack/manifest.json"><script>register("/jump-attack/sw.js")</script>');
  expect(finishHtml(html, '')).toBe('<link rel="manifest" href="/manifest.json"><script>register("/sw.js")</script>');
});

it('copies the product page into dist/intro/', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  const site = path.join(tmp, 'site');
  fs.mkdirSync(path.join(site, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(site, 'index.html'), '<h1>Jump Attack</h1>');
  fs.writeFileSync(path.join(site, 'assets', 'home.webp'), 'img');
  const dist = path.join(tmp, 'dist');
  fs.mkdirSync(dist);

  copySite(site, dist);

  expect(fs.readFileSync(path.join(dist, 'intro', 'index.html'), 'utf8')).toBe('<h1>Jump Attack</h1>');
  expect(fs.readFileSync(path.join(dist, 'intro', 'assets', 'home.webp'), 'utf8')).toBe('img');
});
