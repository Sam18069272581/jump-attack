// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isolate, shouldHandle } = require('../../public/sw');

// GitHub Pages can't send COOP/COEP headers, but expo-sqlite's web worker needs SharedArrayBuffer,
// which browsers only allow on cross-origin-isolated pages. The service worker adds them.
it('adds the cross-origin isolation headers and keeps the response', async () => {
  const res = isolate(new Response('<html></html>', { status: 200, statusText: 'OK', headers: { 'Content-Type': 'text/html' } }));
  expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
  expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
  expect(res.headers.get('Content-Type')).toBe('text/html');
  expect(res.status).toBe(200);
  await expect(res.text()).resolves.toBe('<html></html>');
});

it('only handles same-origin GET requests', () => {
  const origin = 'https://sam18069272581.github.io';
  expect(shouldHandle({ method: 'GET', url: `${origin}/jump-attack/` }, origin)).toBe(true);
  expect(shouldHandle({ method: 'POST', url: `${origin}/jump-attack/` }, origin)).toBe(false);
  expect(shouldHandle({ method: 'GET', url: 'https://example.com/a.js' }, origin)).toBe(false);
});
