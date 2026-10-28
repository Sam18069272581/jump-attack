/* Builds the web version into dist/ for static hosting such as GitHub Pages.
 *   node scripts/webBuild.js --base /jump-attack
 * --base is the sub-path the site is served from (https://<user>.github.io/<repo>/); leave it out for a domain root. */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function normalizeBase(input) {
  const trimmed = (input ?? '').trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
}

/** public/index.html refers to the manifest, icons and service worker through %BASE_URL%. */
function finishHtml(html, base) {
  return html.split('%BASE_URL%').join(`${base}/`);
}

/** The product page lives in ../site as plain HTML and is served next to the app at <base>/intro/. */
function copySite(siteDir, distDir) {
  fs.cpSync(siteDir, path.join(distDir, 'intro'), { recursive: true });
}

function main(argv) {
  const at = argv.indexOf('--base');
  const base = normalizeBase(at >= 0 ? argv[at + 1] : process.env.BASE_URL);
  const root = path.resolve(__dirname, '..');
  const appJson = path.join(root, 'app.json');
  const original = fs.readFileSync(appJson, 'utf8');

  // Expo reads the sub-path only from app.json; set it for this build and put the file back afterwards.
  if (base) {
    const config = JSON.parse(original);
    config.expo.experiments = { ...config.expo.experiments, baseUrl: base };
    fs.writeFileSync(appJson, `${JSON.stringify(config, null, 2)}\n`);
  }
  try {
    execFileSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', 'dist', '--clear'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  } finally {
    fs.writeFileSync(appJson, original);
  }

  const index = path.join(root, 'dist', 'index.html');
  const html = finishHtml(fs.readFileSync(index, 'utf8'), base);
  fs.writeFileSync(index, html);
  // GitHub Pages serves 404.html for unknown paths, so a reload on /jump-attack/history still boots the app.
  fs.writeFileSync(path.join(root, 'dist', '404.html'), html);
  // Without this GitHub Pages runs Jekyll, which drops folders starting with "_" such as _expo/.
  fs.writeFileSync(path.join(root, 'dist', '.nojekyll'), '');
  copySite(path.resolve(root, '..', 'site'), path.join(root, 'dist'));
  console.log(`Web build ready in dist/ (base path "${base || '/'}").`);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { copySite, finishHtml, normalizeBase };
