#!/usr/bin/env node
/*
 * End-to-end check of the replay and export page (mobile/src/media/replayHtml.ts): a synthetic 10/5 set rendered by
 * mobile/src/domain/testing/jumpScene.ts and encoded to H.264, the app's own replay config for it, the page in a real
 * browser engine (Playwright's Chromium), and the recorded video checked with ffprobe.
 *
 *   node tools/jump-analysis-validation/export.js [--out <dir>]
 *
 * Writes clip.mp4, the exported video, still frames of it (PNG) and report.json to the output folder.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { compile, encode, serve } = require('./lib');

const args = process.argv.slice(2);
const OUT = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : fs.mkdtempSync(path.join(os.tmpdir(), 'jump-export-')));

// The app's "paper court" theme (mobile/src/theme).
const COLORS = { ink: '#17130E', paper: '#F1ECE2', card: '#FFFFFF', accent: '#2340C8', rim: '#D9541E', muted: '#665D52', touch: '#6A46BE' };

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const M = compile(OUT, ['domain/jumpAnalysis.ts', 'domain/metrics.ts', 'domain/testing/jumpScene.ts', 'media/replayConfig.ts', 'media/replayHtml.ts']);
  const S = M('domain/testing/jumpScene');
  const scene = S.defaultScene('repeat', { shadow: 0.4, reflection: 0.25, noise: 3 });
  await encode(S, scene, path.join(OUT, 'clip.mp4'));

  const events = S.sceneEvents(scene);
  const analysis = M('domain/jumpAnalysis').analyseJumps(events, { kind: 'repeat', captureFps: scene.fps });
  const def = M('domain/metrics').REPEATED_JUMP;
  const from = events[0].takeoff - 150;
  const to = events[events.length - 1].landing + 100;
  // The athlete's box as the detector reports it (FinePlan.box), roughly, for this scene.
  const config = M('media/replayConfig').replayConfig({ def, kind: 'repeat', analysis, video: 'clip.mp4', fileFps: scene.fps, captureFps: scene.fps, from, to, date: new Date().toISOString().slice(0, 10), colors: COLORS, focus: { x: 60, y: 0, w: 220, h: 600 } });
  fs.writeFileSync(path.join(OUT, 'replay.html'), M('media/replayHtml').replayHtml(config));

  const { chromium } = require('playwright');
  const srv = await serve(OUT, 0);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
  const messages = [];
  await page.exposeFunction('onReplayMessageFromPage', (m) => messages.push(m));
  await page.addInitScript(() => {
    window.onReplayMessage = (m) => window.onReplayMessageFromPage(m);
  });
  await page.goto(`http://127.0.0.1:${srv.address().port}/replay.html`);
  const until = async (pred, ms = 120000) => {
    const end = Date.now() + ms;
    while (!messages.some(pred)) {
      if (Date.now() > end) throw new Error('timed out; last messages: ' + JSON.stringify(messages.slice(-3)).slice(0, 400));
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  await until((m) => m.type === 'ready' || m.type === 'error');
  if (messages.some((m) => m.type === 'error')) throw new Error(JSON.stringify(messages));

  // Stills straight from the page: mid-flight of the second jump, and just after the last landing.
  const stills = { flight: Math.round((events[1].takeoff + events[1].landing) / 2), landed: events[events.length - 1].landing + 20 };
  for (const [name, f] of Object.entries(stills)) {
    await page.evaluate((x) => window.replay.show(x), f);
    await page.locator('#out').screenshot({ path: path.join(OUT, `still-${name}.png`) });
  }

  const t0 = Date.now();
  await page.evaluate(() => window.replay.exportVideo());
  await until((m) => (m.type === 'file' && m.part === m.parts - 1) || m.type === 'error' || m.type === 'unsupported', 300000);
  const parts = messages.filter((m) => m.type === 'file').sort((a, b) => a.part - b.part);
  if (!parts.length) throw new Error('no video: ' + JSON.stringify(messages.filter((m) => m.type !== 'progress')));
  const mime = parts[0].mime;
  const file = path.join(OUT, `export.${mime.includes('mp4') ? 'mp4' : 'webm'}`);
  fs.writeFileSync(file, Buffer.from(parts.map((p) => p.data).join(''), 'base64'));
  await browser.close();
  srv.close();

  const probe = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_read_frames:format=duration', '-of', 'json', file]).toString(),
  );
  for (const [k, at] of [['early', 2], ['late', 0.6]]) {
    const dur = Number(probe.format.duration) || 10;
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(k === 'late' ? dur * at : at), '-i', file, '-frames:v', '1', path.join(OUT, `export-${k}.png`)]);
  }
  const expected = Math.ceil((to - from + 1) / config.stride) / config.outFps;
  const report = {
    mime,
    bytes: fs.statSync(file).size,
    exportSeconds: (Date.now() - t0) / 1000,
    expectedVideoSeconds: expected + 1.5,
    probe,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
