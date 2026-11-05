// Two devices and one cloud account, each device a real in-memory database.
import { exportBackup, restoreBackup, undoRestore } from '@/db/backup';
import { LATEST_VERSION, migrate } from '@/db/migrations';
import { addTrial, createAthlete, ensureSession, listAthletes } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { backupHash, type Backup } from '@/domain/backup';

import type { CloudBackups, CloudMeta } from '../cloud';
import { forgetAccount, syncWithCloud, type SyncMemory } from '../sync';

type Row = CloudMeta & { date: string; data: unknown };

function fakeCloud() {
  const rows: Row[] = [];
  let tick = 0;
  let offline = false;
  const newest = () => rows.reduce<Row | null>((a, r) => (!a || r.updatedAt > a.updatedAt ? r : a), null);
  const fail = () => {
    if (offline) throw new Error('Network request failed');
  };
  const cloud: CloudBackups = {
    async latest() {
      fail();
      const r = newest();
      return r && { hash: r.hash, updatedAt: r.updatedAt, device: r.device };
    },
    async download() {
      fail();
      const r = newest();
      // Through JSON like the network, so nothing is shared with the uploader's objects.
      return r && { data: JSON.parse(JSON.stringify(r.data)), hash: r.hash };
    },
    async newestSchemaVersion() {
      fail();
      return rows.reduce<number | null>((v, r) => Math.max(v ?? 0, (r.data as Backup).schema_version), null);
    },
    async upload({ backup, hash, device, date }) {
      fail();
      const updatedAt = `2026-10-28T08:00:${String(++tick).padStart(2, '0')}Z`;
      const existing = rows.find((r) => r.date === date);
      const row = { hash, device, date, updatedAt, data: JSON.parse(JSON.stringify(backup)) };
      if (existing) Object.assign(existing, row);
      else rows.push(row);
    },
  };
  return { cloud, rows, setOffline: (v: boolean) => void (offline = v) };
}

function memory(): SyncMemory & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: async (k) => map.get(k) ?? null, setItem: async (k, v) => void map.set(k, v) };
}

async function device() {
  const db = openMemoryDb();
  await migrate(db);
  return { db, mem: memory() };
}

async function recordCmj(db: Awaited<ReturnType<typeof device>>['db'], id: string, value: number) {
  await ensureSession(db, id, 1, 'cmj');
  await addTrial(db, { session_id: id, value });
}

const data = async (db: Awaited<ReturnType<typeof device>>['db']) => (await exportBackup(db)).tables;

