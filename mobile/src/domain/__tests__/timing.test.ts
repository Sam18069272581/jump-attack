import { previousSameTiming, timingOf } from '../timing';

it('tells how a sprint was timed from the trial detail', () => {
  expect(timingOf({ source: 'video', asset_id: 'a' })).toBe('video');
  // Older filmed sprints saved no detail at all.
  expect(timingOf(null)).toBe('video');
  expect(timingOf({ source: 'manual', timing: 'gates' })).toBe('gates');
  expect(timingOf({ source: 'manual', timing: 'stopwatch' })).toBe('stopwatch');
  // Typed in before the timing question existed: unknown method.
  expect(timingOf({ source: 'manual' })).toBe('manual');
});

it('compares each sprint only with the last one timed the same way', () => {
  // A stopwatch carries the timer's reaction time and reads ~0.2 s faster than gates (Haugen & Buchheit 2016,
  // Sports Med 46:641): 1.62 by hand after 1.82 on video is a method change, not a 0.20 s gain.
  const rows = [
    { best: 1.85, timing: 'video' as const },
    { best: 1.62, timing: 'stopwatch' as const },
    { best: 1.82, timing: 'video' as const },
    { best: 1.6, timing: 'stopwatch' as const },
  ];
  expect(previousSameTiming(rows)).toEqual([undefined, undefined, rows[0], rows[1]]);
});
