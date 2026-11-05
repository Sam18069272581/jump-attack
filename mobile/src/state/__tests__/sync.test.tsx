// The sync provider on a new phone: opening the app signed in restores the cloud backup, and a phone
// with its own data asks first. Real in-memory database, fake Supabase auth and cloud.
import { useEffect } from 'react';
import { act, create } from 'react-test-renderer';
import { Alert, AppState, type AlertButton } from 'react-native';

import { exportBackup, restoreBackup, undoRestore } from '@/db/backup';
import { migrate } from '@/db/migrations';
import { addTrial, createAthlete, ensureSession, listAthletes } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { backupHash as mockHash, type Backup } from '@/domain/backup';
import type { CloudBackups } from '@/sync/cloud';

import { SyncProvider, useSync } from '../sync';

let mockDb = openMemoryDb();
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
const mockKv = new Map<string, string>();
// Set while the phone can't write anything down, e.g. with its storage full.
let mockKvFull = false;
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockKv.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      if (mockKvFull) throw new Error('database or disk is full');
      mockKv.set(k, v);
    },
    removeItem: async (k: string) => void mockKv.delete(k),
  },
}));

let mockCloudBackup: Backup | null = null;
// While set, the cloud doesn't answer yet: a sync on a slow network.
let mockSlow: Promise<void> | null = null;
const mockLatest = jest.fn();
const mockUpload = jest.fn();
jest.mock('@/sync/cloud', () => ({
  supabaseBackups: (): CloudBackups => ({
    latest: async () => {
      mockLatest();
      await mockSlow;
      return mockCloudBackup && { hash: mockHash(mockCloudBackup), updatedAt: '2026-10-27T20:00:00Z', device: 'iPhone' };
    },
    download: async () => mockCloudBackup && { data: JSON.parse(JSON.stringify(mockCloudBackup)), hash: mockHash(mockCloudBackup) },
    newestSchemaVersion: async () => mockCloudBackup?.schema_version ?? null,
    upload: async (b) => void mockUpload(b),
  }),
}));
const mockAuth = {
  onAuthStateChange: (cb: (event: string, s: unknown) => void) => {
    cb('INITIAL_SESSION', { user: { id: 'u1', email: 'me@example.com' } });
    return { data: { subscription: { unsubscribe: () => {} } } };
  },
  startAutoRefresh: jest.fn(),
  stopAutoRefresh: jest.fn(),
};
const mockSupabase = { auth: mockAuth };
jest.mock('@/sync/client', () => ({ getSupabase: () => mockSupabase, authProblem: (m: string) => m }));

const probe: { seen: ReturnType<typeof useSync> | null; mounts: number } = { seen: null, mounts: 0 };
function Probe() {
  useEffect(() => {
    probe.mounts += 1;
  }, []);
  const value = useSync();
  useEffect(() => {
    probe.seen = value;
  });
  return null;
}

async function open() {
  await act(async () => {
    create(
      <SyncProvider>
        <Probe />
      </SyncProvider>,
    );
  });
  // Let the deferred first sync run.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

async function phoneWithData() {
  const db = openMemoryDb();
  await migrate(db);
  await createAthlete(db, '队友');
  await ensureSession(db, 's1', 1, 'cmj');
  await addTrial(db, { session_id: 's1', value: 45.2 });
  return db;
}

let alerts: { title: string; buttons?: AlertButton[] }[] = [];
beforeEach(async () => {
  alerts = [];
  jest.spyOn(Alert, 'alert').mockImplementation((title, _m, buttons) => void alerts.push({ title: title ?? '', buttons }));
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: () => {} } as ReturnType<typeof AppState.addEventListener>);
  mockKv.clear();
  mockKvFull = false;
  mockSlow = null;
  mockLatest.mockClear();
  mockUpload.mockClear();
  probe.mounts = 0;
  mockDb = openMemoryDb();
  await migrate(mockDb);
});

it('restores the cloud backup on a new phone as soon as the app opens signed in, and remounts every screen', async () => {
  mockCloudBackup = await exportBackup(await phoneWithData());
  await open();
  expect((await listAthletes(mockDb)).map((a) => a.name)).toEqual(['我自己', '队友']);
  expect(probe.seen?.email).toBe('me@example.com');
  expect(probe.seen?.status).toMatch(/^已从云端恢复 · /);
  expect(probe.seen?.epoch).toBe(1);
  expect(probe.mounts).toBe(2); // remounted, so screens below read the restored data
  expect(alerts).toEqual([]);
});

it('backs up a phone whose account has nothing in the cloud yet', async () => {
  mockCloudBackup = null;
  mockDb = await phoneWithData();
  await open();
  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(probe.seen?.status).toMatch(/^已备份到云端 · /);
});

it('asks once which side to keep when the phone already has other data, and does what is picked', async () => {
  mockCloudBackup = await exportBackup(await phoneWithData());
  await ensureSession(mockDb, 'mine', 1, 'sj');
  await addTrial(mockDb, { session_id: 'mine', value: 30 });
  await open();
  expect(alerts.map((a) => a.title)).toEqual(['手机和云端的数据不一样']);
  expect(probe.seen?.conflict).toMatchObject({ phone: '1 个测试对象、1 次测试、0 次训练', cloud: '2 个测试对象、1 次测试、0 次训练' });

  await act(async () => {
    await probe.seen?.syncNow(); // e.g. coming back to the app: still open, no second prompt
  });
  expect(alerts).toHaveLength(1);

  await act(async () => {
    alerts[0].buttons?.find((b) => b.text === '用云端的')?.onPress?.();
    await new Promise((r) => setTimeout(r, 20));
  });
  expect((await listAthletes(mockDb)).map((a) => a.name)).toEqual(['我自己', '队友']);
  expect(probe.seen?.conflict).toBeNull();
});

