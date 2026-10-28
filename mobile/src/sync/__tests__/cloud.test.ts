// Checks the requests the Supabase adapter sends, against supabase/backups.sql, without a network.
import { createClient } from '@supabase/supabase-js';

import type { Backup } from '@/domain/backup';

import { supabaseBackups } from '../cloud';

type Call = { method: string; url: URL; headers: Headers; body: unknown };

function client(reply: unknown) {
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url: new URL(String(input)), headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const c = createClient('https://demo.supabase.co', 'sb_publishable_demo', { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false } });
  return { cloud: supabaseBackups(c, 'user-1'), calls };
}

const backup: Backup = { format: 'jump-attack-backup', schema_version: 7, exported_at: '2026-10-28T08:00:00Z', tables: { athlete: [{ id: 1, name: '我自己' }] } };

it('asks only for the newest backup’s hash when checking, not its data', async () => {
  const { cloud, calls } = client({ hash: 'h1', updated_at: '2026-10-28T08:00:00Z', device: 'iPhone' });
  expect(await cloud.latest()).toEqual({ hash: 'h1', updatedAt: '2026-10-28T08:00:00Z', device: 'iPhone' });
  const { url } = calls[0];
  expect(url.pathname).toBe('/rest/v1/backups');
  expect(url.searchParams.get('select')).toBe('hash,updated_at,device');
  expect(url.searchParams.get('order')).toBe('updated_at.desc');
  expect(url.searchParams.get('limit')).toBe('1');
});

it('reads no backup as null', async () => {
  const { cloud } = client(null);
  expect(await cloud.latest()).toBeNull();
});

it('replaces the day’s row for this account on upload', async () => {
  const { cloud, calls } = client(null);
  await cloud.upload({ backup, hash: 'h2', device: 'iPhone', date: '2026-10-28' });
  const { method, url, headers, body } = calls[0];
  expect(method).toBe('POST');
  expect(url.searchParams.get('on_conflict')).toBe('user_id,backup_date');
  expect(headers.get('Prefer')).toContain('resolution=merge-duplicates');
  expect(body).toMatchObject({ user_id: 'user-1', backup_date: '2026-10-28', device: 'iPhone', schema_version: 7, hash: 'h2', data: backup });
});

it('turns a server error into a thrown error for sync to report', async () => {
  const calls: unknown[] = [];
  const fetch = async () => {
    calls.push(1);
    return new Response(JSON.stringify({ message: 'permission denied for table backups', code: '42501' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  };
  const c = createClient('https://demo.supabase.co', 'k', { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false } });
  await expect(supabaseBackups(c, 'u').latest()).rejects.toThrow('permission denied');
});
