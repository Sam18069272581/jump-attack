import { barTrackerHtml } from '../barTrackerHtml';
import { frameGrabberHtml } from '../frameGrabberHtml';
import { poseReaderHtml } from '../poseReaderHtml';
import { replayHtml } from '../replayHtml';
import { scriptJson } from '../scriptJson';

// A clip's name comes from the file picked (its extension is kept), so a page must not let one end its <script>.
const video = 'clip</script><script>alert(1)</script>.mov';

it('writes JSON that sits inside a <script> without ending it, and reads back the same', () => {
  const value = { video, comment: '<!-- x', lines: 'a\u2028b\u2029c' };
  const json = scriptJson(value);
  expect(json).not.toMatch(/[<\u2028\u2029]/);
  expect(JSON.parse(json)).toEqual(value);
});

it('is how every page embeds what it is given', () => {
  const pages = {
    frames: frameGrabberHtml({ video, bg: '#000', accent: '#fff' }),
    bar: barTrackerHtml({ video, fps: 60, accent: '#fff', bg: '#000', text: '#fff', muted: '#888' }),
    pose: poseReaderHtml({ video, bg: '#000', accent: '#fff' }),
  };
  for (const [name, html] of Object.entries(pages)) {
    expect({ name, intact: !html.includes(video) && html.includes('clip\\u003c/script>') }).toEqual({ name, intact: true });
  }
});

it('leaves the replay page as safe as it was', () => {
  const colors = { ink: '#000', paper: '#fff', card: '#fff', accent: '#00f', rim: '#f80', muted: '#888', touch: '#0f0' };
  const html = replayHtml({ title: video, colors } as Parameters<typeof replayHtml>[0]);
  expect(html).not.toContain(video);
});
