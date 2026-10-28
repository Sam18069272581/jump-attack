import { firstClip, IMPORT_LIMIT, nextClip, queuedCount } from '../importQueue';

const clips = [{ uri: 'file:///a.mov', asset: 'A' }, { uri: 'file:///b.mov' }, { uri: 'file:///c.mov', asset: 'C' }];

describe('importing several clips at once', () => {
  it('opens the first clip and carries the rest along, in the order they were picked', () => {
    expect(IMPORT_LIMIT).toBe(10);
    const first = firstClip(clips, 'analyse')!;
    expect(first.pathname).toBe('/measure/analyse');
    expect(first.params).toMatchObject({ uri: 'file:///a.mov', fps: '0', asset: 'A' });
    expect(queuedCount(first.params.queue)).toBe(2);
  });

  it('opens one clip without a queue', () => {
    expect(firstClip([clips[1]], 'mark')).toEqual({ pathname: '/measure/mark', params: { uri: 'file:///b.mov', fps: '0' } });
    expect(firstClip([], 'mark')).toBeNull();
  });

  it('moves on to the next clip on the same screen, keeping the test’s own settings and dropping the last clip’s', () => {
    const first = firstClip(clips, 'analyse')!;
    const params = { metric: 'dj_rsi', session: 's1', from: 'testday', box: '30', ...first.params };
    const second = nextClip(params)!;
    // The second clip has no photo-library id, so the first one's must not carry over.
    expect(second).toEqual({ pathname: '/measure/analyse', params: { metric: 'dj_rsi', session: 's1', from: 'testday', box: '30', uri: 'file:///b.mov', fps: '0', queue: expect.any(String) } });
    const third = nextClip(second.params)!;
    expect(third.params).toEqual({ metric: 'dj_rsi', session: 's1', from: 'testday', box: '30', uri: 'file:///c.mov', fps: '0', asset: 'C' });
    expect(nextClip(third.params)).toBeNull();
  });

  it('ignores a queue it cannot read', () => {
    expect(nextClip({ metric: 'cmj', queue: 'not json' })).toBeNull();
    expect(queuedCount(undefined)).toBe(0);
    expect(queuedCount('{"screen":"mark"}')).toBe(0);
  });
});