describe('syncWithCloud', () => {
  it('backs up the first phone and restores onto a new one after signing in', async () => {
    const { cloud, rows } = fakeCloud();
    const a = await device();
    await recordCmj(a.db, 's1', 45.2);
    expect(await syncWithCloud(a.db, cloud, a.mem, 'u1', 'iPhone')).toEqual({ kind: 'uploaded' });
    expect(rows).toHaveLength(1);

    const b = await device();
    expect(await syncWithCloud(b.db, cloud, b.mem, 'u1', 'iPhone')).toEqual({ kind: 'downloaded' });
    expect(await data(b.db)).toEqual(await data(a.db));
  });

  it('does nothing when nothing changed, so a sync on every app switch costs one small query', async () => {
    const { cloud } = fakeCloud();
    const upload = jest.spyOn(cloud, 'upload');
    const a = await device();
    await recordCmj(a.db, 's1', 45.2);
    await syncWithCloud(a.db, cloud, a.mem, 'u1', 'iPhone');
    expect(await syncWithCloud(a.db, cloud, a.mem, 'u1', 'iPhone')).toEqual({ kind: 'nothing' });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('carries changes both ways between two devices used one after the other', async () => {
    const { cloud } = fakeCloud();
    const a = await device();
    const b = await device();
    await recordCmj(a.db, 's1', 45.2);
    await syncWithCloud(a.db, cloud, a.mem, 'u1', 'iPhone');
    await syncWithCloud(b.db, cloud, b.mem, 'u1', '网页');

    await recordCmj(b.db, 's2', 46.0);
    expect(await syncWithCloud(b.db, cloud, b.mem, 'u1', '网页')).toEqual({ kind: 'uploaded' });
    expect(await syncWithCloud(a.db, cloud, a.mem, 'u1', 'iPhone')).toEqual({ kind: 'downloaded' });
    expect(await data(a.db)).toEqual(await data(b.db));
  });

  it('asks instead of overwriting when both sides have their own changes, then keeps the chosen side', async () => {
    const { cloud } = fakeCloud();
    const a = await device();
    const b = await device();
    await recordCmj(a.db, 's1', 45.2);
    await syncWithCloud(a.db, cloud, a.mem, 'u1', 'iPhone');
    await recordCmj(b.db, 'x1', 40.0);
    await recordCmj(b.db, 'x2', 41.0);
    await createAthlete(b.db, '队友');

    const outcome = await syncWithCloud(b.db, cloud, b.mem, 'u1', 'iPhone');
    expect(outcome).toEqual({ kind: 'conflict', phone: '2 个测试对象、2 次测试、0 次训练', cloud: '1 个测试对象、1 次测试、0 次训练', cloudAt: '2026-10-28T08:00:01Z' });
    expect((await listAthletes(b.db)).map((x) => x.name)).toEqual(['我自己', '队友']); // untouched until the person picks

    expect(await syncWithCloud(b.db, cloud, b.mem, 'u1', 'iPhone', 'cloud')).toEqual({ kind: 'downloaded' });
    expect(await data(b.db)).toEqual(await data(a.db));
  });

  it('keeps the phone when that is the side picked, and the other devices follow', async () => {
    const { cloud } = fakeCloud();
    const a = await device();
    const b = await device();
    await recordCmj(a.db, 's1', 45.2);
    await syncWithCloud(a.db, cloud, a.mem, 'u1', 'iPhone');
    await recordCmj(b.db, 'x1', 40.0);
    expect(await syncWithCloud(b.db, cloud, b.mem, 'u1', 'iPhone', 'phone')).toEqual({ kind: 'uploaded' });
    expect(await syncWithCloud(a.db, cloud, a.mem, 'u1', 'iPhone')).toEqual({ kind: 'downloaded' });
    expect(await data(a.db)).toEqual(await data(b.db));
  });

  it('remembers what was synced per account, so signing in to another account starts over', async () => {
    const { cloud } = fakeCloud();
    const a = await device();
    await recordCmj(a.db, 's1', 45.2);
    await syncWithCloud(a.db, cloud, a.mem, 'u1', 'iPhone');
    const other = fakeCloud();
    await other.cloud.upload({ backup: (await exportBackup((await device()).db)) as Backup, hash: 'someone-else', device: 'iPhone', date: '2026-10-28' });
    expect((await syncWithCloud(a.db, other.cloud, a.mem, 'u2', 'iPhone')).kind).toBe('conflict');
  });

  // A teammate signs in with their own new account on the coach's phone.
  it('asks before backing up a shared phone into the account of whoever signs in on it next', async () => {
    const coach = fakeCloud();
    const player = fakeCloud();
    const phone = await device();
    await recordCmj(phone.db, 's1', 45.2);
    await createAthlete(phone.db, '队友');
    expect(await syncWithCloud(phone.db, coach.cloud, phone.mem, 'coach', 'iPhone')).toEqual({ kind: 'uploaded' });

    expect(await syncWithCloud(phone.db, player.cloud, phone.mem, 'player', 'iPhone')).toEqual({ kind: 'confirm', phone: '2 个测试对象、1 次测试、0 次训练' });
    expect(player.rows).toHaveLength(0);
    expect(await syncWithCloud(phone.db, player.cloud, phone.mem, 'player', 'iPhone', 'phone')).toEqual({ kind: 'uploaded' });
    expect(player.rows).toHaveLength(1);
  });

  it('asks the coach which to keep after a teammate switched the phone to their own data', async () => {
    const coach = fakeCloud();
    const player = fakeCloud();
    const phone = await device();
    await recordCmj(phone.db, 's1', 45.2);
    await syncWithCloud(phone.db, coach.cloud, phone.mem, 'coach', 'iPhone');
    const theirs = await device();
    await recordCmj(theirs.db, 'p1', 38.0);
    await syncWithCloud(theirs.db, player.cloud, theirs.mem, 'player', 'iPhone');

    expect((await syncWithCloud(phone.db, player.cloud, phone.mem, 'player', 'iPhone')).kind).toBe('conflict');
    expect(await syncWithCloud(phone.db, player.cloud, phone.mem, 'player', 'iPhone', 'cloud')).toEqual({ kind: 'downloaded' });
    const coachBackup = coach.rows[0].hash;
    // Back with the coach's account: only the phone changed since the coach's last sync, which used to mean upload.
    expect((await syncWithCloud(phone.db, coach.cloud, phone.mem, 'coach', 'iPhone')).kind).toBe('conflict');
    expect(coach.rows.map((r) => r.hash)).toEqual([coachBackup]);
  });

  // The phone kept the coach's data when the teammate took their own from the cloud, and the coach puts it back.
  it('asks before backing up data put back after a restore, which may be another account’s', async () => {
    const coach = fakeCloud();
    const player = fakeCloud();
    const phone = await device();
    await recordCmj(phone.db, 's1', 45.2);
    await syncWithCloud(phone.db, coach.cloud, phone.mem, 'coach', 'iPhone');
    const theirs = await device();
    await recordCmj(theirs.db, 'p1', 38.0);
    await syncWithCloud(theirs.db, player.cloud, theirs.mem, 'player', 'iPhone');
    await syncWithCloud(phone.db, player.cloud, phone.mem, 'player', 'iPhone', 'cloud');
    const playerBackup = player.rows[0].hash;

    expect(await undoRestore(phone.db)).toEqual({ ok: true });
    expect(await forgetAccount(phone.mem)).toBe(true);
    // Still signed in as the teammate: only the phone changed since their last sync, which used to mean upload.
    expect((await syncWithCloud(phone.db, player.cloud, phone.mem, 'player', 'iPhone')).kind).toBe('conflict');
    expect(player.rows.map((r) => r.hash)).toEqual([playerBackup]);
    // The coach's account already holds that data: nothing to ask, and the phone is the coach's again.
    expect(await syncWithCloud(phone.db, coach.cloud, phone.mem, 'coach', 'iPhone')).toEqual({ kind: 'nothing' });
    await recordCmj(phone.db, 's2', 46.0);
    expect(await syncWithCloud(phone.db, coach.cloud, phone.mem, 'coach', 'iPhone')).toEqual({ kind: 'uploaded' });
  });

  // A phone that never synced holds no account's data but its own, as one that just has data on it.
  it('has nothing to forget on a phone that never synced, which then backs up as it would have', async () => {
    const { cloud, rows } = fakeCloud();
    const phone = await device();
    await recordCmj(phone.db, 's1', 45.2);
    await restoreBackup(phone.db, await exportBackup((await device()).db));
    expect(await undoRestore(phone.db)).toEqual({ ok: true });
    expect(await forgetAccount(phone.mem)).toBe(false);
    expect(await syncWithCloud(phone.db, cloud, phone.mem, 'u1', 'iPhone')).toEqual({ kind: 'uploaded' });
    expect(rows).toHaveLength(1);
  });

  // The person picks a side of what the question showed. Replaced since (a restore, putting back what one replaced),
  // the phone holds other data, which the pick says nothing about: the person is asked again, about that.
  it('applies a pick only to the data it was asked about, and asks again once that was replaced', async () => {
    const { cloud, rows } = fakeCloud();
    const a = await device();
    await recordCmj(a.db, 's1', 45.2);
    await syncWithCloud(a.db, cloud, a.mem, 'u1', 'iPhone');
    const b = await device();
    await recordCmj(b.db, 'x1', 40.0);
    expect((await syncWithCloud(b.db, cloud, b.mem, 'u1', 'iPhone')).kind).toBe('conflict');
    const other = await device();
    await createAthlete(other.db, '别人');
    await restoreBackup(b.db, await exportBackup(other.db));

    expect(await syncWithCloud(b.db, cloud, b.mem, 'u1', 'iPhone', 'phone')).toEqual({ kind: 'conflict', phone: '2 个测试对象、0 次测试、0 次训练', cloud: '1 个测试对象、1 次测试、0 次训练', cloudAt: '2026-10-28T08:00:01Z' });
    expect(rows.map((r) => r.hash)).toEqual([backupHash(await exportBackup(a.db))]);
    expect(await syncWithCloud(b.db, cloud, b.mem, 'u1', 'iPhone', 'phone')).toEqual({ kind: 'uploaded' });
  });

  it('reports a failure without touching anything when offline', async () => {
    const { cloud, setOffline } = fakeCloud();
    const a = await device();
    await recordCmj(a.db, 's1', 45.2);
    setOffline(true);
    expect(await syncWithCloud(a.db, cloud, a.mem, 'u1', 'iPhone')).toEqual({ kind: 'failed', problem: '连不上云端，数据还在手机上，下次打开 App 会再试。' });
    expect(a.mem.map.size).toBe(0);
  });

  // supabase/backups-hardening.sql makes the cloud refuse some writes, which is not the connection being down.
  it('says why the cloud refused a backup instead of blaming the connection', async () => {
    const { cloud } = fakeCloud();
    const a = await device();
    await recordCmj(a.db, 's1', 45.2);
    const refused = async (message: string) => {
      jest.spyOn(cloud, 'upload').mockRejectedValueOnce(new Error(message));
      return syncWithCloud(a.db, cloud, a.mem, 'u1', 'iPhone');
    };
    expect(await refused('new row violates row-level security policy for table "backups"')).toEqual({
      kind: 'failed',
      problem: '云端没有收下这次备份：可能是这台设备的日期不对，或云端已有更新版本 App 的备份。数据还在手机上。',
    });
    expect(await refused('new row for relation "backups" violates check constraint "backups_size"')).toEqual({ kind: 'failed', problem: '这份备份超过云端单份的大小上限，没有上传。数据还在手机上。' });
    expect(a.mem.map.size).toBe(0);
  });

  it('refuses a cloud backup from a newer app and leaves the phone alone', async () => {
    const { cloud } = fakeCloud();
    const a = await device();
    const newer = { ...(await exportBackup(a.db)), schema_version: LATEST_VERSION + 1 };
    await cloud.upload({ backup: newer, hash: 'newer', device: 'iPhone', date: '2026-10-28' });
    const b = await device();
    await recordCmj(b.db, 'x1', 40.0);
    const before = await data(b.db);
    expect(await syncWithCloud(b.db, cloud, b.mem, 'u1', 'iPhone', 'cloud')).toEqual({ kind: 'failed', problem: '这份备份来自更新版本的 App，先更新 App 再恢复。' });
    expect(await data(b.db)).toEqual(before);
  });

  // The newest backup is the one every device compares with. A laptop whose clock runs months ahead dates its backup
  // then (with supabase/backups.sql alone it also stamps the time), so it stays the newest whatever is uploaded later.
  it('keeps what the phone recorded when a device with a wrong clock left a backup dated ahead', async () => {
    const { cloud, rows } = fakeCloud();
    const laptop = await device();
    await recordCmj(laptop.db, 'a', 40.0);
    const ahead = await exportBackup(laptop.db);
    rows.push({ hash: backupHash(ahead), device: '网页', date: '2027-06-01', updatedAt: '2027-06-01T10:00:00Z', data: ahead });

    const phone = await device();
    expect(await syncWithCloud(phone.db, cloud, phone.mem, 'u1', 'iPhone')).toEqual({ kind: 'downloaded' });
    await recordCmj(phone.db, 'b', 47.0);
    const recorded = await data(phone.db);
    const problem = '云端最新的一份不是刚传的这份，可能有设备的日期或时间不对，请检查。数据还在手机上。';
    expect(await syncWithCloud(phone.db, cloud, phone.mem, 'u1', 'iPhone')).toEqual({ kind: 'failed', problem });
    // Opening the app again used to download the laptop's backup over the 47 cm.
    expect(await syncWithCloud(phone.db, cloud, phone.mem, 'u1', 'iPhone')).toEqual({ kind: 'failed', problem });
    expect(await data(phone.db)).toEqual(recorded);
  });

  // An older app (a cached web app, Expo Go before it fetched the update) can't read what a newer one backed up. Asked
  // to keep its own side, it used to replace the cloud's day with data missing the newer tables and columns, and the
  // newer phones then downloaded that over their own.
  it('neither asks nor uploads over a backup from a newer app, which would lose what that app added', async () => {
    const { cloud, rows } = fakeCloud();
    const a = await device();
    await recordCmj(a.db, 's1', 45.2);
    const newer = { ...(await exportBackup(a.db)), schema_version: LATEST_VERSION + 1 };
    await cloud.upload({ backup: newer, hash: backupHash(newer), device: 'iPhone', date: '2026-10-28' });
    const b = await device();
    await recordCmj(b.db, 'x1', 40.0);
    const problem = '云端有更新版本 App 传的备份，这个版本不能覆盖它。先更新 App 再同步，数据还在手机上。';
    expect(await syncWithCloud(b.db, cloud, b.mem, 'u1', 'iPhone')).toEqual({ kind: 'failed', problem });
    expect(await syncWithCloud(b.db, cloud, b.mem, 'u1', 'iPhone', 'phone')).toEqual({ kind: 'failed', problem });
    expect(rows.map((r) => r.hash)).toEqual([backupHash(newer)]);
  });

  it('settles after restoring an older-schema backup instead of downloading it again every time', async () => {
    const { cloud } = fakeCloud();
    const a = await device();
    await recordCmj(a.db, 's1', 45.2);
    const old = await exportBackup(a.db);
    old.schema_version = 4;
    old.tables.athlete = old.tables.athlete.map(({ rim_height_cm: _r, dunk_clearance_cm: _d, ...rest }) => rest);
    await cloud.upload({ backup: old, hash: backupHash(old), device: 'iPhone', date: '2026-10-28' });

    const b = await device();
    expect((await syncWithCloud(b.db, cloud, b.mem, 'u1', 'iPhone')).kind).toBe('downloaded');
    const next = (await syncWithCloud(b.db, cloud, b.mem, 'u1', 'iPhone')).kind;
    expect(['nothing', 'uploaded']).toContain(next);
    expect(await syncWithCloud(b.db, cloud, b.mem, 'u1', 'iPhone')).toEqual({ kind: 'nothing' });
  });
});
