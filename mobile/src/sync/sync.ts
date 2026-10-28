import type { SQLiteDatabase } from 'expo-sqlite';

import { exportBackup, restoreBackup } from '@/db/backup';
import { LATEST_VERSION } from '@/db/migrations';
import { backupHash, describeBackup, isPristine, parseBackup } from '@/domain/backup';
import { toISODate } from '@/domain/dates';
import { decideSync } from '@/domain/sync';

import type { CloudBackups } from './cloud';

/** Where a device keeps the hash it last synced, e.g. expo-sqlite/kv-store. */
export type SyncMemory = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

export type SyncOutcome =
  | { kind: 'nothing' | 'uploaded' | 'downloaded' }
  /** Both sides changed; `phone` and `cloud` say what each holds, for the person to pick one. */
  | { kind: 'conflict'; phone: string; cloud: string; cloudAt: string }
  | { kind: 'failed'; problem: string };

/** Which side to keep after a conflict. */
export type SyncChoice = 'phone' | 'cloud';

const lastKey = (userId: string) => `sync-last-hash:${userId}`;
const OFFLINE = '连不上云端，数据还在手机上，下次打开 App 会再试。';

/** One round of sync for the signed-in account. Never throws: failures come back as an outcome. */
export async function syncWithCloud(
  db: SQLiteDatabase,
  cloud: CloudBackups,
  memory: SyncMemory,
  userId: string,
  device: string,
  choice?: SyncChoice,
): Promise<SyncOutcome> {
  try {
    const local = await exportBackup(db);
    const localHash = backupHash(local);
    const lastHash = await memory.getItem(lastKey(userId));
    const meta = await cloud.latest();
    const action = choice
      ? choice === 'phone'
        ? 'upload'
        : 'download'
      : decideSync({ localHash, localPristine: isPristine(local), lastHash, cloud: meta && { hash: meta.hash, updatedAt: meta.updatedAt } });

    if (action === 'nothing') {
      if (meta && meta.hash === localHash && lastHash !== localHash) await memory.setItem(lastKey(userId), localHash);
      return { kind: 'nothing' };
    }
    if (action === 'upload') {
      await cloud.upload({ backup: local, hash: localHash, device, date: toISODate(new Date()) });
      await memory.setItem(lastKey(userId), localHash);
      return { kind: 'uploaded' };
    }

    const remote = await cloud.download();
    if (!remote) return { kind: 'nothing' };
    const parsed = parseBackup(JSON.stringify(remote.data), LATEST_VERSION);
    if (action === 'conflict') {
      return { kind: 'conflict', phone: describeBackup(local), cloud: parsed.ok ? describeBackup(parsed.backup) : '无法读取', cloudAt: meta?.updatedAt ?? '' };
    }
    if (!parsed.ok) return { kind: 'failed', problem: parsed.problem };
    const restored = await restoreBackup(db, parsed.backup);
    if (!restored.ok) return { kind: 'failed', problem: restored.problem };
    // Remember the cloud's hash, not the restored data's: an older backup gains default columns here,
    // which then reads as a local change and is uploaded once, instead of being downloaded on every sync.
    await memory.setItem(lastKey(userId), remote.hash);
    return { kind: 'downloaded' };
  } catch {
    return { kind: 'failed', problem: OFFLINE };
  }
}
