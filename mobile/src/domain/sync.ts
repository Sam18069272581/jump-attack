/**
 * Whole-database sync between one device and the person's cloud backup. Each device remembers the hash
 * of the data it last uploaded or restored; comparing that with the phone and the cloud now shows which
 * side changed. When both did, the person picks one, so no history is merged or dropped silently.
 */
export type SyncState = {
  localHash: string;
  /** The phone holds only what a fresh install has (see isPristine). */
  localPristine: boolean;
  /** Hash this device last synced for this account; null if it never has. */
  lastHash: string | null;
  /** The newest cloud backup, or null if the account has none. */
  cloud: { hash: string; updatedAt: string } | null;
};

export type SyncAction = 'nothing' | 'upload' | 'download' | 'conflict';

export function decideSync({ localHash, localPristine, lastHash, cloud }: SyncState): SyncAction {
  if (!cloud) return localPristine ? 'nothing' : 'upload';
  if (cloud.hash === localHash) return 'nothing';
  if (lastHash == null) return localPristine ? 'download' : 'conflict';
  const localChanged = localHash !== lastHash;
  const cloudChanged = cloud.hash !== lastHash;
  if (localChanged && cloudChanged) return 'conflict';
  return localChanged ? 'upload' : 'download';
}
