// Drives the backup screen: exporting a file, restoring it onto another phone, and the cloud sign-in states.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Text, TextInput, type AlertButton } from 'react-native';

import { exportBackup } from '@/db/backup';
import { migrate } from '@/db/migrations';
import { addTrial, createAthlete, ensureSession, listAthletes } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';

import BackupScreen from '../backup';

let mockDb = openMemoryDb();
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));

// Files live in a map: what the screen writes for sharing, and what the picker hands back.
const mockFiles = new Map<string, string>();
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    create() {
      mockFiles.set(this.uri, '');
    }
    async write(s: string) {
      mockFiles.set(this.uri, s);
    }
    async text() {
      return mockFiles.get(this.uri) ?? '';
    }
  }
  return { File, Paths: { cache: { uri: 'file:///cache' } } };
});
const mockShare = jest.fn(async (_uri: string, _options?: object) => {});
jest.mock('expo-sharing', () => ({ shareAsync: (uri: string, options?: object) => mockShare(uri, options) }));
let mockPicked: string | null = null;
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: async () => (mockPicked ? { canceled: false, assets: [{ uri: mockPicked, name: 'backup.json' }] } : { canceled: true, assets: null }),
}));

const mockSync = {
  configured: false,
  email: null as string | null,
  busy: false,
  status: null as string | null,
  conflict: null as object | null,
  signIn: jest.fn(async (_e: string, _p: string): Promise<string | null> => null),
  signUp: jest.fn(async (_e: string, _p: string): Promise<string | null> => null),
  signOut: jest.fn(async () => {}),
  syncNow: jest.fn(async () => {}),
  dataReplaced: jest.fn(async () => {}),
  epoch: 0,
};
jest.mock('@/state/sync', () => ({ useSync: () => mockSync, askWhichToKeep: jest.fn() }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

function pressable(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((n) => typeof n.props.onPress === 'function' && (n.props.accessibilityLabel === label || n.findAllByType(Text).some((t) => [t.props.children].flat().includes(label))));
}

function input(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.findAll((n) => n.type === TextInput && n.props.accessibilityLabel === label)[0];
}

async function press(root: ReactTestInstance, label: string) {
  await act(async () => {
    await pressable(root, label).props.onPress();
  });
}

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<BackupScreen />);
  });
  return r;
}

let alerts: { title: string; message?: string | null; buttons?: AlertButton[] }[] = [];
beforeEach(async () => {
  alerts = [];
  jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => void alerts.push({ title: title ?? '', message, buttons }));
  mockFiles.clear();
  mockPicked = null;
  mockShare.mockClear();
  Object.assign(mockSync, { configured: false, email: null, status: null, conflict: null });
  jest.clearAllMocks();
  mockDb = openMemoryDb();
  await migrate(mockDb);
});

async function usedPhone() {
  await createAthlete(mockDb, '队友');
  await ensureSession(mockDb, 's1', 1, 'cmj');
  await addTrial(mockDb, { session_id: 's1', value: 45.2 });
}

it('exports a backup file and restores it onto another phone after confirming', async () => {
  await usedPhone();
  const original = (await exportBackup(mockDb)).tables;
  let r = await render();
  await press(r.root, '导出备份文件');
  expect(mockShare).toHaveBeenCalledTimes(1);
  const [uri, options] = mockShare.mock.calls[0];
  expect(uri).toMatch(/^file:\/\/\/cache\/jump-attack-backup-\d{4}-\d{2}-\d{2}\.json$/);
  expect(options).toMatchObject({ mimeType: 'application/json', UTI: 'public.json' });

  // The new phone.
  mockDb = openMemoryDb();
  await migrate(mockDb);
  mockPicked = uri;
  r = await render();
  await press(r.root, '从备份文件恢复');
  expect(alerts[0].title).toBe('用这份备份替换手机上的数据？');
  expect(alerts[0].message).toContain('备份里：2 个测试对象、1 次测试、0 次训练');
  expect(alerts[0].message).toContain('手机上现在：1 个测试对象、0 次测试、0 次训练');
  expect((await listAthletes(mockDb)).map((a) => a.name)).toEqual(['我自己']); // nothing changes before confirming

  await act(async () => {
    await alerts[0].buttons?.find((b) => b.text === '替换')?.onPress?.();
  });
  expect((await exportBackup(mockDb)).tables).toEqual(original);
  expect(mockSync.dataReplaced).toHaveBeenCalledTimes(1);
  expect(alerts[1].title).toBe('已恢复');
});

it('says what is wrong with a file that is not a backup, and leaves the data alone', async () => {
  mockFiles.set('file:///picked.json', '{"hello": 1}');
  mockPicked = 'file:///picked.json';
  const r = await render();
  await press(r.root, '从备份文件恢复');
  expect(alerts).toEqual([{ title: '没有恢复', message: '这不是 Jump Attack 的备份文件。', buttons: undefined }]);
  expect(mockSync.dataReplaced).not.toHaveBeenCalled();
});

it('does nothing when the picker is cancelled', async () => {
  const r = await render();
  await press(r.root, '从备份文件恢复');
  expect(alerts).toEqual([]);
});

it('explains that the cloud is not set up yet instead of offering a sign-in that cannot work', async () => {
  const r = await render();
  expect(texts(r.root)).toContain('云端还没接好');
  expect(r.root.findAll((n) => n.type === TextInput)).toHaveLength(0);
});

it('signs in with email and password and shows what went wrong', async () => {
  mockSync.configured = true;
  mockSync.signIn.mockResolvedValueOnce('邮箱或密码不对。');
  const r = await render();
  expect(texts(r.root)).toContain('只有你登录后能读');
  await act(async () => {
    input(r.root, '邮箱').props.onChangeText('me@example.com');
    input(r.root, '密码').props.onChangeText('secret1');
  });
  await press(r.root, '登录');
  expect(mockSync.signIn).toHaveBeenCalledWith('me@example.com', 'secret1');
  expect(texts(r.root)).toContain('邮箱或密码不对。');

  await press(r.root, '注册');
  expect(mockSync.signUp).toHaveBeenCalledWith('me@example.com', 'secret1');
});

it('shows the account and sync state once signed in', async () => {
  Object.assign(mockSync, { configured: true, email: 'me@example.com', status: '已备份到云端 · 2026-10-28 09:00' });
  const r = await render();
  expect(texts(r.root)).toContain('me@example.com');
  expect(texts(r.root)).toContain('已备份到云端 · 2026-10-28 09:00');
  await press(r.root, '立即同步');
  expect(mockSync.syncNow).toHaveBeenCalledTimes(1);
  await press(r.root, '退出登录');
  expect(mockSync.signOut).toHaveBeenCalledTimes(1);
});

it('lets the person pick a side of a conflict with plain buttons, which also work on the web', async () => {
  Object.assign(mockSync, {
    configured: true,
    email: 'me@example.com',
    conflict: { kind: 'conflict', phone: '1 个测试对象、3 次测试、0 次训练', cloud: '1 个测试对象、5 次测试、2 次训练', cloudAt: '2026-10-27T20:00:00Z' },
  });
  const r = await render();
  expect(texts(r.root)).toContain('手机上：1 个测试对象、3 次测试、0 次训练');
  expect(texts(r.root)).toContain('云端：1 个测试对象、5 次测试、2 次训练');
  await press(r.root, '用云端的');
  expect(mockSync.syncNow).toHaveBeenLastCalledWith('cloud');
  await press(r.root, '用手机上的');
  expect(mockSync.syncNow).toHaveBeenLastCalledWith('phone');
});
