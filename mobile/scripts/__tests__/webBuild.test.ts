// eslint-disable-next-line @typescript-eslint/no-require-imports
const { finishHtml, normalizeBase } = require('../webBuild');

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
