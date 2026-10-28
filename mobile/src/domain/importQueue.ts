/**
 * Several clips picked from the photo library in one go. The first opens on the analysis (or marking) screen; the rest
 * travel along as a route param, and each save moves on to the next clip of the same test until none are left.
 */

/** How many clips one pick may take: a test day is three tests of up to a few clips each. */
export const IMPORT_LIMIT = 10;

export type Clip = { uri: string; asset?: string };
type Screen = 'analyse' | 'mark';
type Queue = { screen: Screen; clips: Clip[] };

export type ClipRoute = { pathname: '/measure/analyse' | '/measure/mark'; params: Record<string, string> };

/** The params that belong to one clip rather than to the test, replaced on every move to the next clip. */
const CLIP_PARAMS = ['uri', 'fps', 'asset', 'queue'];

function readQueue(raw: string | undefined): Queue | null {
  if (!raw) return null;
  try {
    const q = JSON.parse(raw) as Partial<Queue>;
    return (q.screen === 'analyse' || q.screen === 'mark') && Array.isArray(q.clips) ? { screen: q.screen, clips: q.clips.filter((c) => typeof c?.uri === 'string') } : null;
  } catch {
    return null;
  }
}

/** The screen and params for the first of `clips`, carrying the rest; null with no clips. */
export function firstClip(clips: Clip[], screen: Screen): ClipRoute | null {
  const [clip, ...rest] = clips;
  if (!clip) return null;
  return {
    pathname: `/measure/${screen}`,
    params: {
      uri: clip.uri,
      // The file's own frame rate is read on that screen; 0 means the picker didn't report one.
      fps: '0',
      ...(clip.asset ? { asset: clip.asset } : {}),
      ...(rest.length ? { queue: JSON.stringify({ screen, clips: rest } satisfies Queue) } : {}),
    },
  };
}

/** Where the next queued clip opens, with the test's own params (metric, session, box…) kept; null when none is left. */
export function nextClip(params: Record<string, string | undefined>): ClipRoute | null {
  const q = readQueue(params.queue);
  const next = q && firstClip(q.clips, q.screen);
  if (!next) return null;
  const test = Object.fromEntries(Object.entries(params).filter((e): e is [string, string] => e[1] != null && !CLIP_PARAMS.includes(e[0])));
  return { pathname: next.pathname, params: { ...test, ...next.params } };
}

/** Clips still waiting after this one. */
export function queuedCount(raw: string | undefined): number {
  return readQueue(raw)?.clips.length ?? 0;
}
