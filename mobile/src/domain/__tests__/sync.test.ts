import { decideSync, type SyncState } from '../sync';

// Hashes are opaque labels here: L = what the phone holds now, S = what was last synced, C = what the cloud holds.
const state = (s: Partial<SyncState>): SyncState => ({ localHash: 'L', localPristine: false, lastHash: 'S', cloud: { hash: 'C', updatedAt: '2026-10-28T08:00:00Z' }, ...s });

describe('decideSync', () => {
  it('uploads the first time when the cloud is empty', () => {
    expect(decideSync(state({ lastHash: null, cloud: null }))).toBe('upload');
  });

  it('does not fill an empty cloud with an empty phone', () => {
    expect(decideSync(state({ lastHash: null, cloud: null, localPristine: true }))).toBe('nothing');
  });

  it('does nothing when phone and cloud already hold the same data', () => {
    expect(decideSync(state({ localHash: 'C', lastHash: null }))).toBe('nothing');
  });

  it('restores onto a new phone, or a new Expo Go scope, that has nothing yet', () => {
    expect(decideSync(state({ lastHash: null, localPristine: true }))).toBe('download');
  });

  it('asks when a device that never synced already has its own data, so neither history is overwritten silently', () => {
    expect(decideSync(state({ lastHash: null }))).toBe('conflict');
  });

  it('uploads what changed on the phone since the last sync', () => {
    expect(decideSync(state({ lastHash: 'C' }))).toBe('upload');
  });

  it('downloads what another device synced while this one did not change', () => {
    expect(decideSync(state({ localHash: 'S' }))).toBe('download');
  });

  it('asks when both changed since the last sync', () => {
    expect(decideSync(state({}))).toBe('conflict');
  });

  // On a shared phone (a coach's, the team's), data last synced with one account belongs to that account: whoever signs
  // in next with their own would otherwise get everyone's data uploaded into theirs, or over it.
  describe('on a phone last synced with another account', () => {
    it('asks before backing up into an account that has nothing in the cloud yet', () => {
      expect(decideSync(state({ lastHash: null, cloud: null, otherAccount: true }))).toBe('confirm');
    });

    it('asks which to keep instead of uploading', () => {
      expect(decideSync(state({ lastHash: 'C', otherAccount: true }))).toBe('conflict');
    });

    it('still restores onto an empty phone, and does nothing when both hold the same', () => {
      expect(decideSync(state({ lastHash: null, localPristine: true, otherAccount: true }))).toBe('download');
      expect(decideSync(state({ localHash: 'C', otherAccount: true }))).toBe('nothing');
      expect(decideSync(state({ cloud: null, localPristine: true, otherAccount: true }))).toBe('nothing');
    });
  });
});