it('asks before backing up a phone last synced with another account into this one, and backs up when told to', async () => {
  mockCloudBackup = null;
  mockDb = await phoneWithData();
  mockKv.set('sync-account', 'someone-else');
  await open();
  expect(alerts.map((a) => a.title)).toEqual(['这台手机上的数据之前同步到另一个账号']);
  expect(probe.seen?.confirm).toMatchObject({ phone: '2 个测试对象、1 次测试、0 次训练' });
  expect(mockUpload).not.toHaveBeenCalled();

  await act(async () => {
    alerts[0].buttons?.find((b) => b.text === '备份到这个账号')?.onPress?.();
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(probe.seen?.confirm).toBeNull();
});

// The backup page replaces the data (from a file, or putting back what a restore replaced) while a sync may be running:
// that sync would read the data half replaced, or download over it.
describe('replacing the data', () => {
  /** Signed in and backed up once, so the phone is remembered as this account's. */
  async function syncedPhone() {
    mockCloudBackup = null;
    mockDb = await phoneWithData();
    await open();
    expect(mockKv.get('sync-account')).toBe('u1');
    mockUpload.mockClear();
    mockLatest.mockClear();
  }

  async function theirs() {
    const db = openMemoryDb();
    await migrate(db);
    await createAthlete(db, '别人');
    return exportBackup(db);
  }

  const settle = () => new Promise((r) => setTimeout(r, 20));

  it('waits for the sync that is running, and no sync runs until it is done', async () => {
    await syncedPhone();
    let answer!: () => void;
    mockSlow = new Promise((r) => (answer = r));
    const steps: string[] = [];
    let finish!: () => void;
    await act(async () => {
      const syncing = probe.seen!.syncNow();
      const replacing = probe.seen!.replaceData(async () => {
        steps.push('restore');
        await new Promise<void>((r) => (finish = r));
        return { ok: true };
      });
      await settle();
      expect(steps).toEqual([]); // the sync still waits for the cloud
      answer();
      await syncing;
      await settle();
      expect(steps).toEqual(['restore']);
      const asked = mockLatest.mock.calls.length;
      await probe.seen!.syncNow(); // e.g. the app going to the background meanwhile
      expect(mockLatest).toHaveBeenCalledTimes(asked);
      finish();
      await replacing;
    });
    expect(probe.seen?.busy).toBe(false);
  });

  it('has the next sync ask before backing up what it puts back, which may be another account’s', async () => {
    await syncedPhone();
    await act(async () => {
      const other = await theirs();
      expect(await probe.seen!.replaceData(() => restoreBackup(mockDb, other))).toEqual({ ok: true, asks: false });
    });
    expect(mockKv.get('sync-account')).toBe('u1');
    await act(async () => {
      expect(await probe.seen!.replaceData(() => undoRestore(mockDb), true)).toEqual({ ok: true, asks: true });
    });
    await act(async () => {
      await probe.seen!.syncNow();
    });
    expect(alerts.map((a) => a.title)).toEqual(['这台手机上的数据之前同步到另一个账号']);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('drops a question about the data it replaced, and asks again about what is on the phone now', async () => {
    mockCloudBackup = await exportBackup(await phoneWithData());
    await ensureSession(mockDb, 'mine', 1, 'sj');
    await addTrial(mockDb, { session_id: 'mine', value: 30 });
    await open();
    expect(alerts.map((a) => a.title)).toEqual(['手机和云端的数据不一样']);
    await act(async () => {
      const other = await theirs();
      await probe.seen!.replaceData(() => restoreBackup(mockDb, other));
    });
    expect(probe.seen?.conflict).toBeNull();
    expect(probe.seen?.status).toBeNull();

    // The alert still on screen asked about the data replaced: its answer says nothing about the data now.
    await act(async () => {
      alerts[0].buttons?.find((b) => b.text === '用手机上的')?.onPress?.();
      await settle();
    });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(alerts.map((a) => a.title)).toEqual(['手机和云端的数据不一样', '手机和云端的数据不一样']);
    expect(probe.seen?.conflict).toMatchObject({ phone: '2 个测试对象、0 次测试、0 次训练' });
  });

  it('changes nothing, and says why, when the phone can’t note that the data may be another account’s', async () => {
    await syncedPhone();
    mockKvFull = true;
    const restore = jest.fn(async () => ({ ok: true as const }));
    await act(async () => {
      expect(await probe.seen!.replaceData(restore, true)).toEqual({ ok: false, problem: 'database or disk is full', asks: false });
    });
    expect(restore).not.toHaveBeenCalled();
    expect(probe.seen?.busy).toBe(false);
    mockKvFull = false;
    await act(async () => {
      await probe.seen!.syncNow();
    });
    expect(mockLatest).toHaveBeenCalled();
  });
});
