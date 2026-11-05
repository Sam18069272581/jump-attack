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
  /** The device last synced with a different account, so the data on it is that account's. */
  otherAccount?: boolean;
  /** The newest cloud backup, or null if the account has none. */
  cloud: { hash: string; updatedAt: string } | null;
};

/** `confirm`: back the phone up into an account that has nothing in the cloud, once the person says so. */
export type SyncAction = 'nothing' | 'upload' | 'download' | 'conflict' | 'confirm';

export function decideSync({ localHash, localPristine, lastHash, otherAccount = false, cloud }: SyncState): SyncAction {
  // On a shared phone, whoever signs in next would otherwise get the data of the account it was synced with uploaded
  // into their own, or over it. Nothing happens to it on its own; the person decides.
  if (otherAccount && !localPristine && cloud?.hash !== localHash) return cloud ? 'conflict' : 'confirm';
  if (!cloud) return localPristine ? 'nothing' : 'upload';
  if (cloud.hash === localHash) return 'nothing';
  if (lastHash == null) return localPristine ? 'download' : 'conflict';
  const localChanged = localHash !== lastHash;
  const cloudChanged = cloud.hash !== lastHash;
  if (localChanged && cloudChanged) return 'conflict';
  return localChanged ? 'upload' : 'download';
}
