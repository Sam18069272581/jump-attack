// Two devices and one cloud account, each device a real in-memory database.
import { exportBackup } from '@/db/backup';
import { LATEST_VERSION, migrate } from '@/db/migrations';
import { addTrial, createAthlete, ensureSession, listAthletes } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { backupHash, type Backup } from '@/domain/backup';

import type { CloudBackups, CloudMeta } from '../cloud';
import { syncWithCloud, type SyncMemory } from '../sync';

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

  it('reports a failure without touching anything when offline', async () => {
    const { cloud, setOffline } = fakeCloud();
    const a = await device();
    await recordCmj(a.db, 's1', 45.2);
    setOffline(true);
    expect(await syncWithCloud(a.db, cloud, a.mem, 'u1', 'iPhone')).toEqual({ kind: 'failed', problem: '连不上云端，数据还在手机上，下次打开 App 会再试。' });
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
