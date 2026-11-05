import type { SQLiteDatabase } from 'expo-sqlite';

import { exportBackup, restoreBackup } from '@/db/backup';
import { LATEST_VERSION } from '@/db/migrations';
import { backupHash, describeBackup, isPristine, parseBackup } from '@/domain/backup';
import { toISODate } from '@/domain/dates';
import { decideSync } from '@/domain/sync';
import { tr } from '@/i18n';

import type { CloudBackups } from './cloud';

/** Where a device keeps the hash it last synced, e.g. expo-sqlite/kv-store. */
export type SyncMemory = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

export type SyncOutcome =
  | { kind: 'nothing' | 'uploaded' | 'downloaded' }
  /** Both sides changed; `phone` and `cloud` say what each holds, for the person to pick one. */
  | { kind: 'conflict'; phone: string; cloud: string; cloudAt: string }
  /** The phone was last synced with another account and this one has nothing in the cloud: upload only if told to. */
  | { kind: 'confirm'; phone: string }
  | { kind: 'failed'; problem: string };

/** Which side to keep after a conflict. */
export type SyncChoice = 'phone' | 'cloud';

const lastKey = (userId: string) => `sync-last-hash:${userId}`;
/** The account this device last synced with, whichever it was: the data on the phone is that account's. */
const ACCOUNT_KEY = 'sync-account';
const OFFLINE = '连不上云端，数据还在手机上，下次打开 App 会再试。';
const NOT_NEWEST = '云端最新的一份不是刚传的这份，可能有设备的日期或时间不对，请检查。数据还在手机上。';
const NEWER = '云端有更新版本 App 传的备份，这个版本不能覆盖它。先更新 App 再同步，数据还在手机上。';

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
    const account = await memory.getItem(ACCOUNT_KEY);
    const meta = await cloud.latest();
    const action = choice
      ? choice === 'phone'
        ? 'upload'
        : 'download'
      : decideSync({
          localHash,
          localPristine: isPristine(local),
          lastHash,
          // A device that synced before the account was remembered has none, and goes on as it did.
          otherAccount: account != null && account !== userId,
          cloud: meta && { hash: meta.hash, updatedAt: meta.updatedAt },
        });
    const synced = async (hash: string) => {
      await memory.setItem(lastKey(userId), hash);
      await memory.setItem(ACCOUNT_KEY, userId);
    };

    if (action === 'nothing') {
      if (meta && meta.hash === localHash && (lastHash !== localHash || account !== userId)) await synced(localHash);
      return { kind: 'nothing' };
    }
    if (action === 'confirm') return { kind: 'confirm', phone: describeBackup(local) };
    if (action === 'upload' || action === 'conflict') {
      // This app can't read a newer app's backup, and its own would lack the tables and columns that app added, which
      // every device that downloads it then loses. So it neither asks which to keep nor uploads until it is updated.
      const version = await cloud.newestSchemaVersion();
      if (version != null && version > LATEST_VERSION) return { kind: 'failed', problem: tr(NEWER) };
    }
    if (action === 'upload') {
      await cloud.upload({ backup: local, hash: localHash, device, date: toISODate(new Date()) });
      // Every device compares with the newest backup. If that is still another one (dated ahead by a device whose clock
      // is wrong), this upload doesn't count: remembering it would make the next sync download that one over the phone.
      const newest = await cloud.latest();
      if (newest && newest.hash !== localHash) return { kind: 'failed', problem: tr(NOT_NEWEST) };
      await synced(localHash);
      return { kind: 'uploaded' };
    }

    const remote = await cloud.download();
    if (!remote) return { kind: 'nothing' };
    const parsed = parseBackup(JSON.stringify(remote.data), LATEST_VERSION);
    if (action === 'conflict') {
      return { kind: 'conflict', phone: describeBackup(local), cloud: parsed.ok ? describeBackup(parsed.backup) : tr('无法读取'), cloudAt: meta?.updatedAt ?? '' };
    }
    if (!parsed.ok) return { kind: 'failed', problem: parsed.problem };
    const restored = await restoreBackup(db, parsed.backup);
    if (!restored.ok) return { kind: 'failed', problem: restored.problem };
    // Remember the cloud's hash, not the restored data's: an older backup gains default columns here,
    // which then reads as a local change and is uploaded once, instead of being downloaded on every sync.
    await synced(remote.hash);
    return { kind: 'downloaded' };
  } catch (e) {
    return { kind: 'failed', problem: cloudProblem(e instanceof Error ? e.message : String(e)) };
  }
}

/** Why a sync failed, for the person: the cloud refusing a backup is not the connection being down. */
function cloudProblem(message: string): string {
  // supabase/backups-hardening.sql: only the days around today can be written, never by an app older than the backups.
  if (/row-level security/i.test(message)) return tr('云端没有收下这次备份：可能是这台设备的日期不对，或云端已有更新版本 App 的备份。数据还在手机上。');
  if (/backups_size/.test(message)) return tr('这份备份超过云端单份的大小上限，没有上传。数据还在手机上。');
  return tr(OFFLINE);
}
